import { useCallback, useEffect, useReducer, useRef, useState, type ReactNode } from 'react';
import type { AssessmentAnswer, CreatePracticeInput, NervousnessValue, PracticeSession, UpdatePracticeInput } from '../../shared/types';
import { PracticeApiError, practiceApi } from '../services/practiceApi';
import { SessionContext } from './useSessions';
import { initialSessionState, sessionReducer, type SessionAction, type SessionState } from './sessionReducer';

const STORAGE_KEY = 'feynman.practice.v1';
interface BrowserSnapshot { version: 1; tokens: Record<string, string>; sessions: Record<string, PracticeSession> }
interface Draft extends UpdatePracticeInput { attemptId: string; revision: number }

function readSnapshot(): BrowserSnapshot {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (value && typeof value === 'object' && 'version' in value && value.version === 1 && 'tokens' in value && 'sessions' in value) {
      const snapshot = value as BrowserSnapshot;
      if (snapshot.tokens && snapshot.sessions && typeof snapshot.tokens === 'object' && typeof snapshot.sessions === 'object') {
        const sessions = Object.fromEntries(Object.entries(snapshot.sessions).filter(([id, session]) => session && session.id === id && Array.isArray(session.attempts) && Array.isArray(session.cycles)));
        const tokens = Object.fromEntries(Object.entries(snapshot.tokens).filter(([id, token]) => typeof token === 'string' && sessions[id]));
        return { version: 1, tokens, sessions };
      }
    }
  } catch { /* The UI reports storage write failures; unknown/old formats are not migrated as practice data. */ }
  return { version: 1, tokens: {}, sessions: {} };
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [snapshot] = useState(readSnapshot);
  const [state, dispatch] = useReducer(sessionReducer, { ...initialSessionState, sessions: snapshot.sessions });
  const current = useRef<SessionState>(state);
  const tokens = useRef(snapshot.tokens);
  const drafts = useRef<Record<string, Draft>>({});
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const queues = useRef<Record<string, Promise<unknown>>>({});
  const [storageError, setStorageError] = useState<string>();
  const restored = useRef(false);

  const persist = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, tokens: tokens.current, sessions: current.current.sessions }));
      setStorageError(undefined);
    } catch { setStorageError('Browser saving is unavailable. Keep this tab open until saving works again.'); }
  }, []);
  const send = useCallback((action: SessionAction) => {
    current.current = sessionReducer(current.current, action);
    dispatch(action);
    if (action.type === 'receive' || action.type === 'draft') persist();
  }, [persist]);
  const tokenFor = useCallback((id: string) => {
    const token = tokens.current[id];
    if (!token) throw new Error('This browser has no access reference for that session. Open a saved session from Home.');
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
    const next = (queues.current[id] ?? Promise.resolve()).catch(() => undefined).then(async () => {
      if (showBusy) send({ type: 'busy', sessionId: id, busy: true });
      send({ type: 'error', sessionId: id, message: '' });
      try { return await operation(); }
      catch (error) {
        if (error instanceof PracticeApiError && error.session) receive(error.session);
        send({ type: 'error', sessionId: id, message: error instanceof Error ? error.message : 'Please try again.' });
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
    const session = await practiceApi.update(id, tokenFor(id), input);
    if (drafts.current[id]?.revision === revision) delete drafts.current[id];
    receive(session);
  }, [receive, tokenFor]);
  const loadSession = useCallback((id: string) => run(id, async () => receive(await practiceApi.load(id, tokenFor(id)))), [receive, run, tokenFor]);
  const action = useCallback((id: string, name: 'prepare' | 'submit' | 'pause' | 'resume' | 'recheck' | 'cycles' | 'finish', input?: Record<string, string>) =>
    run(id, async () => { if (name !== 'resume' && name !== 'prepare') await flush(id); receive(await practiceApi.action(id, tokenFor(id), name, input)); }), [flush, receive, run, tokenFor]);
  const prepareSession = useCallback((id: string, clarification?: string) => action(id, 'prepare', clarification ? { clarification } : {}), [action]);
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
    clearTimeout(timers.current[id]);
    timers.current[id] = setTimeout(() => { void run(id, () => flush(id), false).catch(() => undefined); }, 600);
  }, [flush, run, send]);
  const submitAssessment = useCallback((id: string, attemptId: string) => action(id, 'submit', { attemptId }), [action]);
  const saveAndExit = useCallback((id: string) => action(id, 'pause'), [action]);
  const resumeSession = useCallback((id: string) => action(id, 'resume'), [action]);
  const startRecheck = useCallback((id: string) => action(id, 'recheck'), [action]);
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

  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    for (const session of Object.values(snapshot.sessions)) {
      const attempt = session.attempts.find((item) => item.kind === session.stage && !item.submittedAt);
      if (attempt) drafts.current[session.id] = { attemptId: attempt.id, answers: attempt.answers, currentQuestionIndex: attempt.currentQuestionIndex, revision: 1 };
      void loadSession(session.id).catch(() => undefined);
    }
  }, [loadSession, snapshot]);
  useEffect(() => {
    const warnUnsaved = (event: BeforeUnloadEvent) => {
      persist();
      if (Object.keys(drafts.current).length) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', warnUnsaved);
    return () => { window.removeEventListener('beforeunload', warnUnsaved); Object.values(timers.current).forEach(clearTimeout); };
  }, [persist]);
  return <SessionContext.Provider value={{ ...state, storageError, createSession, loadSession, prepareSession, updateDraft,
    submitAssessment, saveAndExit, resumeSession, startRecheck, practiceAgain, finishSession, setNervousness,
    requestVoice, registerConversation, finalizeConversation }}>{children}</SessionContext.Provider>;
}
