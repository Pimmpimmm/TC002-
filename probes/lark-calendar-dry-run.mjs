#!/usr/bin/env node
import { buildCalendarPlan } from './lib/lark-calendar.mjs';
import { assertNoCredentialEnv, exitOnError, ProbeError, required } from './lib/safety.mjs';

function positiveInt(name, fallback) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw)) throw new ProbeError(`ALARM ${name} must be a non-negative integer`);
  return Number(raw);
}

try {
  assertNoCredentialEnv();

  const calendarId = required('LARK_CALENDAR_ID');
  const now = Number(process.env.NOW_EPOCH_SECONDS || Math.floor(Date.now() / 1000));
  const sessionId = process.env.SESSION_ID?.trim() || null;
  const plan = buildCalendarPlan({
    calendarId,
    now,
    sessionId,
    focusSeconds: positiveInt('FOCUS_SECONDS', 2700),
    graceSeconds: positiveInt('GRACE_SECONDS', 0),
    extendSeconds: positiveInt('EXTEND_SECONDS', 600),
    maxExtensions: positiveInt('MAX_EXTENSIONS', 0),
    timezone: process.env.LARK_TIMEZONE?.trim() || 'Asia/Shanghai'
  });

  const hideCalendarId = url => url.replace(encodeURIComponent(calendarId.trim()), '[CALENDAR_ID]');

  console.log(JSON.stringify({
    spec: 'research/SPEC-V2-45-5.md (focus 2700 s, rest 300 s; Busy is exactly the focus window and expires by itself)',
    mutates_lark: false,
    credentials_accepted: false,
    calendar_id: '[REDACTED]',
    session_id: sessionId ? '[SESSION_ID]' : null,
    minimum_user_scopes_to_verify: [
      'calendar:calendar:read',
      'calendar:calendar.event:create',
      'calendar:calendar.event:delete'
    ],
    ...plan,
    create: { ...plan.create, url: hideCalendarId(plan.create.url) },
    extend_while_ringing: plan.extend_while_ringing
      ? { ...plan.extend_while_ringing, url: hideCalendarId(plan.extend_while_ringing.url) }
      : null,
    delete_on_early_exit: { ...plan.delete_on_early_exit, url: hideCalendarId(plan.delete_on_early_exit.url) },
    fail_safe: 'end_time releases Busy on its own, so a dead bridge, lost acknowledgement or failed DELETE cannot leave Busy stuck.'
  }, null, 2));
} catch (error) {
  exitOnError(error);
}
