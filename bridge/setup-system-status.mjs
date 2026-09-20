#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { readKeychainSecret, writeKeychainSecret } from './lib/keychain.mjs';
import { createKeychainTenantTokenProvider, createKeychainTokenProvider, getUserInfo } from './lib/lark-token.mjs';
import { ensureFocusSystemStatus } from './lib/system-status.mjs';

export const KEYCHAIN_SERVICE = 'tc002-focus-bridge';

export async function setupSystemStatus({
  service = KEYCHAIN_SERVICE,
  userTokenProvider = createKeychainTokenProvider({ service }),
  tenantTokenProvider = createKeychainTenantTokenProvider({ service }),
  fetchImpl = fetch,
  read = readKeychainSecret,
  write = writeKeychainSecret
} = {}) {
  let userOpenId;
  try { userOpenId = read({ service, account: 'user_open_id' }); } catch { userOpenId = ''; }
  if (!userOpenId) {
    const userAccessToken = await userTokenProvider();
    const user = await getUserInfo({ userAccessToken, fetchImpl });
    userOpenId = user.open_id;
    write({ service, account: 'user_open_id', value: userOpenId });
  }
  const tenantAccessToken = await tenantTokenProvider();
  const ensured = await ensureFocusSystemStatus({ tenantAccessToken, fetchImpl });
  write({ service, account: 'system_status_id', value: ensured.status.system_status_id });
  return { saved: true, created: ensured.created, userOpenId, systemStatusId: ensured.status.system_status_id };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  setupSystemStatus()
    .then(result => console.log(result.created ? '已创建“专注中”状态并写入钥匙串。' : '已复用“专注中”状态并写入钥匙串。'))
    .catch(error => {
      console.error(error.message.startsWith('ALARM') ? error.message : `ALARM ${error.message}`);
      process.exitCode = 1;
    });
}
