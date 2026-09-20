#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { writeKeychainSecret } from './lib/keychain.mjs';
import { createKeychainTokenProvider, getPrimaryCalendar } from './lib/lark-token.mjs';

export const KEYCHAIN_SERVICE = 'tc002-focus-bridge';

export async function savePrimaryCalendar({
  service = KEYCHAIN_SERVICE,
  tokenProvider = createKeychainTokenProvider({ service }),
  fetchImpl = fetch,
  write = writeKeychainSecret
} = {}) {
  const userAccessToken = await tokenProvider();
  const calendar = await getPrimaryCalendar({ userAccessToken, fetchImpl });
  write({ service, account: 'calendar_id', value: calendar.calendar_id });
  return { saved: true, writable: !['reader', 'free_busy_reader'].includes(calendar.role) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  savePrimaryCalendar()
    .then(result => {
      if (!result.writable) throw new Error('主日历只有只读权限，无法创建忙碌日程');
      console.log('主日历已确认并安全写入 macOS 钥匙串。');
    })
    .catch(error => {
      console.error(error.message.startsWith('ALARM') ? error.message : `ALARM ${error.message}`);
      process.exitCode = 1;
    });
}
