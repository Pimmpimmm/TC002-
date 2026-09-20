import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const repo = path.resolve(import.meta.dirname, '..');

async function fakeAdb({ connectFails = false } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'tc002-adb-test.'));
  const log = path.join(directory, 'calls.log');
  const executable = path.join(directory, 'adb');
  const script = `#!/bin/sh
printf '%s\\n' "$*" >> "$ADB_TEST_LOG"
if [ "$1" = connect ]; then
  ${connectFails ? 'echo "failed to connect"; exit 1' : 'echo "connected to $2"; exit 0'}
fi
if [ "$3" = get-state ]; then echo device; fi
exit 0
`;
  await writeFile(executable, script);
  await chmod(executable, 0o755);
  return { directory, log };
}

test('a fresh device is connected before configure-device writes anything', async () => {
  const mock = await fakeAdb();
  try {
    const result = spawnSync('/bin/bash', [
      path.join(repo, 'companion/configure-device.sh'),
      '--adb-target', '192.0.2.131',
      '--lan-host', '192.0.2.100'
    ], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${mock.directory}:/usr/bin:/bin`, ADB_TEST_LOG: mock.log }
    });
    assert.equal(result.status, 0, result.stderr);
    const calls = (await readFile(mock.log, 'utf8')).trim().split('\n');
    assert.equal(calls[0], 'connect 192.0.2.131:5555');
    assert.match(calls[1], /^-s 192\.0\.2\.131:5555 get-state$/);
    assert.match(calls[2], /^-s 192\.0\.2\.131:5555 shell /);
    assert.match(calls[3], /^-s 192\.0\.2\.131:5555 push /);
  } finally {
    await rm(mock.directory, { recursive: true, force: true });
  }
});

test('a failed first ADB connection stops before any device write', async () => {
  const mock = await fakeAdb({ connectFails: true });
  try {
    const result = spawnSync('/bin/bash', [
      path.join(repo, 'companion/configure-device.sh'),
      '--adb-target', '192.0.2.131:5555',
      '--lan-host', '192.0.2.100'
    ], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${mock.directory}:/usr/bin:/bin`, ADB_TEST_LOG: mock.log }
    });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /ADB 无法连接/);
    const calls = (await readFile(mock.log, 'utf8')).trim().split('\n');
    assert.deepEqual(calls, ['connect 192.0.2.131:5555']);
  } finally {
    await rm(mock.directory, { recursive: true, force: true });
  }
});
