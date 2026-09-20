#!/usr/bin/env node
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

/**
 * Loopback stand-in for Lark Calendar v4 used by S5 fault tests. It asserts the
 * request shape the real API needs and records metadata only — never a token value.
 */
export function createFakeLark({ failCreateTimes = 0, failDeleteTimes = 0 } = {}) {
  const requests = [];
  let createFailures = failCreateTimes;
  let deleteFailures = failDeleteTimes;
  let sequence = 0;

  const server = createServer((request, response) => {
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      const authorized = /^Bearer .+/.test(request.headers.authorization || '');
      const record = {
        method: request.method,
        path: request.url.split('?')[0],
        has_idempotency_key: request.url.includes('idempotency_key='),
        authorized
      };
      const send = (status, payload) => {
        record.status = status;
        requests.push(record);
        response.writeHead(status, { 'content-type': 'application/json' });
        response.end(JSON.stringify(payload));
      };
      if (!authorized) return send(401, { code: 99991663, msg: 'missing token' });
      if (request.method === 'POST' && record.path.endsWith('/events')) {
        const parsed = JSON.parse(body || '{}');
        record.free_busy_status = parsed.free_busy_status;
        record.visibility = parsed.visibility;
        record.start_timestamp = parsed.start_time?.timestamp;
        record.end_timestamp = parsed.end_time?.timestamp;
        if (createFailures > 0) { createFailures -= 1; return send(503, { code: 1, msg: 'fake outage' }); }
        sequence += 1;
        return send(200, { code: 0, data: { event: { event_id: `evt_fake_${sequence}` } } });
      }
      if (request.method === 'DELETE' && record.path.includes('/events/')) {
        if (deleteFailures > 0) { deleteFailures -= 1; return send(503, { code: 1, msg: 'fake outage' }); }
        return send(200, { code: 0 });
      }
      if (request.method === 'POST' && record.path.endsWith('/calendars/primary')) {
        return send(200, { code: 0, data: { calendar: { calendar_id: 'primary-fake' } } });
      }
      return send(404, { code: 1, msg: 'unexpected route' });
    });
  });

  return {
    requests,
    async listen() {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      return `http://127.0.0.1:${server.address().port}`;
    },
    async close() {
      await new Promise(resolve => server.close(resolve));
    }
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const fake = createFakeLark();
  fake.listen().then(base => console.log(JSON.stringify({ event: 'fake_lark_ready', base })));
}
