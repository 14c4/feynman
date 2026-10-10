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
  /** What the concept covers; never the answer to an assessment question. */
  description?: string;
}

/** Public metadata only. Extracted text stays on the server. */
export interface StudyMaterial {
  id: string;
  name: string;
  kind: 'pdf' | 'text' | 'markdown' | 'image';
  characters: number;
  pages?: number;
  truncated: boolean;
}

export interface MaterialUpload {
  name: string;
  /** Base64 file contents without a data: URL prefix. */
  data: string;
}

export interface PracticeQuestion {
  id: string;
  conceptId: string;
  prompt: string;
  supportsWorking: boolean;
}

/** Optional self-rated certainty for one answer. Independent of the camera. */
export type ConfidenceLevel = 'low' | 'medium' | 'high';

export interface AssessmentAnswer {
  questionId: string;
  text: string;
  working: string;
  skipped: boolean;
  /** Legacy "not sure" flag; kept in sync with confidence === 'low'. */
  uncertain: boolean;
  confidence?: ConfidenceLevel;
  /** Browser time the confidence was last chosen. */
  confidenceAt?: string;
  /** Browser time the learner moved on from this question (answered or skipped). */
  answeredAt?: string;
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
  /** When the learner first saw the first question. */
  startedAt?: string;
  submittedAt?: string;
  grade?: AssessmentGrade;
}

/** Learning phases on the shared session timeline. */
export type TimelinePhase = 'preparation' | 'baseline' | 'teaching' | 'recheck' | 'results';

export type SessionEventType =
  | 'session_created' | 'concepts_ready'
  | 'assessment_started' | 'answer_recorded' | 'assessment_submitted' | 'assessment_graded'
  | 'teaching_started' | 'nervousness_recorded'
  | 'session_paused' | 'session_resumed' | 'session_finished';

/**
 * One genuine, timestamped moment in a session. Events are appended by the server when
 * the moment happens (or, for answers, with the browser time the learner moved on) and
 * are never back-filled. Conversation turns and physiology samples keep their own
 * timestamps on their existing structures and are merged by `buildTimeline`.
 */
export interface SessionEvent {
  id: string;
  /** Monotonic per session; breaks ties between equal timestamps. */
  seq: number;
  sessionId: string;
  type: SessionEventType;
  at: string;
  attemptId?: string;
  questionId?: string;
  conceptId?: string;
  kind?: 'baseline' | 'recheck';
  confidence?: ConfidenceLevel;
  skipped?: boolean;
  score?: number;
  maxScore?: number;
  value?: number;
  when?: 'before' | 'after';
}

export type PhysiologySource = 'presage' | 'simulated';
export type MonitoringPurpose = 'before_assessment' | 'after_teaching' | 'after_reassessment' | 'in_session';

/** One downsampled reading. `valid` means it passed Presage's confidence, stability, warm-up and range checks. */
export interface PhysiologySample {
  at: string;
  metric: 'pulse' | 'breathing';
  /** Beats or breaths per minute. */
  value: number;
  /** 0–100 as reported by the SDK (or the simulator). */
  confidence: number;
  stable: boolean;
  valid: boolean;
}

export interface QualityNote { at: string; code: string; hint: string }

export interface MonitoringWindow {
  id: string;
  source: PhysiologySource;
  purpose: MonitoringPurpose;
  startedAt: string;
  endedAt?: string;
  status: 'active' | 'ended' | 'error';
  endReason?: string;
  framesReceived: number;
  samples: PhysiologySample[];
  /** Validation status changes (face not found, motion, lighting…), debounced. */
  quality: QualityNote[];
  /** Latest measured camera pipeline figures for this window. */
  pipeline?: PipelineStats;
}

/**
 * Measured, never advertised, frame rates. `captureFps` comes from the browser's capture
 * timestamps, `deliveredFps` from frames the server accepted, `processedFps` from frames
 * Presage reports it consumed (`frameSentThrough`).
 */
export interface PipelineStats {
  captureFps?: number;
  deliveredFps?: number;
  processedFps?: number;
  width?: number;
  height?: number;
  /** Frames rejected by the server as out of order or duplicate. */
  outOfOrder: number;
  /** Frames Presage reported it did not use. */
  notProcessed: number;
}

export interface PhysiologyHealth {
  source: PhysiologySource;
  available: boolean;
  /** Why real monitoring is unavailable (missing key, SDK not installed…). */
  reason?: string;
}

