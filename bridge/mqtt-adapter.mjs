#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { MqttClient } from '../probes/lib/mqtt.mjs';
import { parseBroker, required, validatePrefix } from '../probes/lib/safety.mjs';
import { sign } from './lib/auth.mjs';
import { readKeychainSecret } from './lib/keychain.mjs';
import { BridgeError } from './lib/state.mjs';
import { KEYCHAIN_SERVICE } from './server.mjs';

const MAX_BODY_BYTES = 4096;

export function validateBridgeUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new BridgeError('ALARM invalid BRIDGE_URL', 500); }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/focus') {
    throw new BridgeError('ALARM BRIDGE_URL must be a local http://127.0.0.1.../focus URL', 500);
  }
  return url.toString();
}

export function validateEventTopic(value) {
  const topic = validatePrefix(value);
  if (!topic.includes('/')) throw new BridgeError('ALARM MQTT_EVENT_TOPIC must be an exact topic path', 500);
  return topic;
}

/**
 * MQTT is only the transport from TC002 to the Mac. The adapter re-signs the
 * unchanged JSON body before handing it to the already hardened local bridge.
 */
export async function forwardMqttEvent({
  topic,
  payload,
  eventTopic,
  secret,
  bridgeUrl,
  now = Math.floor(Date.now() / 1000),
  fetchImpl = fetch
}) {
  if (topic !== eventTopic) return { forwarded: false, reason: 'topic_mismatch' };
  if (!Buffer.isBuffer(payload)) payload = Buffer.from(payload);
  if (payload.length === 0 || payload.length > MAX_BODY_BYTES) {
    throw new BridgeError('ALARM MQTT event body must be 1..4096 bytes');
  }
  const rawBody = payload.toString('utf8');
  if (!Buffer.from(rawBody, 'utf8').equals(payload)) throw new BridgeError('ALARM MQTT event body must be UTF-8');
  let parsed;
  try { parsed = JSON.parse(rawBody); } catch { throw new BridgeError('ALARM MQTT event body is not valid JSON'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new BridgeError('ALARM MQTT event body must be a JSON object');
  }
  if (typeof secret !== 'string' || secret.length < 16) {
    throw new BridgeError('ALARM MQTT adapter shared secret must be at least 16 chars', 500);
  }
  const target = validateBridgeUrl(bridgeUrl);
  const timestamp = String(now);
  const response = await fetchImpl(target, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-tc002-timestamp': timestamp,
      'x-tc002-signature': sign(secret, timestamp, rawBody)
    },
    body: rawBody
  });
  if (!response.ok) throw new BridgeError(`ALARM local bridge rejected MQTT event with HTTP ${response.status}`);
  return { forwarded: true, status: response.status };
}

export function createMqttAdapter({ mqtt, eventTopic, secret, bridgeUrl, clock, fetchImpl = fetch, log = console.log }) {
  const exactTopic = validateEventTopic(eventTopic);
  let chain = Promise.resolve();
  mqtt.onPublish(({ topic, payload }) => {
    chain = chain.then(async () => {
      try {
        const result = await forwardMqttEvent({
          topic, payload, eventTopic: exactTopic, secret, bridgeUrl,
          now: clock ? clock() : Math.floor(Date.now() / 1000), fetchImpl
        });
        if (result.forwarded) log(JSON.stringify({ event: 'mqtt_event_forwarded', bytes: payload.length, status: result.status }));
      } catch (error) {
        log(JSON.stringify({ event: 'mqtt_event_rejected', error: error.message }));
      }
    });
  });
  return {
    async start() { await mqtt.connect(); await mqtt.subscribe(exactTopic); return { topic: exactTopic }; },
    async idle() { await chain; },
    close() { mqtt.close(); }
  };
}

async function main() {
  const broker = parseBroker(required('MQTT_BROKER'));
  const eventTopic = validateEventTopic(required('MQTT_EVENT_TOPIC'));
  const secret = process.env.BRIDGE_SHARED_SECRET?.trim()
    || readKeychainSecret({ service: KEYCHAIN_SERVICE, account: 'shared_secret' });
  const bridgeUrl = validateBridgeUrl(process.env.BRIDGE_URL?.trim() || 'http://127.0.0.1:8787/focus');
  const mqtt = new MqttClient({ ...broker, clientId: `tc002-lark-adapter-${process.pid}` });
  mqtt.onDisconnect(({ hadError }) => {
    console.error(JSON.stringify({ event: 'mqtt_adapter_disconnected', had_error: Boolean(hadError) }));
    process.exitCode = 2;
    setImmediate(() => process.exit(2));
  });
  const adapter = createMqttAdapter({ mqtt, eventTopic, secret, bridgeUrl });
  await adapter.start();
  console.log(JSON.stringify({ event: 'mqtt_adapter_ready', broker: 'configured', topic: 'configured', bridge: 'local' }));
  const stop = reason => { adapter.close(); console.log(JSON.stringify({ event: 'mqtt_adapter_stopped', reason })); };
  process.once('SIGINT', () => stop('SIGINT'));
  process.once('SIGTERM', () => stop('SIGTERM'));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error.message.startsWith('ALARM') ? error.message : `ALARM MQTT adapter failed: ${error.message}`);
    process.exitCode = 2;
  });
}
