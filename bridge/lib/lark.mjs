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

export function actionRequest(action, { base = LARK_BASE, systemStatusId, userOpenId }) {
  if (!['open', 'close'].includes(action.type)) throw new BridgeError(`ALARM unsupported Lark action: ${action.type}`, 500);
  if (!systemStatusId || !userOpenId) throw new BridgeError('ALARM system status action requires system_status_id and user open_id', 500);
  const operation = action.type === 'open' ? 'batch_open' : 'batch_close';
  const url = new URL(`${base}/open-apis/personal_settings/v1/system_statuses/${encodeURIComponent(systemStatusId)}/${operation}`);
  url.searchParams.set('user_id_type', 'open_id');
  return {
    url: url.toString(),
    body: action.type === 'open'
      ? { user_list: [{ user_id: userOpenId, end_time: action.focus_deadline }] }
      : { user_list: [userOpenId] }
  };
}

/** Executes one queued system-status action. Dry mode never touches the network. */
export async function executeAction(action, context) {
  const { mode, base, systemStatusId, userOpenId, token, tokenProvider, fetchImpl = fetch } = context;
  if (mode === 'dry') return { ok: true, network: false };

  const effectiveToken = tokenProvider ? await tokenProvider() : token;
  if (!effectiveToken) throw new BridgeError('ALARM missing tenant_access_token for a network mode', 500);
  const request = actionRequest(action, { base, systemStatusId, userOpenId });
  const response = await fetchImpl(request.url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${effectiveToken}`,
      'content-type': 'application/json; charset=utf-8'
    },
    body: JSON.stringify(request.body)
  });
  if (!response.ok) return { ok: false, status: response.status, network: true };
  const payload = await response.json().catch(() => ({}));
  if (typeof payload.code === 'number' && payload.code !== 0) {
    return { ok: false, status: response.status, lark_code: payload.code, network: true };
  }
  const results = payload?.data?.result_list;
  const perUser = Array.isArray(results) ? results[0] : null;
  if (!perUser || perUser.user_id !== userOpenId || !String(perUser.result || '').toLowerCase().startsWith('success')) {
    return { ok: false, status: response.status, lark_result: perUser?.result || 'missing_result', network: true };
  }
  return { ok: true, network: true };
}
