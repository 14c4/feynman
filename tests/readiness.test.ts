import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import test, { type TestContext } from 'node:test';
import type { MonitoringStatus, PracticeSession, QuestionGrade, SessionAccess } from '../shared/types.js';
import { buildTimeline, calibrate, calibrationSummary, conceptJourneys, mentionedConcepts, phaseAt, readingsNear } from '../shared/insights.js';
import { createProviders } from '../server/providers.js';
import { createPracticeHandler } from '../server/routes.js';
import { isValidReading, MonitoringService, readingsFromMetrics, type PresageModule } from '../server/physiology.js';

interface ApiResponse { session?: PracticeSession; error?: { code: string; message: string } }

async function harness(context: TestContext, options: { scenario?: string; monitoring?: MonitoringService; env?: Record<string, string> } = {}) {
  const env = { NODE_ENV: 'test', PRACTICE_PROVIDER_MODE: 'mock', MOCK_PROVIDER_SCENARIO: options.scenario ?? 'normal', MOCK_PROVIDER_DELAY_MS: '0', ...options.env };
  const monitoring = options.monitoring ?? new MonitoringService({ env });
  const server = createServer(createPracticeHandler({ env, providers: createProviders(env), monitoring }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const nativeFetch = globalThis.fetch;
  context.mock.method(globalThis, 'fetch', (url: string, init?: RequestInit) => {
    assert.ok(String(url).startsWith(`${base}/`), 'Only this loopback API may be requested; never real providers');
    return nativeFetch(url, init);
  });
  context.after(async () => { monitoring.close(); server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); });
  let token = '';
  const call = async <T = PracticeSession,>(path: string, method = 'POST', body: unknown = {}, status = 200): Promise<T> => {
    const binary = body instanceof Uint8Array;
    const response = await fetch(`${base}/api${path}`, { method, headers: { 'Content-Type': binary ? 'application/octet-stream' : 'application/json', Authorization: `Bearer ${token}` }, body: method === 'GET' ? undefined : binary ? body : JSON.stringify(body) });
    const value: unknown = await response.json();
    assert.equal(response.status, status, JSON.stringify(value));
    return value as T;
  };
  const access = await call<SessionAccess>('/sessions', 'POST', { description: 'Learner topic' }, 201);
  token = access.token;
  return { call, path: `/sessions/${access.session.id}`, access, monitoring };
}

const grade = (score: 0 | 1 | 2): QuestionGrade => ({ questionId: 'q', conceptId: 'c', score, maxScore: 2, feedback: '', evidence: '' });

test('calibration compares confidence with graded results, including partial credit', () => {
  assert.equal(calibrate('high', grade(0)).kind, 'confident_incorrect');
  assert.equal(calibrate('low', grade(2)).kind, 'correct_unsure');
  assert.equal(calibrate('high', grade(2)).kind, 'calibrated');
  assert.equal(calibrate('medium', grade(1)).kind, 'calibrated');
  assert.equal(calibrate('low', grade(0)).kind, 'calibrated');
  assert.equal(calibrate('high', grade(1)).kind, 'overconfident');
  assert.equal(calibrate('medium', grade(0)).kind, 'overconfident');
  assert.equal(calibrate('medium', grade(2)).kind, 'underconfident');
  assert.equal(calibrate('low', grade(1)).kind, 'underconfident');
  assert.equal(calibrate(undefined, grade(2)).kind, 'unrated');
  assert.equal(calibrate('high', undefined).kind, 'ungraded');
  assert.equal(calibrate('high', grade(0), true).kind, 'skipped');
  assert.equal(calibrate('high', grade(0)).mismatch, true);
  assert.equal(calibrate('high', grade(2)).mismatch, false);
});

test('concept mentions are a transparent lexical match', () => {
  const concepts = [{ id: 'a', title: 'Addition' }, { id: 'm', title: 'Matrix multiplication rules' }, { id: 'x', title: 'Of it' }];
  assert.deepEqual(mentionedConcepts('Can you give me an example of addition?', concepts), ['a']);
  assert.deepEqual(mentionedConcepts('Multiplying a matrix by a vector', concepts), ['m']);
  assert.deepEqual(mentionedConcepts('Just a matrix here', concepts), []);
  assert.deepEqual(mentionedConcepts('of it all', concepts), ['x'], 'A short title still matches when named in full');
});

test('confidence ratings persist through autosave and refresh, and invalid values are rejected', async (context) => {
  const api = await harness(context);
  const prepared = await api.call(`${api.path}/prepare`);
  const attempt = prepared.attempts[0];
  const at = new Date().toISOString();
  const answers = attempt.answers.map((answer, index) => ({ ...answer, text: ['5', '12', ''][index], skipped: index === 2, confidence: (['high', 'low', undefined] as const)[index], confidenceAt: index < 2 ? at : undefined, uncertain: index === 1, answeredAt: at }));
  await api.call(api.path, 'PATCH', { attemptId: attempt.id, answers, currentQuestionIndex: 2 });
  const restored = await api.call(api.path, 'GET');
  assert.deepEqual(restored.attempts[0].answers.map((answer) => answer.confidence), ['high', 'low', undefined]);
  assert.equal(restored.attempts[0].answers[0].confidenceAt, at);
  await api.call(api.path, 'PATCH', { attemptId: attempt.id, answers: answers.map((answer) => ({ ...answer, confidence: 'certain' })) }, 409);
  await api.call(api.path, 'PATCH', { attemptId: attempt.id, answers: answers.map((answer) => ({ ...answer, answeredAt: 'yesterday' })) }, 409);
  // Saving the same answers again does not duplicate answer events.
  await api.call(api.path, 'PATCH', { attemptId: attempt.id, answers });
  assert.equal((await api.call(api.path, 'GET')).events!.filter((event) => event.type === 'answer_recorded').length, 3);
});

test('a full cycle records ordered, phase-consistent events and builds the readiness timeline', async (context) => {
  const api = await harness(context, { scenario: 'grade-error-once' });
  const prepared = await api.call(`${api.path}/prepare`);
  const baseline = prepared.attempts[0];
  const started = await api.call(api.path, 'PATCH', { attemptId: baseline.id, attemptStarted: true });
  assert.ok(started.attempts[0].startedAt);
  await api.call(api.path, 'PATCH', { attemptId: baseline.id, attemptStarted: true });
  await api.call(api.path, 'PATCH', { nervousnessBefore: 4 });

  // Answer one question at a time, revisiting the first one.
  let answers = baseline.answers;
  const step = async (index: number, change: Partial<typeof answers[number]>) => {
    answers = answers.map((answer, i) => i === index ? { ...answer, ...change, answeredAt: new Date().toISOString() } : answer);
    await api.call(api.path, 'PATCH', { attemptId: baseline.id, answers });
    await new Promise((resolve) => setTimeout(resolve, 3));
  };
  await step(0, { text: '6', confidence: 'medium' });
  await step(1, { text: '12', confidence: 'high' });
  await step(0, { text: '5', working: '2 + 3 = 5', confidence: 'low' });
  await step(2, { text: '9', confidence: 'high' });
  await api.call<ApiResponse>(`${api.path}/submit`, 'POST', { attemptId: baseline.id }, 429);
  const taught = await api.call(`${api.path}/submit`, 'POST', { attemptId: baseline.id });
  assert.equal(taught.stage, 'teaching');

  const conversation = await api.call(`${api.path}/conversations/text`);
  const segment = conversation.cycles[0].conversations[0];
  await api.call(`${api.path}/conversations/${segment.id}/messages`, 'POST', { text: 'Division means sharing 12 into 3 equal groups.' });
  await api.call(`${api.path}/pause`); await api.call(`${api.path}/resume`);
  const recheck = await api.call(`${api.path}/recheck`);
  const follow = recheck.attempts[1];
  assert.ok(follow.startedAt, 'Follow-up questions start when they are shown');
  const followAnswers = follow.answers.map((answer, index) => ({ ...answer, text: ['7', '8', '5'][index], working: index === 2 ? '10 shared into 2 groups' : 'Equal groups', confidence: (['high', 'low', 'medium'] as const)[index], answeredAt: new Date().toISOString() }));
  await api.call(api.path, 'PATCH', { attemptId: follow.id, answers: followAnswers });
  const results = await api.call(`${api.path}/submit`, 'POST', { attemptId: follow.id });
  await api.call(api.path, 'PATCH', { nervousnessAfter: 2 });
  const finished = await api.call(`${api.path}/finish`);

  const events = finished.events!;
  assert.deepEqual(events.map((event) => event.seq), events.map((_, index) => index + 1), 'Sequence numbers are contiguous');
  const types = events.map((event) => event.type);
  assert.deepEqual(types.filter((type) => type !== 'answer_recorded' && type !== 'nervousness_recorded'), [
    'session_created', 'concepts_ready', 'assessment_started', 'assessment_submitted', 'assessment_graded', 'teaching_started',
    'session_paused', 'session_resumed', 'assessment_started', 'assessment_submitted', 'assessment_graded', 'session_finished',
  ], 'One start per attempt and one submission despite a grading retry');
  assert.equal(types.filter((type) => type === 'answer_recorded').length, 7, 'Four baseline visits (one revisit) and three follow-up answers');
  for (const event of events.filter((item) => item.type !== 'answer_recorded')) assert.ok(events.filter((item) => item.seq < event.seq && item.type !== 'answer_recorded').every((item) => item.at <= event.at), `${event.type} is in time order`);

  const timeline = buildTimeline(finished);
  for (let index = 1; index < timeline.items.length; index++) assert.ok(timeline.items[index]!.at >= timeline.items[index - 1]!.at, 'Timeline items are chronological');
  assert.deepEqual(timeline.phases.map((span) => span.phase), ['preparation', 'baseline', 'teaching', 'recheck', 'results']);
  for (const moment of timeline.answers) {
    const item = timeline.items.find((entry) => entry.type === 'answer' && entry.answer === moment)!;
    assert.equal(phaseAt(timeline.phases, item.at), moment.kind, 'Each answer falls inside its own assessment phase');
  }
  const baselineMoments = timeline.answers.filter((moment) => moment.kind === 'baseline');
  assert.equal(baselineMoments.filter((moment) => moment.revised).length, 1);
  const final = baselineMoments.filter((moment) => !moment.revised);
  // Mock grading: '5' with working = 2, '12' without working = 1, '9' = 0.
  assert.deepEqual(final.map((moment) => [moment.confidence, moment.grade?.score, moment.calibration.kind]), [
    ['high', 1, 'overconfident'], ['low', 2, 'correct_unsure'], ['high', 0, 'confident_incorrect'],
  ]);
  const journeys = conceptJourneys(finished, timeline);
  const division = journeys.find((journey) => journey.concept.id === 'division')!;
  assert.equal(division.baseline?.calibration.kind, 'confident_incorrect');
  assert.equal(division.recheck?.grade?.score, 2);
  assert.equal(division.mentions.learner, 1, 'The learner named division while teaching');
  assert.ok(division.focus);
  assert.deepEqual(calibrationSummary(journeys.map((journey) => journey.baseline)), { rated: 3, calibrated: 0, mismatched: 3, confidentIncorrect: 1, correctUnsure: 1 });
  assert.equal(results.stage, 'results');
  assert.equal(timeline.items.filter((item) => item.type === 'nervousness').length, 2);
  assert.equal(timeline.windows.length, 0);
  assert.deepEqual(readingsNear(timeline, timeline.start), { pulse: undefined, breathing: undefined }, 'No readings are invented without monitoring');
});

test('Presage readings follow published reliability rules', () => {
  assert.equal(isValidReading('pulse', 70, 80, true, 12_000), true);
  assert.equal(isValidReading('pulse', 70, 80, true, 11_999), false, 'pulse warm-up is 12 s');
  assert.equal(isValidReading('pulse', 70, 39, true, 20_000), false, 'pulse needs confidence ≥ 40');
  assert.equal(isValidReading('pulse', 70, 90, false, 20_000), false, 'unstable readings are not valid');
  assert.equal(isValidReading('pulse', 130, 90, true, 20_000), false, 'outside the 40–110 operating range');
  assert.equal(isValidReading('breathing', 14, 50, true, 29_000), false, 'breathing warm-up is 30 s');
  assert.equal(isValidReading('breathing', 14, 44, true, 31_000), false, 'breathing needs confidence ≥ 45');
  assert.equal(isValidReading('breathing', 14, 45, true, 31_000), true);
  const parsed = readingsFromMetrics({ cardio: { pulseRate: [{ value: 71.2, confidence: 66, stable: true, timestamp: { toString: () => '1700000000000000' } }] }, breathing: { rate: [{ value: 'bad', timestamp: 1 }] } });
  assert.deepEqual(parsed, [{ metric: 'pulse', value: 71.2, confidence: 66, stable: true, atMs: 1_700_000_000_000 }]);
});

test('monitoring health is honest about missing keys, missing SDK and production', async () => {
  const noKey = new MonitoringService({ env: { NODE_ENV: 'development' } });
  assert.match((await noKey.health()).reason!, /PRESAGE_API_KEY/);
  const noSdk = new MonitoringService({ env: { NODE_ENV: 'development', PRESAGE_API_KEY: 'test-key' }, loadPresage: async () => { throw new Error('Cannot find module'); } });
  const health = await noSdk.health();
  assert.equal(health.available, false); assert.match(health.reason!, /not installed/);
  await assert.rejects(noSdk.start('s', 'in_session'), /not installed/);
  assert.throws(() => new MonitoringService({ env: { NODE_ENV: 'production', PHYSIOLOGY_SOURCE: 'simulated' } }), /unavailable in production/);
  assert.throws(() => new MonitoringService({ env: { NODE_ENV: 'development', PHYSIOLOGY_SOURCE: 'fake' } }), /presage or simulated/);
  noKey.close(); noSdk.close();
});

test('simulated monitoring is labeled, timestamped and joins the session timeline', async (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-10T10:00:00Z') });
  const service = new MonitoringService({ env: { NODE_ENV: 'test', PHYSIOLOGY_SOURCE: 'simulated' } });
  context.after(() => service.close());
  assert.deepEqual(await service.health(), { source: 'simulated', available: true });
  const window = await service.start('session-1', 'before_assessment');
  assert.equal(window.source, 'simulated');
  context.mock.timers.tick(39_000);
  const status = service.ingest('session-1', window.id, Buffer.alloc(0), 0, 0);
  assert.ok(status.window.samples.length >= 60);
  assert.ok(status.window.samples.every((sample) => Number.isFinite(Date.parse(sample.at))));
  assert.equal(status.window.samples.filter((sample) => sample.metric === 'breathing' && Date.parse(sample.at) - Date.parse(window.startedAt) < 30_000 && sample.valid).length, 0, 'no breathing reading counts during warm-up');
  assert.ok(status.latest.pulse?.valid);
  assert.throws(() => service.ingest('another-session', window.id, Buffer.alloc(0), 0, 0), /not found/);
  const stopped = await service.stop('session-1', window.id);
  assert.equal(stopped.window.status, 'ended');
  const after = service.ingest('session-1', window.id, Buffer.alloc(0), 0, 0);
  assert.equal(after.window.samples.length, stopped.window.samples.length, 'No samples are added after stopping');
});

class FakeSdk {
  static last?: FakeSdk;
  handlers: Record<string, (...args: never[]) => void> = {};
  frames: number[] = []; started = false; destroyed = false; input?: number; options: unknown;
  constructor(options: unknown) { this.options = options; FakeSdk.last = this; }
  useCustomInput(transform?: number) { this.input = transform; return this; }
  start() { this.started = true; }
  stop() { this.started = false; }
  async destroy() { this.destroyed = true; }
  sendFrame(buffer: Uint8Array, width: number, height: number, stride: number, format: number, timestampUs: number) {
    assert.equal(buffer.length, width * height * 3); assert.equal(stride, width * 3); assert.equal(format, 0);
    this.frames.push(timestampUs); return true;
  }
  on(event: string, callback: (...args: never[]) => void) { this.handlers[event] = callback; return this; }
  emit(event: string, ...args: unknown[]) { (this.handlers[event] as (...values: unknown[]) => void)(...args); }
}
const fakeModule: PresageModule = { SmartSpectraSDK: FakeSdk as unknown as PresageModule['SmartSpectraSDK'], decodeMetrics: (buffer: Buffer) => JSON.parse(buffer.toString()) as unknown, breathingMetrics: [2], cardioMetrics: [15] };

function frameBatch(timestampsUs: number[], width = 64, height = 64) {
  const stride = 8 + width * height * 3; const body = Buffer.alloc(stride * timestampsUs.length);
  timestampsUs.forEach((timestamp, index) => body.writeDoubleLE(timestamp, index * stride));
  return body;
}

test('Presage pipeline: binary frames reach the SDK in order, readings are validated and video is never stored', async (context) => {
  const monitoring = new MonitoringService({ env: { NODE_ENV: 'test', PRESAGE_API_KEY: 'test-key' }, loadPresage: async () => fakeModule });
  const api = await harness(context, { monitoring });
  await api.call(`${api.path}/monitoring`, 'POST', { purpose: 'sometime' }, 400);
  const session = await api.call(`${api.path}/monitoring`, 'POST', { purpose: 'before_assessment' });
  const window = session.monitoring!.find((item) => item.status === 'active')!;
  const sdk = FakeSdk.last!;
  assert.equal(sdk.started, true); assert.equal(sdk.input, 0);
  assert.deepEqual((sdk.options as { requestedMetrics: number[] }).requestedMetrics, [2, 15]);
  const origin = Date.parse('2026-10-10T10:00:00Z') * 1000;
  const framesPath = `${api.path}/monitoring/${window.id}/frames?w=64&h=64`;
  await api.call<ApiResponse>(framesPath, 'POST', new Uint8Array(frameBatch([origin]).subarray(5)), 400);
  await api.call<MonitoringStatus>(framesPath, 'POST', new Uint8Array(frameBatch([origin, origin + 33_000, origin + 33_000, origin + 10])), 200);
  assert.deepEqual(sdk.frames, [origin, origin + 33_000], 'Duplicate and out-of-order frames are dropped');

  const metrics = (pulse: [number, number, boolean, number][], breathing: [number, number, boolean, number][] = []) => Buffer.from(JSON.stringify({ cardio: { pulseRate: pulse.map(([value, confidence, stable, offset]) => ({ value, confidence, stable, timestamp: origin + offset * 1_000_000 })) }, breathing: { rate: breathing.map(([value, confidence, stable, offset]) => ({ value, confidence, stable, timestamp: origin + offset * 1_000_000 })) } }));
  sdk.emit('validationStatus', 1, origin, 'Move your face into view');
  sdk.emit('validationStatus', 1, origin + 500_000, 'Move your face into view');
  sdk.emit('metrics', metrics([[70, 80, true, 5], [71, 80, true, 13], [72, 30, true, 14], [73, 90, false, 15]], [[15, 60, true, 31]]));
  sdk.emit('validationStatus', 0, origin + 16_000_000, '');
  sdk.emit('metrics', metrics([[71, 80, true, 13]]));
  const status = await api.call<MonitoringStatus>(framesPath, 'POST', new Uint8Array(frameBatch([origin + 66_000])), 200);
  assert.equal(status.code, 'OK');
  assert.deepEqual(status.window.quality.map((note) => note.code), ['NO_FACE_FOUND', 'OK'], 'Repeated statuses are debounced');
  assert.deepEqual(status.window.samples.filter((sample) => sample.metric === 'pulse').map((sample) => [sample.value, sample.valid]), [[70, false], [71, true], [72, false], [73, false]], 'Warm-up, confidence and stability rules apply; duplicates are ignored');
  assert.equal(status.latest.breathing?.valid, true);

  const loaded = await api.call(api.path, 'GET');
  assert.equal(loaded.monitoring?.[0].samples.length, 5);
  const json = JSON.stringify(loaded);
  assert.equal(json.includes('test-key'), false, 'The API key is never exposed');
  assert.ok(json.length < 10_000, 'Frames are not stored');
  const timeline = buildTimeline(loaded);
  assert.deepEqual(timeline.samples.pulse.map((sample) => sample.t), [...timeline.samples.pulse.map((sample) => sample.t)].sort((a, b) => a - b));

  sdk.emit('error', 2, 'auth failed', false);
  const failed = await api.call<MonitoringStatus>(framesPath, 'POST', new Uint8Array(frameBatch([origin + 99_000])), 200);
  assert.equal(failed.window.status, 'error');
  assert.match(failed.window.endReason!, /API key/);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(sdk.destroyed, true, 'The SDK is released when a window ends');
  await api.call(api.path, 'DELETE');
});
