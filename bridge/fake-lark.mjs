#!/usr/bin/env node
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

/** Loopback stand-in for the Lark Personal Settings API used by fault tests. */
export function createFakeLark({ failOpenTimes = 0, failCloseTimes = 0 } = {}) {
  const requests = [];
  let openFailures = failOpenTimes;
  let closeFailures = failCloseTimes;

  const server = createServer((request, response) => {
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      const authorized = /^Bearer .+/.test(request.headers.authorization || '');
      const record = { method: request.method, path: request.url.split('?')[0], authorized };
      const send = (status, payload) => {
        record.status = status;
        requests.push(record);
        response.writeHead(status, { 'content-type': 'application/json' });
        response.end(JSON.stringify(payload));
      };
      if (!authorized) return send(401, { code: 99991663, msg: 'missing token' });
      if (request.method === 'POST' && record.path.endsWith('/batch_open')) {
        const parsed = JSON.parse(body || '{}');
        record.user_id = parsed.user_list?.[0]?.user_id;
        record.end_time = parsed.user_list?.[0]?.end_time;
        if (openFailures > 0) { openFailures -= 1; return send(503, { code: 1, msg: 'fake outage' }); }
        return send(200, { code: 0, data: { result_list: [{ user_id: record.user_id, result: 'success_show' }] } });
      }
      if (request.method === 'POST' && record.path.endsWith('/batch_close')) {
        const parsed = JSON.parse(body || '{}');
        record.user_id = parsed.user_list?.[0];
        if (closeFailures > 0) { closeFailures -= 1; return send(503, { code: 1, msg: 'fake outage' }); }
        return send(200, { code: 0, data: { result_list: [{ user_id: record.user_id, result: 'success' }] } });
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
    async close() { await new Promise(resolve => server.close(resolve)); }
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const fake = createFakeLark();
  fake.listen().then(base => console.log(JSON.stringify({ event: 'fake_lark_ready', base })));
}
