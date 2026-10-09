import { createContext, useContext } from 'react';
import type { SessionState } from './sessionReducer';

export interface SessionContextValue extends SessionState {
  createSession: (topicId: string, previousSessionId?: string) => string;
  startSession: (sessionId: string) => void;
  saveExplanation: (sessionId: string, text: string) => void;
  finishSession: (sessionId: string) => void;
}

export const SessionContext = createContext<SessionContextValue | null>(null);

export function useSessions() {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSessions must be used within SessionProvider');
  return context;
}
