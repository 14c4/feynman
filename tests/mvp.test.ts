import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import test, { type TestContext } from 'node:test';
import type { PracticeSession, SessionAccess, TranscriptMessage, VoiceCredentials } from '../shared/types.js';
import type { AlexContext } from '../server/alex.js';
import { materialExcerpt } from '../server/materials.js';
import type { Providers } from '../server/providers.js';
import { createProviders } from '../server/providers.js';
import { createPracticeHandler } from '../server/routes.js';
import { buildPdf } from './pdfFixture.js';

interface ApiError { error: { code: string; message: string }; session?: PracticeSession }
const b64 = (value: string | Buffer) => Buffer.from(value).toString('base64');
const SOURCE = 'Photosynthesis converts light energy into chemical energy stored in glucose. Chlorophyll in the chloroplast absorbs mostly red and blue light. The light-dependent reactions split water and release oxygen.';

// Real-mode-shaped providers injected locally: no Gemini or ElevenLabs request is made.
function fakeProviders() {
  const calls = { generate: [] as { description: string; material?: string }[], alex: [] as { context: AlexContext; messages: TranscriptMessage[] }[], history: 0 };
  let failNextReply = false; let historyStatus = 'processing'; let historySession = '';
  const providers: Providers = {
    mode: 'real',
    async generate(description, _notes, _clarification, material) {
      calls.generate.push({ description, material });
      return { kind: 'ready', title: 'Model title', scope: 'Overview of photosynthesis.', concepts: ['light', 'chlorophyll', 'water'].map((id) => ({
        id, title: `Concept ${id}`, description: `What ${id} covers`, rubric: '0 none, 1 partial, 2 complete', supportsWorking: false,
        baselinePrompt: `Baseline about ${id}?`, baselineExpectedAnswer: `${id} answer`, recheckPrompt: `Different follow-up about ${id}?`, recheckExpectedAnswer: `${id} follow-up answer`,
      })) };
    },
    async grade({ text, expectedAnswer }) { return text === expectedAnswer ? { score: 2, feedback: 'Complete.', evidence: text } : { score: 0, feedback: 'Revisit this idea.', evidence: '' }; },
    async voice(sessionId, title, context, opening): Promise<VoiceCredentials> { return { signedUrl: 'wss://voice.invalid', dynamicVariables: { session_id: sessionId, session_title: title, focus_context: context, opening_question: opening } }; },
    async history() {
      calls.history++;
      return { agent_id: 'agent-test', status: historyStatus, conversation_initiation_client_data: { dynamic_variables: { session_id: historySession } },
        transcript: [{ role: 'agent', message: 'What is chlorophyll for?' }, { role: 'user', message: 'It absorbs light.' }] };
    },
    async alexReply(context, messages) {
      calls.alex.push({ context, messages: structuredClone(messages) });
      if (failNextReply) { failNextReply = false; throw Object.assign(new Error('Gemini request failed (HTTP 503).'), {}); }
      return `Reply ${messages.filter((message) => message.role === 'learner').length}: can you give an example?`;
    },
  };
  return { providers, calls, failReply: () => { failNextReply = true; }, setHistory: (status: string, session: string) => { historyStatus = status; historySession = session; } };
}

