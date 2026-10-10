import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import test, { type TestContext } from 'node:test';
import type { PracticeSession, SessionAccess } from '../shared/types.js';
import { createProviders } from '../server/providers.js';
import { createPracticeHandler } from '../server/routes.js';

interface ApiResponse { session?: PracticeSession; error?: { code: string; message: string } }

async function harness(context: TestContext, scenario = 'normal', delay = '0') {
  const env = { NODE_ENV: 'test', PRACTICE_PROVIDER_MODE: 'mock', MOCK_PROVIDER_SCENARIO: scenario, MOCK_PROVIDER_DELAY_MS: delay };
  const providers = createProviders(env);
  let grades = 0; let batches = 0;
  const gradeAll = providers.gradeAll!;
  // Counts graded answers and grading requests (one request per assessment).
  providers.gradeAll = async (items) => { batches++; grades += items.length; return gradeAll(items); };
  const server = createServer(createPracticeHandler({ env, providers }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const nativeFetch = globalThis.fetch;
  context.mock.method(globalThis, 'fetch', (url: string, init?: RequestInit) => {
    assert.ok(String(url).startsWith(`${base}/`), 'Only this loopback API may be requested; never real providers');
    return nativeFetch(url, init);
  });
  context.after(async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); });
  let token = '';
  const call = async <T = PracticeSession,>(path: string, method = 'POST', body: unknown = {}, status = 200, signal?: AbortSignal): Promise<T> => {
    const response = await fetch(`${base}/api${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: method === 'GET' ? undefined : JSON.stringify(body), signal });
    const value: unknown = await response.json();
    assert.equal(response.status, status, JSON.stringify(value));
    return value as T;
  };
  const access = await call<SessionAccess>('/sessions', 'POST', { description: 'Learner topic', notes: 'Original notes' }, 201);
  token = access.token;
  return { call, path: `/sessions/${access.session.id}`, access, grades: () => grades, batches: () => batches };
}

test('mock providers require explicit non-production mode and never contact providers', async (context) => {
  context.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected provider request'); });
  for (const NODE_ENV of ['production', undefined, 'staging']) {
    assert.throws(() => createProviders({ NODE_ENV, PRACTICE_PROVIDER_MODE: 'mock' }), /unavailable in production/);
  }
  assert.throws(() => createProviders({ NODE_ENV: 'development', PRACTICE_PROVIDER_MODE: 'typo' }), /real or mock/);
  const real = createProviders({ NODE_ENV: 'development' });
  assert.equal(real.mode, 'real');
  await assert.rejects(real.generate('Topic', ''), /not configured/);
  const providers = createProviders({ NODE_ENV: 'test', PRACTICE_PROVIDER_MODE: 'mock', MOCK_PROVIDER_DELAY_MS: '0' });
  const first = await providers.generate('Topic one', 'notes');
  assert.deepEqual(first, await providers.generate('Different topic', 'other notes'));
  assert.equal(first.kind, 'ready');
  await assert.rejects(providers.voice('id', 'title', 'context', 'opening'), /No ElevenLabs or Gemini request/);
  await assert.rejects(providers.history('id'), /No ElevenLabs or Gemini request/);
  assert.throws(() => createPracticeHandler({ env: { NODE_ENV: 'production' }, providers }), /unavailable in production/);
});

test('Stage 1 persists answers, working, uncertainty, navigation and skips; repeated submission does not regrade', async (context) => {
  const api = await harness(context);
  assert.equal(api.access.session.providerMode, 'mock');
  const prepared = await api.call(`${api.path}/prepare`);
  assert.equal(prepared.stage, 'baseline');
  const attempt = prepared.attempts[0];
  assert.equal(attempt.questions.length, 3);
  const publicJson = JSON.stringify(prepared);
  for (const privateKey of ['expectedAnswer', 'rubric', 'recheckPrompt']) assert.equal(publicJson.includes(privateKey), false);
  const incomplete = await api.call<ApiResponse>(`${api.path}/submit`, 'POST', { attemptId: attempt.id }, 409);
  assert.match(incomplete.error!.message, /Complete all questions/);
  const answers = attempt.answers.map((answer, index) => ({ ...answer, text: ['5', '12', 'Uncertain draft'][index], working: index === 0 ? '2 + 3 = 5' : '', uncertain: index === 1, skipped: index === 2 }));
  await api.call(api.path, 'PATCH', { attemptId: attempt.id, answers, currentQuestionIndex: 1 });
  await api.call(`${api.path}/pause`);
  await api.call(api.path, 'PATCH', { attemptId: attempt.id, answers }, 409);
  await api.call(`${api.path}/submit`, 'POST', { attemptId: attempt.id }, 409);
  await api.call(`${api.path}/resume`);
  const restored = await api.call(api.path, 'GET');
  assert.deepEqual(restored.attempts[0].answers, answers);
  assert.equal(restored.attempts[0].currentQuestionIndex, 1);
  const graded = await api.call(`${api.path}/submit`, 'POST', { attemptId: attempt.id });
  assert.equal(graded.stage, 'teaching');
  assert.equal(graded.attempts[0].grade!.totalScore, 3);
  assert.deepEqual(graded.attempts[0].grade!.questionGrades.map((grade) => grade.score), [2, 1, 0]);
  assert.deepEqual(graded.cycles[0].focusConceptIds, ['multiplication', 'division']);
  assert.equal(api.grades(), 2, 'Skipped answers do not call even the mock grading provider');
  const repeated = await api.call(`${api.path}/submit`, 'POST', { attemptId: attempt.id });
  assert.deepEqual(repeated.attempts[0].grade, graded.attempts[0].grade);
  assert.equal(api.grades(), 2);
  await api.call(api.path, 'PATCH', { attemptId: attempt.id, answers }, 409);
  await api.call(api.path, 'PATCH', { attemptId: attempt.id, currentQuestionIndex: 0 }, 409);
});

test('preparation failure recovers through existing endpoints', async (context) => {
  const scenario = await harness(context, 'prepare-error-once');
  const failed = await scenario.call<ApiResponse>(`${scenario.path}/prepare`, 'POST', {}, 503);
  assert.equal(failed.session!.preparation.status, 'error');
  assert.match(failed.error!.message, /DEV MOCK/);
  assert.equal((await scenario.call(`${scenario.path}/prepare`)).stage, 'baseline');
});

test('clarification requires an answer before deterministic preparation becomes ready', async (context) => {
  const api = await harness(context, 'clarification');
  const pending = await api.call(`${api.path}/prepare`);
  assert.equal(pending.preparation.status, 'clarification');
  assert.equal(pending.attempts.length, 0);
  const ready = await api.call(`${api.path}/prepare`, 'POST', { clarification: 'Addition and equal groups' });
  assert.equal(ready.stage, 'baseline');
  assert.equal(ready.description, 'Learner topic');
});

test('grading failure preserves exact responses for retry', async (context) => {
  const api = await harness(context, 'grade-error-once');
  const prepared = await api.call(`${api.path}/prepare`);
  const attempt = prepared.attempts[0];
  const answers = attempt.answers.map((answer) => ({ ...answer, text: '5', working: 'Test working', uncertain: true }));
  await api.call(api.path, 'PATCH', { attemptId: attempt.id, answers });
  const failed = await api.call<ApiResponse>(`${api.path}/submit`, 'POST', { attemptId: attempt.id }, 429);
  assert.equal(failed.session!.stage, 'baseline_evaluating');
  assert.deepEqual(failed.session!.attempts[0].answers, answers);
  assert.equal(failed.session!.attempts[0].grade, undefined);
  const graded = await api.call(`${api.path}/submit`, 'POST', { attemptId: attempt.id });
  assert.equal(graded.stage, 'teaching');
  assert.equal(graded.operationError, undefined);
});

test('all skipped answers transition to teaching without grading requests', async (context) => {
  const api = await harness(context);
  const session = await api.call(`${api.path}/prepare`);
  const attempt = session.attempts[0];
  await api.call(api.path, 'PATCH', { attemptId: attempt.id, answers: attempt.answers.map((answer) => ({ ...answer, skipped: true })) });
  const graded = await api.call(`${api.path}/submit`, 'POST', { attemptId: attempt.id });
  assert.equal(graded.stage, 'teaching');
  assert.equal(graded.attempts[0].grade!.totalScore, 0);
  assert.equal(api.grades(), 0);
});

test('interrupted preparation and grading requests can be reconciled by refreshing server state', async (context) => {
  const api = await harness(context, 'normal', '150');
  async function interrupt(action: string, body: unknown, pending: string, complete: string) {
    const controller = new AbortController();
    const request = api.call(`${api.path}/${action}`, 'POST', body, 200, controller.signal).catch((error: unknown) => error);
    let state = await api.call(api.path, 'GET');
    for (let n = 0; n < 100 && (action === 'prepare' ? state.preparation.status : state.stage) !== pending; n++) {
      await new Promise((resolve) => setTimeout(resolve, 5)); state = await api.call(api.path, 'GET');
    }
    assert.equal(action === 'prepare' ? state.preparation.status : state.stage, pending);
    controller.abort();
    assert.ok(await request instanceof Error);
    for (let n = 0; n < 100 && state.stage !== complete; n++) {
      await new Promise((resolve) => setTimeout(resolve, 5)); state = await api.call(api.path, 'GET');
    }
    assert.equal(state.stage, complete);
    return state;
  }
  const prepared = await interrupt('prepare', {}, 'pending', 'baseline');
  const attempt = prepared.attempts[0];
  await api.call(api.path, 'PATCH', { attemptId: attempt.id, answers: attempt.answers.map((answer) => ({ ...answer, text: '5' })) });
  const graded = await interrupt('submit', { attemptId: attempt.id }, 'baseline_evaluating', 'teaching');
  assert.ok(graded.attempts[0].grade);
});

test('declining a suggested rewrite (No) keeps the original request and continues', async (context) => {
  const declined = await harness(context, 'clarification');
  const pending = await declined.call(`${declined.path}/prepare`);
  assert.equal(pending.preparation.status, 'clarification');
  assert.ok(pending.preparation.suggestedPrompt?.includes('DEV MOCK'));
  const kept = await declined.call(`${declined.path}/prepare`, 'POST', { keepOriginal: true });
  assert.equal(kept.stage, 'baseline', 'No continues without forcing a rewrite');
  assert.equal(kept.description, 'Learner topic');
});

test('accepting a suggested rewrite (Yes) adopts it as the request', async (context) => {
  const accepted = await harness(context, 'clarification');
  const suggested = await accepted.call(`${accepted.path}/prepare`);
  const ready = await accepted.call(`${accepted.path}/prepare`, 'POST', { acceptSuggestion: true });
  assert.equal(ready.stage, 'baseline');
  assert.equal(ready.description, suggested.preparation.suggestedPrompt, 'Yes adopts the server-stored suggestion');
});

test('Back to Alex leaves the follow-up check and returns to the same attempt without grading', async (context) => {
  const api = await harness(context);
  const prepared = await api.call(`${api.path}/prepare`);
  const baseline = prepared.attempts[0];
  await api.call<ApiResponse>(`${api.path}/teach`, 'POST', {}, 400);
  await api.call(api.path, 'PATCH', { attemptId: baseline.id, answers: baseline.answers.map((answer) => ({ ...answer, text: '1' })) });
  await api.call(`${api.path}/submit`, 'POST', { attemptId: baseline.id });
  const recheck = await api.call(`${api.path}/recheck`);
  const attempt = recheck.attempts[1];
  const answers = attempt.answers.map((answer, index) => ({ ...answer, text: index === 0 ? 'draft answer' : '' }));
  await api.call(api.path, 'PATCH', { attemptId: attempt.id, answers, currentQuestionIndex: 1 });

  const teaching = await api.call(`${api.path}/teach`);
  assert.equal(teaching.stage, 'teaching');
  await api.call<ApiResponse>(api.path, 'PATCH', { attemptId: attempt.id, answers }, 409);
  const resumed = await api.call(`${api.path}/recheck`);
  assert.equal(resumed.stage, 'recheck');
  assert.equal(resumed.attempts.length, 2, 'No new follow-up attempt is created');
  assert.equal(resumed.attempts[1].id, attempt.id);
  assert.equal(resumed.attempts[1].answers[0].text, 'draft answer');
  assert.equal(resumed.attempts[1].currentQuestionIndex, 1);
  assert.equal(api.batches(), 1, 'Only the baseline was graded');

  await api.call(api.path, 'PATCH', { attemptId: attempt.id, answers: answers.map((answer, index) => ({ ...answer, skipped: index > 0 })) });
  await api.call(`${api.path}/submit`, 'POST', { attemptId: attempt.id });
  await api.call<ApiResponse>(`${api.path}/teach`, 'POST', {}, 400);
});

test('DEV MOCK full cycle: baseline, teaching bypass, matched recheck, grading, results and finish', async (context) => {
  const api = await harness(context);
  const prepared = await api.call(`${api.path}/prepare`);
  const baseline = prepared.attempts[0];
  await api.call<ApiResponse>(`${api.path}/recheck`, 'POST', {}, 409);
  await api.call(api.path, 'PATCH', { attemptId: baseline.id, answers: baseline.answers.map((answer, index) => ({ ...answer, text: ['5', '12', '9'][index], working: index === 0 ? '2 + 3 = 5' : '' })) });
  const taught = await api.call(`${api.path}/submit`, 'POST', { attemptId: baseline.id });
  assert.equal(taught.stage, 'teaching');
  assert.deepEqual(taught.attempts[0].grade!.questionGrades.map((grade) => grade.score), [2, 1, 0]);

  await api.call(`${api.path}/pause`);
  await api.call<ApiResponse>(`${api.path}/recheck`, 'POST', {}, 409);
  await api.call(`${api.path}/resume`);
  const recheck = await api.call(`${api.path}/recheck`);
  assert.equal(recheck.stage, 'recheck');
  await api.call<ApiResponse>(`${api.path}/recheck`, 'POST', {}, 409);
  assert.equal(recheck.attempts.length, 2);
  const attempt = recheck.attempts[1];
  assert.equal(attempt.kind, 'recheck');
  assert.equal(recheck.cycles[0].recheckAttemptId, attempt.id);
  assert.deepEqual(attempt.questions.map((question) => question.conceptId), baseline.questions.map((question) => question.conceptId), 'Recheck questions are matched to baseline concepts');
  for (const [index, question] of attempt.questions.entries()) assert.notEqual(question.prompt, baseline.questions[index].prompt);
  for (const privateKey of ['expectedAnswer', 'rubric']) assert.equal(JSON.stringify(recheck).includes(privateKey), false);
  assert.equal(recheck.cycles[0].conversations.length, 0, 'The bypass creates no conversation or transcript');

  await api.call<ApiResponse>(`${api.path}/finish`, 'POST', {}, 400);
  const answers = attempt.answers.map((answer, index) => ({ ...answer, text: ['7', '8', ''][index], working: index < 2 ? 'Equal groups' : '', skipped: index === 2 }));
  await api.call(api.path, 'PATCH', { attemptId: attempt.id, answers, currentQuestionIndex: 2 });
  const results = await api.call(`${api.path}/submit`, 'POST', { attemptId: attempt.id });
  assert.equal(results.stage, 'results');
  assert.equal(results.providerMode, 'mock');
  assert.equal(results.attempts[0].grade!.totalScore, 3);
  assert.equal(results.attempts[1].grade!.totalScore, 4);
  assert.deepEqual(results.attempts[1].grade!.questionGrades.map((grade) => grade.score), [2, 2, 0]);
  assert.ok(results.attempts[1].grade!.questionGrades.slice(0, 2).every((grade) => grade.feedback.includes('DEV MOCK')));
  assert.equal(api.grades(), 5, 'Three baseline and two non-skipped recheck answers graded');
  assert.equal(api.batches(), 2, 'One grading request per assessment');
  assert.deepEqual(await api.call(api.path, 'GET'), results, 'Refreshing returns the same server-backed results');

  await api.call(api.path, 'PATCH', { nervousnessAfter: 2 });
  const finished = await api.call(`${api.path}/finish`);
  assert.equal(finished.lifecycle, 'completed');
  assert.ok(finished.completedAt);
  assert.equal(finished.nervousnessAfter, 2);
  await api.call<ApiResponse>(`${api.path}/resume`, 'POST', {}, 409);
});
