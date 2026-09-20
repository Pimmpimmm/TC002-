import { createHash } from 'node:crypto';
import { ProbeError } from './safety.mjs';

const LARK_BASE = 'https://open.larksuite.com';

function integerInRange(name, value, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ProbeError(`ALARM ${name} must be an integer in ${min}..${max}`);
  }
  return value;
}

/**
 * SPEC v2 (research/SPEC-V2-45-5.md), user decision 2026-09-11: Busy is exactly the focus
 * window. The event ends itself at focus_deadline and the bridge does nothing about it;
 * the next focus round books a new event. The only write after create is a DELETE when the
 * user leaves early (stop before focus_deadline). graceSeconds/extendSeconds/maxExtensions
 * stay as opt-in parameters (all default 0 / off) so "stay Busy while ringing" can be
 * re-enabled by configuration without touching this contract.
 */
export function buildCalendarPlan({
  calendarId,
  now,
  sessionId = null,
  focusSeconds = 2700,
  graceSeconds = 0,
  extendSeconds = 600,
  maxExtensions = 0,
  timezone = 'Asia/Shanghai'
}) {
  if (typeof calendarId !== 'string' || !calendarId.trim()) throw new ProbeError('ALARM missing calendar_id');
  if (!Number.isInteger(now) || now <= 0) throw new ProbeError('ALARM invalid NOW_EPOCH_SECONDS');
  integerInRange('FOCUS_SECONDS', focusSeconds, 60, 14_400);
  integerInRange('GRACE_SECONDS', graceSeconds, 0, 3_600);
  integerInRange('EXTEND_SECONDS', extendSeconds, 60, 1_800);
  integerInRange('MAX_EXTENSIONS', maxExtensions, 0, 6);
  if (sessionId !== null && !/^[A-Za-z0-9_-]{8,64}$/.test(sessionId)) {
    throw new ProbeError('ALARM session_id must be 8..64 chars of [A-Za-z0-9_-]');
  }
  if (!/^[A-Za-z_]+\/[A-Za-z0-9_+\-/]+$/.test(timezone)) throw new ProbeError('ALARM invalid IANA timezone');

  const trimmedCalendarId = calendarId.trim();
  const encodedCalendarId = encodeURIComponent(trimmedCalendarId);
  const base = `${LARK_BASE}/open-apis/calendar/v4/calendars/${encodedCalendarId}/events`;

  const focusDeadline = now + focusSeconds;
  const bookedEnd = focusDeadline + graceSeconds;
  const busyCeiling = bookedEnd + extendSeconds * maxExtensions;

  // One key per session (falls back to the start second when the device sent no id),
  // so a retried start never books a second event for the same round.
  const idempotencyKey = createHash('sha256')
    .update(`tc002-focus:${trimmedCalendarId}:${sessionId ?? now}:${focusSeconds}:${graceSeconds}`)
    .digest('hex');

  return {
    token_type: 'user_access_token',
    primary_calendar: {
      method: 'POST',
      url: `${LARK_BASE}/open-apis/calendar/v4/calendars/primary`
    },
    create: {
      method: 'POST',
      url: `${base}?idempotency_key=${idempotencyKey}`,
      body: {
        summary: '专注',
        need_notification: false,
        start_time: { timestamp: String(now), timezone },
        end_time: { timestamp: String(bookedEnd), timezone },
        vchat: { vc_type: 'no_meeting' },
        visibility: 'private',
        attendee_ability: 'none',
        free_busy_status: 'busy',
        reminders: []
      }
    },
    extend_while_ringing: maxExtensions > 0
      ? {
          method: 'PATCH',
          url: `${base}/:event_id`,
          body: { end_time: { timestamp: ':current_end_plus_extend', timezone } },
          event_id_source: 'create response data.event.event_id',
          trigger: 'device heartbeat still reports FOCUS_ALARM at booked_end - 120s',
          extend_seconds: extendSeconds,
          max_extensions: maxExtensions
        }
      : null,
    delete_on_early_exit: {
      method: 'DELETE',
      url: `${base}/:event_id?need_notification=false`,
      event_id_source: 'create response data.event.event_id',
      trigger: 'stop received while now < focus_deadline (user_exit). At or after focus_deadline the event has already expired, so the bridge makes no call.'
    },
    busy_release: maxExtensions > 0 ? 'booked_end, extended while ringing' : 'booked_end, no bridge action required',
    focus_deadline: focusDeadline,
    booked_end: bookedEnd,
    busy_ceiling: busyCeiling,
    idempotency_key_length: idempotencyKey.length
  };
}
