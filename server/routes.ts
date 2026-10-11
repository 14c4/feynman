import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AssessmentAnswer, AssessmentAttempt, ConversationSegment, PracticeCycle, PracticeQuestion, PracticeSession, QuestionGrade, ReviewSheet, SessionEvent, TranscriptMessage, UpdatePracticeInput, NervousnessValue, IntegrationHealth } from '../shared/types.js';
import { MONITORING_LIMITS, PRACTICE_LIMITS } from '../shared/types.js';
import { makeQuestions, PracticeError, publicQuestion, totalGrades, validateGrade, type PrivateBlueprint } from './domain.js';
import { createProviders, ProviderError, type GradeItem, type Providers } from './providers.js';
import { MemorySessionStore, type SessionStore, type StoredRecord } from './store.js';
import { assertDevelopmentMode } from './developmentProviders.js';
import { EXCERPT_CHARACTERS, extractMaterials, materialExcerpt } from './materials.js';
import { alexContext, openingQuestion, voiceFocusContext } from './alex.js';
import { MonitoringService } from './physiology.js';
import { bucketFor, clientAddress, positiveInteger, RateLimiter, rateLimitEnabled } from './protection.js';
import { buildReviewSheet, reviewFingerprint, reviewInput } from './review.js';
import { createAccounts, type Accounts } from './accounts.js';

interface HandlerOptions { /** Overrides the Supabase-backed account store (tests). */ accounts?: Accounts; store?: SessionStore; providers?: Providers; env?: NodeJS.ProcessEnv; monitoring?: MonitoringService; /** Minimum gap between ElevenLabs transcript checks per conversation. */ transcriptIntervalMs?: number; /** Per-client limits; defaults to on in production (see protection.ts). Pass null to disable. */ limiter?: RateLimiter | null }
const now = () => new Date().toISOString();
const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const safeEqual = (a: string, b: string) => { const left = Buffer.from(a); const right = Buffer.from(b); return left.length === right.length && timingSafeEqual(left, right); };
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Request could not be completed.';
const obj = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

function publicSession(record: StoredRecord, monitoring?: MonitoringService): PracticeSession {
  const session = structuredClone(record.session);
  // Monitoring windows live outside the record so slow grading/reply writes never overwrite streamed samples.
  const windows = monitoring?.list(session.id); if (windows) session.monitoring = windows;
  session.attempts = session.attempts.map((attempt) => ({ ...attempt, questions: attempt.questions.map(({ id, conceptId, prompt, supportsWorking }) => ({ id, conceptId, prompt, supportsWorking })) }));
  return session;
}

function safeConversationMessages(payload: unknown, sessionId: string, startedAt?: string): { status: 'ready' | 'incomplete'; messages: PracticeCycle['conversations'][number]['messages'] } {
  const data = obj(payload);
  if (data.status !== 'done') return { status: 'incomplete', messages: [] };
  const raw = Array.isArray(data.transcript) ? data.transcript : [];
  const messages = raw.flatMap((entry: unknown, index) => {
    const row = obj(entry); const role = row.role; const message = row.message ?? row.text;
    if ((role !== 'user' && role !== 'agent') || typeof message !== 'string' || !message.trim()) return [];
    return [{ id: typeof row.message_id === 'string' ? row.message_id : `voice-${index}`, sessionId, role: role === 'user' ? 'learner' as const : 'student' as const, text: message.slice(0, 6000), createdAt: messageTime(row, startedAt), source: 'voice' as const }];
  });
  return { status: messages.length ? 'ready' : 'incomplete', messages };
}

