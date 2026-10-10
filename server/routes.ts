import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AssessmentAnswer, AssessmentAttempt, ConversationSegment, PracticeCycle, PracticeQuestion, PracticeSession, TranscriptMessage, UpdatePracticeInput, NervousnessValue, IntegrationHealth } from '../shared/types.js';
import { PRACTICE_LIMITS } from '../shared/types.js';
import { makeQuestions, PracticeError, publicQuestion, totalGrades, validateGrade, type PrivateBlueprint } from './domain.js';
import { createProviders, type Providers } from './providers.js';
import { MemorySessionStore, type SessionStore, type StoredRecord } from './store.js';
import { assertDevelopmentMode } from './developmentProviders.js';
import { EXCERPT_CHARACTERS, extractMaterials, materialExcerpt } from './materials.js';
import { alexContext, openingQuestion, voiceFocusContext } from './alex.js';

interface HandlerOptions { store?: SessionStore; providers?: Providers; env?: NodeJS.ProcessEnv; }
const now = () => new Date().toISOString();
const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const safeEqual = (a: string, b: string) => { const left = Buffer.from(a); const right = Buffer.from(b); return left.length === right.length && timingSafeEqual(left, right); };
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Request could not be completed.';
const obj = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

function publicSession(record: StoredRecord): PracticeSession {
  const session = structuredClone(record.session);
  session.attempts = session.attempts.map((attempt) => ({ ...attempt, questions: attempt.questions.map(({ id, conceptId, prompt, supportsWorking }) => ({ id, conceptId, prompt, supportsWorking })) }));
  return session;
}

function safeConversationMessages(payload: unknown, sessionId: string): { status: 'ready' | 'incomplete'; messages: PracticeCycle['conversations'][number]['messages'] } {
  const data = obj(payload);
  if (data.status !== 'done') return { status: 'incomplete', messages: [] };
  const raw = Array.isArray(data.transcript) ? data.transcript : [];
  const messages = raw.flatMap((entry: unknown, index) => {
    const row = obj(entry); const role = row.role; const message = row.message ?? row.text;
    if ((role !== 'user' && role !== 'agent') || typeof message !== 'string' || !message.trim()) return [];
    return [{ id: typeof row.message_id === 'string' ? row.message_id : `voice-${index}`, sessionId, role: role === 'user' ? 'learner' as const : 'student' as const, text: message.slice(0, 6000), createdAt: typeof row.time === 'string' ? row.time : now(), source: 'voice' as const }];
  });
  return { status: messages.length ? 'ready' : 'incomplete', messages };
}

