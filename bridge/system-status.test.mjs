import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureFocusSystemStatus } from './lib/system-status.mjs';

test('reuses an existing focus status without creating a duplicate', async () => {
  const calls = [];
  const result = await ensureFocusSystemStatus({
    tenantAccessToken: 'tenant-token',
    base: 'https://example.test',
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return { ok: true, status: 200, json: async () => ({ code: 0, data: { items: [{ system_status_id: 'status-1', title: '专注中', priority: 1 }] } }) };
    }
  });
  assert.equal(result.created, false);
  assert.equal(result.status.system_status_id, 'status-1');
  assert.equal(calls.length, 1);
});

test('creates focus status with the first unused priority', async () => {
  const calls = [];
  const result = await ensureFocusSystemStatus({
    tenantAccessToken: 'tenant-token',
    base: 'https://example.test',
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      if (!options?.body) return { ok: true, status: 200, json: async () => ({ code: 0, data: { items: [{ system_status_id: 'other', title: '会议', priority: 1 }] } }) };
      const body = JSON.parse(options.body);
      assert.deepEqual(body, { title: '专注中', icon_key: 'StatusReading', color: 'GREEN', priority: 2 });
      return { ok: true, status: 200, json: async () => ({ code: 0, data: { system_status: { system_status_id: 'status-2', ...body } } }) };
    }
  });
  assert.equal(result.created, true);
  assert.equal(result.status.system_status_id, 'status-2');
  assert.equal(calls.length, 2);
});
