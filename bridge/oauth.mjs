#!/usr/bin/env node
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readKeychainSecret, writeKeychainSecret } from './lib/keychain.mjs';
import {
  authorizationUrl, exchangeAuthorizationCode, getAppAccessToken, getTenantAccessToken, getUserInfo, persistTokenBundle
} from './lib/lark-token.mjs';
import { ensureFocusSystemStatus } from './lib/system-status.mjs';
import { KEYCHAIN_SERVICE } from './server.mjs';

export const OAUTH_HOST = '127.0.0.1';
export const OAUTH_PORT = 8788;
export const OAUTH_PATH = '/oauth/callback';

export async function closeOAuthServer(server, { forceAfterMs = 1_000 } = {}) {
  await new Promise(resolve => {
    let finished = false;
    let forceTimer;
    const done = () => {
      if (finished) return;
      finished = true;
      if (forceTimer) clearTimeout(forceTimer);
      resolve();
    };
    server.close(done);
    server.closeIdleConnections?.();
    forceTimer = setTimeout(() => {
      server.closeAllConnections?.();
      done();
    }, forceAfterMs);
    forceTimer.unref?.();
  });
}

export async function runOAuth({
  service = KEYCHAIN_SERVICE,
  host = OAUTH_HOST,
  port = OAUTH_PORT,
  fetchImpl = fetch,
  clock = () => Math.floor(Date.now() / 1000),
  timeoutMs = 300_000,
  log = console.log
} = {}) {
  const appId = readKeychainSecret({ service, account: 'app_id' });
  const appSecret = readKeychainSecret({ service, account: 'app_secret' });
  const state = randomBytes(24).toString('hex');
  const redirectUri = `http://${host}:${port}${OAUTH_PATH}`;
  let finish;
  const completed = new Promise((resolve, reject) => { finish = { resolve, reject }; });
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, redirectUri);
    if (url.pathname !== OAUTH_PATH) { response.writeHead(404).end('Not found'); return; }
    if (url.searchParams.get('state') !== state) {
      response.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' }).end('Authorization failed: state mismatch.');
      finish.reject(new Error('ALARM OAuth state mismatch'));
      return;
    }
    const code = url.searchParams.get('code');
    if (!code || url.searchParams.get('error')) {
      response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end('Authorization was not granted.');
      finish.reject(new Error('ALARM Lark authorization was not granted'));
      return;
    }
    try {
      const appAccessToken = await getAppAccessToken({ appId, appSecret, fetchImpl });
      const bundle = await exchangeAuthorizationCode({ code, appAccessToken, fetchImpl });
      persistTokenBundle({ service, bundle, now: clock() });
      const user = await getUserInfo({ userAccessToken: bundle.access_token, fetchImpl });
      writeKeychainSecret({ service, account: 'user_open_id', value: user.open_id });
      const tenant = await getTenantAccessToken({ appId, appSecret, fetchImpl });
      const ensured = await ensureFocusSystemStatus({ tenantAccessToken: tenant.token, fetchImpl });
      writeKeychainSecret({ service, account: 'system_status_id', value: ensured.status.system_status_id });
      response.once('finish', () => finish.resolve({ ok: true, createdStatus: ensured.created }));
      response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end('Lark authorization succeeded. You can close this page.');
    } catch (error) {
      response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' }).end('Authorization failed. Return to Terminal for the error.');
      finish.reject(error);
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  const timer = setTimeout(() => finish.reject(new Error('ALARM OAuth timed out after 5 minutes')), timeoutMs);
  log('\n请在浏览器打开下面的 Lark 授权链接：\n');
  const url = authorizationUrl({ appId, redirectUri, state });
  log(url);
  if (process.env.TC002_OPEN_BROWSER === '1') {
    const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
    const browser = spawn(opener, [url], { detached: true, stdio: 'ignore' });
    browser.unref();
  }
  log('\n授权后浏览器会自动返回本机。请不要关闭这个终端窗口。\n');
  try {
    await completed;
    log('授权成功：Token、用户 open_id 和“专注中”状态 ID 已写入 macOS 钥匙串。');
  } finally {
    clearTimeout(timer);
    await closeOAuthServer(server);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runOAuth().catch(error => { console.error(error.message); process.exitCode = 2; });
}
