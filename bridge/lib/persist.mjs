import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { emptyStore } from './state.mjs';

// Restart rule (SPEC v2 §5.3): only absolute values are restored, never recomputed.
export function loadStore(file) {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (!parsed || parsed.v !== 1 || typeof parsed.sessions !== 'object') return emptyStore();
    return { v: 1, sessions: parsed.sessions, queue: Array.isArray(parsed.queue) ? parsed.queue : [] };
  } catch {
    return emptyStore();
  }
}

export function saveStore(file, store) {
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  writeFileSync(temporary, JSON.stringify(store), { mode: 0o600 });
  renameSync(temporary, file);
  return file;
}
