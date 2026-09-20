#!/usr/bin/env node
import { appendFile, writeFile } from 'node:fs/promises';
import { MqttClient } from './lib/mqtt.mjs';
import { exitOnError, maskHost, parseBroker, redactTopic, required, safePayload, validatePrefix } from './lib/safety.mjs';

const output = new URL('../research/tc002-events.redacted.jsonl', import.meta.url);
const checklist = [
  'T+00 开始录屏；镜头同时包含 TC002 与可校时秒表，记录固件/Studio 版本和当前原界面',
  'T+10 中间实体键短按一次，确认进入原生 BUSY Clock',
  'T+25 中间实体键短按一次，确认退出并回原界面',
  'T+40 中间实体键短按一次，再次进入原生 BUSY Clock',
  'T+55 旋钮转一格切走 BUSY，随后不再操作',
  'T+70 确认原界面和长期设置未变化',
  'T+90 捕获结束；保留原始画面，本文件只保存脱敏 MQTT 帧'
];

try {
  const broker = parseBroker(required('MQTT_BROKER'));
  const prefix = validatePrefix(required('MQTT_PREFIX'));
  const derivedPrefix = process.env.TC002_DERIVED_PREFIX === 'YES';
  if (process.env.TC002_DERIVED_PREFIX && !derivedPrefix) throw new Error('ALARM TC002_DERIVED_PREFIX, when set, must equal YES');
  const topicFilter = derivedPrefix ? '#' : `${prefix}/#`;
  const seconds = Number(process.env.CAPTURE_SECONDS || 90);
  if (seconds !== 90) throw new Error('ALARM CAPTURE_SECONDS must be exactly 90 for the required evidence sequence');
  console.log(JSON.stringify({ broker: `${maskHost(broker.host)}:${broker.port}`, topic: derivedPrefix ? '[BROKER-GATED PREFIX OR PREFIX_[DEVICE]]' : '[PREFIX]/#', seconds, checklist }, null, 2));
  if (process.argv.includes('--check')) process.exit(0);
  let started = 0; let count = 0; const writes = new Set(); const writeErrors = [];
  const mqtt = new MqttClient(broker);
  mqtt.onPublish(({ topic, payload }) => {
    count += 1; const elapsed = (Date.now() - started) / 1000;
    const phase = elapsed < 10 ? 'setup' : elapsed < 25 ? 'enter_busy' : elapsed < 40 ? 'exit_busy' : elapsed < 70 ? 'enter_then_rotate_away' : 'settle';
    const write = appendFile(output, `${JSON.stringify({ received_at: new Date().toISOString(), elapsed_seconds: Number(elapsed.toFixed(3)), phase, topic: redactTopic(topic, prefix), payload: safePayload(payload) })}\n`)
      .catch(error => { writeErrors.push(error); })
      .finally(() => writes.delete(write));
    writes.add(write);
  });
  await mqtt.connect();
  await writeFile(output, '');
  started = Date.now();
  await mqtt.subscribe(topicFilter);
  console.log(`capture_started=${new Date(started).toISOString()} duration_seconds=${seconds}`);
  await new Promise(resolve => setTimeout(resolve, seconds * 1000)); mqtt.close();
  await Promise.all(writes);
  if (writeErrors.length) throw new Error(`ALARM failed to persist ${writeErrors.length} captured MQTT frame(s): ${writeErrors[0].message}`);
  if (!count) {
    await appendFile(output, `${JSON.stringify({ type: 'capture_status', captured_at: new Date().toISOString(), verified: false, reason: 'zero MQTT publishes captured; native BUSY event remains UNVERIFIED' })}\n`);
    console.error('ALARM zero MQTT publishes captured; native BUSY event remains UNVERIFIED'); process.exitCode = 3;
  }
  else console.log(`captured=${count} output=research/tc002-events.redacted.jsonl; visual correlation still required`);
} catch (error) { exitOnError(error); }
