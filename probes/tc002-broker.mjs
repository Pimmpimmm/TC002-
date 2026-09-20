#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { createRequire } from 'node:module';
import { createServer, isIP } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProbeError, exitOnError, maskHost, redactTopic, required, topicMatchesConfiguredPrefix, validatePrefix } from './lib/safety.mjs';

export function parseBrokerPort(value = '1883') {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new ProbeError('ALARM BROKER_PORT must be an integer from 1024 to 65535');
  }
  return port;
}

export function parseBrokerSeconds(value = '600') {
  const seconds = Number(value);
  if (!Number.isInteger(seconds) || seconds < 5 || seconds > 900) {
    throw new ProbeError('ALARM BROKER_SECONDS must be an integer from 5 to 900');
  }
  return seconds;
}

export function assertLocalBindHost(host, interfaces = networkInterfaces()) {
  if (!isIP(host)) throw new ProbeError('ALARM BROKER_HOST must be a literal IP address assigned to this Mac');
  if (host === '127.0.0.1' || host === '::1') return host;
  const localAddresses = Object.values(interfaces).flat().filter(Boolean).map(item => item.address);
  if (!localAddresses.includes(host)) {
    throw new ProbeError('ALARM BROKER_HOST is not assigned to a local network interface');
  }
  return host;
}

export function hasNonEmptyCredential(value) {
  return value != null && Buffer.byteLength(value) > 0;
}

async function main() {
  const host = assertLocalBindHost(required('BROKER_HOST'));
  const port = parseBrokerPort(process.env.BROKER_PORT);
  const seconds = parseBrokerSeconds(process.env.BROKER_SECONDS);
  const prefix = validatePrefix(required('MQTT_PREFIX'));
  const probesDir = path.dirname(fileURLToPath(import.meta.url));
  const runtimeDir = process.env.AEDES_RUNTIME_DIR?.trim() || path.join(probesDir, '.runtime');

  let Aedes;
  try {
    ({ Aedes } = createRequire(path.join(runtimeDir, 'package.json'))('aedes'));
  } catch {
    throw new ProbeError('ALARM broker runtime missing; run npm run probe:broker:install');
  }

  const broker = await Aedes.createBroker({ drainTimeout: 10_000, maxClientsIdLength: 128 });
  const safeError = error => {
    const message = String(error?.message || '');
    const category = /client.?id|identifier/i.test(message) ? 'client-id'
      : /protocol|version/i.test(message) ? 'protocol'
        : /auth|credential|password|username/i.test(message) ? 'auth'
          : /topic|publish|subscribe/i.test(message) ? 'topic'
            : 'other';
    return { category, code: error?.code || 'unspecified', message_sha256: createHash('sha256').update(message).digest('hex') };
  };
  broker.authenticate = (_client, username, password, callback) => {
    if (hasNonEmptyCredential(username) || hasNonEmptyCredential(password)) {
      return callback(new Error('non-empty credentials are disabled for this short private probe'), false);
    }
    callback(null, true);
  };
  broker.authorizePublish = (_client, packet, callback) => {
    if (!topicMatchesConfiguredPrefix(packet.topic, prefix) || packet.topic.startsWith('$SYS/')) {
      return callback(new Error('publish outside the configured literal prefix'));
    }
    callback(null);
  };
  broker.authorizeSubscribe = (client, subscription, callback) => {
    const gatedCapture = client?.id?.startsWith('tc002-probe-') && subscription.topic === '#';
    if (!gatedCapture && (!topicMatchesConfiguredPrefix(subscription.topic, prefix) || subscription.topic.startsWith('$SYS/'))) {
      return callback(new Error('subscription outside the configured literal prefix'));
    }
    callback(null, subscription);
  };
  broker.authorizeForward = (_client, packet) => topicMatchesConfiguredPrefix(packet.topic, prefix) ? packet : null;

  broker.on('clientReady', client => {
    console.log(JSON.stringify({ at: new Date().toISOString(), event: 'client_connected', remote: maskHost(client.conn.remoteAddress || '') }));
  });
  broker.on('client', client => {
    console.log(JSON.stringify({ at: new Date().toISOString(), event: 'client_authenticated', remote: maskHost(client.conn.remoteAddress || '') }));
  });
  broker.on('clientDisconnect', client => {
    console.log(JSON.stringify({ at: new Date().toISOString(), event: 'client_disconnected', remote: maskHost(client.conn.remoteAddress || '') }));
  });
  broker.on('connectionError', (client, error) => {
    console.error(JSON.stringify({ at: new Date().toISOString(), event: 'connection_error', remote: maskHost(client?.conn?.remoteAddress || ''), ...safeError(error) }));
  });
  broker.on('clientError', (client, error) => {
    console.error(JSON.stringify({ at: new Date().toISOString(), event: 'client_error', remote: maskHost(client?.conn?.remoteAddress || ''), ...safeError(error) }));
  });
  broker.on('subscribe', (subscriptions, client) => {
    const topics = subscriptions
      .map(subscription => subscription.topic)
      .filter(topic => topicMatchesConfiguredPrefix(topic, prefix))
      .map(topic => redactTopic(topic, prefix));
    if (topics.length) console.log(JSON.stringify({ at: new Date().toISOString(), event: 'subscribe', remote: maskHost(client?.conn?.remoteAddress || ''), topics }));
  });
  broker.on('publish', (packet, client) => {
    if (!client || !topicMatchesConfiguredPrefix(packet.topic, prefix)) return;
    console.log(JSON.stringify({
      at: new Date().toISOString(),
      event: 'publish',
      topic: redactTopic(packet.topic, prefix),
      qos: packet.qos,
      retain: Boolean(packet.retain),
      bytes: packet.payload.length,
      sha256: createHash('sha256').update(packet.payload).digest('hex')
    }));
  });

  const server = createServer(broker.handle);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  console.log(JSON.stringify({ event: 'broker_ready', bind: `${maskHost(host)}:${port}`, topic: '[PREFIX]/#', seconds, credentials: 'disabled', payload_logging: 'hash-and-size-only' }));

  let closing = false;
  const close = async reason => {
    if (closing) return;
    closing = true;
    await broker.close();
    await new Promise(resolve => server.close(resolve));
    console.log(JSON.stringify({ event: 'broker_stopped', reason }));
  };
  process.once('SIGINT', () => { close('SIGINT').catch(exitOnError); });
  process.once('SIGTERM', () => { close('SIGTERM').catch(exitOnError); });
  await new Promise(resolve => setTimeout(resolve, seconds * 1000));
  await close('duration_elapsed');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(exitOnError);
}
