#!/usr/bin/env node
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import path from 'node:path';
import { assertLocalBindHost } from '../probes/tc002-broker.mjs';
import { verifySignature } from './lib/auth.mjs';
import { readKeychainSecret } from './lib/keychain.mjs';
import { executeAction, resolveBase, resolveMode } from './lib/lark.mjs';
import { createKeychainTokenProvider } from './lib/lark-token.mjs';
import { loadStore, saveStore } from './lib/persist.mjs';
import {
  applyEvent, BridgeError, dueActions, emptyStore, FOCUS_SECONDS_DEFAULT, reconcile, settleAction, validateEnvelope
} from './lib/state.mjs';

const MAX_BODY_BYTES = 4096;
export const KEYCHAIN_SERVICE = 'tc002-focus-bridge';

export function defaultStateFile() {
  return process.env.BRIDGE_STATE_FILE?.trim()
    || path.join(homedir(), 'Library', 'Application Support', KEYCHAIN_SERVICE, 'state.json');
}

/**
 * The bridge never decides when a round starts or ends — the device does. Its whole job
 * is: verify the sender, keep one Lark event per session_id, and stop touching Lark once
 * the focus window is over (SPEC v2 §4, §5).
 */
export function createBridge({
  secret,
  calendarId,
  stateFile = defaultStateFile(),
  timezone = 'Asia/Shanghai',
  focusSeconds = FOCUS_SECONDS_DEFAULT,
  mode = 'dry',
  base = null,
  token = null,
  tokenProvider = null,
  fetchImpl = fetch,
  clock = () => Math.floor(Date.now() / 1000),
  log = line => console.log(JSON.stringify(line))
}) {
  if (typeof secret !== 'string' || secret.length < 16) {
    throw new BridgeError('ALARM BRIDGE shared secret must be at least 16 chars', 500);
  }
  if (typeof calendarId !== 'string' || !calendarId.trim()) {
    throw new BridgeError('ALARM missing LARK_CALENDAR_ID', 500);
  }
  if (!Number.isInteger(focusSeconds) || focusSeconds < 60) {
    throw new BridgeError('ALARM FOCUS_SECONDS must be an integer >= 60', 500);
  }

  let store = loadStore(stateFile);
  if (!store.sessions) store = emptyStore();
  let operationTail = Promise.resolve();

  function serialize(operation) {
    const current = operationTail.then(operation, operation);
    operationTail = current.catch(() => {});
    return current;
  }

  async function drain(now) {
    for (const action of dueActions(store, now)) {
      let result;
      try {
        result = await executeAction(action, { mode, base, calendarId, timezone, token, tokenProvider, fetchImpl });
      } catch (error) {
        result = { ok: false, error: error.message };
      }
      const settled = settleAction(store, action.id, result, now);
      store = settled.store;
      log({
        at: now,
        event: 'lark_action',
        action: action.id,
        type: action.type,
        ok: Boolean(result.ok),
        network: Boolean(result.network),
        event_id_present: Boolean(result.event_id),
        notes: settled.notes
      });
    }
    saveStore(stateFile, store);
  }

  function tick(now = clock()) {
    return serialize(async () => {
      const result = reconcile(store, now);
      store = result.store;
      if (result.notes.length) log({ at: now, event: 'reconcile', notes: result.notes });
      await drain(now);
    });
  }

  async function ingest({ rawBody, headers, now = clock() }) {
    verifySignature({
      secret,
      timestamp: headers['x-tc002-timestamp'],
      signature: headers['x-tc002-signature'],
      rawBody,
      now
    });
    let parsed;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      throw new BridgeError('ALARM body is not valid JSON');
    }
    const envelope = validateEnvelope(parsed, { now, focusSeconds });
    return serialize(async () => {
      const applied = applyEvent(store, envelope, now);
      store = applied.store;
      saveStore(stateFile, store);
      log({
        at: now,
        event: 'device_event',
        kind: envelope.event,
        session_id: envelope.session_id,
        state: envelope.state,
        reason: envelope.reason,
        queued: applied.actions.map(action => action.id),
        notes: applied.notes
      });
      await drain(now);
      return { ok: true, queued: applied.actions.length };
    });
  }

  const server = createServer((request, response) => {
    const reply = (status, payload) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(payload));
    };
    if (request.method !== 'POST' || request.url.split('?')[0] !== '/focus') {
      return reply(404, { ok: false, error: 'ALARM only POST /focus is served' });
    }
    let rawBody = '';
    let aborted = false;
    request.on('data', chunk => {
      rawBody += chunk;
      if (rawBody.length > MAX_BODY_BYTES && !aborted) {
        aborted = true;
        reply(413, { ok: false, error: 'ALARM body too large' });
        request.destroy();
      }
    });
    request.on('end', () => {
      if (aborted) return;
      ingest({ rawBody, headers: request.headers })
        .then(result => reply(202, result))
        .catch(error => {
          log({ at: clock(), event: 'rejected', error: error.message });
          reply(error.httpStatus || 400, { ok: false, error: error.message });
        });
    });
  });

  return {
    server,
    getStore: () => store,
    ingest,
    tick,
    async listen({ host = '127.0.0.1', port = 0 } = {}) {
      assertLocalBindHost(host);
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, resolve);
      });
      return { host, port: server.address().port };
    },
    async close() {
      await new Promise(resolve => server.close(resolve));
    }
  };
}

async function main() {
  const mode = resolveMode();
  const tokenProvider = mode === 'real' ? createKeychainTokenProvider({ service: KEYCHAIN_SERVICE }) : null;
  const bridge = createBridge({
    mode,
    base: resolveBase(mode),
    secret: process.env.BRIDGE_SHARED_SECRET?.trim() || readKeychainSecret({ service: KEYCHAIN_SERVICE, account: 'shared_secret' }),
    calendarId: process.env.LARK_CALENDAR_ID?.trim()
      || readKeychainSecret({ service: KEYCHAIN_SERVICE, account: 'calendar_id' }),
    token: mode === 'fake' ? readKeychainSecret({ service: KEYCHAIN_SERVICE, account: 'user_access_token' }) : null,
    tokenProvider,
    focusSeconds: Number(process.env.FOCUS_SECONDS || FOCUS_SECONDS_DEFAULT)
  });
  const bind = await bridge.listen({
    host: process.env.BRIDGE_HOST?.trim() || '127.0.0.1',
    port: Number(process.env.BRIDGE_PORT || 8787)
  });
  console.log(JSON.stringify({ event: 'bridge_ready', mode, port: bind.port, state_file: 'set' }));
  const timer = setInterval(() => { bridge.tick().catch(error => console.error(error.message)); }, 15_000);
  const stop = async reason => {
    clearInterval(timer);
    await bridge.close();
    console.log(JSON.stringify({ event: 'bridge_stopped', reason }));
  };
  process.once('SIGINT', () => stop('SIGINT'));
  process.once('SIGTERM', () => stop('SIGTERM'));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error.message.startsWith('ALARM') ? error.message : `ALARM bridge failed: ${error.message}`);
    process.exitCode = error.httpStatus === 500 ? 2 : 1;
  });
}
