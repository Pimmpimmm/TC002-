#!/usr/bin/env node
import { assertNoCredentialEnv, exitOnError, ProbeError, required } from './lib/safety.mjs';

try {
  assertNoCredentialEnv();
  const openId = required('LARK_OPEN_ID');
  const statusId = required('LARK_SYSTEM_STATUS_ID');
  if (!/^ou_[A-Za-z0-9]+$/.test(openId)) throw new ProbeError('ALARM LARK_OPEN_ID must look like an application-scoped open_id');
  if (!/^\d+$/.test(statusId)) throw new ProbeError('ALARM LARK_SYSTEM_STATUS_ID must be numeric');
  const now = Number(process.env.NOW_EPOCH_SECONDS || Math.floor(Date.now() / 1000));
  if (!Number.isInteger(now) || now <= 0) throw new ProbeError('ALARM invalid NOW_EPOCH_SECONDS');
  const base = 'https://open.larksuite.com/open-apis/personal_settings/v1/system_statuses/[SYSTEM_STATUS_ID]';
  console.log(JSON.stringify({
    mutates_lark: false,
    token_type: 'tenant_access_token (not supplied in this dry run)',
    open: { method: 'POST', url: `${base}/batch_open?user_id_type=open_id`, body: { user_list: [{ user_id: '[SELF_OPEN_ID]', end_time: now + 1800 }] } },
    early_close: { method: 'POST', url: `${base}/batch_close?user_id_type=open_id`, body: { user_list: ['[SELF_OPEN_ID]'] } },
    compensation: 'On reconnect, if local BUSY session is still active and deadline is future, re-open with the same absolute deadline; otherwise batch_close. Treat per-user result, not HTTP 200 alone, as outcome.'
  }, null, 2));
} catch (error) { exitOnError(error); }
