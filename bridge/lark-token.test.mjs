import assert from 'node:assert/strict';
import test from 'node:test';
import {
  authorizationUrl, createKeychainTenantTokenProvider, createKeychainTokenProvider, exchangeAuthorizationCode,
  getAppAccessToken, getTenantAccessToken, getUserInfo
} from './lib/lark-token.mjs';

test('authorization URL contains the exact local redirect and unpredictable state', () => {
  const value = authorizationUrl({ appId: 'cli_test', redirectUri: 'http://127.0.0.1:8788/oauth/callback', state: 'state-123' });
  const url = new URL(value);
  assert.equal(url.origin, 'https://open.larksuite.com');
  assert.equal(url.searchParams.get('app_id'), 'cli_test');
  assert.equal(url.searchParams.get('redirect_uri'), 'http://127.0.0.1:8788/oauth/callback');
  assert.equal(url.searchParams.get('state'), 'state-123');
  assert.deepEqual(url.searchParams.get('scope').split(' '), ['offline_access']);
});

test('authorization exchange uses an app token and never sends the app secret to the user-token endpoint', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    if (url.endsWith('/app_access_token/internal')) return { ok: true, status: 200, json: async () => ({ code: 0, app_access_token: 'app-token' }) };
    return { ok: true, status: 200, json: async () => ({ code: 0, data: { access_token: 'user-token', refresh_token: 'refresh-token', expires_in: 7200 } }) };
  };
  const appToken = await getAppAccessToken({ appId: 'cli_test', appSecret: 'secret-value', fetchImpl });
  const bundle = await exchangeAuthorizationCode({ code: 'one-time-code', appAccessToken: appToken, fetchImpl });
  assert.equal(bundle.access_token, 'user-token');
  assert.deepEqual(calls[0].body, { app_id: 'cli_test', app_secret: 'secret-value' });
  assert.deepEqual(calls[1].body, { grant_type: 'authorization_code', code: 'one-time-code' });
  assert.equal(calls[1].options.headers.authorization, 'Bearer app-token');
  assert.equal(JSON.stringify(calls[1]).includes('secret-value'), false);
});

test('token provider refreshes an expiring token, persists rotation, and reuses the fresh token', async () => {
  const oldRefreshToken = ['old', 'refresh', 'token'].join('-');
  const newRefreshToken = ['new', 'refresh', 'token'].join('-');
  const values = new Map(Object.entries({
    app_id: 'cli_test', app_secret: 'secret-value', user_access_token: 'old-user-token',
    refresh_token: oldRefreshToken, access_token_expires_at: '1005'
  }));
  const writes = [];
  let now = 1000;
  let calls = 0;
  const provider = createKeychainTokenProvider({
    service: 'test', clock: () => now,
    read: ({ account }) => values.get(account),
    write: ({ account, value }) => { values.set(account, value); writes.push(account); },
    fetchImpl: async (url, options) => {
      calls += 1;
      if (url.endsWith('/app_access_token/internal')) return { ok: true, status: 200, json: async () => ({ code: 0, app_access_token: 'app-token' }) };
      assert.equal(JSON.parse(options.body).refresh_token, oldRefreshToken);
      return { ok: true, status: 200, json: async () => ({ code: 0, data: { access_token: 'new-user-token', refresh_token: newRefreshToken, expires_in: 7200 } }) };
    }
  });
  assert.equal(await provider(), 'new-user-token');
  assert.deepEqual(writes.sort(), ['access_token_expires_at', 'refresh_token', 'user_access_token']);
  now = 1100;
  assert.equal(await provider(), 'new-user-token');
  assert.equal(calls, 2);
});

test('user info lookup uses the user token and returns open_id', async () => {
  const calls = [];
  const user = await getUserInfo({
    userAccessToken: 'user-token',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          code: 0,
          data: { open_id: 'ou_test', name: 'Tester' }
        })
      };
    }
  });
  assert.equal(user.open_id, 'ou_test');
  assert.equal(calls[0].url.endsWith('/open-apis/authen/v1/user_info'), true);
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.headers.authorization, 'Bearer user-token');
});

test('tenant token provider caches the tenant token until shortly before expiry', async () => {
  let now = 1000;
  let calls = 0;
  const read = ({ account }) => ({ app_id: 'cli_test', app_secret: 'secret-value' })[account];
  const fetchImpl = async (url, options) => {
    calls += 1;
    assert.equal(url.endsWith('/tenant_access_token/internal'), true);
    assert.deepEqual(JSON.parse(options.body), { app_id: 'cli_test', app_secret: 'secret-value' });
    return { ok: true, status: 200, json: async () => ({ code: 0, tenant_access_token: 'tenant-token', expire: 7200 }) };
  };
  const direct = await getTenantAccessToken({ appId: 'cli_test', appSecret: 'secret-value', fetchImpl });
  assert.equal(direct.token, 'tenant-token');
  const provider = createKeychainTenantTokenProvider({ service: 'test', read, fetchImpl, clock: () => now });
  assert.equal(await provider(), 'tenant-token');
  now += 60;
  assert.equal(await provider(), 'tenant-token');
  assert.equal(calls, 2);
});
