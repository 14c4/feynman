import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createPracticeHandler } from '../server/routes.js';
import { createDevelopmentProviders } from '../server/developmentProviders.js';
import { bucketFor, clientAddress, RateLimiter } from '../server/protection.js';
import { MemorySessionStore, type StoredRecord } from '../server/store.js';
import { createStaticHandler } from '../server/static.js';
import { providerFailure } from '../server/providers.js';
import type { IncomingMessage } from 'node:http';

async function listen(handler: Parameters<typeof createServer>[1]) {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No address');
  return { base: `http://127.0.0.1:${address.port}`, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

test('routes map to the expected rate-limit buckets', () => {
  const id = '00000000-0000-4000-8000-000000000000';
  assert.equal(bucketFor('POST', '/api/sessions'), 'create');
  assert.equal(bucketFor('POST', `/api/sessions/${id}/prepare`), 'provider');
  assert.equal(bucketFor('POST', `/api/sessions/${id}/submit`), 'provider');
  assert.equal(bucketFor('POST', `/api/sessions/${id}/conversations/abc/messages`), 'provider');
  assert.equal(bucketFor('POST', `/api/sessions/${id}/voice`), 'voice');
  assert.equal(bucketFor('POST', `/api/sessions/${id}/monitoring/${id}/frames`), 'frames');
  assert.equal(bucketFor('PATCH', `/api/sessions/${id}`), 'api');
  assert.equal(bucketFor('GET', '/api/health'), 'api');
});

test('client address uses the proxy-appended X-Forwarded-For entry only when trusted', () => {
  const req = { headers: { 'x-forwarded-for': '1.1.1.1, 203.0.113.9' }, socket: { remoteAddress: '10.0.0.2' } } as unknown as IncomingMessage;
  assert.equal(clientAddress(req, true), '203.0.113.9');
  assert.equal(clientAddress(req, false), '10.0.0.2');
});

test('rate limiter blocks over the limit and resets after the window', () => {
  let now = 0;
  const limiter = new RateLimiter({ create: { limit: 2, windowMs: 1000 }, provider: { limit: 1, windowMs: 1000 }, voice: { limit: 1, windowMs: 1000 }, frames: { limit: 1, windowMs: 1000 }, api: { limit: 1, windowMs: 1000 } }, () => now);
  assert.equal(limiter.hit('a', 'create').ok, true);
  assert.equal(limiter.hit('a', 'create').ok, true);
  const blocked = limiter.hit('a', 'create');
  assert.equal(blocked.ok, false); if (!blocked.ok) assert.equal(blocked.retryAfterMs, 1000);
  assert.equal(limiter.hit('b', 'create').ok, true, 'other clients are unaffected');
  now = 1001;
  assert.equal(limiter.hit('a', 'create').ok, true);
});

test('API answers 429 with Retry-After once a client exceeds the session-creation limit', async () => {
  const env = { NODE_ENV: 'test', PRACTICE_PROVIDER_MODE: 'mock', MOCK_PROVIDER_DELAY_MS: '0' };
  const limiter = new RateLimiter({ create: { limit: 1, windowMs: 60_000 }, provider: { limit: 10, windowMs: 60_000 }, voice: { limit: 10, windowMs: 60_000 }, frames: { limit: 10, windowMs: 60_000 }, api: { limit: 10, windowMs: 60_000 } });
  const api = await listen(createPracticeHandler({ env, providers: createDevelopmentProviders(env), limiter }));
  try {
    const create = () => fetch(`${api.base}/api/sessions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ description: 'Fractions' }) });
    assert.equal((await create()).status, 201);
    const blocked = await create();
    assert.equal(blocked.status, 429);
    assert.equal(blocked.headers.get('retry-after'), '60');
    const body = await blocked.json() as { error: { code: string; message: string } };
    assert.equal(body.error.code, 'TOO_MANY_REQUESTS');
    assert.match(body.error.message, /your work is saved/);
    assert.equal((await fetch(`${api.base}/api/health`)).status, 200, 'other buckets still work');
  } finally { await api.close(); }
});

test('memory store evicts idle sessions and the oldest beyond its cap', async () => {
  let now = 0; const evicted: string[] = [];
  const store = new MemorySessionStore({ maxSessions: 2, idleTtlMs: 1000, onEvict: (id) => evicted.push(id) }, () => now);
  const record = (id: string) => ({ session: { id }, tokenHash: '', blueprint: null, conversationOwners: {} }) as unknown as StoredRecord;
  await store.set(record('a')); await store.set(record('b')); await store.set(record('c'));
  assert.equal(await store.get('a'), undefined);
  assert.deepEqual(evicted, ['a']);
  now = 2000;
  assert.equal(await store.get('b'), undefined, 'idle sessions expire');
  assert.ok(evicted.includes('b'));
});

test('static handler serves the build, falls back to index.html for routes, and 404s missing assets', async () => {
  const root = mkdtempSync(join(tmpdir(), 'feynman-dist-'));
  mkdirSync(join(root, 'assets'));
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>feynman.ai</title>');
  writeFileSync(join(root, 'assets', 'app-abc.js'), `console.log(${JSON.stringify('x'.repeat(4000))});`);
  const serve = createStaticHandler(root);
  const site = await listen((req, res) => { if (!serve(req, res)) { res.writeHead(404); res.end(); } });
  try {
    const page = await fetch(`${site.base}/study/123`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /feynman\.ai/);
    assert.equal(page.headers.get('cache-control'), 'no-cache');
    assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
    const asset = await fetch(`${site.base}/assets/app-abc.js`);
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get('content-type') ?? '', /javascript/);
    assert.match(asset.headers.get('cache-control') ?? '', /immutable/);
    assert.equal((await fetch(`${site.base}/assets/missing.js`)).status, 404);
    assert.equal((await fetch(`${site.base}/..%2f..%2fpackage.json`)).status, 404);
  } finally { await site.close(); }
});

test('rejected provider keys and voice quota produce plain-language errors', () => {
  const gemini = providerFailure('Gemini', 400, { error: { status: 'INVALID_ARGUMENT', message: 'API key not valid. Please pass a valid API key.' } });
  assert.equal(gemini.code, 'PROVIDER_AUTH'); assert.equal(gemini.status, 503);
  assert.match(gemini.message, /Gemini API key was rejected/);
  const voiceKey = providerFailure('ElevenLabs', 401, { detail: { status: 'invalid_api_key', message: 'Invalid API key' } });
  assert.equal(voiceKey.code, 'PROVIDER_AUTH'); assert.match(voiceKey.message, /teach Alex by typing/);
  const voiceQuota = providerFailure('ElevenLabs', 429, { detail: { status: 'quota_exceeded', message: 'This request exceeds your quota.' } });
  assert.equal(voiceQuota.code, 'VOICE_QUOTA'); assert.equal(voiceQuota.status, 429);
});
