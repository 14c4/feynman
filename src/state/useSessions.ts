import { createContext, useContext } from 'react';
import type { SessionState } from './sessionReducer';
import type { AssessmentAnswer, CreatePracticeInput, FrameEncoding, IntegrationHealth, MonitoringPurpose, MonitoringStatus, NervousnessValue, VoiceCredentials } from '../../shared/types';

export interface SessionContextValue extends SessionState {
  storageError?: string;
  providerMode?: 'real' | 'mock';
  integration?: IntegrationHealth;
  draftStatus: Record<string, 'local' | 'saving' | 'saved'>;
  saveDraft: (id: string) => Promise<void>;
  createSession: (input: CreatePracticeInput) => Promise<string>;
  loadSession: (id: string) => Promise<void>;
  /** `suggestion` answers a suggested rewrite: 'accept' adopts it, 'decline' prepares from the original wording. */
  prepareSession: (id: string, clarification?: string, suggestion?: 'accept' | 'decline') => Promise<void>;
  updateDraft: (id: string, attemptId: string, answer: AssessmentAnswer, questionIndex?: number) => void;
  submitAssessment: (id: string, attemptId: string) => Promise<void>;
  saveAndExit: (id: string) => Promise<void>;
  resumeSession: (id: string) => Promise<void>;
  startRecheck: (id: string) => Promise<void>;
  /** Leaves an unsubmitted follow-up check to keep teaching Alex; answers are kept. */
  returnToTeaching: (id: string) => Promise<void>;
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
  /** Records when the learner first sees an assessment's first question. */
  startAttempt: (id: string, attemptId: string) => Promise<void>;
  /** Optional camera monitoring. Returns the new window's id. */
  startMonitoring: (id: string, purpose: MonitoringPurpose) => Promise<string>;
  sendFrames: (id: string, windowId: string, frames: Uint8Array, width: number, height: number, captureFps?: number, encoding?: FrameEncoding) => Promise<MonitoringStatus>;
  stopMonitoring: (id: string, windowId: string, reason?: 'camera_too_slow') => Promise<MonitoringStatus>;
}

export const SessionContext = createContext<SessionContextValue | null>(null);

export function useSessions() {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSessions must be used within SessionProvider');
  return context;
}
