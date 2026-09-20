import net from 'node:net';
import { createHash } from 'node:crypto';

export class ProbeError extends Error {
  constructor(message, exitCode = 2) {
    super(message);
    this.exitCode = exitCode;
  }
}

export function required(name, env = process.env) {
  const value = env[name]?.trim();
  if (!value) throw new ProbeError(`ALARM missing required ${name}`);
  return value;
}

export function validatePrefix(value) {
  if (!/^[A-Za-z0-9_.\/-]+$/.test(value) || value.includes('#') || value.includes('+')) {
    throw new ProbeError('ALARM MQTT_PREFIX must be a literal topic prefix without wildcards');
  }
  return value.replace(/\/$/, '');
}

export function parseBroker(value) {
  const raw = value.includes('://') ? value : `mqtt://${value}`;
  const url = new URL(raw);
  if (url.protocol !== 'mqtt:') throw new ProbeError('ALARM only mqtt:// is supported');
  if (url.username || url.password) throw new ProbeError('ALARM credentials in MQTT_BROKER are forbidden; use broker ACL outside probe logs');
  return { host: url.hostname, port: Number(url.port || 1883) };
}

export function validateIpOrHost(value) {
  if (net.isIP(value)) return value;
  if (!/^[A-Za-z0-9.-]+$/.test(value)) throw new ProbeError('ALARM invalid device host');
  return value;
}

export function redactString(value) {
  return String(value)
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [REDACTED]')
    .replace(/(token|secret|password|authorization)(["'\s:=]+)[^,"'\s}]+/gi, '$1$2[REDACTED]')
    .replace(/\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b/g, '[MAC-REDACTED]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[IP-REDACTED]')
    .replace(/\b[A-Z0-9]{10,}\b/g, '[IDENTIFIER-REDACTED]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL-REDACTED]');
}

export function redactJson(value) {
  if (Array.isArray(value)) return value.map(redactJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      /(token|secret|password|authorization|sender|author|content|body|message|mac|serial|device.?id|user.?id|client.?id)/i.test(key)
        ? '[REDACTED]'
        : redactJson(item)
    ]));
  }
  return typeof value === 'string' ? redactString(value) : value;
}

export function safePayload(buffer) {
  const text = buffer.toString('utf8');
  if (Buffer.from(text, 'utf8').equals(buffer)) {
    try { return { encoding: 'json', value: redactJson(JSON.parse(text)) }; }
    catch { return { encoding: 'utf8', value: redactString(text) }; }
  }
  return {
    encoding: 'binary',
    bytes: buffer.length,
    sha256: createHash('sha256').update(buffer).digest('hex'),
    warning: 'binary payload omitted to prevent opaque content/credential persistence'
  };
}

export function redactTopic(topic, prefix) {
  const normalized = validatePrefix(prefix);
  if (topic === normalized || topic.startsWith(`${normalized}/`)) {
    return `[PREFIX]${redactString(topic.slice(normalized.length))}`;
  }
  const derived = topic.slice(normalized.length).match(/^_([A-Za-z0-9-]{1,64})(\/.*)?$/);
  if (derived) return `[PREFIX]_[DEVICE]${redactString(derived[2] || '')}`;
  throw new ProbeError('ALARM broker delivered a topic outside the requested literal or device-derived prefix');
}

export function topicMatchesConfiguredPrefix(topic, prefix) {
  try { redactTopic(topic, prefix); return true; }
  catch { return false; }
}

export function assertLiteralNotification(payload) {
  let literalCount = 0;
  const safeStructuralValue = /^(?:#[0-9A-Fa-f]{3,8}|left|right|center|top|bottom|middle|start|end|none|true|false|\d+(?:\.\d+)?)$/;
  function visit(value, key = '') {
    if (Array.isArray(value)) return value.forEach(item => visit(item, key));
    if (value && typeof value === 'object') {
      for (const [childKey, child] of Object.entries(value)) {
        if (/(sender|author|from|user|chat|mention|email|phone)/i.test(childKey)) {
          throw new ProbeError(`ALARM prohibited identity/routing field in notify payload: ${childKey}`);
        }
        visit(child, childKey);
      }
      return;
    }
    if (typeof value !== 'string') return;
    if (value === '有新消息') { literalCount += 1; return; }
    if (safeStructuralValue.test(value)) return;
    throw new ProbeError(`ALARM notify string at ${key || '<root>'} must be the literal 有新消息 or a safe structural value`);
  }
  visit(payload);
  if (literalCount !== 1) throw new ProbeError('ALARM notify payload must contain the literal 有新消息 exactly once');
}

export function maskHost(host) {
  if (net.isIP(host) === 4) return host.replace(/\.\d+$/, '.x');
  if (net.isIP(host) === 6) return '[ipv6-redacted]';
  const parts = host.split('.');
  return parts.length > 2 ? `*.${parts.slice(-2).join('.')}` : '[host-redacted]';
}

export function exitOnError(error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message.startsWith('ALARM') ? message : `ALARM unexpected probe failure: ${message}`);
  process.exitCode = error.exitCode || 1;
}

export const CREDENTIAL_ENV_NAMES = ['LARK_USER_ACCESS_TOKEN', 'LARK_REFRESH_TOKEN', 'LARK_APP_SECRET', 'LARK_TENANT_ACCESS_TOKEN'];

export function assertNoCredentialEnv(env = process.env) {
  const forbidden = CREDENTIAL_ENV_NAMES.filter(name => env[name]?.trim());
  if (forbidden.length) throw new ProbeError(`ALARM dry-run refuses credential variables: ${forbidden.join(', ')}`);
}