async function harness(context: TestContext, providers: Providers, env: NodeJS.ProcessEnv = { ELEVENLABS_AGENT_ID: 'agent-test' }) {
  const server = createServer(createPracticeHandler({ env, providers, transcriptIntervalMs: 0 }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const nativeFetch = globalThis.fetch;
  context.mock.method(globalThis, 'fetch', (url: string, init?: RequestInit) => {
    assert.ok(String(url).startsWith(`${base}/`), 'Only the loopback API may be requested; never real providers');
    return nativeFetch(url, init);
  });
  context.after(async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); });
  let token = '';
  const call = async <T = PracticeSession,>(path: string, method = 'POST', body: unknown = {}, status = 200): Promise<T> => {
    const response = await fetch(`${base}/api${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: method === 'GET' ? undefined : JSON.stringify(body) });
    const value: unknown = await response.json();
    assert.equal(response.status, status, JSON.stringify(value).slice(0, 500));
    return value as T;
  };
  const create = async (input: Record<string, unknown>, status = 201) => {
    const access = await call<SessionAccess & ApiError>('/sessions', 'POST', input, status);
    if (status === 201) token = access.token;
    return access;
  };
  return { call, create };
}

async function toTeaching(api: Awaited<ReturnType<typeof harness>>, correctFirst = true) {
  const access = await api.create({ topic: 'Photosynthesis', description: 'How plants turn light into energy', materials: [{ name: 'notes.txt', data: b64(SOURCE) }] });
  const path = `/sessions/${access.session.id}`;
  const prepared = await api.call(`${path}/prepare`);
  const baseline = prepared.attempts[0];
  await api.call(path, 'PATCH', { attemptId: baseline.id, answers: baseline.answers.map((answer, index) => ({ ...answer, text: index === 0 && correctFirst ? 'light answer' : 'not sure' })) });
  const taught = await api.call(`${path}/submit`, 'POST', { attemptId: baseline.id });
  assert.equal(taught.stage, 'teaching');
  return { path, session: taught, baseline };
}

test('uploads: TXT, Markdown and text PDFs are extracted on the server and kept private', async (context) => {
  const fake = fakeProviders(); const api = await harness(context, fake.providers);
  const pdf = buildPdf(['Mitochondria produce ATP through cellular respiration.', 'The Krebs cycle runs in the mitochondrial matrix.']);
  const access = await api.create({ topic: 'Cell energy', description: 'Respiration basics', materials: [
    { name: 'lecture.pdf', data: b64(pdf) }, { name: 'C:\\Users\\me\\summary.md', data: b64(`# Summary\n\n${SOURCE}`) }, { name: 'extra.txt', data: b64(`\uFEFF${SOURCE}\r\n`) },
  ] });
  assert.equal(access.session.title, 'Cell energy');
  assert.deepEqual(access.session.materials!.map(({ name, kind, pages, truncated }) => ({ name, kind, pages, truncated })), [
    { name: 'lecture.pdf', kind: 'pdf', pages: 1, truncated: false }, { name: 'summary.md', kind: 'markdown', pages: undefined, truncated: false }, { name: 'extra.txt', kind: 'text', pages: undefined, truncated: false },
  ]);
  const publicJson = JSON.stringify(access.session);
  assert.equal(publicJson.includes('Krebs'), false, 'Extracted text is never serialized to the client');
  assert.equal(publicJson.includes('Chlorophyll'), false);

  await api.call(`/sessions/${access.session.id}/prepare`);
  const material = fake.calls.generate[0].material!;
  assert.match(material, /### File: lecture\.pdf\nMitochondria produce ATP through cellular respiration\.\nThe Krebs cycle/);
  assert.match(material, /### File: summary\.md\n# Summary/);
  assert.match(fake.calls.generate[0].description, /^Topic: Cell energy\nWhat I want to learn: Respiration basics$/);
});

test('uploads: unsupported, empty, image-only, corrupt and oversized files are rejected without creating a session', async (context) => {
  const api = await harness(context, fakeProviders().providers);
  const cases: [unknown, RegExp][] = [
    [[{ name: 'photo.png', data: b64('not really an image but unsupported anyway') }], /not supported/],
    [[{ name: 'blank.txt', data: '' }], /empty/],
    [[{ name: 'short.md', data: b64('# Hi') }], /enough readable text/],
    [[{ name: 'scan.pdf', data: b64(buildPdf()) }], /no selectable text/],
    [[{ name: 'broken.pdf', data: b64('%PDF-1.4 truncated garbage') }], /could not be read as a PDF/],
    [[{ name: 'fake.pdf', data: b64(SOURCE) }], /not a valid PDF/],
    [[{ name: 'binary.txt', data: b64(Buffer.from([65, 0, 66, 67])) }], /binary/],
    [[{ name: 'latin1.txt', data: b64(Buffer.from([0xe9, 0xe8, 0xff, 0xfe, ...Buffer.from(SOURCE)])) }], /UTF-8/],
    [[{ name: 'big.txt', data: b64(Buffer.alloc(4 * 1024 * 1024 + 1, 97)) }], /larger than 4 MB/],
    [[1, 2, 3, 4].map((n) => ({ name: `n${n}.txt`, data: b64(SOURCE) })), /at most 3 files/],
    [[{ name: 'bad.txt', data: '***' }], /not received correctly/],
  ];
  for (const [materials, message] of cases) {
    const failed = await api.create({ description: 'Topic', materials }, 422);
    assert.match(failed.error.message, message);
    assert.equal(failed.session, undefined);
    assert.equal((failed as Partial<SessionAccess>).token, undefined);
  }
  const four = 4 * 1024 * 1024;
  const overTotal = await api.create({ description: 'Topic', materials: [four, four, 1024].map((size, n) => ({ name: `n${n}.txt`, data: b64(Buffer.alloc(size, 97)) })) }, 422);
  assert.match(overTotal.error.message, /together must be under 8 MB/);
  const overBody = await api.create({ description: 'Topic', materials: [1, 2, 3].map((n) => ({ name: `n${n}.txt`, data: b64(Buffer.alloc(3 * 1024 * 1024 + n, 97)) })) }, 413);
  assert.match(overBody.error.message, /under 8 MB/);
});

