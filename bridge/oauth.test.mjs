import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, get as httpGet, Agent } from 'node:http';
import { closeOAuthServer } from './oauth.mjs';

test('OAuth server closes even when the browser keeps its callback connection alive', async () => {
  const server = createServer((_request, response) => {
    response.setHeader('connection', 'keep-alive');
    response.end('ok');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const agent = new Agent({ keepAlive: true });
  await new Promise((resolve, reject) => {
    httpGet(`http://127.0.0.1:${address.port}/oauth/callback`, { agent }, response => {
      response.resume();
      response.once('end', resolve);
    }).once('error', reject);
  });

  await Promise.race([
    closeOAuthServer(server, { forceAfterMs: 100 }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('OAuth server did not close')), 1_000))
  ]);
  agent.destroy();
  assert.equal(server.listening, false);
});
