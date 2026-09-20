import assert from 'node:assert/strict';
import test from 'node:test';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { sign } from './lib/auth.mjs';
import { createFakeLark } from './fake-lark.mjs';
import { createBridge } from './server.mjs';
import { loadStore, saveStore } from './lib/persist.mjs';
import {
  applyEvent, backoffSeconds, dueActions, emptyStore, reconcile, settleAction, validateEnvelope
} from './lib/state.mjs';

const T0 = 1_788_140_000;
const DEADLINE = T0 + 2700;
const SECRET = 'unit-test-shared-secret-0123456789';

const stateFile = () => path.join(tmpdir(), `tc002-bridge-${randomUUID()}.json`);
const envelope = ({ now = T0, ...overrides } = {}) => validateEnvelope({
  v: 1,
  session_id: 'sess-0001abcd',
  event: 'start',
  state: 'FOCUS',
  reason: 'middle_press',
  started_at: T0,
  focus_deadline: DEADLINE,
  ...overrides
}, { now });

test('envelope validation refuses content, unknown fields and wrong focus length', () => {
  assert.throws(() => validateEnvelope({ v: 1, session_id: 'sess-0001abcd', event: 'start', state: 'FOCUS', started_at: T0, focus_deadline: DEADLINE, sender: 'Alice' }, { now: T0 }), /forbidden field/);
  assert.throws(() => validateEnvelope({ v: 1, session_id: 'sess-0001abcd', event: 'start', state: 'FOCUS', started_at: T0, focus_deadline: DEADLINE, note: 'hi' }, { now: T0 }), /unknown field/);
  assert.throws(() => validateEnvelope({ v: 1, session_id: 'short', event: 'start', state: 'FOCUS', started_at: T0, focus_deadline: DEADLINE }, { now: T0 }), /session_id/);
  assert.throws(() => validateEnvelope({ v: 1, session_id: 'sess-0001abcd', event: 'pause', state: 'FOCUS', started_at: T0, focus_deadline: DEADLINE }, { now: T0 }), /event must be/);
  assert.throws(() => validateEnvelope({ v: 1, session_id: 'sess-0001abcd', event: 'start', state: 'FOCUS', started_at: T0, focus_deadline: T0 + 1800 }, { now: T0 }), /exactly 2700/);
  assert.throws(() => validateEnvelope({ v: 1, session_id: 'sess-0001abcd', event: 'start', state: 'FOCUS', started_at: T0 + 3600, focus_deadline: T0 + 6300 }, { now: T0 }), /future beyond/);
});

test('start is idempotent per session and never moves the deadline', () => {
  const first = applyEvent(emptyStore(), envelope(), T0);
  assert.deepEqual(first.actions.map(a => a.id), ['create:sess-0001abcd']);
  const again = applyEvent(first.store, envelope({ now: T0 + 30 }), T0 + 30);
  assert.equal(again.actions.length, 0);
  assert.equal(again.store.sessions['sess-0001abcd'].focus_deadline, DEADLINE);
  assert.equal(again.store.queue.length, 1);
  assert.match(again.notes.join(' '), /duplicate start ignored/);
});

test('early exit deletes the event, and a stop after the deadline calls nothing', () => {
  let state = applyEvent(emptyStore(), envelope(), T0).store;
  state = settleAction(state, 'create:sess-0001abcd', { ok: true, event_id: 'evt_1' }, T0).store;
  assert.equal(state.queue.length, 0);

  const early = applyEvent(state, envelope({ event: 'stop', state: 'IDLE', reason: 'user_exit', now: T0 + 600 }), T0 + 600);
  assert.deepEqual(early.actions.map(a => a.type), ['delete']);
  assert.equal(early.actions[0].event_id, 'evt_1');
  assert.equal(early.store.sessions['sess-0001abcd'].status, 'closed');

  const late = applyEvent(state, envelope({ event: 'stop', state: 'REST', reason: 'focus_ack', now: DEADLINE + 5 }), DEADLINE + 5);
  assert.equal(late.actions.length, 0);
  assert.match(late.notes.join(' '), /expired by itself, no Lark call/);
});

