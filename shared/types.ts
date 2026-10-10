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
  error: { code: string; message: string };
}

// Practice contracts are client-safe. Expected answers, rubrics and reserved
// questions belong in server-only types and must never be serialized here.
export type PracticeStage = 'preparing' | 'baseline' | 'baseline_evaluating' | 'teaching' | 'recheck' | 'recheck_evaluating' | 'results';
export type PracticeLifecycle = 'active' | 'paused' | 'completed';
export type NervousnessValue = 1 | 2 | 3 | 4 | 5;

export interface PracticeConcept {
  id: string;
  title: string;
}

export interface PracticeQuestion {
  id: string;
  conceptId: string;
  prompt: string;
  supportsWorking: boolean;
}

export interface AssessmentAnswer {
  questionId: string;
  text: string;
  working: string;
  skipped: boolean;
  uncertain: boolean;
}

export interface QuestionGrade {
  questionId: string;
  conceptId: string;
  score: 0 | 1 | 2;
  maxScore: 2;
  feedback: string;
  evidence: string;
}

export interface AssessmentGrade {
  questionGrades: QuestionGrade[];
  totalScore: number;
  maxScore: number;
  summary: string;
  gradedAt: string;
}

export interface AssessmentAttempt {
  id: string;
  kind: 'baseline' | 'recheck';
  cycleId: string;
  blueprintVersion: number;
  questions: PracticeQuestion[];
  answers: AssessmentAnswer[];
  currentQuestionIndex: number;
  submittedAt?: string;
  grade?: AssessmentGrade;
}

export interface ConversationSegment {
  id: string;
  transcriptStatus: 'pending' | 'ready' | 'incomplete';
  messages: TranscriptMessage[];
  startedAt: string;
}

export interface PracticeCycle {
  id: string;
  number: number;
  focusConceptIds: string[];
  conversations: ConversationSegment[];
  recheckAttemptId?: string;
  createdAt: string;
}

export interface PreparationState {
  status: 'idle' | 'pending' | 'clarification' | 'error' | 'ready';
  message?: string;
  clarificationQuestion?: string;
}

export interface PracticeSession {
  id: string;
  title: string;
  description: string;
  notes: string;
  scope: string;
  concepts: PracticeConcept[];
  blueprintVersion: number;
  stage: PracticeStage;
  lifecycle: PracticeLifecycle;
  preparation: PreparationState;
  attempts: AssessmentAttempt[];
  cycles: PracticeCycle[];
  currentCycleId: string;
  operationError?: string;
  nervousnessBefore?: NervousnessValue;
  nervousnessAfter?: NervousnessValue;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface SessionAccess {
  session: PracticeSession;
  token: string;
}

export interface CreatePracticeInput {
  description: string;
  notes?: string;
}

export interface UpdatePracticeInput {
  attemptId?: string;
  answers?: AssessmentAnswer[];
  currentQuestionIndex?: number;
  nervousnessBefore?: NervousnessValue | null;
  nervousnessAfter?: NervousnessValue | null;
}

export interface VoiceCredentials {
  signedUrl: string;
  dynamicVariables: {
    session_id: string;
    session_title: string;
    focus_context: string;
    opening_question: string;
  };
}

export interface IntegrationHealth {
  status: 'ok';
  service: 'feynman.ai';
  geminiConfigured: boolean;
  voiceConfigured: boolean;
}

export const PRACTICE_LIMITS = {
  description: 1200,
  notes: 20000,
  answer: 6000,
  working: 6000,
  questions: 3,
} as const;
