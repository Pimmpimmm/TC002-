import { buildCalendarPlan } from '../../probes/lib/lark-calendar.mjs';
import { BridgeError } from './state.mjs';

export const LARK_BASE = 'https://open.larksuite.com';

export function resolveMode(env = process.env) {
  const mode = (env.BRIDGE_LARK_MODE || 'dry').trim();
  if (!['dry', 'fake', 'real'].includes(mode)) throw new BridgeError('ALARM BRIDGE_LARK_MODE must be dry, fake or real', 500);
  if (mode === 'real' && env.BRIDGE_ACK_REAL_LARK !== 'YES') {
    throw new BridgeError('ALARM real Lark mutation requires BRIDGE_ACK_REAL_LARK=YES', 500);
  }
  return mode;
}

export function resolveBase(mode, env = process.env) {
  if (mode === 'real') return LARK_BASE;
  if (mode === 'dry') return null;
  const base = (env.BRIDGE_LARK_BASE || '').trim();
  const url = base ? new URL(base) : null;
  if (!url || url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) {
    throw new BridgeError('ALARM fake mode requires BRIDGE_LARK_BASE on http://127.0.0.1', 500);
  }
  return base.replace(/\/$/, '');
}

function rewriteBase(url, base) {
  return base ? url.replace(LARK_BASE, base) : url;
}

export function planFor(action, { calendarId, timezone = 'Asia/Shanghai' }) {
  return buildCalendarPlan({
    calendarId,
    now: action.started_at,
    sessionId: action.session_id,
    focusSeconds: action.focus_deadline - action.started_at,
    graceSeconds: 0,
    maxExtensions: 0,
    timezone
  });
}

/**
 * Executes one queued action. `dry` touches no network at all; `fake` talks to a
 * loopback stub; `real` needs the explicit acknowledgement plus a Keychain token.
 */
export async function executeAction(action, context) {
  const { mode, base, calendarId, timezone, token, tokenProvider, fetchImpl = fetch } = context;
  const plan = planFor(action, { calendarId, timezone });

  if (mode === 'dry') {
    return { ok: true, event_id: action.type === 'create' ? `dry-${action.session_id}` : null, network: false };
  }
  const effectiveToken = tokenProvider ? await tokenProvider() : token;
  if (!effectiveToken) throw new BridgeError('ALARM missing user_access_token for a network mode', 500);

  const headers = { authorization: `Bearer ${effectiveToken}`, 'content-type': 'application/json; charset=utf-8' };
  let response;
  if (action.type === 'create') {
    response = await fetchImpl(rewriteBase(plan.create.url, base), {
      method: 'POST',
      headers,
      body: JSON.stringify(plan.create.body)
    });
  } else {
    if (!action.event_id) throw new BridgeError('ALARM delete action without event_id', 500);
    const url = rewriteBase(plan.delete_on_early_exit.url, base).replace(':event_id', encodeURIComponent(action.event_id));
    response = await fetchImpl(url, { method: 'DELETE', headers });
  }

  if (!response.ok) return { ok: false, status: response.status, network: true };
  const payload = await response.json().catch(() => ({}));
  if (payload && typeof payload.code === 'number' && payload.code !== 0) {
    return { ok: false, status: response.status, lark_code: payload.code, network: true };
  }
  return {
    ok: true,
    event_id: action.type === 'create' ? payload?.data?.event?.event_id ?? null : null,
    network: true
  };
}