export function createPracticeHandler(options: HandlerOptions = {}) {
  const store = options.store ?? new MemorySessionStore();
  const env = options.env ?? process.env;
  const providers = options.providers ?? createProviders(env);
  if (providers.mode === 'mock') assertDevelopmentMode(env);
  const json = (res: ServerResponse, status: number, body: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
  const replying = new Set<string>();
  const readBody = async (req: IncomingMessage, limit = 100_000): Promise<Record<string, unknown>> => {
    const chunks: Buffer[] = []; let length = 0;
    for await (const chunk of req) { const buffer = Buffer.from(chunk); length += buffer.length; if (length <= limit) chunks.push(buffer); }
    if (length > limit) throw new PracticeError(limit > 100_000 ? 'Uploaded files are too large. Keep the total under 8 MB.' : 'Request body is too large.', 413, 'BODY_TOO_LARGE');
    if (!length) return {};
    try { const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value as Record<string, unknown>; } catch { throw new PracticeError('Request body must be a valid JSON object.'); }
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
        fresh.session.updatedAt = now(); await store.set(fresh); json(res, 200, publicSession(fresh));
      } finally { replying.delete(session.id); }
    }
    try {
      const url = new URL(req.url ?? '/', 'http://localhost'); const path = url.pathname;
      if (req.method === 'GET' && path === '/api/health') {
        const health: IntegrationHealth = { status: 'ok', service: 'feynman.ai', providerMode: providers.mode ?? 'real', geminiConfigured: providers.mode !== 'mock' && Boolean(env.GEMINI_API_KEY), voiceConfigured: providers.mode !== 'mock' && Boolean(env.ELEVENLABS_API_KEY && env.ELEVENLABS_AGENT_ID) }; json(res, 200, health); return;
      }
      const body = req.method === 'GET' ? {} : await readBody(req, req.method === 'POST' && path === '/api/sessions' ? 12_000_000 : 100_000);
      if (req.method === 'POST' && path === '/api/sessions') {
        const description = body.description; const notes = body.notes ?? ''; const topic = body.topic ?? '';
        if (typeof description !== 'string' || !description.trim() || description.length > PRACTICE_LIMITS.description || typeof notes !== 'string' || notes.length > PRACTICE_LIMITS.notes || typeof topic !== 'string' || topic.length > PRACTICE_LIMITS.topic) { json(res, 400, { error: { code: 'INVALID_INPUT', message: 'Provide a description and valid notes within the permitted limits.' } }); return; }
        // Extraction happens before anything is stored, so a rejected file creates no session.
        const materials = await extractMaterials(body.materials);
        const token = randomBytes(32).toString('base64url'); const timestamp = now(); const id = randomUUID();
        const cycle: PracticeCycle = { id: randomUUID(), number: 1, focusConceptIds: [], conversations: [], createdAt: timestamp };
        const session: PracticeSession = { id, providerMode: providers.mode ?? 'real', title: (topic.trim() || description.trim()).slice(0, 100), description: description.trim(), notes, scope: '', materials: materials.map((item) => item.meta), concepts: [], blueprintVersion: 1, stage: 'preparing', lifecycle: 'active', preparation: { status: 'idle' }, attempts: [], cycles: [cycle], currentCycleId: cycle.id, createdAt: timestamp, updatedAt: timestamp };
        const record: StoredRecord = { session, tokenHash: hash(token), blueprint: null, conversationOwners: {}, topic: topic.trim() || undefined, materials: materials.map(({ meta, text }) => ({ id: meta.id, name: meta.name, text })) };
        await store.set(record); json(res, 201, { session: publicSession(record), token }); return;
      }
      const match = path.match(/^\/api\/sessions\/([0-9a-f-]{36})(.*)$/i);
      if (!match) { json(res, 404, { error: { code: 'NOT_FOUND', message: 'This API endpoint does not exist.' } }); return; }
      const [, id, suffix] = match; const record = await store.get(id);
      if (!record) { json(res, 404, { error: { code: 'NOT_FOUND', message: 'Practice session not found.' } }); return; }
      const auth = req.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{20,})$/)?.[1];
      if (!auth || !safeEqual(record.tokenHash, hash(auth))) { json(res, 401, { error: { code: 'UNAUTHORIZED', message: 'A valid session access token is required.' } }); return; }
      responseRecord = record;
      const session = record.session; const save = async () => { session.updatedAt = now(); await store.set(record); };
      if (req.method === 'GET' && !suffix) { json(res, 200, publicSession(record)); return; }
      // Removes the session, its uploaded text and transcripts from this server.
      if (req.method === 'DELETE' && !suffix) { await store.delete(session.id); responseRecord = undefined; json(res, 200, { deleted: true }); return; }
      if (req.method === 'PATCH' && !suffix) {
        const input = body as unknown as UpdatePracticeInput;
        if (session.lifecycle !== 'active') { json(res, 409, { error: { code: 'INVALID_STAGE', message: 'Resume this session before editing.' } }); return; }
        if (input.answers !== undefined) {
          const attempt = session.attempts.find((item) => item.id === input.attemptId);
          if (!attempt || !['baseline', 'recheck'].includes(attempt.kind) || session.stage !== attempt.kind) throw new Error('Answers cannot be changed in this stage.');
           if (!Array.isArray(input.answers) || input.answers.length !== attempt.questions.length || input.answers.some((answer, index) => !validAnswer(answer, attempt.questions[index], true))) throw new Error('Answers do not match the active assessment.');
           if (attempt.grade || attempt.submittedAt) throw new Error('Submitted answers cannot be changed.');
           attempt.answers = structuredClone(input.answers);
        }
        if (input.currentQuestionIndex !== undefined) {
          const attempt = session.attempts.find((item) => item.id === input.attemptId);
          if (!attempt || session.stage !== attempt.kind || attempt.submittedAt) throw new Error('Question navigation cannot be changed in this stage.');
          if (!Number.isInteger(input.currentQuestionIndex) || input.currentQuestionIndex < 0 || input.currentQuestionIndex >= attempt.questions.length) throw new Error('Question index is invalid.'); attempt.currentQuestionIndex = input.currentQuestionIndex;
        }
        if (input.nervousnessBefore !== undefined) session.nervousnessBefore = nervousness(input.nervousnessBefore);
        if (input.nervousnessAfter !== undefined) { if (session.stage !== 'results') throw new Error('Post-practice reflection is available after results.'); session.nervousnessAfter = nervousness(input.nervousnessAfter); }
        await save(); json(res, 200, publicSession(record)); return;
      }
      if (req.method === 'POST' && suffix === '/prepare') {
        if (session.stage !== 'preparing' || session.lifecycle !== 'active') throw new Error('Preparation is not available in this stage.');
        session.preparation = { status: 'pending' }; await save();
        try {
           const clarification = body.clarification;
           if (clarification !== undefined && (typeof clarification !== 'string' || clarification.length > PRACTICE_LIMITS.description)) throw new PracticeError('Keep your clarification within 1,200 characters.');
           const request = record.topic ? `Topic: ${record.topic}\nWhat I want to learn: ${session.description}` : session.description;
           const output = await providers.generate(request, session.notes, typeof clarification === 'string' ? clarification : undefined, materialExcerpt(record.materials, EXCERPT_CHARACTERS.preparation) || undefined);
           if (output.kind === 'clarification') { session.preparation = { status: 'clarification', clarificationQuestion: output.question }; await save(); json(res, 200, publicSession(record)); return; }
           const generated = output.concepts;
           const baseline = makeQuestions(generated, 'baseline'); const reserved = makeQuestions(generated, 'recheck');
           const blueprint: PrivateBlueprint = { concepts: generated.map(({ id, title, description, rubric }) => ({ id, title, description, rubric })), baseline, reserved, questions: Object.fromEntries([...baseline, ...reserved].map((question) => [question.id, question])), version: 1 };
           record.blueprint = blueprint; session.title = record.topic || output.title?.slice(0, 100) || session.title; session.concepts = generated.map(({ id, title, description }) => ({ id, title, description })); session.scope = output.scope || generated.map((concept) => concept.description).join('\n');
          session.attempts.push(newAttempt('baseline', session.currentCycleId, blueprint.baseline, 1)); session.stage = 'baseline'; session.preparation = { status: 'ready' }; await save(); json(res, 200, publicSession(record));
          } catch (error) { session.preparation = { status: 'error', message: safeError(error) }; await save(); throw error; }
        return;
      }
      if (req.method === 'POST' && suffix === '/submit') { await submit(record, body.attemptId, providers, save); json(res, 200, publicSession(record)); return; }
      if (req.method === 'POST' && suffix === '/pause') { if (session.lifecycle !== 'active') throw new Error('Session is not active.'); session.lifecycle = 'paused'; await save(); json(res, 200, publicSession(record)); return; }
      if (req.method === 'POST' && suffix === '/resume') { if (session.lifecycle === 'completed') throw new PracticeError('This practice session is finished.', 409); session.lifecycle = 'active'; await save(); json(res, 200, publicSession(record)); return; }
      if (req.method === 'POST' && suffix === '/recheck') {
        if (session.stage !== 'teaching' || session.lifecycle !== 'active') throw new Error('Recheck is not available in this stage.');
        const blueprint = record.blueprint as PrivateBlueprint; const cycle = session.cycles.find((item) => item.id === session.currentCycleId); if (!cycle) throw new Error('Practice cycle not found.');
         const questions = blueprint.reserved;
        for (const segment of cycle.conversations) if (segment.channel === 'text' && !segment.endedAt) endText(segment);
        session.attempts.push(newAttempt('recheck', cycle.id, questions, blueprint.version)); cycle.recheckAttemptId = session.attempts.at(-1)?.id; session.stage = 'recheck'; await save(); json(res, 200, publicSession(record)); return;
      }
      if (req.method === 'POST' && suffix === '/cycles') throw new PracticeError('Additional cycles are deferred for this demo. Start a new practice from Home.', 501, 'DEFERRED');
      if (req.method === 'POST' && suffix === '/finish') { if (session.stage !== 'results') throw new Error('Finish is available after results.'); session.lifecycle = 'completed'; session.completedAt = now(); await save(); json(res, 200, publicSession(record)); return; }
      if (req.method === 'POST' && suffix === '/voice') {
        if (session.stage !== 'teaching' || session.lifecycle !== 'active') throw new Error('Voice is available during active teaching.');
        json(res, 200, await providers.voice(session.id, session.title, voiceFocusContext(record), openingQuestion(session))); return;
      }
      const conversation = suffix.match(/^\/conversations(?:\/([A-Za-z0-9_-]{1,128})(?:\/(finalize|messages))?)?$/);
      if (req.method === 'POST' && conversation) {
        const cycle = session.cycles.find((item) => item.id === session.currentCycleId);
        if (!cycle) throw new Error('No active cycle exists.');
        const [, conversationId, operation] = conversation;
        if (!conversationId) {
          const voiceId = body.conversationId;
          if (typeof voiceId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(voiceId) || voiceId === 'text') throw new Error('A valid conversation ID is required.');
          record.conversationOwners[voiceId] = session.id; if (!cycle.conversations.some((item) => item.id === voiceId)) cycle.conversations.push({ id: voiceId, channel: 'voice', transcriptStatus: 'pending', messages: [], startedAt: now() }); await save(); json(res, 200, publicSession(record)); return;
        }
        if (conversationId === 'text' && !operation) {
          if (session.stage !== 'teaching' || session.lifecycle !== 'active') throw new PracticeError('The conversation with Alex is available during active teaching.', 409, 'INVALID_STAGE');
          if (!providers.alexReply) throw new PracticeError('Text conversation is not available with this provider.', 503, 'NOT_CONFIGURED');
          if (!cycle.conversations.some((item) => item.channel === 'text' && !item.endedAt)) {
            cycle.conversations.push({ id: randomUUID(), channel: 'text', transcriptStatus: 'pending', messages: [message(session.id, 'student', `Hi, I’m Alex. ${openingQuestion(session)}`)], startedAt: now() });
            await save();
          }
          json(res, 200, publicSession(record)); return;
        }
        const segment = session.cycles.flatMap((item) => item.conversations).find((item) => item.id === conversationId);
        if (!operation || !segment) throw new PracticeError('Conversation not found in this practice session.', 404, 'NOT_FOUND');
        if (operation === 'messages') { await sendText(record, segment, body.text); return; }
        if (segment.channel === 'text') { if (!segment.endedAt) { endText(segment); await save(); } json(res, 200, publicSession(record)); return; }
        if (record.conversationOwners[conversationId] !== session.id) throw new Error('Conversation does not belong to this practice session.');
        // Duplicate callbacks and later checks are no-ops once the transcript is saved.
        if (segment.transcriptStatus === 'ready') { json(res, 200, publicSession(record)); return; }
        segment.endedAt ??= now(); segment.checkAttempts = (segment.checkAttempts ?? 0) + 1; segment.lastCheckedAt = now(); await save();
        const raw = await providers.history(conversationId); const data = obj(raw);
        if (data.agent_id !== env.ELEVENLABS_AGENT_ID || obj(data.metadata).agent_id !== undefined && obj(data.metadata).agent_id !== env.ELEVENLABS_AGENT_ID) throw new Error('Conversation agent could not be verified.');
        const variables = obj(data.conversation_initiation_client_data); const vars = obj(variables.dynamic_variables);
        if (vars.session_id !== session.id) throw new Error('Conversation session could not be verified.');
        // While ElevenLabs is still processing, stay pending so the client retries. Never mark a partial transcript saved.
        if (data.status === 'failed') segment.transcriptStatus = 'incomplete';
        else if (data.status === 'done') { const result = safeConversationMessages(raw, session.id); segment.transcriptStatus = result.status; segment.messages = result.messages; }
        await save(); json(res, 200, publicSession(record)); return;
      }
      json(res, 404, { error: { code: 'NOT_FOUND', message: 'This API endpoint does not exist.' } });
    } catch (error) { json(res, statusFor(error), { error: { code: error instanceof PracticeError ? error.code : 'REQUEST_FAILED', message: safeError(error) }, ...(responseRecord ? { session: publicSession(responseRecord) } : {}) }); }
  };
}