export function createPracticeHandler(options: HandlerOptions = {}) {
  const env = options.env ?? process.env;
  const providers = options.providers ?? createProviders(env);
  if (providers.mode === 'mock') assertDevelopmentMode(env);
  const monitoring = options.monitoring ?? new MonitoringService({ env, maxActive: positiveInteger(env.MAX_MONITORING_WINDOWS, 4) });
  const memory = new MemorySessionStore({ maxSessions: positiveInteger(env.MAX_SESSIONS, 500), idleTtlMs: positiveInteger(env.SESSION_TTL_HOURS, 24) * 3_600_000, onEvict: (id) => monitoring.delete(id) });
  // Accounts are optional and only wired up for the default store, so tests and guests are unaffected.
  const accounts = options.store ? undefined : options.accounts ?? createAccounts(env, memory);
  const store = options.store ?? accounts?.store ?? memory;
  /** The signed-in user for this request, if the browser sent a valid Supabase access token. */
  const userOf = async (req: IncomingMessage) => { const header = req.headers['x-user-token']; return accounts?.verify(typeof header === 'string' ? header : undefined); };
  const limiter = options.limiter === undefined ? (rateLimitEnabled(env) ? new RateLimiter() : null) : options.limiter;
  const trustProxy = env.TRUST_PROXY === 'true' || env.TRUST_PROXY === '1';
  const transcriptIntervalMs = options.transcriptIntervalMs ?? 2500;
  const view = (record: StoredRecord) => publicSession(record, monitoring);
  const json = (res: ServerResponse, status: number, body: unknown, retryAfterMs?: number) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...(retryAfterMs !== undefined ? { 'Retry-After': String(Math.max(1, Math.ceil(retryAfterMs / 1000))) } : {}) }); res.end(JSON.stringify(body)); };
  const replying = new Set<string>();
  /**
   * One provider operation per key at a time. A duplicate request (double click, refresh, a second tab)
   * waits for the running one and then returns the stored result instead of calling the provider again.
   */
  const inflight = new Map<string, Promise<unknown>>();
  const once = async (key: string, operation: () => Promise<void>): Promise<boolean> => {
    const running = inflight.get(key);
    if (running) { providers.usage?.record({ provider: key.startsWith('history') ? 'elevenlabs' : 'gemini', operation: key.split(':')[0]!, ok: true, latencyMs: 0, avoided: 'dedupe' }); await running.catch(() => undefined); return false; }
    const promise = operation().finally(() => inflight.delete(key));
    inflight.set(key, promise);
    await promise; return true;
  };
  const fresh = async (id: string) => { const latest = await store.get(id); if (!latest) throw new PracticeError('Practice session not found.', 404, 'NOT_FOUND'); return latest; };
  const readRaw = async (req: IncomingMessage, limit: number): Promise<Buffer> => {
    const chunks: Buffer[] = []; let length = 0;
    for await (const chunk of req) { const buffer = Buffer.from(chunk); length += buffer.length; if (length <= limit) chunks.push(buffer); }
    if (length > limit) throw new PracticeError(limit > 100_000 ? 'Uploaded files are too large. Keep the total under 8 MB.' : 'Request body is too large.', 413, 'BODY_TOO_LARGE');
    return Buffer.concat(chunks);
  };
  const readBody = async (req: IncomingMessage, limit = 100_000): Promise<Record<string, unknown>> => {
    const raw = await readRaw(req, limit);
    if (!raw.length) return {};
    try { const value: unknown = JSON.parse(raw.toString('utf8')); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value as Record<string, unknown>; } catch { throw new PracticeError('Request body must be a valid JSON object.'); }
  };
  return async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let responseRecord: StoredRecord | undefined;
    async function sendText(record: StoredRecord, segment: ConversationSegment, input: unknown) {
      const session = record.session;
      if (segment.channel !== 'text') throw new PracticeError('Messages can only be typed in a text conversation.', 409, 'INVALID_CONVERSATION');
      if (segment.endedAt || session.stage !== 'teaching' || session.lifecycle !== 'active') throw new PracticeError('This conversation has ended. Start a new one to keep teaching Alex.', 409, 'INVALID_STAGE');
      if (replying.has(session.id)) throw new PracticeError('Alex is still replying to your last message.', 409, 'REPLY_PENDING');
      if (input !== undefined && (typeof input !== 'string' || input.length > PRACTICE_LIMITS.textMessage)) throw new PracticeError(`Keep each message under ${PRACTICE_LIMITS.textMessage.toLocaleString('en-US')} characters.`);
      const text = typeof input === 'string' ? input.trim() : '';
      const awaiting = segment.messages.at(-1)?.role === 'learner';
      if (text) {
        if (awaiting) throw new PracticeError('Alex hasn’t replied to your last message yet. Retry the reply first.', 409, 'REPLY_PENDING');
        if (segment.messages.filter((item) => item.role === 'learner').length >= PRACTICE_LIMITS.textTurns) throw new PracticeError('This conversation reached its turn limit. Continue to the follow-up questions when you’re ready.', 409, 'TURN_LIMIT');
        segment.messages.push(message(session.id, 'learner', text)); session.updatedAt = now(); await store.set(record);
      } else if (!awaiting) throw new PracticeError('Type a message for Alex.');
      replying.add(session.id);
      try {
        const reply = await providers.alexReply!(alexContext(record), segment.messages);
        // Re-read so a concurrent update (e.g. a draft save) is not overwritten by this slower request.
        const fresh = (await store.get(session.id)) ?? record; responseRecord = fresh;
        const target = fresh.session.cycles.flatMap((item) => item.conversations).find((item) => item.id === segment.id);
        if (target && target.messages.at(-1)?.role === 'learner') target.messages.push(message(session.id, 'student', reply));
        fresh.session.updatedAt = now(); await store.set(fresh); json(res, 200, view(fresh));
      } finally { replying.delete(session.id); }
    }
    try {
      const url = new URL(req.url ?? '/', 'http://localhost'); const path = url.pathname;
      if (limiter) {
        const verdict = limiter.hit(clientAddress(req, trustProxy), bucketFor(req.method, path));
        if (!verdict.ok) {
          const seconds = Math.max(1, Math.ceil(verdict.retryAfterMs / 1000)); const wait = seconds >= 90 ? `${Math.ceil(seconds / 60)} minutes` : `${seconds} seconds`;
          // Drain any upload so the client sees the response instead of a reset connection.
          req.resume(); json(res, 429, { error: { code: 'TOO_MANY_REQUESTS', message: `Too many requests from this connection. Please wait about ${wait} and try again; your work is saved.` } }, verdict.retryAfterMs); return;
        }
      }
      if (req.method === 'GET' && path === '/api/metrics') {
        // Aggregate counts only (no prompts, answers or keys). Off in production unless explicitly enabled.
        if (env.NODE_ENV === 'production' && env.METRICS_ENABLED !== 'true') { json(res, 404, { error: { code: 'NOT_FOUND', message: 'This API endpoint does not exist.' } }); return; }
        json(res, 200, { providerMode: providers.mode ?? 'real', ...(providers.usage?.snapshot() ?? { note: 'DEV MOCK: no provider requests are made.' }) }); return;
      }
      if (req.method === 'GET' && path === '/api/health') {
        const health: IntegrationHealth = { status: 'ok', service: 'feynman.ai', providerMode: providers.mode ?? 'real', geminiConfigured: providers.mode !== 'mock' && Boolean(env.GEMINI_API_KEY), voiceConfigured: providers.mode !== 'mock' && Boolean(env.ELEVENLABS_API_KEY && env.ELEVENLABS_AGENT_ID), physiology: await monitoring.health(), accountsEnabled: Boolean(accounts) }; json(res, 200, health); return;
      }
      // Camera frames are binary; every other request body is JSON.
      const framesRequest = req.method === 'POST' && /^\/api\/sessions\/[0-9a-f-]{36}\/monitoring\/[0-9a-f-]{36}\/frames$/i.test(path);
      const frames = framesRequest ? await readRaw(req, MONITORING_LIMITS.maxBatchBytes) : undefined;
      const body = req.method === 'GET' || framesRequest ? {} : await readBody(req, req.method === 'POST' && path === '/api/sessions' ? 12_000_000 : 100_000);
      if (req.method === 'GET' && path === '/api/me/sessions') {
        const userId = await userOf(req);
        if (!accounts || !userId) { json(res, 401, { error: { code: 'UNAUTHORIZED', message: 'Sign in to see your saved sessions.' } }); return; }
        json(res, 200, { sessions: await accounts.list(userId) }); return;
      }
      if (req.method === 'POST' && path === '/api/sessions') {
        const description = body.description; const notes = body.notes ?? ''; const topic = body.topic ?? '';
        // The description is optional: study material or notes are enough to start.
        const described = description === undefined ? '' : description;
        if (typeof described !== 'string' || described.length > PRACTICE_LIMITS.description || typeof notes !== 'string' || notes.length > PRACTICE_LIMITS.notes || typeof topic !== 'string' || topic.length > PRACTICE_LIMITS.topic) { json(res, 400, { error: { code: 'INVALID_INPUT', message: 'Provide valid details within the permitted limits.' } }); return; }
        if (!described.trim() && !notes.trim() && !(Array.isArray(body.materials) && body.materials.length)) { json(res, 400, { error: { code: 'INVALID_INPUT', message: 'Upload study material or describe what you want to explain.' } }); return; }
        // Extraction (and reading any images) happens before anything is stored, so a rejected file creates no session.
        const materials = await extractMaterials(body.materials, providers.transcribeImage?.bind(providers));
        const token = randomBytes(32).toString('base64url'); const timestamp = now(); const id = randomUUID();
        const cycle: PracticeCycle = { id: randomUUID(), number: 1, focusConceptIds: [], conversations: [], createdAt: timestamp };
        const session: PracticeSession = { id, events: [], providerMode: providers.mode ?? 'real', title: (topic.trim() || described.trim() || materials[0]?.meta.name.replace(/\.[^.]+$/, '') || 'Study session').slice(0, 100), description: described.trim(), notes, scope: '', materials: materials.map((item) => item.meta), concepts: [], blueprintVersion: 1, stage: 'preparing', lifecycle: 'active', preparation: { status: 'idle' }, attempts: [], cycles: [cycle], currentCycleId: cycle.id, createdAt: timestamp, updatedAt: timestamp };
        const record: StoredRecord = { session, tokenHash: hash(token), userId: await userOf(req), blueprint: null, conversationOwners: {}, topic: topic.trim() || undefined, materials: materials.map(({ meta, text }) => ({ id: meta.id, name: meta.name, text })) };
        logEvent(session, 'session_created', {}, timestamp);
        await store.set(record); json(res, 201, { session: view(record), token }); return;
      }
      const match = path.match(/^\/api\/sessions\/([0-9a-f-]{36})(.*)$/i);
      if (!match) { json(res, 404, { error: { code: 'NOT_FOUND', message: 'This API endpoint does not exist.' } }); return; }
      const [, id, suffix] = match; const record = await store.get(id);
      if (!record) { json(res, 404, { error: { code: 'NOT_FOUND', message: 'Practice session not found.' } }); return; }
      // A signed-in owner can reopen their saved session from any browser: the session token is reissued, which signs out any other tab holding the old one.
      if (req.method === 'POST' && suffix === '/reopen') {
        const userId = await userOf(req);
        if (!userId || !record.userId || record.userId !== userId) { json(res, 404, { error: { code: 'NOT_FOUND', message: 'Practice session not found.' } }); return; }
        const token = randomBytes(32).toString('base64url'); record.tokenHash = hash(token);
        await store.set(record); json(res, 200, { session: view(record), token }); return;
      }
      const auth = req.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{20,})$/)?.[1];
      if (!auth || !safeEqual(record.tokenHash, hash(auth))) { json(res, 401, { error: { code: 'UNAUTHORIZED', message: 'A valid session access token is required.' } }); return; }
      responseRecord = record;
      const session = record.session; const save = async () => { session.updatedAt = now(); await store.set(record); };
      if (req.method === 'GET' && !suffix) { json(res, 200, view(record)); return; }
      // Removes the session, its uploaded text and transcripts from this server.
      if (req.method === 'DELETE' && !suffix) { await store.delete(session.id); monitoring.delete(session.id); responseRecord = undefined; json(res, 200, { deleted: true }); return; }
      if (req.method === 'PATCH' && !suffix) {
        const input = body as unknown as UpdatePracticeInput;
        if (session.lifecycle !== 'active') { json(res, 409, { error: { code: 'INVALID_STAGE', message: 'Resume this session before editing.' } }); return; }
        if (input.answers !== undefined) {
          const attempt = session.attempts.find((item) => item.id === input.attemptId);
          if (!attempt || !['baseline', 'recheck'].includes(attempt.kind) || session.stage !== attempt.kind) throw new Error('Answers cannot be changed in this stage.');
           if (!Array.isArray(input.answers) || input.answers.length !== attempt.questions.length || input.answers.some((answer, index) => !validAnswer(answer, attempt.questions[index], true))) throw new Error('Answers do not match the active assessment.');
           if (attempt.grade || attempt.submittedAt) throw new Error('Submitted answers cannot be changed.');
           recordAnswers(session, attempt, input.answers);
           attempt.answers = structuredClone(input.answers);
        }
        if (input.currentQuestionIndex !== undefined) {
          const attempt = session.attempts.find((item) => item.id === input.attemptId);
          if (!attempt || session.stage !== attempt.kind || attempt.submittedAt) throw new Error('Question navigation cannot be changed in this stage.');
          if (!Number.isInteger(input.currentQuestionIndex) || input.currentQuestionIndex < 0 || input.currentQuestionIndex >= attempt.questions.length) throw new Error('Question index is invalid.'); attempt.currentQuestionIndex = input.currentQuestionIndex;
        }
        if (input.attemptStarted === true) {
          const attempt = session.attempts.find((item) => item.id === input.attemptId);
          if (!attempt || session.stage !== attempt.kind || attempt.submittedAt) throw new Error('This assessment cannot be started in this stage.');
          startAttempt(session, attempt);
        }
        if (input.nervousnessBefore !== undefined) { session.nervousnessBefore = nervousness(input.nervousnessBefore); if (session.nervousnessBefore) logEvent(session, 'nervousness_recorded', { when: 'before', value: session.nervousnessBefore }); }
        if (input.nervousnessAfter !== undefined) { if (session.stage !== 'results') throw new Error('Post-practice reflection is available after results.'); session.nervousnessAfter = nervousness(input.nervousnessAfter); if (session.nervousnessAfter) logEvent(session, 'nervousness_recorded', { when: 'after', value: session.nervousnessAfter }); }
        await save(); json(res, 200, view(record)); return;
      }
      if (req.method === 'POST' && suffix === '/prepare') {
        if (session.stage !== 'preparing' || session.lifecycle !== 'active') throw new Error('Preparation is not available in this stage.');
        // A second prepare while one is generating (refresh, double click) waits for it instead of generating again.
        if (inflight.has(`prepare:${session.id}`)) {
          await once(`prepare:${session.id}`, async () => undefined);
          const latest = await fresh(session.id); responseRecord = latest;
          if (latest.session.preparation.status === 'error') throw new PracticeError(latest.session.preparation.message ?? 'Preparation did not finish. Please try again.', 409, 'PREPARATION_FAILED');
          json(res, 200, view(latest)); return;
        }
        let release!: () => void;
        const running = new Promise<void>((resolve) => { release = resolve; });
        inflight.set(`prepare:${session.id}`, running);
        const previous = session.preparation;
        session.preparation = { status: 'pending' }; await save();
        try {
           const clarification = body.clarification;
           if (clarification !== undefined && (typeof clarification !== 'string' || clarification.length > PRACTICE_LIMITS.description)) throw new PracticeError('Keep your clarification within 1,200 characters.');
           // Yes / No on a suggested rewrite: "Yes" adopts the server's own stored suggestion as the request; "No" keeps the original wording.
           const accept = body.acceptSuggestion === true; const keepOriginal = body.keepOriginal === true;
           if (accept) { if (!previous.suggestedPrompt) throw new PracticeError('There is no suggestion to accept. Continue with your own wording.'); session.description = previous.suggestedPrompt; }
           const focus = session.description || 'Practice the key ideas in the study material and notes I provided.';
           const request = record.topic ? `Topic: ${record.topic}\nWhat I want to learn: ${focus}` : focus;
           const output = await providers.generate(request, session.notes, typeof clarification === 'string' && !keepOriginal ? clarification : undefined, materialExcerpt(record.materials, EXCERPT_CHARACTERS.preparation) || undefined, keepOriginal || accept);
           if (output.kind === 'clarification') { session.preparation = { status: 'clarification', clarificationQuestion: output.question, ...(output.suggestion ? { suggestedPrompt: output.suggestion } : {}) }; await save(); json(res, 200, view(record)); return; }
           const generated = output.concepts;
           const baseline = makeQuestions(generated, 'baseline'); const reserved = makeQuestions(generated, 'recheck');
           const blueprint: PrivateBlueprint = { concepts: generated.map(({ id, title, description, rubric }) => ({ id, title, description, rubric })), baseline, reserved, questions: Object.fromEntries([...baseline, ...reserved].map((question) => [question.id, question])), version: 1 };
           record.blueprint = blueprint; session.title = record.topic || output.title?.slice(0, 100) || session.title; session.concepts = generated.map(({ id, title, description }) => ({ id, title, description })); session.scope = output.scope || generated.map((concept) => concept.description).join('\n');
          session.attempts.push(newAttempt('baseline', session.currentCycleId, blueprint.baseline, 1)); session.stage = 'baseline'; session.preparation = { status: 'ready' }; logEvent(session, 'concepts_ready'); await save(); json(res, 200, view(record));
          } catch (error) { session.preparation = { status: 'error', message: safeError(error) }; await save(); throw error; }
        finally { inflight.delete(`prepare:${session.id}`); release(); }
        return;
      }
      if (req.method === 'POST' && suffix === '/submit') {
        const key = `submit:${typeof body.attemptId === 'string' ? body.attemptId : ''}`;
        if (await once(key, () => submit(record, body.attemptId, providers, save))) { json(res, 200, view(record)); return; }
        const latest = await fresh(session.id); responseRecord = latest;
        if (latest.session.operationError) throw new PracticeError(latest.session.operationError, 409, 'GRADING_FAILED');
        json(res, 200, view(latest)); return;
      }
      if (req.method === 'POST' && suffix === '/pause') { if (session.lifecycle !== 'active') throw new Error('Session is not active.'); session.lifecycle = 'paused'; logEvent(session, 'session_paused'); await save(); json(res, 200, view(record)); return; }
      if (req.method === 'POST' && suffix === '/resume') { if (session.lifecycle === 'completed') throw new PracticeError('This practice session is finished.', 409); if (session.lifecycle === 'paused') logEvent(session, 'session_resumed'); session.lifecycle = 'active'; await save(); json(res, 200, view(record)); return; }
      if (req.method === 'POST' && suffix === '/recheck') {
        if (session.stage !== 'teaching' || session.lifecycle !== 'active') throw new Error('Recheck is not available in this stage.');
        const blueprint = record.blueprint as PrivateBlueprint; const cycle = session.cycles.find((item) => item.id === session.currentCycleId); if (!cycle) throw new Error('Practice cycle not found.');
         const questions = blueprint.reserved;
        for (const segment of cycle.conversations) if (segment.channel === 'text' && !segment.endedAt) endText(segment);
        // Returning from "Back to Alex" resumes the same follow-up attempt with its saved answers.
        const existing = session.attempts.find((item) => item.id === cycle.recheckAttemptId && !item.submittedAt && !item.grade);
        if (existing) { session.stage = 'recheck'; await save(); json(res, 200, view(record)); return; }
        const recheck = newAttempt('recheck', cycle.id, questions, blueprint.version); session.attempts.push(recheck); cycle.recheckAttemptId = recheck.id; session.stage = 'recheck';
        // Follow-up questions appear immediately, so the attempt starts now.
        startAttempt(session, recheck); await save(); json(res, 200, view(record)); return;
      }
      if (req.method === 'POST' && suffix === '/teach') {
        // "Back to Alex" from the follow-up check. Answers stay on the unsubmitted attempt; nothing is graded.
        if (session.stage !== 'recheck' || session.lifecycle !== 'active') throw new Error('Returning to Alex is available during the follow-up check.');
        const recheck = session.attempts.find((item) => item.kind === 'recheck' && item.cycleId === session.currentCycleId);
        if (recheck?.submittedAt || recheck?.grade) throw new Error('The follow-up check was already submitted.');
        session.stage = 'teaching'; await save(); json(res, 200, view(record)); return;
      }
      if (req.method === 'POST' && suffix === '/cycles') throw new PracticeError('Additional cycles are deferred for this demo. Start a new practice from Home.', 501, 'DEFERRED');
      if (req.method === 'POST' && suffix === '/finish') { if (session.stage !== 'results') throw new Error('Finish is available after results.'); session.lifecycle = 'completed'; session.completedAt = now(); logEvent(session, 'session_finished', {}, session.completedAt); await save(); json(res, 200, view(record)); return; }
      if (req.method === 'POST' && suffix === '/review') {
        // Generated from this session's stored evidence and saved with it. A stored sheet is reused until that
        // evidence changes (e.g. a voice transcript saved after results) or the learner asks for a new version.
        if (session.stage !== 'results') throw new PracticeError('Your review sheet is available with your results.', 409, 'INVALID_STAGE');
        const input = reviewInput(record); const fingerprint = reviewFingerprint(input);
        if (session.review && record.reviewHash === fingerprint && body.regenerate !== true) { json(res, 200, view(record)); return; }
        if (!providers.reviewSheet) throw new PracticeError('Review sheets are not available with this provider.', 503, 'NOT_CONFIGURED');
        let sheet = undefined as ReviewSheet | undefined;
        await once(`review:${session.id}`, async () => { sheet = buildReviewSheet(input, await providers.reviewSheet!(input), providers.mode === 'mock' ? 'mock' : 'gemini'); });
        // Re-read so a concurrent update (e.g. the after-rating) is not overwritten by this slower request.
        const latest = await fresh(session.id); responseRecord = latest;
        if (sheet) { latest.session.review = sheet; latest.reviewHash = fingerprint; latest.session.updatedAt = now(); await store.set(latest); }
        // A duplicate request that waited on a failed generation must not report an outdated sheet as current.
        if (!latest.session.review || latest.reviewHash !== fingerprint) throw new PracticeError('Your review sheet could not be created. Your results are saved; please retry.', 502, 'REVIEW_FAILED');
        json(res, 200, view(latest)); return;
      }
      if (req.method === 'POST' && suffix === '/voice') {
        if (session.stage !== 'teaching' || session.lifecycle !== 'active') throw new Error('Voice is available during active teaching.');
        json(res, 200, await providers.voice(session.id, session.title, voiceFocusContext(record), openingQuestion(session))); return;
      }
      const monitor = suffix.match(/^\/monitoring(?:\/([0-9a-f-]{36})\/(frames|stop))?$/i);
      if (req.method === 'POST' && monitor) {
        const [, windowId, operation] = monitor;
        if (!windowId) {
          if (session.lifecycle === 'completed') throw new PracticeError('This practice session is finished.', 409, 'INVALID_STAGE');
          await monitoring.start(session.id, body.purpose); json(res, 200, view(record)); return;
        }
        if (operation === 'frames') { json(res, 200, monitoring.ingest(session.id, windowId, frames ?? Buffer.alloc(0), Number(url.searchParams.get('w')), Number(url.searchParams.get('h')), url.searchParams.has('cfps') ? Number(url.searchParams.get('cfps')) : undefined, url.searchParams.get('enc') === 'jpeg' ? 'jpeg' : 'rgb')); return; }
        json(res, 200, { status: await monitoring.stop(session.id, windowId, body.reason), session: view(record) }); return;
      }
      const conversation = suffix.match(/^\/conversations(?:\/([A-Za-z0-9_-]{1,128})(?:\/(finalize|messages))?)?$/);
      if (req.method === 'POST' && conversation) {
        const cycle = session.cycles.find((item) => item.id === session.currentCycleId);
        if (!cycle) throw new Error('No active cycle exists.');
        const [, conversationId, operation] = conversation;
        if (!conversationId) {
          const voiceId = body.conversationId;
          if (typeof voiceId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(voiceId) || voiceId === 'text') throw new Error('A valid conversation ID is required.');
          record.conversationOwners[voiceId] = session.id; if (!cycle.conversations.some((item) => item.id === voiceId)) cycle.conversations.push({ id: voiceId, channel: 'voice', transcriptStatus: 'pending', messages: [], startedAt: now() }); await save(); json(res, 200, view(record)); return;
        }
        if (conversationId === 'text' && !operation) {
          if (session.stage !== 'teaching' || session.lifecycle !== 'active') throw new PracticeError('The conversation with Alex is available during active teaching.', 409, 'INVALID_STAGE');
          if (!providers.alexReply) throw new PracticeError('Text conversation is not available with this provider.', 503, 'NOT_CONFIGURED');
          if (!cycle.conversations.some((item) => item.channel === 'text' && !item.endedAt)) {
            cycle.conversations.push({ id: randomUUID(), channel: 'text', transcriptStatus: 'pending', messages: [message(session.id, 'student', `Hi, I’m Alex. ${openingQuestion(session)}`)], startedAt: now() });
            await save();
          }
          json(res, 200, view(record)); return;
        }
        const segment = session.cycles.flatMap((item) => item.conversations).find((item) => item.id === conversationId);
        if (!operation || !segment) throw new PracticeError('Conversation not found in this practice session.', 404, 'NOT_FOUND');
        if (operation === 'messages') { await sendText(record, segment, body.text); return; }
        if (segment.channel === 'text') { if (!segment.endedAt) { endText(segment); await save(); } json(res, 200, view(record)); return; }
        if (record.conversationOwners[conversationId] !== session.id) throw new Error('Conversation does not belong to this practice session.');
        // Duplicate callbacks and later checks are no-ops once the transcript is saved.
        if (segment.transcriptStatus === 'ready') { json(res, 200, view(record)); return; }
        // Several views poll the same pending transcript; check ElevenLabs at most every few seconds per conversation.
        if (segment.lastCheckedAt && Date.now() - Date.parse(segment.lastCheckedAt) < transcriptIntervalMs) { providers.usage?.record({ provider: 'elevenlabs', operation: 'conversation_history', ok: true, latencyMs: 0, avoided: 'throttle' }); json(res, 200, view(record)); return; }
        if (inflight.has(`history:${conversationId}`)) { await once(`history:${conversationId}`, async () => undefined); const latest = await fresh(session.id); responseRecord = latest; json(res, 200, view(latest)); return; }
        segment.endedAt ??= now(); segment.checkAttempts = (segment.checkAttempts ?? 0) + 1; segment.lastCheckedAt = now(); await save();
        let raw: unknown; await once(`history:${conversationId}`, async () => { raw = await providers.history(conversationId); }); const data = obj(raw);
        if (data.agent_id !== env.ELEVENLABS_AGENT_ID || obj(data.metadata).agent_id !== undefined && obj(data.metadata).agent_id !== env.ELEVENLABS_AGENT_ID) throw new Error('Conversation agent could not be verified.');
        const variables = obj(data.conversation_initiation_client_data); const vars = obj(variables.dynamic_variables);
        if (vars.session_id !== session.id) throw new Error('Conversation session could not be verified.');
        // While ElevenLabs is still processing, stay pending so the client retries. Never mark a partial transcript saved.
        if (data.status === 'failed') segment.transcriptStatus = 'incomplete';
        else if (data.status === 'done') { const result = safeConversationMessages(raw, session.id, segment.startedAt); segment.transcriptStatus = result.status; segment.messages = result.messages; }
        await save(); json(res, 200, view(record)); return;
      }
      json(res, 404, { error: { code: 'NOT_FOUND', message: 'This API endpoint does not exist.' } });
    } catch (error) {
      const status = statusFor(error);
      json(res, status, { error: { code: error instanceof PracticeError ? error.code : 'REQUEST_FAILED', message: safeError(error) }, ...(responseRecord ? { session: view(responseRecord) } : {}) }, error instanceof ProviderError && status === 429 ? error.retryAfterMs ?? 30_000 : undefined);
    }
  };
}