test('leaving with the knob deletes the event exactly like a middle-button exit', () => {
  let state = applyEvent(emptyStore(), envelope(), T0).store;
  state = settleAction(state, 'create:sess-0001abcd', { ok: true, event_id: 'evt_1' }, T0).store;
  const rotated = applyEvent(state, envelope({ event: 'stop', state: 'IDLE', reason: 'rotate_away', now: T0 + 300 }), T0 + 300);
  assert.deepEqual(rotated.actions.map(a => a.type), ['delete']);
  assert.equal(rotated.actions[0].event_id, 'evt_1');
  assert.equal(rotated.store.sessions['sess-0001abcd'].close_reason, 'rotate_away');
  // A knob exit while the Mac was unreachable keeps retrying until the focus window ends.
  const failed = settleAction(rotated.store, 'delete:sess-0001abcd', { ok: false, status: 503 }, T0 + 300).store;
  assert.equal(failed.queue[0].attempts, 1);
  assert.equal(dueActions(failed, T0 + 300 + backoffSeconds(1)).length, 1);
  assert.equal(reconcile(failed, DEADLINE + 1).store.queue.length, 0);
});

test('a start cancelled while Lark is offline never books anything', () => {
  const started = applyEvent(emptyStore(), envelope(), T0);
  const stopped = applyEvent(started.store, envelope({ event: 'stop', state: 'IDLE', reason: 'user_exit', now: T0 + 20 }), T0 + 20);
  assert.equal(stopped.actions.length, 0);
  assert.equal(stopped.store.queue.length, 0);
  assert.match(stopped.notes.join(' '), /cancelled instead of create\+delete/);
});

test('a new start without a stop closes the superseded round', () => {
  let state = applyEvent(emptyStore(), envelope(), T0).store;
  state = settleAction(state, 'create:sess-0001abcd', { ok: true, event_id: 'evt_1' }, T0).store;
  const next = applyEvent(state, envelope({ session_id: 'sess-0002abcd', started_at: T0 + 900, focus_deadline: T0 + 900 + 2700, now: T0 + 900 }), T0 + 900);
  assert.deepEqual(next.actions.map(a => a.id).sort(), ['create:sess-0002abcd', 'delete:sess-0001abcd']);
  assert.match(next.notes.join(' '), /ALARM session sess-0001abcd: superseded/);
});

test('restart restores absolute deadlines and the pending queue verbatim', () => {
  const file = stateFile();
  const state = applyEvent(emptyStore(), envelope(), T0).store;
  saveStore(file, state);
  const reloaded = loadStore(file);
  assert.equal(reloaded.sessions['sess-0001abcd'].focus_deadline, DEADLINE);
  assert.equal(reloaded.queue[0].id, 'create:sess-0001abcd');
  // A restart 40 minutes later must not recompute 2700 seconds from "now".
  const after = applyEvent(reloaded, envelope({ now: T0 + 2400 }), T0 + 2400);
  assert.equal(after.store.sessions['sess-0001abcd'].focus_deadline, DEADLINE);
  assert.equal(loadStore(path.join(tmpdir(), `missing-${randomUUID()}.json`)).queue.length, 0);
});

test('failed actions back off and are dropped once the focus window is over', () => {
  let state = applyEvent(emptyStore(), envelope(), T0).store;
  state = settleAction(state, 'create:sess-0001abcd', { ok: false, status: 503 }, T0).store;
  assert.equal(state.queue[0].attempts, 1);
  assert.equal(state.queue[0].next_attempt_at, T0 + backoffSeconds(1));
  assert.equal(dueActions(state, T0 + 1).length, 0);
  assert.equal(dueActions(state, T0 + backoffSeconds(1)).length, 1);
  const pruned = reconcile(state, DEADLINE + 1);
  assert.equal(pruned.store.queue.length, 0);
  assert.equal(pruned.store.sessions['sess-0001abcd'].status, 'expired');
  assert.match(pruned.notes.join(' '), /Busy released by end_time/);
});

