import { useEffect, useReducer, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import { SessionContext } from './useSessions';
import { initialSessionState, sessionReducer } from './sessionReducer';
import { getTopic } from '../features/topics/topics';

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(sessionReducer, initialSessionState);
  const { pathname } = useLocation();

  // Route changes close unfinished sessions. This avoids unmount cleanup races
  // and remains safe under React StrictMode's development effect replay.
  useEffect(() => {
    // Preserve the target session while its page redirects between study/results.
    const match = /^\/(?:study|results)\/([^/]+)\/?$/.exec(pathname);
    dispatch({ type: 'leave', keepSessionId: match?.[1], at: new Date().toISOString() });
  }, [pathname]);

  function createSession(topicId: string, previousSessionId?: string) {
    if (!getTopic(topicId)) throw new Error('Unknown study topic');
    const previous = previousSessionId ? state.sessions[previousSessionId] : undefined;
    if (previousSessionId && (!previous || previous.topicId !== topicId || previous.status !== 'completed')) {
      throw new Error('Retry requires a completed session for the same topic');
    }
    const id = crypto.randomUUID();
    const attemptNumber = Math.max(0, ...Object.values(state.sessions)
      .filter((session) => session.topicId === topicId).map((session) => session.attemptNumber)) + 1;
    dispatch({ type: 'create', session: {
      id, topicId, previousSessionId, attemptNumber,
      status: 'preparing', createdAt: new Date().toISOString(), transcript: [],
    } });
    return id;
  }

  return (
    <SessionContext.Provider value={{
      ...state,
      createSession,
      startSession: (sessionId) => dispatch({ type: 'start', sessionId, at: new Date().toISOString() }),
      saveExplanation: (sessionId, text) => dispatch({ type: 'append', message: {
        id: crypto.randomUUID(), sessionId, role: 'learner', text,
        createdAt: new Date().toISOString(), source: 'text',
      } }),
      finishSession: (sessionId) => dispatch({ type: 'finish', sessionId, at: new Date().toISOString() }),
    }}>
      {children}
    </SessionContext.Provider>
  );
}
