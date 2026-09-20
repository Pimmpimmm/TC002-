// Pure session logic for the TC002 focus bridge (research/SPEC-V2-45-5.md).
// No I/O here on purpose: every rule below is unit-testable without a device or Lark.

export const FOCUS_SECONDS_DEFAULT = 2700;
export const REST_SECONDS_DEFAULT = 300;

export class BridgeError extends Error {
  constructor(message, httpStatus = 400) {
    super(message);
    this.httpStatus = httpStatus;
  }
}

const ENVELOPE_KEYS = new Set(['v', 'session_id', 'event', 'state', 'reason', 'started_at', 'focus_deadline', 'sent_at']);
const EVENTS = new Set(['start', 'stop', 'heartbeat']);
const STATES = new Set(['IDLE', 'FOCUS', 'FOCUS_ALARM', 'REST', 'REST_ALARM']);
const REASONS = new Set(['middle_press', 'rotate_away', 'user_exit', 'focus_ack', 'boot_recovery', 'heartbeat_reconcile']);
const FORBIDDEN_KEY = /(token|secret|password|authorization|sender|author|from|content|body|message|summary|title|mac|serial|email|phone|chat)/i;
const SESSION_ID = /^[A-Za-z0-9_-]{8,64}$/;

// States in which the device still owns a focus round; anything else means it left.
const FOCUS_STATES = new Set(['FOCUS', 'FOCUS_ALARM']);

export function emptyStore() {
  return { v: 1, sessions: {}, queue: [] };
}

function integer(name, value) {
  if (!Number.isInteger(value)) throw new BridgeError(`ALARM ${name} must be an integer`);
  return value;
}

/**
 * Rejects anything that is not the exact metadata envelope of SPEC v2 §5.
 * Privacy rule: an unknown or content-shaped field is a hard failure, never ignored,
 * so a future firmware cannot quietly start shipping chat text through this port.
 */
export function validateEnvelope(raw, { now, focusSeconds = FOCUS_SECONDS_DEFAULT, maxSkewSeconds = 120, maxAgeSeconds = 14_400 } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new BridgeError('ALARM body must be a JSON object');
  for (const key of Object.keys(raw)) {
    if (FORBIDDEN_KEY.test(key)) throw new BridgeError(`ALARM forbidden field in device event: ${key}`);
    if (!ENVELOPE_KEYS.has(key)) throw new BridgeError(`ALARM unknown field in device event: ${key}`);
  }
  if (raw.v !== 1) throw new BridgeError('ALARM unsupported envelope version');
  if (typeof raw.session_id !== 'string' || !SESSION_ID.test(raw.session_id)) {
    throw new BridgeError('ALARM session_id must be 8..64 chars of [A-Za-z0-9_-]');
  }
  if (!EVENTS.has(raw.event)) throw new BridgeError('ALARM event must be start, stop or heartbeat');
  if (!STATES.has(raw.state)) throw new BridgeError('ALARM state must be one of the SPEC v2 states');
  if (raw.reason !== undefined && !REASONS.has(raw.reason)) throw new BridgeError('ALARM unknown reason');
  integer('started_at', raw.started_at);
  integer('focus_deadline', raw.focus_deadline);
  if (raw.sent_at !== undefined) integer('sent_at', raw.sent_at);
  if (raw.focus_deadline - raw.started_at !== focusSeconds) {
    throw new BridgeError(`ALARM focus_deadline - started_at must be exactly ${focusSeconds}`);
  }
  if (!Number.isInteger(now)) throw new BridgeError('ALARM invalid now');
  if (raw.started_at > now + maxSkewSeconds) throw new BridgeError('ALARM started_at is in the future beyond the allowed skew');
  if (now - raw.started_at > maxAgeSeconds) throw new BridgeError('ALARM started_at is too old to act on');
  return {
    v: 1,
    session_id: raw.session_id,
    event: raw.event,
    state: raw.state,
    reason: raw.reason ?? null,
    started_at: raw.started_at,
    focus_deadline: raw.focus_deadline
  };
}

function actionId(type, sessionId) {
  return `${type}:${sessionId}`;
}

function enqueue(store, action) {
  if (store.queue.some(item => item.id === action.id)) return;
  store.queue.push(action);
}

function cancelQueued(store, type, sessionId) {
  const id = actionId(type, sessionId);
  const before = store.queue.length;
  store.queue = store.queue.filter(item => item.id !== id);
  return store.queue.length !== before;
}

function openSessions(store) {
  return Object.values(store.sessions).filter(session => session.status === 'open');
}

function closeSession(store, session, now, reason, notes, actions) {
  session.status = 'closed';
  session.closed_at = now;
  session.close_reason = reason;
  // Busy is exactly the focus window, so after the deadline the event has already
  // released itself and the bridge must not call Lark at all (user decision 2026-09-11).
  if (now >= session.focus_deadline) {
    notes.push(`session ${session.session_id}: past focus_deadline, event expired by itself, no Lark call`);
    cancelQueued(store, 'create', session.session_id);
    return;
  }
  if (cancelQueued(store, 'create', session.session_id) && !session.event_id) {
    notes.push(`session ${session.session_id}: create was still queued, cancelled instead of create+delete`);
    return;
  }
  if (!session.event_id) {
    notes.push(`ALARM session ${session.session_id}: early exit without a known event_id; nothing to delete`);
    return;
  }
  const action = {
    id: actionId('delete', session.session_id),
    type: 'delete',
    session_id: session.session_id,
    started_at: session.started_at,
    focus_deadline: session.focus_deadline,
    event_id: session.event_id,
    attempts: 0,
    next_attempt_at: now
  };
  enqueue(store, action);
  actions.push(action);
}

