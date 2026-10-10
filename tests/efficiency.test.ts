import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import test, { type TestContext } from 'node:test';
import type { PracticeSession, SessionAccess } from '../shared/types.js';
import { createProviders } from '../server/providers.js';
import { createPracticeHandler } from '../server/routes.js';
import { UsageTracker } from '../server/usage.js';

/*
 * These tests run the REAL provider adapters against an intercepted fetch: every Gemini or
 * ElevenLabs HTTP request is counted and answered locally. Nothing leaves the machine.
 */

// Loosely typed JSON from request bodies and the metrics endpoint.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
interface GeminiCall { kind: 'generate' | 'grade' | 'alex'; body: Record<string, Any>; bytes: number }
type Respond = (call: GeminiCall, index: number) => { status: number; json: unknown } | undefined;

const concepts = ['a', 'b', 'c'].map((id, index) => ({
  id, title: `Concept ${id}`, description: `About ${id}.`, rubric: '0 wrong, 1 partial, 2 complete.',
  baselinePrompt: `Baseline question ${index}?`, baselineExpectedAnswer: `base-${id}`, recheckPrompt: `Recheck question ${index}?`, recheckExpectedAnswer: `re-${id}`, supportsWorking: false,
}));
const ok = (output: unknown, bytes: number) => ({ status: 200, json: { candidates: [{ content: { parts: [{ text: JSON.stringify(output) }] } }], usageMetadata: { promptTokenCount: Math.ceil(bytes / 4), candidatesTokenCount: 40, thoughtsTokenCount: 0 } } });

