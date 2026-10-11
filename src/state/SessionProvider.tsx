import { useCallback, useEffect, useReducer, useRef, useState, type ReactNode } from 'react';
import type { AssessmentAnswer, CreatePracticeInput, FrameEncoding, IntegrationHealth, MonitoringPurpose, NervousnessValue, PracticeSession, UpdatePracticeInput } from '../../shared/types';
import { loadIntegrationHealth, PracticeApiError, practiceApi, resumeSavedSession } from '../services/practiceApi';
import { accessToken } from '../services/supabase';
import { SessionContext } from './useSessions';
import { initialSessionState, sessionReducer, type SessionAction, type SessionState } from './sessionReducer';

interface Draft extends UpdatePracticeInput { attemptId: string; revision: number }

/** Sessions live only in this tab's memory: nothing is written to browser storage. */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(sessionReducer, initialSessionState);
  const current = useRef<SessionState>(state);
  const tokens = useRef<Record<string, string>>({});
  const drafts = useRef<Record<string, Draft>>({});
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const queues = useRef<Record<string, Promise<unknown>>>({});
  const pendingActions = useRef<Record<string, Promise<void> | undefined>>({});
  const [draftStatus, setDraftStatus] = useState<Record<string, 'local' | 'saving' | 'saved'>>({});
  const [integration, setIntegration] = useState<IntegrationHealth>();
  const providerMode = integration ? integration.providerMode ?? 'real' : undefined;

  const send = useCallback((action: SessionAction) => {
    current.current = sessionReducer(current.current, action);
    dispatch(action);
  }, []);
  const tokenFor = useCallback((id: string) => {
    const token = tokens.current[id];
    if (!token) throw new Error('This session is no longer open in this tab. Start a new session from Home.');
    return token;
  }, []);
  const receive = useCallback((session: PracticeSession) => {
    const draft = drafts.current[session.id];
    if (draft && session.stage === session.attempts.find((attempt) => attempt.id === draft.attemptId)?.kind) {
      session = { ...session, attempts: session.attempts.map((attempt) => attempt.id === draft.attemptId && !attempt.submittedAt
        ? { ...attempt, answers: draft.answers ?? attempt.answers, currentQuestionIndex: draft.currentQuestionIndex ?? attempt.currentQuestionIndex } : attempt) };
    } else if (draft) delete drafts.current[session.id];
    send({ type: 'receive', session });
  }, [send]);
  const run = useCallback(<T,>(id: string, operation: () => Promise<T>, showBusy = true): Promise<T> => {
    if (showBusy) send({ type: 'busy', sessionId: id, busy: true });
    const next = (queues.current[id] ?? Promise.resolve()).catch(() => undefined).then(async () => {
      if (showBusy) send({ type: 'busy', sessionId: id, busy: true });
      send({ type: 'error', sessionId: id, message: '' });
      try { return await operation(); }
      catch (error) {
        if (error instanceof PracticeApiError && error.session) receive(error.session);
        send({ type: 'error', sessionId: id, message: error instanceof Error ? error.message : 'Please try again.', status: error instanceof PracticeApiError ? error.status : undefined });
        throw error;
      } finally { if (showBusy) send({ type: 'busy', sessionId: id, busy: false }); }
    });
    queues.current[id] = next;
    return next;
  }, [receive, send]);
  const flush = useCallback(async (id: string) => {
    clearTimeout(timers.current[id]);
    const draft = drafts.current[id];
    if (!draft) return;
    const { revision, ...input } = draft;
    setDraftStatus((previous) => ({ ...previous, [id]: 'saving' }));
    try {
      const session = await practiceApi.update(id, tokenFor(id), input);
      if (drafts.current[id]?.revision === revision) {
        delete drafts.current[id];
        setDraftStatus((previous) => ({ ...previous, [id]: 'saved' }));
      } else setDraftStatus((previous) => ({ ...previous, [id]: 'local' }));
      receive(session);
    } catch (error) {
      setDraftStatus((previous) => ({ ...previous, [id]: 'local' }));
      throw error;
    }
  }, [receive, tokenFor]);
  // Reopens one of the signed-in learner's saved sessions in this browser (the server reissues its access token).
  const resumeSession = useCallback(async (id: string) => {
    const access = await resumeSavedSession(id);
    tokens.current[id] = access.token;
    receive(access.session);
  }, [receive]);
  const loadSession = useCallback((id: string) => run(id, async () => {
    // A reload or a new browser has no token for a saved session; a signed-in owner can get one back.
    if (!tokens.current[id] && await accessToken()) { await resumeSession(id); return; }
    receive(await practiceApi.load(id, tokenFor(id)));
  }), [receive, resumeSession, run, tokenFor]);
  const action = useCallback((id: string, name: 'prepare' | 'submit' | 'recheck' | 'teach' | 'cycles' | 'finish', input?: Record<string, string | boolean>) => {
    const key = `${id}:${name}`;
    const pending = pendingActions.current[key];
    if (pending) return pending;
    const operation = run(id, async () => { if (name !== 'prepare') await flush(id); receive(await practiceApi.action(id, tokenFor(id), name, input)); });
    pendingActions.current[key] = operation;
    const clear = () => { delete pendingActions.current[key]; };
    void operation.then(clear, clear);
    return operation;
  }, [flush, receive, run, tokenFor]);
  const prepareSession = useCallback((id: string, clarification?: string, suggestion?: 'accept' | 'decline') => action(id, 'prepare',
    suggestion === 'accept' ? { acceptSuggestion: true } : suggestion === 'decline' ? { keepOriginal: true } : clarification ? { clarification } : {}), [action]);
  const createSession = useCallback(async (input: CreatePracticeInput) => {
    const access = await practiceApi.create(input);
    tokens.current[access.session.id] = access.token;
    receive(access.session);
    void prepareSession(access.session.id).catch(() => undefined);
    return access.session.id;
  }, [prepareSession, receive]);
  const updateDraft = useCallback((id: string, attemptId: string, answer: AssessmentAnswer, questionIndex?: number) => {
    send({ type: 'draft', sessionId: id, attemptId, answer, index: questionIndex });
    const session = current.current.sessions[id];
    const attempt = session?.attempts.find((item) => item.id === attemptId);
    if (!attempt || session.stage !== attempt.kind || session.lifecycle !== 'active' || attempt.submittedAt) return;
    drafts.current[id] = { attemptId, answers: attempt.answers, currentQuestionIndex: attempt.currentQuestionIndex, revision: (drafts.current[id]?.revision ?? 0) + 1 };
    setDraftStatus((previous) => ({ ...previous, [id]: 'local' }));
    clearTimeout(timers.current[id]);
    timers.current[id] = setTimeout(() => { void run(id, () => flush(id), false).catch(() => undefined); }, 600);
  }, [flush, run, send]);
  const submitAssessment = useCallback((id: string, attemptId: string) => action(id, 'submit', { attemptId }), [action]);
  const saveDraft = useCallback((id: string) => run(id, () => flush(id), false), [flush, run]);
  const startRecheck = useCallback((id: string) => action(id, 'recheck'), [action]);
  const returnToTeaching = useCallback((id: string) => action(id, 'teach'), [action]);
  const practiceAgain = useCallback((id: string) => action(id, 'cycles'), [action]);
  const finishSession = useCallback((id: string) => action(id, 'finish'), [action]);
  const setNervousness = useCallback((id: string, when: 'before' | 'after', value: NervousnessValue | null) => run(id, async () => {
    await flush(id);
    receive(await practiceApi.update(id, tokenFor(id), when === 'before' ? { nervousnessBefore: value } : { nervousnessAfter: value }));
  }, false), [flush, receive, run, tokenFor]);
  const requestVoice = useCallback((id: string) => run(id, () => practiceApi.voice(id, tokenFor(id))), [run, tokenFor]);
  const registerConversation = useCallback((id: string, conversationId: string) => run(id, async () => receive(await practiceApi.registerConversation(id, tokenFor(id), conversationId)), false), [receive, run, tokenFor]);
  const finalizeConversation = useCallback((id: string, conversationId: string) => run(id, async () => {
    const session = await practiceApi.finalizeConversation(id, tokenFor(id), conversationId);
    receive(session);
  }, false), [receive, run, tokenFor]);
  const startTextConversation = useCallback((id: string) => run(id, async () => receive(await practiceApi.startTextConversation(id, tokenFor(id)))), [receive, run, tokenFor]);
  const startAttempt = useCallback((id: string, attemptId: string) => run(id, async () => {
    await flush(id);
    receive(await practiceApi.update(id, tokenFor(id), { attemptId, attemptStarted: true }));
  }, false), [flush, receive, run, tokenFor]);
  // Monitoring calls bypass the session queue: frames stream continuously and must never wait behind grading.
  const startMonitoring = useCallback(async (id: string, purpose: MonitoringPurpose) => {
    const session = await practiceApi.startMonitoring(id, tokenFor(id), purpose);
    receive(session);
    const window = session.monitoring?.find((item) => item.status === 'active');
    if (!window) throw new Error('Monitoring did not start. Please try again.');
    return window.id;
  }, [receive, tokenFor]);
  const sendFrames = useCallback((id: string, windowId: string, frames: Uint8Array, width: number, height: number, captureFps?: number, encoding?: FrameEncoding) => practiceApi.sendFrames(id, tokenFor(id), windowId, frames, width, height, captureFps, encoding), [tokenFor]);
  const stopMonitoring = useCallback(async (id: string, windowId: string, reason?: 'camera_too_slow') => {
    const { status, session } = await practiceApi.stopMonitoring(id, tokenFor(id), windowId, reason);
    receive(session);
    return status;
  }, [receive, tokenFor]);
  const sendTextMessage = useCallback((id: string, conversationId: string, text?: string) => run(id, async () => receive(await practiceApi.sendTextMessage(id, tokenFor(id), conversationId, text))), [receive, run, tokenFor]);
  // Bypasses the session queue: generating the review sheet must not block the after-rating or Finish.
  const generateReview = useCallback(async (id: string, regenerate = false) => {
    try { receive(await practiceApi.review(id, tokenFor(id), regenerate)); }
    catch (error) { if (error instanceof PracticeApiError && error.session) receive(error.session); throw error; }
  }, [receive, tokenFor]);

  useEffect(() => {
    let active = true;
    void loadIntegrationHealth().then((health) => { if (active) setIntegration(health); }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const activeTimers = timers.current;
    // Answers not yet synced to the server would be lost on reload, so warn before leaving.
    const warnUnsaved = (event: BeforeUnloadEvent) => {
      if (Object.keys(drafts.current).length) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', warnUnsaved);
    return () => { window.removeEventListener('beforeunload', warnUnsaved); Object.values(activeTimers).forEach(clearTimeout); };
  }, []);
  return <SessionContext.Provider value={{ ...state, providerMode, integration, draftStatus, saveDraft, createSession, loadSession, resumeSession, prepareSession, updateDraft,
    submitAssessment, startRecheck, returnToTeaching, practiceAgain, finishSession, setNervousness,
    requestVoice, generateReview, registerConversation, finalizeConversation, startTextConversation, sendTextMessage, startAttempt, startMonitoring, sendFrames, stopMonitoring }}>{children}</SessionContext.Provider>;
}