/**
 * Applies one validated device event. Returns a new store plus the actions it queued,
 * so the caller decides when to talk to Lark.
 */
export function applyEvent(store, envelope, now) {
  const next = structuredClone(store);
  const notes = [];
  const actions = [];
  const existing = next.sessions[envelope.session_id];

  if (envelope.event === 'start') {
    if (existing) {
      // Idempotent by session_id: a retried start never re-books and never moves the deadline.
      existing.last_seen = now;
      notes.push(`session ${envelope.session_id}: duplicate start ignored (deadline unchanged)`);
      return { store: next, actions, notes };
    }
    for (const other of openSessions(next)) {
      notes.push(`ALARM session ${other.session_id}: superseded by a new start without a stop`);
      closeSession(next, other, now, 'superseded', notes, actions);
    }
    const session = {
      session_id: envelope.session_id,
      started_at: envelope.started_at,
      focus_deadline: envelope.focus_deadline,
      event_id: null,
      status: 'open',
      opened_at: now,
      last_seen: now
    };
    next.sessions[envelope.session_id] = session;
    if (now >= session.focus_deadline) {
      // Boot recovery of a round that already ended: nothing to book.
      session.status = 'expired';
      notes.push(`session ${envelope.session_id}: start arrived after focus_deadline, no Lark call`);
      return { store: next, actions, notes };
    }
    const action = {
      id: actionId('create', envelope.session_id),
      type: 'create',
      session_id: envelope.session_id,
      started_at: envelope.started_at,
      focus_deadline: envelope.focus_deadline,
      event_id: null,
      attempts: 0,
      next_attempt_at: now
    };
    enqueue(next, action);
    actions.push(action);
    return { store: next, actions, notes };
  }

  if (envelope.event === 'stop') {
    if (!existing) {
      notes.push(`ALARM stop for unknown session ${envelope.session_id}; reconciling open sessions`);
      for (const other of openSessions(next)) closeSession(next, other, now, 'reconcile_unknown_stop', notes, actions);
      return { store: next, actions, notes };
    }
    existing.last_seen = now;
    if (existing.status !== 'open') {
      notes.push(`session ${envelope.session_id}: repeated stop treated as success`);
      return { store: next, actions, notes };
    }
    closeSession(next, existing, now, envelope.reason || 'user_exit', notes, actions);
    return { store: next, actions, notes };
  }

  // heartbeat
  if (!existing) {
    notes.push(`ALARM heartbeat for unknown session ${envelope.session_id}`);
    return { store: next, actions, notes };
  }
  existing.last_seen = now;
  if (existing.status === 'open' && !FOCUS_STATES.has(envelope.state)) {
    notes.push(`session ${envelope.session_id}: heartbeat reports ${envelope.state}, closing round`);
    closeSession(next, existing, now, 'heartbeat_reconcile', notes, actions);
  }
  return { store: next, actions, notes };
}

/** Marks rounds whose deadline passed; Lark released Busy on its own. */
export function reconcile(store, now) {
  const next = structuredClone(store);
  const notes = [];
  for (const session of Object.values(next.sessions)) {
    if (session.status === 'open' && now >= session.focus_deadline) {
      session.status = 'expired';
      session.closed_at = now;
      session.close_reason = 'deadline';
      notes.push(`session ${session.session_id}: focus_deadline reached, Busy released by end_time`);
    }
  }
  const before = next.queue.length;
  next.queue = next.queue.filter(action => {
    if (now < action.focus_deadline) return true;
    notes.push(`action ${action.id}: dropped, focus window already over`);
    return false;
  });
  if (next.queue.length !== before) notes.push('queue pruned to actions that still matter');
  return { store: next, notes };
}

export function dueActions(store, now) {
  return store.queue.filter(action => action.next_attempt_at <= now && now < action.focus_deadline);
}

export function backoffSeconds(attempts) {
  return Math.min(300, 5 * 2 ** Math.max(0, attempts - 1));
}

export function settleAction(store, actionId_, result, now) {
  const next = structuredClone(store);
  const action = next.queue.find(item => item.id === actionId_);
  const notes = [];
  if (!action) return { store: next, notes: [`ALARM settle for unknown action ${actionId_}`] };
  const session = next.sessions[action.session_id];
  if (result.ok) {
    next.queue = next.queue.filter(item => item.id !== actionId_);
    if (action.type === 'create' && session) {
      session.event_id = result.event_id || null;
      if (!session.event_id) notes.push(`ALARM create for ${action.session_id} returned no event_id`);
    }
    if (action.type === 'delete' && session) session.event_id = null;
    notes.push(`action ${actionId_}: ok`);
    return { store: next, notes };
  }
  action.attempts += 1;
  action.next_attempt_at = now + backoffSeconds(action.attempts);
  notes.push(`ALARM action ${actionId_}: attempt ${action.attempts} failed, retry at +${backoffSeconds(action.attempts)}s`);
  return { store: next, notes };
}
