import assert from 'node:assert/strict';
import test from 'node:test';
import { publishPacket } from './lib/mqtt.mjs';
import { buildCalendarPlan } from './lib/lark-calendar.mjs';
import { assertLiteralNotification, assertNoCredentialEnv, parseBroker, redactTopic, safePayload, topicMatchesConfiguredPrefix, validatePrefix } from './lib/safety.mjs';
import { findSecretFindings } from './secret-scan.mjs';
import { assertLocalBindHost, hasNonEmptyCredential, parseBrokerPort, parseBrokerSeconds } from './tc002-broker.mjs';
import { findLiveCandidatePaths } from './tc002-http-state.mjs';

test('broker and literal prefix validation', () => {
  assert.deepEqual(parseBroker('mqtt://127.0.0.1:1883'), { host: '127.0.0.1', port: 1883 });
  assert.equal(validatePrefix('tc002/test/'), 'tc002/test');
  assert.throws(() => validatePrefix('tc002/#'));
  assert.throws(() => parseBroker('mqtt://user:secret@localhost'));
});

test('redacts secret-shaped MQTT JSON fields', () => {
  const result = safePayload(Buffer.from('{"state":"busy","token":"abc","mac":"AA:BB:CC:DD:EE:FF"}'));
  assert.equal(result.value.state, 'busy');
  assert.equal(result.value.token, '[REDACTED]');
  assert.equal(result.value.mac, '[REDACTED]');
  assert.equal(redactTopic('ulanzi_AABB/status/busy', 'ulanzi_AABB'), '[PREFIX]/status/busy');
  assert.equal(redactTopic('ulanzi_1c0e/custom/display', 'ulanzi'), '[PREFIX]_[DEVICE]/custom/display');
  assert.equal(topicMatchesConfiguredPrefix('ulanzi_1c0e/custom/display', 'ulanzi'), true);
  assert.equal(topicMatchesConfiguredPrefix('ulanzievil/custom/display', 'ulanzi'), false);
});

test('omits opaque binary payloads and enforces the content-free notification literal', () => {
  const binary = safePayload(Buffer.from([0xff, 0x00, 0x61]));
  assert.equal(binary.encoding, 'binary');
  assert.equal(binary.bytes, 3);
  assert.equal('value' in binary, false);
  assert.doesNotThrow(() => assertLiteralNotification({ text: [{ content: '有新消息', color: '#FFFFFF' }], duration: 5 }));
  assert.throws(() => assertLiteralNotification({ text: [{ content: 'Alice: secret' }], duration: 5 }));
  assert.throws(() => assertLiteralNotification({ text: [{ content: '有新消息' }], sender: 'Alice', duration: 5 }));
});

test('builds a QoS0 MQTT PUBLISH packet', () => {
  const result = publishPacket('clock/test', '{"ok":true}');
  assert.equal(result[0], 0x30);
  assert.ok(result.includes(Buffer.from('clock/test')));
});

test('books Busy for exactly the focus window, one idempotent event per session', () => {
  const plan = buildCalendarPlan({ calendarId: 'primary-test', now: 1_788_140_000, sessionId: 'sess-0001abcd' });
  assert.equal(plan.token_type, 'user_access_token');
  assert.equal(plan.create.body.free_busy_status, 'busy');
  assert.equal(plan.create.body.visibility, 'public');
  assert.equal(plan.create.body.need_notification, false);
  assert.deepEqual(plan.create.body.reminders, []);
  assert.equal(plan.create.body.start_time.timestamp, '1788140000');
  // user decision 2026-09-11: Busy is exactly 2700 s and the event expires by itself
  assert.equal(plan.focus_deadline, 1_788_142_700);
  assert.equal(plan.create.body.end_time.timestamp, '1788142700');
  assert.equal(plan.booked_end, 1_788_142_700);
  assert.equal(plan.busy_ceiling, 1_788_142_700);
  assert.equal(plan.extend_while_ringing, null);
  assert.equal(plan.idempotency_key_length, 64);
  assert.match(plan.delete_on_early_exit.url, /need_notification=false$/);
  assert.match(plan.delete_on_early_exit.trigger, /now < focus_deadline/);
  const sameSession = buildCalendarPlan({ calendarId: 'primary-test', now: 1_788_140_009, sessionId: 'sess-0001abcd' });
  assert.equal(sameSession.create.url, plan.create.url);
  const otherSession = buildCalendarPlan({ calendarId: 'primary-test', now: 1_788_140_000, sessionId: 'sess-0002abcd' });
  assert.notEqual(otherSession.create.url, plan.create.url);
});