test('material excerpts stay bounded and sample across long documents', () => {
  const text = Array.from({ length: 2000 }, (_, index) => `Sentence ${index}.`).join(' ');
  const excerpt = materialExcerpt([{ id: 'a', name: 'long.txt', text }, { id: 'b', name: 'short.txt', text: 'Short file body.' }], 6000);
  assert.ok(excerpt.length < 6200);
  assert.match(excerpt, /Sentence 0\./);
  assert.match(excerpt, /Sentence 19\d\d\./, 'Later parts of long files are represented');
  assert.match(excerpt, /### File: short\.txt\nShort file body\./);
  assert.equal(materialExcerpt(undefined, 100), '');
});

test('preparation publishes an overview and concept descriptions but never answer keys', async (context) => {
  const api = await harness(context, fakeProviders().providers);
  const access = await api.create({ description: 'Photosynthesis', materials: [{ name: 'n.txt', data: b64(SOURCE) }] });
  const prepared = await api.call(`/sessions/${access.session.id}/prepare`);
  assert.equal(prepared.scope, 'Overview of photosynthesis.');
  assert.equal(prepared.title, 'Model title', 'Without a topic the generated title is used');
  assert.deepEqual(prepared.concepts.map((concept) => concept.description), ['What light covers', 'What chlorophyll covers', 'What water covers']);
  const json = JSON.stringify(prepared);
  for (const secret of ['light answer', 'follow-up answer', 'rubric', 'Different follow-up']) assert.equal(json.includes(secret), false, secret);
});

test('text Alex: grounded context, one reply per turn, failure recovery, end and recheck', async (context) => {
  const fake = fakeProviders(); const api = await harness(context, fake.providers);
  const access = await api.create({ description: 'Photosynthesis', materials: [{ name: 'n.txt', data: b64(SOURCE) }] });
  const early = await api.call<ApiError>(`/sessions/${access.session.id}/conversations/text`, 'POST', {}, 409);
  assert.match(early.error.message, /during active teaching/);
  await api.call(`/sessions/${access.session.id}/prepare`);
  const baseline = (await api.call(`/sessions/${access.session.id}`, 'GET')).attempts[0];
  await api.call(`/sessions/${access.session.id}`, 'PATCH', { attemptId: baseline.id, answers: baseline.answers.map((answer, index) => ({ ...answer, text: index === 0 ? 'light answer' : 'unsure' })) });
  await api.call(`/sessions/${access.session.id}/submit`, 'POST', { attemptId: baseline.id });
  const path = `/sessions/${access.session.id}`;

  const started = await api.call(`${path}/conversations/text`);
  const segment = started.cycles[0].conversations[0];
  assert.equal(segment.channel, 'text');
  assert.equal(segment.transcriptStatus, 'pending');
  assert.deepEqual(segment.messages.map((message) => message.role), ['student']);
  assert.match(segment.messages[0].text, /Hi, I’m Alex\. Can you explain Concept chlorophyll to me in your own words\?/, 'Opens on the first weak concept');
  const again = await api.call(`${path}/conversations/text`);
  assert.equal(again.cycles[0].conversations.length, 1, 'Starting twice reuses the open conversation');

  const empty = await api.call<ApiError>(`${path}/conversations/${segment.id}/messages`, 'POST', { text: '   ' }, 400);
  assert.match(empty.error.message, /Type a message/);
  await api.call<ApiError>(`${path}/conversations/${segment.id}/messages`, 'POST', { text: 'x'.repeat(2001) }, 400);

  const replied = await api.call(`${path}/conversations/${segment.id}/messages`, 'POST', { text: 'Chlorophyll absorbs red and blue light.' });
  assert.deepEqual(replied.cycles[0].conversations[0].messages.map((message) => message.role), ['student', 'learner', 'student']);
  assert.equal(replied.cycles[0].conversations[0].messages[2].text, 'Reply 1: can you give an example?');
  const sent = fake.calls.alex[0];
  assert.deepEqual(sent.context.focusConcepts.map((concept) => concept.title), ['Concept chlorophyll', 'Concept water']);
  assert.equal(sent.context.focusConcepts[0].baselineFeedback, 'Revisit this idea.');
  assert.deepEqual(sent.context.otherConcepts, ['Concept light']);
  assert.match(sent.context.sourceExcerpt, /### File: n\.txt\nPhotosynthesis converts light energy/);
  assert.equal(sent.messages.at(-1)!.text, 'Chlorophyll absorbs red and blue light.');

  fake.failReply();
  const failed = await api.call<ApiError>(`${path}/conversations/${segment.id}/messages`, 'POST', { text: 'Water is split to release oxygen.' }, 400);
  assert.equal(failed.session!.cycles[0].conversations[0].messages.at(-1)!.text, 'Water is split to release oxygen.', 'The learner message survives a provider failure');
  const blocked = await api.call<ApiError>(`${path}/conversations/${segment.id}/messages`, 'POST', { text: 'Another message' }, 409);
  assert.match(blocked.error.message, /Retry the reply first/);
  const retried = await api.call(`${path}/conversations/${segment.id}/messages`, 'POST', {});
  const messages = retried.cycles[0].conversations[0].messages;
  assert.deepEqual(messages.map((message) => message.role), ['student', 'learner', 'student', 'learner', 'student']);
  assert.equal(fake.calls.alex.at(-1)!.messages.length, 4, 'Alex receives the full discussion so far');

  const ended = await api.call(`${path}/conversations/${segment.id}/finalize`);
  assert.equal(ended.cycles[0].conversations[0].transcriptStatus, 'ready');
  assert.ok(ended.cycles[0].conversations[0].endedAt);
  await api.call<ApiError>(`${path}/conversations/${segment.id}/messages`, 'POST', { text: 'More' }, 409);
  const second = await api.call(`${path}/conversations/text`);
  assert.equal(second.cycles[0].conversations.length, 2, 'A new conversation can start after ending one');

  const recheck = await api.call(`${path}/recheck`);
  const open = recheck.cycles[0].conversations[1];
  assert.ok(open.endedAt, 'Moving to the recheck closes an open text conversation');
  assert.equal(open.transcriptStatus, 'incomplete', 'A conversation with no learner turns is not labeled saved');
  await api.call<ApiError>(`${path}/conversations/text`, 'POST', {}, 409);
});

test('voice: bounded focus context, pending transcripts retried until done, duplicates are no-ops', async (context) => {
  const fake = fakeProviders(); const api = await harness(context, fake.providers);
  const { path, session } = await toTeaching(api);
  fake.setHistory('processing', session.id);
  const credentials = await api.call<VoiceCredentials>(`${path}/voice`);
  const focus = JSON.parse(credentials.dynamicVariables.focus_context) as AlexContext;
  assert.ok(credentials.dynamicVariables.focus_context.length <= 5000);
  assert.deepEqual(focus.focusConcepts.map((concept) => concept.title), ['Concept chlorophyll', 'Concept water']);
  assert.ok(focus.sourceExcerpt.length <= 1600);
  assert.match(credentials.dynamicVariables.opening_question, /Concept chlorophyll/);

  await api.call(`${path}/conversations`, 'POST', { conversationId: 'conv_1' });
  const pending = await api.call(`${path}/conversations/conv_1/finalize`);
  const segment = pending.cycles[0].conversations[0];
  assert.equal(segment.channel, 'voice');
  assert.equal(segment.transcriptStatus, 'pending', 'Processing history is never labeled saved');
  assert.deepEqual(segment.messages, []);
  assert.equal(segment.checkAttempts, 1);

  // The learner may move on before the transcript is ready; finalization still works later.
  await api.call(`${path}/recheck`);
  fake.setHistory('done', session.id);
  const ready = await api.call(`${path}/conversations/conv_1/finalize`);
  assert.equal(ready.stage, 'recheck');
  assert.equal(ready.cycles[0].conversations[0].transcriptStatus, 'ready');
  assert.deepEqual(ready.cycles[0].conversations[0].messages.map((message) => [message.role, message.text]), [['student', 'What is chlorophyll for?'], ['learner', 'It absorbs light.']]);
  const calls = fake.calls.history;
  await api.call(`${path}/conversations/conv_1/finalize`);
  assert.equal(fake.calls.history, calls, 'A saved transcript is not fetched again');

  await api.call<ApiError>(`${path}/conversations/unknown/finalize`, 'POST', {}, 404);
});

test('voice: failed processing is incomplete and a foreign conversation is rejected', async (context) => {
  const fake = fakeProviders(); const api = await harness(context, fake.providers);
  const { path, session } = await toTeaching(api);
  await api.call(`${path}/conversations`, 'POST', { conversationId: 'conv_failed' });
  fake.setHistory('failed', session.id);
  const failed = await api.call(`${path}/conversations/conv_failed/finalize`);
  assert.equal(failed.cycles[0].conversations[0].transcriptStatus, 'incomplete');
  await api.call(`${path}/conversations`, 'POST', { conversationId: 'conv_other' });
  fake.setHistory('done', 'another-session');
  const rejected = await api.call<ApiError>(`${path}/conversations/conv_other/finalize`, 'POST', {}, 400);
  assert.match(rejected.error.message, /could not be verified/);
  assert.equal(rejected.session!.cycles[0].conversations[1].transcriptStatus, 'pending');
});

test('full real-shaped cycle with uploads and text Alex reaches results that reflect actual answers', async (context) => {
  const fake = fakeProviders(); const api = await harness(context, fake.providers);
  const { path, baseline } = await toTeaching(api);
  const started = await api.call(`${path}/conversations/text`);
  const segment = started.cycles[0].conversations[0];
  await api.call(`${path}/conversations/${segment.id}/messages`, 'POST', { text: 'Chlorophyll absorbs light energy.' });
  await api.call(`${path}/conversations/${segment.id}/finalize`);
  const recheck = await api.call(`${path}/recheck`);
  const attempt = recheck.attempts[1];
  assert.deepEqual(attempt.questions.map((question) => question.conceptId), baseline.questions.map((question) => question.conceptId));
  assert.deepEqual(attempt.questions.map((question) => question.prompt), ['Different follow-up about light?', 'Different follow-up about chlorophyll?', 'Different follow-up about water?']);
  await api.call(path, 'PATCH', { attemptId: attempt.id, answers: attempt.answers.map((answer, index) => ({ ...answer, text: index === 1 ? 'chlorophyll follow-up answer' : 'unsure' })) });
  const results = await api.call(`${path}/submit`, 'POST', { attemptId: attempt.id });
  assert.equal(results.stage, 'results');
  assert.deepEqual(results.attempts.map((item) => item.grade!.totalScore), [2, 2], 'Equal totals are reported as-is, not as improvement');
  assert.deepEqual(results.attempts[1].grade!.questionGrades.map((grade) => grade.score), [0, 2, 0]);
  assert.equal(results.cycles[0].conversations[0].transcriptStatus, 'ready');
  assert.equal(results.cycles[0].conversations[0].messages.length, 3);
  const finished = await api.call(`${path}/finish`);
  assert.equal(finished.lifecycle, 'completed');
  assert.deepEqual((await api.call(path, 'GET')).attempts.map((item) => item.grade!.totalScore), [2, 2], 'Completed sessions stay readable');
});

test('DEV MOCK Alex replies are scripted, labeled and make no provider requests', async (context) => {
  context.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected provider request'); });
  const providers = createProviders({ NODE_ENV: 'test', PRACTICE_PROVIDER_MODE: 'mock', MOCK_PROVIDER_DELAY_MS: '0', MOCK_PROVIDER_SCENARIO: 'reply-error-once' });
  const alex: AlexContext = { topic: 't', overview: '', focusConcepts: [{ title: 'Division', description: 'd' }], otherConcepts: [], sourceExcerpt: '' };
  const turn = (text: string): TranscriptMessage => ({ id: text, sessionId: 's', role: 'learner', text, createdAt: '', source: 'text' });
  await assert.rejects(providers.alexReply!(alex, [turn('a')]), /DEV MOCK: simulated Alex reply failure/);
  const reply = await providers.alexReply!(alex, [turn('a')]);
  assert.match(reply, /^DEV MOCK scripted Alex \(test message, not AI\): Can you give me a concrete example of Division\?$/);
  assert.notEqual(await providers.alexReply!(alex, [turn('a'), turn('b')]), reply, 'Scripted questions vary by turn');
});

test('deleting a session removes it and its uploaded material from the server', async (context) => {
  const api = await harness(context, fakeProviders().providers);
  const access = await api.create({ description: 'Photosynthesis', materials: [{ name: 'n.txt', data: b64(SOURCE) }] });
  const path = `/sessions/${access.session.id}`;
  assert.deepEqual(await api.call<{ deleted: boolean }>(path, 'DELETE'), { deleted: true });
  await api.call<ApiError>(path, 'GET', {}, 404);
  await api.call<ApiError>(`${path}/prepare`, 'POST', {}, 404);
});
