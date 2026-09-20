import assert from 'node:assert/strict';
import test from 'node:test';
import { verifySignature } from './lib/auth.mjs';
import { createMqttAdapter, forwardMqttEvent, validateBridgeUrl, validateEventTopic } from './mqtt-adapter.mjs';

const SECRET = 'unit-test-shared-secret-0123456789';
const TOPIC = 'tc002/test/events/focus';
const URL = 'http://127.0.0.1:8787/focus';
const NOW = 1_788_140_000;

test('MQTT event is forwarded unchanged and signed for the local bridge', async () => {
  const rawBody = JSON.stringify({ v: 1, session_id: 'sess-mqtt-0001', event: 'start' });
  let call;
  const result = await forwardMqttEvent({
    topic: TOPIC, payload: Buffer.from(rawBody), eventTopic: TOPIC, secret: SECRET, bridgeUrl: URL, now: NOW,
    fetchImpl: async (url, options) => { call = { url, options }; return { ok: true, status: 202 }; }
  });
  assert.deepEqual(result, { forwarded: true, status: 202 });
  assert.equal(call.url, URL);
  assert.equal(call.options.body, rawBody);
  assert.equal(verifySignature({
    secret: SECRET,
    timestamp: call.options.headers['x-tc002-timestamp'],
    signature: call.options.headers['x-tc002-signature'],
    rawBody: call.options.body,
    now: NOW
  }), true);
});

test('MQTT adapter rejects unsafe input before it reaches the bridge', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return { ok: true, status: 202 }; };
  assert.deepEqual(await forwardMqttEvent({ topic: 'other/topic', payload: '{}', eventTopic: TOPIC, secret: SECRET, bridgeUrl: URL, fetchImpl }), {
    forwarded: false, reason: 'topic_mismatch'
  });
  await assert.rejects(() => forwardMqttEvent({ topic: TOPIC, payload: 'not-json', eventTopic: TOPIC, secret: SECRET, bridgeUrl: URL, fetchImpl }), /valid JSON/);
  await assert.rejects(() => forwardMqttEvent({ topic: TOPIC, payload: Buffer.alloc(4097), eventTopic: TOPIC, secret: SECRET, bridgeUrl: URL, fetchImpl }), /1\.\.4096/);
  assert.throws(() => validateBridgeUrl('https://example.com/focus'), /must be a local/);
  assert.throws(() => validateEventTopic('single'), /exact topic path/);
  assert.equal(calls, 0);
});

test('MQTT adapter subscribes to one exact topic and serializes deliveries', async () => {
  let handler;
  const calls = [];
  const mqtt = {
    async connect() { calls.push('connect'); },
    async subscribe(topic) { calls.push(`subscribe:${topic}`); },
    onPublish(fn) { handler = fn; },
    close() { calls.push('close'); }
  };
  const adapter = createMqttAdapter({
    mqtt, eventTopic: TOPIC, secret: SECRET, bridgeUrl: URL, clock: () => NOW,
    fetchImpl: async () => ({ ok: true, status: 202 }), log: () => {}
  });
  await adapter.start();
  handler({ topic: TOPIC, payload: Buffer.from('{}') });
  handler({ topic: TOPIC, payload: Buffer.from('{}') });
  await adapter.idle();
  adapter.close();
  assert.deepEqual(calls, ['connect', `subscribe:${TOPIC}`, 'close']);
});