test('a heartbeat that reports a non-focus state closes the round', () => {
  let state = applyEvent(emptyStore(), envelope(), T0).store;
  state = settleAction(state, 'create:sess-0001abcd', { ok: true, event_id: 'evt_1' }, T0).store;
  const beat = applyEvent(state, envelope({ event: 'heartbeat', state: 'IDLE', reason: undefined, now: T0 + 300 }), T0 + 300);
  assert.deepEqual(beat.actions.map(a => a.type), ['delete']);
  const stillFocused = applyEvent(state, envelope({ event: 'heartbeat', state: 'FOCUS_ALARM', reason: undefined, now: DEADLINE - 10 }), DEADLINE - 10);
  assert.equal(stillFocused.actions.length, 0);
  assert.equal(stillFocused.store.sessions['sess-0001abcd'].status, 'open');
});

test('signed HTTP round trip books Busy for exactly the focus window and deletes on early exit', async t => {
  const fake = createFakeLark();
  const base = await fake.listen();
  let now = T0;
  const bridge = createBridge({
    secret: SECRET, calendarId: 'primary-test', stateFile: stateFile(),
    mode: 'fake', base, token: 'fake-user-token', clock: () => now, log: () => {}
  });
  const bind = await bridge.listen({ host: '127.0.0.1', port: 0 });
  t.after(async () => { await bridge.close(); await fake.close(); });

  const post = async (body, { badSignature = false } = {}) => {
    const rawBody = JSON.stringify(body);
    const signature = sign(badSignature ? 'wrong-secret-wrong-secret' : SECRET, now, rawBody);
    return fetch(`http://127.0.0.1:${bind.port}/focus`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-tc002-timestamp': String(now), 'x-tc002-signature': signature },
      body: rawBody
    });
  };
  const start = { v: 1, session_id: 'sess-http-0001', event: 'start', state: 'FOCUS', reason: 'middle_press', started_at: T0, focus_deadline: DEADLINE };

  assert.equal((await post(start)).status, 202);
  const created = fake.requests.filter(r => r.method === 'POST' && r.path.endsWith('/events'));
  assert.equal(created.length, 1);
  assert.equal(created[0].authorized, true);
  assert.equal(created[0].has_idempotency_key, true);
  assert.equal(created[0].free_busy_status, 'busy');
  assert.equal(created[0].visibility, 'public');
  assert.equal(created[0].start_timestamp, String(T0));
  assert.equal(created[0].end_timestamp, String(DEADLINE));
  assert.equal(bridge.getStore().sessions['sess-http-0001'].event_id, 'evt_fake_1');

  // Replaying the same start must not book a second event.
  now = T0 + 60;
  assert.equal((await post(start)).status, 202);
  assert.equal(fake.requests.filter(r => r.method === 'POST' && r.path.endsWith('/events')).length, 1);

  now = T0 + 120;
  assert.equal((await post({ ...start, event: 'stop', state: 'IDLE', reason: 'user_exit' })).status, 202);
  assert.equal(fake.requests.filter(r => r.method === 'DELETE').length, 1);
  assert.equal(bridge.getStore().sessions['sess-http-0001'].status, 'closed');
  assert.equal(bridge.getStore().queue.length, 0);

  assert.equal((await post(start, { badSignature: true })).status, 401);
  const oversized = await post({ ...start, session_id: 'x'.repeat(5000) });
  assert.equal(oversized.status, 413);
  assert.equal((await fetch(`http://127.0.0.1:${bind.port}/other`, { method: 'POST' })).status, 404);
  assert.ok(fake.requests.every(r => r.authorized));
});