test('opt-in grace/extension still works and timing stays range-checked', () => {
  const held = buildCalendarPlan({
    calendarId: 'primary-test', now: 1_788_140_000, graceSeconds: 600, extendSeconds: 600, maxExtensions: 3
  });
  assert.equal(held.create.body.end_time.timestamp, '1788143300');
  assert.equal(held.busy_ceiling, 1_788_145_100);
  assert.equal(held.extend_while_ringing.method, 'PATCH');
  assert.throws(() => buildCalendarPlan({ calendarId: 'primary-test', now: 1_788_140_000, focusSeconds: 30 }), /FOCUS_SECONDS/);
  assert.throws(() => buildCalendarPlan({ calendarId: 'primary-test', now: 1_788_140_000, graceSeconds: 7200 }), /GRACE_SECONDS/);
  assert.throws(() => buildCalendarPlan({ calendarId: 'primary-test', now: 1_788_140_000, maxExtensions: 99 }), /MAX_EXTENSIONS/);
  assert.throws(() => buildCalendarPlan({ calendarId: 'primary-test', now: 1_788_140_000, sessionId: 'short' }), /session_id/);
});

test('secret scan alarms on a credential-shaped value and accepts redaction', () => {
  const fakeBearer = `Bearer ${'x'.repeat(24)}`;
  assert.equal(findSecretFindings(fakeBearer).length, 1);
  assert.equal(findSecretFindings('Bearer [REDACTED]').length, 0);
});

test('broker refuses non-local binds and unsafe duration or port', () => {
  const interfaces = { en0: [{ address: '192.168.10.2' }] };
  assert.equal(assertLocalBindHost('192.168.10.2', interfaces), '192.168.10.2');
  assert.throws(() => assertLocalBindHost('192.168.10.3', interfaces));
  assert.throws(() => assertLocalBindHost('0.0.0.0', interfaces));
  assert.equal(parseBrokerPort('1883'), 1883);
  assert.throws(() => parseBrokerPort('80'));
  assert.equal(parseBrokerSeconds('600'), 600);
  assert.throws(() => parseBrokerSeconds('3600'));
  assert.equal(hasNonEmptyCredential(Buffer.alloc(0)), false);
  assert.equal(hasNonEmptyCredential(Buffer.from('secret')), true);
});

test('HTTP state audit detects named live fields without exposing values', () => {
  assert.deepEqual(findLiveCandidatePaths({ toolsInfos: { busy: { focusTime: '45', enable: true } } }), []);
  assert.deepEqual(findLiveCandidatePaths({ currentPage: 'busy', nested: { remaining: 42 } }), ['currentPage', 'nested.remaining']);
});

test('dry-run credential guard rejects every credential variable and allows none-set', () => {
  for (const name of ['LARK_USER_ACCESS_TOKEN', 'LARK_REFRESH_TOKEN', 'LARK_APP_SECRET', 'LARK_TENANT_ACCESS_TOKEN']) {
    assert.throws(() => assertNoCredentialEnv({ [name]: 'x' }), /ALARM dry-run refuses credential variables: /);
  }
  assert.doesNotThrow(() => assertNoCredentialEnv({ LARK_OPEN_ID: 'ou_FAKE123' }));
});
