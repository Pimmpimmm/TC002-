#!/usr/bin/env node
import { appendFile } from 'node:fs/promises';
import { MqttClient } from './lib/mqtt.mjs';
import { assertLiteralNotification, exitOnError, parseBroker, ProbeError, redactJson, required, safePayload } from './lib/safety.mjs';

try {
  const mode = required('TC002_NOTIFY_MODE');
  const duration = Number(required('TC002_NOTIFY_DURATION_SECONDS'));
  if (!(duration > 0 && duration <= 5)) throw new ProbeError('ALARM notify duration must be >0 and <=5 seconds');
  const raw = required('TC002_NOTIFY_PAYLOAD_JSON');
  let payload; try { payload = JSON.parse(raw); } catch { throw new ProbeError('ALARM payload is not valid JSON'); }
  assertLiteralNotification(payload);
  const serialized = JSON.stringify(payload);
  if (serialized.length > 2048) throw new ProbeError('ALARM payload exceeds 2048 bytes');
  if (/(sender|author|chat正文|message_text)/i.test(serialized)) throw new ProbeError('ALARM payload appears to contain sender/content data');
  const execute = process.argv.includes('--execute');
  if (!execute) {
    const target = mode === 'http' ? required('TC002_NOTIFY_URL') : required('TC002_NOTIFY_TOPIC');
    console.log(JSON.stringify({ dry_run: true, mode, target: mode === 'http' ? '[device-url-redacted]' : '[TOPIC-REDACTED]', duration_seconds: duration, payload: redactJson(payload), required_visual_proof: ['immediate overlay', '<=5s visible', 'automatic return to exact prior screen', 'settings unchanged'] }, null, 2));
    process.exit(0);
  }
  if (required('TC002_ACK_DEVICE_TEST') !== 'YES') throw new ProbeError('ALARM set TC002_ACK_DEVICE_TEST=YES only while filming the permitted device test');
  const result = { at: new Date().toISOString(), mode, duration_seconds: duration, payload: redactJson(payload) };
  if (mode === 'http') {
    const response = await fetch(required('TC002_NOTIFY_URL'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw, signal: AbortSignal.timeout(5000) });
    const responseBody = Buffer.from(await response.arrayBuffer());
    result.http_status = response.status; result.response = safePayload(responseBody.subarray(0, 4096));
    if (!response.ok) throw new ProbeError(`ALARM HTTP status ${response.status}`);
  } else if (mode === 'mqtt') {
    const mqtt = new MqttClient(parseBroker(required('MQTT_BROKER'))); await mqtt.connect();
    const topic = required('TC002_NOTIFY_TOPIC');
    mqtt.publish(topic, raw); mqtt.close(); result.publish = 'qos0-written'; result.topic = '[TOPIC-REDACTED]';
  } else throw new ProbeError('ALARM TC002_NOTIFY_MODE must be http or mqtt');
  await appendFile(new URL('../research/tc002-notify-results.redacted.jsonl', import.meta.url), `${JSON.stringify(result)}\n`);
  console.log('request sent; PASS requires filmed <=5s auto-return and settings comparison; otherwise mark FAIL');
} catch (error) { exitOnError(error); }