function message(sessionId: string, role: TranscriptMessage['role'], text: string): TranscriptMessage { return { id: randomUUID(), sessionId, role, text, createdAt: now(), source: 'text' }; }
/** Text transcripts are stored turn by turn, so ending one makes it complete as saved. */
function endText(segment: ConversationSegment) { segment.endedAt = now(); segment.transcriptStatus = segment.messages.some((item) => item.role === 'learner') ? 'ready' : 'incomplete'; }
function validAnswer(value: AssessmentAnswer, question: PracticeQuestion, draft = false): boolean { return Boolean(value && value.questionId === question.id && typeof value.text === 'string' && value.text.length <= PRACTICE_LIMITS.answer && typeof value.working === 'string' && value.working.length <= PRACTICE_LIMITS.working && typeof value.skipped === 'boolean' && typeof value.uncertain === 'boolean' &&
  (value.confidence === undefined || CONFIDENCE.includes(value.confidence)) && optionalTime(value.confidenceAt) && optionalTime(value.answeredAt) && (draft || value.skipped || Boolean(value.text.trim() || value.working.trim()))); }
const CONFIDENCE: string[] = ['low', 'medium', 'high'];
function optionalTime(value: unknown): boolean { return value === undefined || (typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value))); }
function messageTime(row: Record<string, unknown>, startedAt?: string): string {
  if (typeof row.time === 'string' && Number.isFinite(Date.parse(row.time))) return row.time;
  // ElevenLabs reports each turn as seconds into the call; anchor it to when the call was registered.
  const offset = row.time_in_call_secs;
  if (startedAt && typeof offset === 'number' && Number.isFinite(offset) && offset >= 0) return new Date(Date.parse(startedAt) + offset * 1000).toISOString();
  return now();
}
/** Appends a genuine event at the moment it happens (or at a validated browser time for answers). */
function logEvent(session: PracticeSession, type: SessionEvent['type'], details: Partial<Omit<SessionEvent, 'id' | 'seq' | 'sessionId' | 'type' | 'at'>> = {}, at = now()) {
  session.events ??= [];
  session.events.push({ id: randomUUID(), seq: (session.events.at(-1)?.seq ?? 0) + 1, sessionId: session.id, type, at, ...details });
}
function startAttempt(session: PracticeSession, attempt: AssessmentAttempt) {
  if (attempt.startedAt) return;
  attempt.startedAt = now();
  logEvent(session, 'assessment_started', { attemptId: attempt.id, kind: attempt.kind }, attempt.startedAt);
}
/** Logs an answer each time the learner moves on from a question (a new `answeredAt`). */
function recordAnswers(session: PracticeSession, attempt: AssessmentAttempt, answers: AssessmentAnswer[]) {
  const latest = Date.now() + 120_000; const earliest = Date.parse(attempt.startedAt ?? session.createdAt) - 120_000;
  for (const [index, answer] of answers.entries()) {
    if (!answer.answeredAt || answer.answeredAt === attempt.answers[index]?.answeredAt) continue;
    const stamped = Date.parse(answer.answeredAt);
    // Browser clocks are trusted within reason; an implausible time is replaced by the server time.
    const at = stamped <= latest && stamped >= earliest ? new Date(stamped).toISOString() : now();
    const question = attempt.questions[index]!;
    logEvent(session, 'answer_recorded', { attemptId: attempt.id, kind: attempt.kind, questionId: question.id, conceptId: question.conceptId, confidence: answer.confidence, skipped: answer.skipped }, at);
  }
}
function nervousness(value: NervousnessValue | null): NervousnessValue | undefined { if (value === null) return undefined; if (![1, 2, 3, 4, 5].includes(value)) throw new Error('Nervousness must be from 1 to 5.'); return value; }
function newAttempt(kind: 'baseline' | 'recheck', cycleId: string, questions: PracticeBlueprintQuestions, version: number): AssessmentAttempt { return { id: randomUUID(), kind, cycleId, blueprintVersion: version, questions: questions.map(publicQuestion), answers: questions.map((question) => ({ questionId: question.id, text: '', working: '', skipped: false, uncertain: false })), currentQuestionIndex: 0 }; }
type PracticeBlueprintQuestions = PrivateBlueprint['baseline'];
async function submit(record: StoredRecord, attemptId: unknown, providers: Providers, save: () => Promise<void>): Promise<void> {
  const session = record.session; const attempt = session.attempts.find((item) => item.id === attemptId);
  if (!attempt || session.lifecycle !== 'active') throw new Error('Assessment cannot be submitted in this stage.');
  if (attempt.grade) return;
  if (session.stage !== attempt.kind && session.stage !== `${attempt.kind}_evaluating`) throw new Error('Assessment cannot be submitted in this stage.');
  if (attempt.answers.length !== 3 || attempt.answers.some((answer, index) => !validAnswer(answer, attempt.questions[index]))) throw new Error('Complete all questions or explicitly skip each one.');
  // A retry after a grading failure is not a second submission.
  if (!session.events?.some((event) => event.type === 'assessment_submitted' && event.attemptId === attempt.id)) logEvent(session, 'assessment_submitted', { attemptId: attempt.id, kind: attempt.kind });
  session.stage = attempt.kind === 'baseline' ? 'baseline_evaluating' : 'recheck_evaluating'; await save();
  try {
    const blueprint = record.blueprint as PrivateBlueprint;
    // Grades that already passed validation survive a failed attempt, so a retry only regrades what is missing.
    const cache = record.gradeCache ??= {};
    let pending: GradeItem[] = attempt.questions.flatMap((question, index) => {
      const answer = attempt.answers[index]!;
      if (answer.skipped || cache[question.id]) return [];
      const concept = blueprint.concepts.find((item) => item.id === question.conceptId); if (!concept) throw new Error('Assessment blueprint is unavailable.');
      const expectedAnswer = blueprint.questions[question.id]?.expectedAnswer; if (!expectedAnswer) throw new Error('Assessment answer key is unavailable.');
      return [{ id: question.id, question: question.prompt, rubric: concept.rubric, expectedAnswer, text: answer.text, working: answer.working }];
    });
    // One request grades the whole assessment; items whose evidence fails validation get one focused regrade.
    for (let round = 0; pending.length && round < 2; round++) {
      const raw = providers.gradeAll ? await providers.gradeAll(pending)
        : Object.fromEntries(await Promise.all(pending.map(async (item) => [item.id, await providers.grade(item)] as const)));
      const failed: GradeItem[] = [];
      for (const item of pending) {
        try { const result = validateGrade(raw[item.id], item.text, item.working); cache[item.id] = { questionId: item.id, conceptId: attempt.questions.find((question) => question.id === item.id)!.conceptId, score: result.score, maxScore: 2, feedback: result.feedback, evidence: result.evidence }; }
        catch { failed.push(item); }
      }
      pending = failed;
    }
    if (pending.length) throw new PracticeError('Grading returned unsupported evidence. Your answers are saved; please retry.', 502, 'INVALID_GRADE');
    const questionGrades: QuestionGrade[] = attempt.questions.map((question, index) => attempt.answers[index]!.skipped
      ? { questionId: question.id, conceptId: question.conceptId, score: 0, maxScore: 2, feedback: 'Skipped; no evidence was provided to assess.', evidence: '' }
      : cache[question.id]!);
    const grade = totalGrades(questionGrades);
    for (const question of attempt.questions) delete cache[question.id];
     attempt.grade = grade; attempt.submittedAt = now(); session.operationError = undefined;
    logEvent(session, 'assessment_graded', { attemptId: attempt.id, kind: attempt.kind, score: grade.totalScore, maxScore: grade.maxScore }, grade.gradedAt);
    if (attempt.kind === 'baseline') { session.stage = 'teaching'; logEvent(session, 'teaching_started'); const cycle = session.cycles.find((item) => item.id === session.currentCycleId)!; cycle.focusConceptIds = grade.questionGrades.filter((item) => item.score < 2).map((item) => item.conceptId); }
    else session.stage = 'results';
    await save();
   } catch (error) { session.stage = attempt.kind === 'baseline' ? 'baseline_evaluating' : 'recheck_evaluating'; session.operationError = safeError(error); await save(); throw error; }
}

function statusFor(error: unknown): number { if (error instanceof PracticeError) return error.status; const message = errorMessage(error); if (/too large/i.test(message)) return 413; if (/stage|active|submitted|cannot|complete|resume|paused/i.test(message)) return 409; return 400; }
function safeError(error: unknown): string { return error instanceof PracticeError ? error.message : errorMessage(error); }