async function harness(context: TestContext, options: { respond?: Respond; history?: () => unknown; before?: (call: GeminiCall) => Promise<void> } = {}) {
  const env = { NODE_ENV: 'test', GEMINI_API_KEY: 'test-gemini-key', GEMINI_MODEL: 'gemini-2.5-flash', ELEVENLABS_API_KEY: 'test-el-key', ELEVENLABS_AGENT_ID: 'agent-1' };
  const providers = createProviders(env, new UsageTracker(env, () => undefined));
  const server = createServer(createPracticeHandler({ env, providers }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const gemini: GeminiCall[] = []; let history = 0;
  const nativeFetch = globalThis.fetch;
  context.mock.method(globalThis, 'fetch', async (url: string, init?: RequestInit) => {
    const target = String(url);
    if (target.startsWith(base)) return nativeFetch(url, init);
    if (target.startsWith('https://generativelanguage.googleapis.com/')) {
      const raw = String(init?.body); const body = JSON.parse(raw) as Record<string, Any>;
      const system = String(body.systemInstruction.parts[0].text);
      const kind = system.includes('retrieval practice') ? 'generate' : system.includes('Grade each item') ? 'grade' : 'alex';
      const call: GeminiCall = { kind, body, bytes: raw.length }; gemini.push(call);
      await options.before?.(call);
      const custom = options.respond?.(call, gemini.length - 1);
      const reply = custom ?? (kind === 'generate' ? ok({ kind: 'ready', question: '', title: 'Test topic', scope: 'Scope.', concepts }, raw.length)
        : kind === 'grade' ? ok({ grades: JSON.parse(body.contents[0].parts[0].text).items.map((item: Record<string, string>) => ({ id: item.id, score: item.answer === item.expectedAnswer ? 2 : 0, feedback: 'Feedback.', evidence: item.answer === item.expectedAnswer ? item.answer : '' })) }, raw.length)
          : ok({ reply: 'Could you give me an example?' }, raw.length));
      return new Response(JSON.stringify(reply.json), { status: reply.status, headers: { 'Content-Type': 'application/json' } });
    }
    if (target.startsWith('https://api.elevenlabs.io/v1/convai/conversations/')) { history++; return Response.json(options.history?.() ?? { status: 'processing' }); }
    throw new Error(`Unexpected request to ${target}`);
  });
  context.after(async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); });
  let token = '';
  const call = async <T = PracticeSession,>(path: string, method = 'POST', body: unknown = {}, status?: number): Promise<T> => {
    const response = await fetch(`${base}/api${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: method === 'GET' ? undefined : JSON.stringify(body) });
    const value: unknown = await response.json();
    if (status !== undefined) assert.equal(response.status, status, JSON.stringify(value));
    return value as T;
  };
  const access = await call<SessionAccess>('/sessions', 'POST', { description: 'Learner topic', notes: 'Private study notes' }, 201);
  token = access.token;
  return { call, path: `/sessions/${access.session.id}`, gemini, history: () => history, providers, base };
}

async function answerAll(api: Awaited<ReturnType<typeof harness>>, session: PracticeSession, index: number, answers: string[]) {
  const attempt = session.attempts[index]!;
  await api.call(api.path, 'PATCH', { attemptId: attempt.id, answers: attempt.answers.map((answer, i) => ({ ...answer, text: answers[i] })) }, 200);
  return attempt;
}

test('a full study cycle uses one Gemini request per assessment instead of one per answer', async (context) => {
  const api = await harness(context);
  const prepared = await api.call(`${api.path}/prepare`, 'POST', {}, 200);
  const baseline = await answerAll(api, prepared, 0, ['base-a', 'wrong', 'base-c']);
  const taught = await api.call(`${api.path}/submit`, 'POST', { attemptId: baseline.id }, 200);
  assert.deepEqual(taught.attempts[0].grade!.questionGrades.map((grade) => grade.score), [2, 0, 2], 'each answer keeps its own grade');
  assert.ok(taught.attempts[0].grade!.questionGrades.every((grade) => grade.feedback === 'Feedback.'), 'each answer keeps its own feedback');
  const conversation = await api.call(`${api.path}/conversations/text`, 'POST', {}, 200);
  const segment = conversation.cycles[0].conversations[0]!;
  for (const text of ['First explanation.', 'Second explanation.']) await api.call(`${api.path}/conversations/${segment.id}/messages`, 'POST', { text }, 200);
  const recheck = await api.call(`${api.path}/recheck`, 'POST', {}, 200);
  const follow = await answerAll(api, recheck, 1, ['re-a', 're-b', 're-c']);
  const results = await api.call(`${api.path}/submit`, 'POST', { attemptId: follow.id }, 200);
  assert.equal(results.stage, 'results');
  assert.equal(results.attempts[1].grade!.totalScore, 6);

  const kinds = api.gemini.map((call) => call.kind);
  assert.deepEqual(kinds, ['generate', 'grade', 'alex', 'alex', 'grade'], '5 Gemini requests; per-answer grading would have needed 9');
  // Refreshing and navigating never regenerates or regrades.
  await api.call(api.path, 'GET'); await api.call(`${api.path}/submit`, 'POST', { attemptId: follow.id }, 200);
  assert.equal(api.gemini.length, 5);

  // Alex's stable context is in the system instruction (cacheable prefix) and uses minimal thinking.
  const alex = api.gemini.filter((call) => call.kind === 'alex');
  assert.equal(alex[0]!.body.systemInstruction.parts[0].text, alex[1]!.body.systemInstruction.parts[0].text, 'identical prefix across turns');
  assert.deepEqual(alex[0]!.body.generationConfig.thinkingConfig, { thinkingBudget: 0 });
  assert.equal(api.gemini.find((call) => call.kind === 'grade')!.body.generationConfig.thinkingConfig, undefined, 'grading keeps the model’s default reasoning');

  const metrics = await api.call<Record<string, Any>>('/metrics', 'GET');
  assert.equal(metrics.geminiRequestsToday, 5);
  assert.equal(metrics.operations['gemini:grade'].requests, 2);
  const json = JSON.stringify(metrics);
  for (const secret of ['test-gemini-key', 'Private study notes', 'First explanation', 'base-a']) assert.equal(json.includes(secret), false, `metrics never include ${secret}`);
  context.diagnostic(`gemini request bytes: ${api.gemini.map((call) => `${call.kind}=${call.bytes}`).join(', ')}`);
});

test('duplicate prepare and submit requests share one provider call', async (context) => {
  let releaseGenerate!: () => void; const generateGate = new Promise<void>((resolve) => { releaseGenerate = resolve; });
  // Hold the generate call open so the duplicate arrives while it is running.
  const api = await harness(context, { before: async (call) => { if (call.kind === 'generate') await generateGate; } });
  const first = api.call(`${api.path}/prepare`, 'POST', {}, 200);
  await new Promise((resolve) => setTimeout(resolve, 30));
  const second = api.call(`${api.path}/prepare`, 'POST', {}, 200);
  await new Promise((resolve) => setTimeout(resolve, 30));
  releaseGenerate();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.stage, 'baseline'); assert.equal(b.stage, 'baseline');
  assert.equal(api.gemini.filter((call) => call.kind === 'generate').length, 1);
  const attempt = await answerAll(api, a, 0, ['base-a', 'base-b', 'base-c']);
  const submits = await Promise.all([1, 2, 3].map(() => api.call(`${api.path}/submit`, 'POST', { attemptId: attempt.id }, 200)));
  assert.ok(submits.every((session) => session.stage === 'teaching'));
  assert.equal(api.gemini.filter((call) => call.kind === 'grade').length, 1, 'three rapid submits, one grading request');
});

test('only answers whose evidence fails validation are regraded, and validated grades survive a retry', async (context) => {
  // The first batch invents evidence for item q2; the focused regrade does too; the user retries later.
  const api = await harness(context, { respond: (call, index) => {
    if (call.kind !== 'grade') return undefined;
    const items = JSON.parse(call.body.contents[0].parts[0].text).items as Record<string, string>[];
    const bad = index <= 2;
    return ok({ grades: items.map((item) => ({ id: item.id, score: 2, feedback: 'Fine.', evidence: bad && item.answer === 'base-b' ? 'invented quote' : item.answer })) }, 100);
  } });
  const prepared = await api.call(`${api.path}/prepare`, 'POST', {}, 200);
  const attempt = await answerAll(api, prepared, 0, ['base-a', 'base-b', 'base-c']);
  const failed = await api.call<{ error: { code: string } }>(`${api.path}/submit`, 'POST', { attemptId: attempt.id }, 502);
  assert.equal(failed.error.code, 'INVALID_GRADE');
  const grades = api.gemini.filter((call) => call.kind === 'grade');
  assert.deepEqual(grades.map((call) => JSON.parse(call.body.contents[0].parts[0].text).items.length), [3, 1], 'the focused regrade sends only the failing answer');
  const retried = await api.call(`${api.path}/submit`, 'POST', { attemptId: attempt.id }, 200);
  assert.equal(retried.stage, 'teaching');
  assert.equal(JSON.parse(api.gemini.at(-1)!.body.contents[0].parts[0].text).items.length, 1, 'the retry regrades one answer, not three');
  assert.equal(JSON.stringify(retried).includes('gradeCache'), false, 'the cache stays server-side');
});

test('an exhausted daily quota fails fast without spending more requests', async (context) => {
  const api = await harness(context, { respond: () => ({ status: 429, json: { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'You exceeded your current quota.', details: [
    { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests', quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] },
    { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '40s' }] } } }) });
  const first = await api.call<{ error: { code: string; message: string } }>(`${api.path}/prepare`, 'POST', {}, 429);
  assert.equal(first.error.code, 'QUOTA_EXHAUSTED');
  assert.match(first.error.message, /daily request quota.*midnight Pacific/);
  for (let index = 0; index < 3; index++) await api.call(`${api.path}/prepare`, 'POST', {}, 429);
  assert.equal(api.gemini.length, 1, 'later attempts are refused locally until the quota resets');
  const metrics = await api.call<Record<string, Any>>('/metrics', 'GET');
  assert.equal(metrics.operations['gemini:generate'].avoided, 3);
});

test('short rate limits are retried once after the advised delay; transient errors once; others not at all', async (context) => {
  const api = await harness(context, { respond: (call, index) => call.kind === 'generate' && index === 0
    ? { status: 429, json: { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Rate limit.', details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '0.05s' }] } } }
    : call.kind === 'grade' && index <= 3 ? { status: 503, json: { error: { code: 503, status: 'UNAVAILABLE', message: 'The model is overloaded.' } } } : undefined });
  const prepared = await api.call(`${api.path}/prepare`, 'POST', {}, 200);
  assert.equal(prepared.stage, 'baseline');
  assert.deepEqual(api.gemini.map((call) => call.kind), ['generate', 'generate'], 'one retry after the advised 50 ms');
  const attempt = await answerAll(api, prepared, 0, ['base-a', 'base-b', 'base-c']);
  const failed = await api.call<{ error: { code: string } }>(`${api.path}/submit`, 'POST', { attemptId: attempt.id }, 502);
  assert.equal(failed.error.code, 'UNAVAILABLE');
  assert.equal(api.gemini.filter((call) => call.kind === 'grade').length, 2, '503 retried exactly once, then reported');
});

test('a model that rejects the thinking setting falls back once and stops sending it', async (context) => {
  const api = await harness(context, { respond: (call) => call.kind === 'alex' && call.body.generationConfig.thinkingConfig
    ? { status: 400, json: { error: { code: 400, status: 'INVALID_ARGUMENT', message: 'Thinking budget is not supported for this model.' } } } : undefined });
  const prepared = await api.call(`${api.path}/prepare`, 'POST', {}, 200);
  const attempt = await answerAll(api, prepared, 0, ['', '', '']);
  await api.call(api.path, 'PATCH', { attemptId: attempt.id, answers: attempt.answers.map((answer) => ({ ...answer, skipped: true })) }, 200);
  await api.call(`${api.path}/submit`, 'POST', { attemptId: attempt.id }, 200);
  assert.equal(api.gemini.filter((call) => call.kind === 'grade').length, 0, 'all-skipped assessments need no grading request');
  const conversation = await api.call(`${api.path}/conversations/text`, 'POST', {}, 200);
  const id = conversation.cycles[0].conversations[0]!.id;
  await api.call(`${api.path}/conversations/${id}/messages`, 'POST', { text: 'One.' }, 200);
  await api.call(`${api.path}/conversations/${id}/messages`, 'POST', { text: 'Two.' }, 200);
  assert.deepEqual(api.gemini.filter((call) => call.kind === 'alex').map((call) => Boolean(call.body.generationConfig.thinkingConfig)), [true, false, false]);
});

test('voice transcript checks are throttled and deduplicated per conversation', async (context) => {
  let sessionId = '';
  const api = await harness(context, { history: () => ({ status: 'processing', agent_id: 'agent-1', conversation_initiation_client_data: { dynamic_variables: { session_id: sessionId } } }) });
  sessionId = api.path.split('/')[2]!;
  const prepared = await api.call(`${api.path}/prepare`, 'POST', {}, 200);
  const attempt = await answerAll(api, prepared, 0, ['base-a', 'base-b', 'base-c']);
  await api.call(`${api.path}/submit`, 'POST', { attemptId: attempt.id }, 200);
  await api.call(`${api.path}/conversations`, 'POST', { conversationId: 'voice-1' }, 200);
  // Three views polling at once, then an immediate re-check.
  await Promise.all([1, 2, 3].map(() => api.call(`${api.path}/conversations/voice-1/finalize`, 'POST', {})));
  await api.call(`${api.path}/conversations/voice-1/finalize`, 'POST', {});
  assert.equal(api.history(), 1, 'one ElevenLabs history request for four checks');
  const metrics = await api.call<Record<string, Any>>('/metrics', 'GET');
  assert.ok(metrics.operations['elevenlabs:conversation_history'].avoided >= 3);
});

test('reading an uploaded image is one Gemini request that carries the image inline and returns plain study text', async (context) => {
  const text = 'Mitochondria produce ATP. Diagram: a bean-shaped organelle labelled inner membrane and matrix.';
  const api = await harness(context, { respond: () => ok({ studyContent: true, text }, 100) });
  const read = await api.providers.transcribeImage!({ name: 'cell.png', mimeType: 'image/png', data: 'AAAA' });
  assert.equal(read, text);
  assert.equal(api.gemini.length, 1);
  const parts = api.gemini[0]!.body.contents[0].parts as Any[];
  assert.deepEqual(parts[1], { inlineData: { mimeType: 'image/png', data: 'AAAA' } });
});

test('an image with no study content reads as empty text rather than invented content', async (context) => {
  const blank = await harness(context, { respond: () => ok({ studyContent: false, text: '' }, 100) });
  assert.equal(await blank.providers.transcribeImage!({ name: 'blank.png', mimeType: 'image/png', data: 'AAAA' }), '');
});
