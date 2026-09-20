import { BridgeError } from './state.mjs';
import { LARK_BASE } from './lark-token.mjs';

export const FOCUS_STATUS_TITLE = '专注中';

async function requestJson({ url, method = 'GET', tenantAccessToken, body, fetchImpl = fetch, operation }) {
  const response = await fetchImpl(url, {
    method,
    headers: {
      authorization: `Bearer ${tenantAccessToken}`,
      ...(body ? { 'content-type': 'application/json; charset=utf-8' } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || (typeof payload.code === 'number' && payload.code !== 0)) {
    throw new BridgeError(`ALARM Lark ${operation} failed (HTTP ${response.status}, code ${payload.code ?? 'unknown'})`, 500);
  }
  return payload;
}

export async function listSystemStatuses({ tenantAccessToken, fetchImpl = fetch, base = LARK_BASE }) {
  const items = [];
  let pageToken = '';
  do {
    const url = new URL(`${base}/open-apis/personal_settings/v1/system_statuses`);
    url.searchParams.set('page_size', '50');
    if (pageToken) url.searchParams.set('page_token', pageToken);
    const payload = await requestJson({ url, tenantAccessToken, fetchImpl, operation: 'system status list' });
    const data = payload.data || {};
    const page = Array.isArray(data.items) ? data.items
      : Array.isArray(data.system_statuses) ? data.system_statuses : [];
    items.push(...page);
    pageToken = data.has_more ? String(data.page_token || '') : '';
  } while (pageToken);
  return items;
}

export async function createSystemStatus({
  tenantAccessToken,
  title = FOCUS_STATUS_TITLE,
  priority,
  fetchImpl = fetch,
  base = LARK_BASE
}) {
  const payload = await requestJson({
    url: `${base}/open-apis/personal_settings/v1/system_statuses`,
    method: 'POST',
    tenantAccessToken,
    body: { title, icon_key: 'StatusReading', color: 'GREEN', priority },
    fetchImpl,
    operation: 'system status create'
  });
  const status = payload?.data?.system_status || payload?.data;
  if (!status?.system_status_id) throw new BridgeError('ALARM Lark system status create response omitted system_status_id', 500);
  return status;
}

export async function ensureFocusSystemStatus({ tenantAccessToken, fetchImpl = fetch, base = LARK_BASE }) {
  const statuses = await listSystemStatuses({ tenantAccessToken, fetchImpl, base });
  const existing = statuses.find(status => status?.title === FOCUS_STATUS_TITLE && status?.system_status_id);
  if (existing) return { status: existing, created: false };
  const used = new Set(statuses.map(status => Number(status?.priority)).filter(Number.isInteger));
  let priority = 1;
  while (used.has(priority)) priority += 1;
  const status = await createSystemStatus({ tenantAccessToken, priority, fetchImpl, base });
  return { status, created: true };
}
