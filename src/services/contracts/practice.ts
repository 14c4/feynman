import type { CreatePracticeInput, MonitoringPurpose, MonitoringStatus, PracticeSession, SessionAccess, UpdatePracticeInput, VoiceCredentials } from '../../../shared/types';

export interface PracticeService {
  create(input: CreatePracticeInput): Promise<SessionAccess>;
  load(id: string, token: string): Promise<PracticeSession>;
  update(id: string, token: string, input: UpdatePracticeInput): Promise<PracticeSession>;
  action(id: string, token: string, action: 'prepare' | 'submit' | 'pause' | 'resume' | 'recheck' | 'cycles' | 'finish', input?: Record<string, string>): Promise<PracticeSession>;
  voice(id: string, token: string): Promise<VoiceCredentials>;
  registerConversation(id: string, token: string, conversationId: string): Promise<PracticeSession>;
  finalizeConversation(id: string, token: string, conversationId: string): Promise<PracticeSession>;
  remove(id: string, token: string): Promise<{ deleted: true }>;
  startTextConversation(id: string, token: string): Promise<PracticeSession>;
  sendTextMessage(id: string, token: string, conversationId: string, text?: string): Promise<PracticeSession>;
  startMonitoring(id: string, token: string, purpose: MonitoringPurpose): Promise<PracticeSession>;
  sendFrames(id: string, token: string, windowId: string, frames: Uint8Array, width: number, height: number, captureFps?: number): Promise<MonitoringStatus>;
  stopMonitoring(id: string, token: string, windowId: string, reason?: 'camera_too_slow'): Promise<{ status: MonitoringStatus; session: PracticeSession }>;
}