export interface ConversationSegment {
  id: string;
  /** Older sessions omit this; those segments were voice conversations. */
  channel?: 'voice' | 'text';
  transcriptStatus: 'pending' | 'ready' | 'incomplete';
  messages: TranscriptMessage[];
  startedAt: string;
  endedAt?: string;
  /** Voice transcript retrieval bookkeeping. */
  checkAttempts?: number;
  lastCheckedAt?: string;
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
  /** A suggested rewrite of the learner's request, offered with the clarification. Accepting it is optional. */
  suggestedPrompt?: string;
}

export interface PracticeSession {
  id: string;
  /** Server-selected source. Optional for older browser snapshots. */
  providerMode?: 'real' | 'mock';
  title: string;
  description: string;
  notes: string;
  scope: string;
  materials?: StudyMaterial[];
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
  /** Older sessions omit this; their timeline is reconstructed only from stored timestamps. */
  events?: SessionEvent[];
  /** Optional camera monitoring windows. Absent when monitoring was never used. */
  monitoring?: MonitoringWindow[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface SessionAccess {
  session: PracticeSession;
  token: string;
}

export interface CreatePracticeInput {
  topic?: string;
  /** Optional when study material or notes are provided. */
  description?: string;
  notes?: string;
  materials?: MaterialUpload[];
}

export interface UpdatePracticeInput {
  attemptId?: string;
  answers?: AssessmentAnswer[];
  currentQuestionIndex?: number;
  /** Marks `attemptId` as started (first question shown). Ignored once set. */
  attemptStarted?: boolean;
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
  providerMode?: 'real' | 'mock';
  physiology?: PhysiologyHealth;
}

/** Live status returned while frames stream to the server. */
export interface MonitoringStatus {
  window: MonitoringWindow;
  /** Latest validation hint from the SDK, if any. */
  hint?: string;
  code?: string;
  latest: { pulse?: PhysiologySample; breathing?: PhysiologySample };
  pipeline?: PipelineStats;
  /** Measurement clock: ms since the first frame reached Presage (or the simulated window began). Warm-ups count from here. */
  elapsedMs?: number;
  /** Live Presage SDK state for this window. Absent for simulated windows. Never stored with the session. */
  presage?: PresageLiveState;
}

export type PresageProcessing = 'uninitialized' | 'idle' | 'starting' | 'running' | 'stopping' | 'error';

/** What the SmartSpectra SDK itself is reporting right now. */
export interface PresageLiveState {
  processing?: PresageProcessing;
  /** Metrics packets delivered by the SDK in this window (0 means no analysis output yet). */
  metricsPackets: number;
  /** Face analysis from Presage's face metrics, when the API key includes them. */
  face?: PresageFace;
  /** Latest heart-rate variability estimate, when the SDK provides one. */
  hrv?: { rmssdMs: number; confidence: number; valid: boolean; at: string };
}

export interface PresageFace {
  at: string;
  /** Face bounds normalized to the frame Presage received (0–1, unmirrored). Omitted when coordinates can't be placed. */
  box?: { x: number; y: number; w: number; h: number };
  /** A subsample of Presage's landmarks, normalized like `box`. */
  points?: [number, number][];
  stable: boolean;
  blinking?: boolean;
  talking?: boolean;
  /** Blinks Presage detected over the last minute, once at least 20 seconds of face data exist. */
  blinksPerMinute?: number;
}

export type FrameEncoding = 'rgb' | 'jpeg';

export const MONITORING_LIMITS = {
  /** Frames are downscaled in the browser before upload (long side ≤ 480); raw video is never stored. */
  maxWidth: 640,
  maxHeight: 480,
  maxBatchBytes: 16_000_000,
  /** A window with no frames for this long is closed as interrupted. */
  idleMs: 15_000,
  maxSamplesPerWindow: 7200,
  pulseWarmupMs: 12_000,
  breathingWarmupMs: 30_000,
  pulseMinConfidence: 40,
  breathingMinConfidence: 45,
  pulseRange: [40, 110],
  breathingRange: [5, 40],
} as const;

export const MATERIAL_LIMITS = {
  files: 3,
  fileBytes: 4 * 1024 * 1024,
  totalBytes: 8 * 1024 * 1024,
  extensions: ['.pdf', '.txt', '.md', '.markdown', '.png', '.jpg', '.jpeg', '.webp'],
  /** Photos and screenshots; their text and diagrams are transcribed on the server. */
  imageExtensions: ['.png', '.jpg', '.jpeg', '.webp'],
} as const;

export const PRACTICE_LIMITS = {
  topic: 100,
  description: 1200,
  notes: 20000,
  textMessage: 2000,
  textTurns: 30,
  answer: 6000,
  working: 6000,
  questions: 3,
} as const;
