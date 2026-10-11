import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import test, { type TestContext } from 'node:test';
import type { PracticeSession, SessionAccess, SessionSummary } from '../shared/types.js';
import { createDevelopmentProviders } from '../server/developmentProviders.js';
import type { Accounts } from '../server/accounts.js';
import { createPracticeHandler } from '../server/routes.js';
import { MemorySessionStore } from '../server/store.js';

// Fake account layer: tokens "user-a" / "user-b" are valid. No Supabase request is made.
function fakeAccounts() {
  const store = new MemorySessionStore();
  const accounts: Accounts = {
    store,
    async verify(token) { return token === 'user-a' ? 'id-a' : token === 'user-b' ? 'id-b' : undefined; },
    async list(userId) {
      const out: SessionSummary[] = [];
      for (const id of ids) { const record = await store.get(id); if (record?.userId === userId) out.push({ id, title: record.session.title, stage: record.session.stage, lifecycle: record.session.lifecycle, createdAt: record.session.createdAt, updatedAt: record.session.updatedAt }); }
      return out;
    },
  };
  const ids = new Set<string>();
  const wrapped = { ...accounts, store: { get: store.get.bind(store), delete: store.delete.bind(store), async set(record: Parameters<typeof store.set>[0]) { ids.add(record.session.id); await store.set(record); } } };
  return wrapped;
}

async function harness(context: TestContext) {
  const env = { NODE_ENV: 'test', PRACTICE_PROVIDER_MODE: 'mock' } as NodeJS.ProcessEnv;
  const server = createServer(createPracticeHandler({ env, providers: createDevelopmentProviders(env), accounts: fakeAccounts(), limiter: null }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  context.after(async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); });
  const call = async <T>(path: string, init: { method?: string; user?: string; token?: string; body?: unknown } = {}) => {
    const response = await fetch(`${base}${path}`, { method: init.method ?? 'GET', headers: { 'Content-Type': 'application/json', ...(init.user ? { 'X-User-Token': init.user } : {}), ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}) }, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
    return { status: response.status, body: await response.json() as T };
  };
  return { call };
}

test('accounts are reported as enabled', async (context) => {
  const { call } = await harness(context);
  const health = await call<{ accountsEnabled: boolean }>('/api/health');
  assert.equal(health.body.accountsEnabled, true);
});

test('a signed-in learner sees their saved sessions, guests and other users do not', async (context) => {
  const { call } = await harness(context);
  const mine = await call<SessionAccess>('/api/sessions', { method: 'POST', user: 'user-a', body: { description: 'Fractions' } });
  const guest = await call<SessionAccess>('/api/sessions', { method: 'POST', body: { description: 'Guest topic' } });
  const other = await call<SessionAccess>('/api/sessions', { method: 'POST', user: 'user-b', body: { description: 'Not mine' } });
  assert.deepEqual([mine.status, guest.status, other.status], [201, 201, 201]);

  const list = await call<{ sessions: SessionSummary[] }>('/api/me/sessions', { user: 'user-a' });
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.sessions.map((item) => item.id), [mine.body.session.id]);

  assert.equal((await call('/api/me/sessions')).status, 401, 'guests have no saved list');
  assert.equal((await call('/api/me/sessions', { user: 'forged' })).status, 401, 'invalid account tokens are rejected');
});

test('the owner can resume with a fresh token; others cannot', async (context) => {
  const { call } = await harness(context);
  const created = await call<SessionAccess>('/api/sessions', { method: 'POST', user: 'user-a', body: { description: 'Fractions' } });
  const { id } = created.body.session; const oldToken = created.body.token;

  assert.equal((await call(`/api/sessions/${id}/reopen`, { method: 'POST', user: 'user-b', body: {} })).status, 404, 'another user');
  assert.equal((await call(`/api/sessions/${id}/reopen`, { method: 'POST', body: {} })).status, 404, 'not signed in');

  const resumed = await call<SessionAccess>(`/api/sessions/${id}/reopen`, { method: 'POST', user: 'user-a', body: {} });
  assert.equal(resumed.status, 200);
  assert.equal(resumed.body.session.id, id);
  assert.notEqual(resumed.body.token, oldToken);
  assert.equal((await call(`/api/sessions/${id}`, { token: oldToken })).status, 401, 'the old token stops working');
  assert.equal((await call<PracticeSession>(`/api/sessions/${id}`, { token: resumed.body.token })).status, 200);
});

test('a guest session cannot be resumed through an account', async (context) => {
  const { call } = await harness(context);
  const guest = await call<SessionAccess>('/api/sessions', { method: 'POST', body: { description: 'Guest topic' } });
  assert.equal((await call(`/api/sessions/${guest.body.session.id}/reopen`, { method: 'POST', user: 'user-a', body: {} })).status, 404);
});

test('without accounts configured the API reports it and offers no account routes', async (context) => {
  const env = { NODE_ENV: 'test', PRACTICE_PROVIDER_MODE: 'mock' } as NodeJS.ProcessEnv;
  const server = createServer(createPracticeHandler({ env, providers: createDevelopmentProviders(env), limiter: null }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const health = await (await fetch(`${base}/api/health`)).json() as { accountsEnabled: boolean };
  assert.equal(health.accountsEnabled, false);
  assert.equal((await fetch(`${base}/api/me/sessions`, { headers: { 'X-User-Token': 'user-a' } })).status, 401);
});
