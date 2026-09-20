import { BridgeError } from './state.mjs';
import { readKeychainSecret, writeKeychainSecret } from './keychain.mjs';

export const LARK_BASE = 'https://open.larksuite.com';
export const REQUIRED_USER_SCOPES = Object.freeze([
  'offline_access'
]);

async function responseJson(response, operation) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || (typeof payload.code === 'number' && payload.code !== 0)) {
    throw new BridgeError(`ALARM Lark ${operation} failed (HTTP ${response.status}, code ${payload.code ?? 'unknown'})`, 500);
  }
  return payload;
}

export async function getAppAccessToken({ appId, appSecret, fetchImpl = fetch, base = LARK_BASE }) {
  const response = await fetchImpl(`${base}/open-apis/auth/v3/app_access_token/internal`, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret })
  });
  const payload = await responseJson(response, 'app token request');
  if (!payload.app_access_token) throw new BridgeError('ALARM Lark app token response omitted app_access_token', 500);
  return payload.app_access_token;
}

export async function getTenantAccessToken({ appId, appSecret, fetchImpl = fetch, base = LARK_BASE }) {
  const response = await fetchImpl(`${base}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret })
  });
  const payload = await responseJson(response, 'tenant token request');
  if (!payload.tenant_access_token) throw new BridgeError('ALARM Lark tenant token response omitted tenant_access_token', 500);
  return { token: payload.tenant_access_token, expiresIn: Number(payload.expire) || 7200 };
}

async function userTokenRequest({ path, body, appAccessToken, fetchImpl = fetch, base = LARK_BASE, operation }) {
  const response = await fetchImpl(`${base}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${appAccessToken}`,
      'content-type': 'application/json; charset=utf-8'
    },
    body: JSON.stringify(body)
  });
  const payload = await responseJson(response, operation);
  const data = payload.data || {};
  if (!data.access_token || !data.refresh_token || !Number.isInteger(data.expires_in)) {
    throw new BridgeError(`ALARM Lark ${operation} response omitted token fields`, 500);
  }
  return data;
}

export function authorizationUrl({
  appId,
  redirectUri,
  state,
  scopes = REQUIRED_USER_SCOPES,
  base = LARK_BASE
}) {
  const url = new URL(`${base}/open-apis/authen/v1/authorize`);
  url.searchParams.set('app_id', appId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  url.searchParams.set('scope', scopes.join(' '));
  return url.toString();
}

export async function exchangeAuthorizationCode({ code, appAccessToken, fetchImpl = fetch, base = LARK_BASE }) {
  return userTokenRequest({
    path: '/open-apis/authen/v1/access_token',
    body: { grant_type: 'authorization_code', code },
    appAccessToken, fetchImpl, base, operation: 'authorization code exchange'
  });
}

export async function refreshUserAccessToken({ refreshToken, appAccessToken, fetchImpl = fetch, base = LARK_BASE }) {
  return userTokenRequest({
    path: '/open-apis/authen/v1/refresh_access_token',
    body: { grant_type: 'refresh_token', refresh_token: refreshToken },
    appAccessToken, fetchImpl, base, operation: 'user token refresh'
  });
}

export async function getUserInfo({ userAccessToken, fetchImpl = fetch, base = LARK_BASE }) {
  const response = await fetchImpl(`${base}/open-apis/authen/v1/user_info`, {
    method: 'GET',
    headers: {
      authorization: `Bearer ${userAccessToken}`
    }
  });
  const payload = await responseJson(response, 'user info request');
  if (!payload?.data?.open_id) throw new BridgeError('ALARM Lark user info response omitted open_id', 500);
  return payload.data;
}

export function persistTokenBundle({ service, bundle, now, write = writeKeychainSecret }) {
  const fields = {
    user_access_token: bundle.access_token,
    refresh_token: bundle.refresh_token,
    access_token_expires_at: String(now + bundle.expires_in)
  };
  for (const [account, value] of Object.entries(fields)) write({ service, account, value });
}

export function createKeychainTokenProvider({
  service,
  fetchImpl = fetch,
  clock = () => Math.floor(Date.now() / 1000),
  read = readKeychainSecret,
  write = writeKeychainSecret,
  base = LARK_BASE
}) {
  let inFlight = null;
  return async function getUserAccessToken() {
    const now = clock();
    const accessToken = read({ service, account: 'user_access_token' });
    const expiresAt = Number(read({ service, account: 'access_token_expires_at' }));
    if (Number.isFinite(expiresAt) && now < expiresAt - 120) return accessToken;
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const appId = read({ service, account: 'app_id' });
      const appSecret = read({ service, account: 'app_secret' });
      const refreshToken = read({ service, account: 'refresh_token' });
      const appAccessToken = await getAppAccessToken({ appId, appSecret, fetchImpl, base });
      const bundle = await refreshUserAccessToken({ refreshToken, appAccessToken, fetchImpl, base });
      persistTokenBundle({ service, bundle, now: clock(), write });
      return bundle.access_token;
    })();
    try { return await inFlight; } finally { inFlight = null; }
  };
}

export function createKeychainTenantTokenProvider({
  service,
  fetchImpl = fetch,
  clock = () => Math.floor(Date.now() / 1000),
  read = readKeychainSecret,
  base = LARK_BASE
}) {
  let cached = null;
  let inFlight = null;
  return async function getTenantToken() {
    const now = clock();
    if (cached && now < cached.expiresAt - 120) return cached.token;
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const appId = read({ service, account: 'app_id' });
      const appSecret = read({ service, account: 'app_secret' });
      const result = await getTenantAccessToken({ appId, appSecret, fetchImpl, base });
      cached = { token: result.token, expiresAt: clock() + result.expiresIn };
      return result.token;
    })();
    try { return await inFlight; } finally { inFlight = null; }
  };
}