test('a Lark outage retries the create after backoff without duplicating it', async t => {
  const fake = createFakeLark({ failCreateTimes: 1 });
  const base = await fake.listen();
  let now = T0;
  const bridge = createBridge({
    secret: SECRET, calendarId: 'primary-test', stateFile: stateFile(),
    mode: 'fake', base, token: 'fake-user-token', clock: () => now, log: () => {}
  });
  t.after(async () => { await fake.close(); });

  const body = { v: 1, session_id: 'sess-retry-001', event: 'start', state: 'FOCUS', reason: 'middle_press', started_at: T0, focus_deadline: DEADLINE };
  await bridge.ingest({ rawBody: JSON.stringify(body), headers: { 'x-tc002-timestamp': String(now), 'x-tc002-signature': sign(SECRET, now, JSON.stringify(body)) }, now });
  assert.equal(bridge.getStore().queue[0].attempts, 1);
  assert.equal(bridge.getStore().sessions['sess-retry-001'].event_id, null);

  now = T0 + backoffSeconds(1);
  await bridge.tick(now);
  assert.equal(bridge.getStore().queue.length, 0);
  assert.equal(bridge.getStore().sessions['sess-retry-001'].event_id, 'evt_fake_1');
  assert.equal(fake.requests.filter(r => r.method === 'POST' && r.path.endsWith('/events')).length, 2);

  // After the deadline the bridge must stop touching Lark entirely.
  now = DEADLINE + 1;
  await bridge.tick(now);
  assert.equal(bridge.getStore().sessions['sess-retry-001'].status, 'expired');
  assert.equal(fake.requests.filter(r => r.method === 'DELETE').length, 0);
});

test('a timer tick overlapping an ingest cannot execute one Lark action twice', async () => {
  let releaseCreate;
  const createGate = new Promise(resolve => { releaseCreate = resolve; });
  let createCalls = 0;
  const fetchImpl = async () => {
    createCalls += 1;
    await createGate;
    return {
      ok: true,
      async json() { return { code: 0, data: { event: { event_id: 'evt_serialized_1' } } }; }
    };
  };
  const bridge = createBridge({
    secret: SECRET,
    calendarId: 'primary-test',
    stateFile: stateFile(),
    mode: 'fake',
    base: 'http://127.0.0.1:1',
    token: 'fake-user-token',
    fetchImpl,
    log: () => {}
  });
  const body = envelope({ session_id: 'sess-overlap-001' });
  const rawBody = JSON.stringify(body);
  const headers = {
    'x-tc002-timestamp': String(T0),
    'x-tc002-signature': sign(SECRET, T0, rawBody)
  };

  const ingesting = bridge.ingest({ rawBody, headers, now: T0 });
  while (createCalls === 0) await new Promise(resolve => setImmediate(resolve));
  const ticking = bridge.tick(T0);
  releaseCreate();
  await Promise.all([ingesting, ticking]);

  assert.equal(createCalls, 1);
  assert.equal(bridge.getStore().queue.length, 0);
  assert.equal(bridge.getStore().sessions['sess-overlap-001'].event_id, 'evt_serialized_1');
});

test('dry mode reaches no network and real mode refuses without an explicit acknowledgement', async () => {
  const { resolveMode, executeAction } = await import('./lib/lark.mjs');
  let called = false;
  const result = await executeAction(
    { id: 'create:sess-dry-0001', type: 'create', session_id: 'sess-dry-0001', started_at: T0, focus_deadline: DEADLINE },
    { mode: 'dry', base: null, calendarId: 'primary-test', token: null, fetchImpl: () => { called = true; } }
  );
  assert.equal(result.ok, true);
  assert.equal(result.network, false);
  assert.equal(called, false);
  assert.throws(() => resolveMode({ BRIDGE_LARK_MODE: 'real' }), /BRIDGE_ACK_REAL_LARK=YES/);
  assert.equal(resolveMode({ BRIDGE_LARK_MODE: 'real', BRIDGE_ACK_REAL_LARK: 'YES' }), 'real');
});
