import { createContext, useContext } from 'react';
import type { SessionState } from './sessionReducer';
import type { AssessmentAnswer, CreatePracticeInput, IntegrationHealth, NervousnessValue, VoiceCredentials } from '../../shared/types';

export interface SessionContextValue extends SessionState {
  storageError?: string;
  providerMode?: 'real' | 'mock';
  integration?: IntegrationHealth;
  draftStatus: Record<string, 'local' | 'saving' | 'saved'>;
  saveDraft: (id: string) => Promise<void>;
  createSession: (input: CreatePracticeInput) => Promise<string>;
  loadSession: (id: string) => Promise<void>;
  prepareSession: (id: string, clarification?: string) => Promise<void>;
  updateDraft: (id: string, attemptId: string, answer: AssessmentAnswer, questionIndex?: number) => void;
  submitAssessment: (id: string, attemptId: string) => Promise<void>;
  saveAndExit: (id: string) => Promise<void>;
  resumeSession: (id: string) => Promise<void>;
  startRecheck: (id: string) => Promise<void>;
  practiceAgain: (id: string) => Promise<void>;
  finishSession: (id: string) => Promise<void>;
  setNervousness: (id: string, when: 'before' | 'after', value: NervousnessValue | null) => Promise<void>;
  requestVoice: (id: string) => Promise<VoiceCredentials>;
  registerConversation: (id: string, conversationId: string) => Promise<void>;
  finalizeConversation: (id: string, conversationId: string) => Promise<void>;
  /** Deletes sessions from this browser and, when reachable, from the server. */
  removeSessions: (ids: string[]) => Promise<void>;
  startTextConversation: (id: string) => Promise<void>;
  /** Omit `text` to retry Alex's reply to the last saved message. */
  sendTextMessage: (id: string, conversationId: string, text?: string) => Promise<void>;
}

export const SessionContext = createContext<SessionContextValue | null>(null);

export function useSessions() {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSessions must be used within SessionProvider');
  return context;
}
