import type { StudyTopic, TranscriptMessage } from '../../../shared/types';

export type VoiceStatus = 'connecting' | 'ready' | 'listening' | 'thinking' | 'speaking' | 'disconnected';

export interface VoiceSessionOptions {
  sessionId: string;
  topic: StudyTopic;
  onStatusChange: (status: VoiceStatus) => void;
  onError: (error: Error) => void;
  // Finalized messages only. The transcription provider/pipeline is undecided.
  onTranscriptMessage?: (message: TranscriptMessage) => void;
}

export interface VoiceConnection {
  setMuted(muted: boolean): Promise<void>;
  // Resolve after final transcript delivery and resource cleanup.
  disconnect(): Promise<void>;
}

export interface VoiceService {
  connect(options: VoiceSessionOptions): Promise<VoiceConnection>;
}