function message(sessionId: string, role: TranscriptMessage['role'], text: string): TranscriptMessage { return { id: randomUUID(), sessionId, role, text, createdAt: now(), source: 'text' }; }
/** Text transcripts are stored turn by turn, so ending one makes it complete as saved. */
function endText(segment: ConversationSegment) { segment.endedAt = now(); segment.transcriptStatus = segment.messages.some((item) => item.role === 'learner') ? 'ready' : 'incomplete'; }
function validAnswer(value: AssessmentAnswer, question: PracticeQuestion, draft = false): boolean { return Boolean(value && value.questionId === question.id && typeof value.text === 'string' && value.text.length <= PRACTICE_LIMITS.answer && typeof value.working === 'string' && value.working.length <= PRACTICE_LIMITS.working && typeof value.skipped === 'boolean' && typeof value.uncertain === 'boolean' && (draft || value.skipped || Boolean(value.text.trim() || value.working.trim()))); }
function nervousness(value: NervousnessValue | null): NervousnessValue | undefined { if (value === null) return undefined; if (![1, 2, 3, 4, 5].includes(value)) throw new Error('Nervousness must be from 1 to 5.'); return value; }
function newAttempt(kind: 'baseline' | 'recheck', cycleId: string, questions: PracticeBlueprintQuestions, version: number): AssessmentAttempt { return { id: randomUUID(), kind, cycleId, blueprintVersion: version, questions: questions.map(publicQuestion), answers: questions.map((question) => ({ questionId: question.id, text: '', working: '', skipped: false, uncertain: false })), currentQuestionIndex: 0 }; }
type PracticeBlueprintQuestions = PrivateBlueprint['baseline'];
async function submit(record: StoredRecord, attemptId: unknown, providers: Providers, save: () => Promise<void>): Promise<void> {
  const session = record.session; const attempt = session.attempts.find((item) => item.id === attemptId);
  if (!attempt || session.lifecycle !== 'active') throw new Error('Assessment cannot be submitted in this stage.');
  if (attempt.grade) return;
  if (session.stage !== attempt.kind && session.stage !== `${attempt.kind}_evaluating`) throw new Error('Assessment cannot be submitted in this stage.');
  if (attempt.answers.length !== 3 || attempt.answers.some((answer, index) => !validAnswer(answer, attempt.questions[index]))) throw new Error('Complete all questions or explicitly skip each one.');
  session.stage = attempt.kind === 'baseline' ? 'baseline_evaluating' : 'recheck_evaluating'; await save();
  try {
    const blueprint = record.blueprint as PrivateBlueprint;
     const questionGrades = await Promise.all(attempt.questions.map(async (question, index) => {
      const answer = attempt.answers[index]!; if (answer.skipped) return { questionId: question.id, conceptId: question.conceptId, score: 0 as const, maxScore: 2 as const, feedback: 'Skipped; no evidence was provided to assess.', evidence: '' };
      const concept = blueprint.concepts.find((item) => item.id === question.conceptId); if (!concept) throw new Error('Assessment blueprint is unavailable.');
       const expectedAnswer = blueprint.questions[question.id]?.expectedAnswer; if (!expectedAnswer) throw new Error('Assessment answer key is unavailable.');
       const grade = await providers.grade({ question: question.prompt, rubric: concept.rubric, expectedAnswer, text: answer.text, working: answer.working });
       validateGrade(grade, answer.text, answer.working);
      return { questionId: question.id, conceptId: question.conceptId, score: grade.score, maxScore: 2 as const, feedback: grade.feedback, evidence: grade.evidence };
    }));
    const grade = totalGrades(questionGrades);
     attempt.grade = grade; attempt.submittedAt = now(); session.operationError = undefined;
    if (attempt.kind === 'baseline') { session.stage = 'teaching'; const cycle = session.cycles.find((item) => item.id === session.currentCycleId)!; cycle.focusConceptIds = grade.questionGrades.filter((item) => item.score < 2).map((item) => item.conceptId); }
    else session.stage = 'results';
    await save();
   } catch (error) { session.stage = attempt.kind === 'baseline' ? 'baseline_evaluating' : 'recheck_evaluating'; session.operationError = safeError(error); await save(); throw error; }
}

export const handleRequest = createPracticeHandler();

function statusFor(error: unknown): number { if (error instanceof PracticeError) return error.status; const message = errorMessage(error); if (/too large/i.test(message)) return 413; if (/stage|active|submitted|cannot|complete|resume|paused/i.test(message)) return 409; return 400; }
function safeError(error: unknown): string { return error instanceof PracticeError ? error.message : errorMessage(error); }
