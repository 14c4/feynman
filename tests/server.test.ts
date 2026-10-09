import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import type { ApiError } from '../shared/types.js';
import { handleRequest } from '../server/routes.js';

test('health works, integrations return 501, and unknown endpoints return 404', async () => {
  const server = createServer(handleRequest);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const health = await fetch(`${base}/api/health`);
    assert.equal(health.status, 200);
    assert.equal(health.headers.get('content-type'), 'application/json; charset=utf-8');
    assert.deepEqual(await health.json(), { status: 'ok', service: 'feynman.ai', integrations: 'pending' });
    for (const route of ['/api/voice/session', '/api/student/reply', '/api/evaluations']) {
      const response = await fetch(`${base}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      assert.equal(response.status, 501);
      const body = await response.json() as ApiError;
      assert.equal(body.error.code, 'INTEGRATION_PENDING');
    }
    const unknown = await fetch(`${base}/api/unknown`);
    assert.equal(unknown.status, 404);
    const body = await unknown.json() as ApiError;
    assert.equal(body.error.code, 'NOT_FOUND');
    assert.equal((await fetch(`${base}/api/evaluations`)).status, 404);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
