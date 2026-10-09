export interface EssentialConcept {
  id: string;
  title: string;
  description: string;
}

export interface StudyTopic {
  id: string;
  title: string;
  category: string;
  description: string;
  openingPrompt: string;
  essentialConcepts: EssentialConcept[];
}

export interface TranscriptMessage {
  id: string;
  sessionId: string;
  role: 'learner' | 'student';
  text: string;
  createdAt: string;
  source: 'text' | 'voice' | 'sample';
}

export interface StudySession {
  id: string;
  topicId: string;
  attemptNumber: number;
  previousSessionId?: string;
  status: 'preparing' | 'active' | 'completed' | 'abandoned';
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  transcript: TranscriptMessage[];
}

export interface ConceptCoverage {
  conceptId: string;
  status: 'covered' | 'partial' | 'missing' | 'misunderstood';
  feedback: string;
  evidenceMessageIds: string[];
}

export interface EvaluationResult {
  id: string;
  sessionId: string;
  source: 'sample' | 'gemini';
  summary: string;
  conceptCoverage: ConceptCoverage[];
  recommendations: string[];
  suggestedRetry: string;
  createdAt: string;
}

export type EvaluationStatus = 'unavailable' | 'pending' | 'ready' | 'error';

export interface RetryAttempt {
  sessionId: string;
  previousSessionId?: string;
  topicId: string;
  attemptNumber: number;
  completedAt?: string;
  evaluationId?: string;
}

export interface StudentReplyInput {
  topic: StudyTopic;
  transcript: TranscriptMessage[];
}

export interface EvaluationInput extends StudentReplyInput {
  sessionId: string;
}

export interface ApiError {
  error: { code: 'INTEGRATION_PENDING' | 'NOT_FOUND'; message: string };
}
