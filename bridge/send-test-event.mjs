#!/usr/bin/env node
// Signed smoke-test client. It is also the reference implementation of the signature
// the TC002 firmware must produce: HMAC-SHA256 over `${timestamp}.${rawBody}`.
import { sign } from './lib/auth.mjs';
import { KEYCHAIN_SERVICE } from './server.mjs';
import { readKeychainSecret } from './lib/keychain.mjs';
import { FOCUS_SECONDS_DEFAULT } from './lib/state.mjs';

function parseArgs(argv) {
  const options = {
    event: 'start', session: null, host: '127.0.0.1', port: '8787',
    state: null, reason: null, startedAt: null, focusSeconds: String(FOCUS_SECONDS_DEFAULT), recipe: false
  };
  const map = {
    '--event': 'event', '--session': 'session', '--host': 'host', '--port': 'port',
    '--state': 'state', '--reason': 'reason', '--started-at': 'startedAt', '--focus-seconds': 'focusSeconds'
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--print-recipe') { options.recipe = true; continue; }
    const key = map[flag];
    if (!key) throw new Error(`ALARM unknown argument ${flag}`);
    options[key] = argv[index + 1];
    index += 1;
  }
  if (!['start', 'stop', 'heartbeat'].includes(options.event)) throw new Error('ALARM --event must be start, stop or heartbeat');
  if (!options.session) throw new Error('ALARM --session is required (8..64 chars of [A-Za-z0-9_-])');
  return options;
}

const RECIPE = `signature recipe (device side)
  timestamp = 当前 epoch 秒
  raw_body  = 要发送的 JSON 字符串（字节级原样，不要重新序列化）
  signature = HMAC_SHA256(shared_secret, timestamp + "." + raw_body) 的小写 hex
  headers   = X-TC002-Timestamp: <timestamp>
              X-TC002-Signature: <signature>
              Content-Type: application/json
  端点      = POST http://<mac-ip>:<port>/focus
  时间窗    = 服务端只接受 ±120 秒内的 timestamp`;

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.recipe) console.log(RECIPE);

  const secret = process.env.BRIDGE_SHARED_SECRET?.trim()
    || readKeychainSecret({ service: KEYCHAIN_SERVICE, account: 'shared_secret' });
  const now = Math.floor(Date.now() / 1000);
  const focusSeconds = Number(options.focusSeconds);
  const startedAt = options.startedAt ? Number(options.startedAt) : now;
  const defaultState = options.event === 'start' ? 'FOCUS' : 'IDLE';
  const body = {
    v: 1,
    session_id: options.session,
    event: options.event,
    state: options.state || defaultState,
    reason: options.reason || (options.event === 'start' ? 'middle_press' : 'user_exit'),
    started_at: startedAt,
    focus_deadline: startedAt + focusSeconds
  };
  const rawBody = JSON.stringify(body);
  const response = await fetch(`http://${options.host}:${options.port}/focus`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-tc002-timestamp': String(now),
      'x-tc002-signature': sign(secret, now, rawBody)
    },
    body: rawBody
  });
  const text = await response.text();
  console.log(JSON.stringify({ sent: { ...body, session_id: body.session_id }, status: response.status, response: text }));
  if (!response.ok) process.exitCode = 2;
}

main().catch(error => {
  console.error(error.message.startsWith('ALARM') ? error.message : `ALARM test client failed: ${error.message}`);
  process.exitCode = 2;
});
