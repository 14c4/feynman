import type { AssessmentAttempt, ConfidenceLevel, MonitoringWindow, PhysiologySample, PracticeConcept, PracticeSession, QualityNote, QuestionGrade, SessionEvent, TimelinePhase, TranscriptMessage } from './types.js';

/* Readiness Insights: everything here is derived from stored, timestamped records.
   Nothing is inferred by a model, and missing timestamps are left missing. */

export const CONFIDENCE_LABELS: Record<ConfidenceLevel, string> = { low: 'Guessing', medium: 'Somewhat sure', high: 'Confident' };
const EXPECTED: Record<ConfidenceLevel, number> = { low: 0, medium: 1, high: 2 };

export type CalibrationKind = 'calibrated' | 'overconfident' | 'underconfident' | 'confident_incorrect' | 'correct_unsure' | 'unrated' | 'skipped' | 'ungraded';
export interface Calibration { kind: CalibrationKind; label: string; /** score − expected score for the stated confidence (−2…2). */ gap?: number; mismatch: boolean }

export const CALIBRATION_LABELS: Record<CalibrationKind, string> = {
  calibrated: 'Confidence matched the result',
  overconfident: 'A little more confident than the result',
  underconfident: 'Did better than you expected',
  confident_incorrect: 'Confident, but incorrect',
  correct_unsure: 'Correct, but unsure',
  unrated: 'No confidence given',
  skipped: 'Skipped',
  ungraded: 'Not graded',
};

/**
 * Compares stated confidence with the 0–2 grade, including partial credit.
 * Guessing ↔ 0, somewhat sure ↔ 1, confident ↔ 2. The two strongest mismatches get their own labels.
 */
export function calibrate(confidence: ConfidenceLevel | undefined, grade: QuestionGrade | undefined, skipped = false): Calibration {
  const make = (kind: CalibrationKind, gap?: number): Calibration => ({ kind, label: CALIBRATION_LABELS[kind], gap, mismatch: kind === 'confident_incorrect' || kind === 'correct_unsure' || kind === 'overconfident' || kind === 'underconfident' });
  if (skipped) return make('skipped');
  if (!grade) return make('ungraded');
  if (!confidence) return make('unrated');
  const gap = grade.score - EXPECTED[confidence];
  if (confidence === 'high' && grade.score === 0) return make('confident_incorrect', gap);
  if (confidence === 'low' && grade.score === grade.maxScore) return make('correct_unsure', gap);
  return make(gap === 0 ? 'calibrated' : gap < 0 ? 'overconfident' : 'underconfident', gap);
}

export const PHASE_LABELS: Record<TimelinePhase, string> = { preparation: 'Getting ready', baseline: 'First check', teaching: 'Teaching Alex', recheck: 'Follow-up check', results: 'Reflection' };
export interface PhaseSpan { phase: TimelinePhase; start: number; end: number }

export interface AnswerMoment {
  kind: 'baseline' | 'recheck';
  attemptId: string;
  questionId: string;
  conceptId: string;
  prompt: string;
  text: string;
  skipped: boolean;
  /** Confidence when the learner moved on; the final answer's confidence is used for calibration. */
  confidence?: ConfidenceLevel;
  grade?: QuestionGrade;
  calibration: Calibration;
  /** True for an earlier visit to a question the learner later changed. */
  revised: boolean;
}

export type TimelineItem =
  | { id: string; at: number; type: 'answer'; answer: AnswerMoment }
  | { id: string; at: number; type: 'assessment'; kind: 'baseline' | 'recheck'; edge: 'started' | 'submitted' | 'graded'; score?: number; maxScore?: number }
  | { id: string; at: number; type: 'conversation'; edge: 'started' | 'ended'; channel: 'voice' | 'text'; conversationId: string; transcriptStatus: string }
  | { id: string; at: number; type: 'message'; role: TranscriptMessage['role']; text: string; question: boolean; conceptIds: string[]; conversationId: string }
  | { id: string; at: number; type: 'nervousness'; when: 'before' | 'after'; value: number }
  | { id: string; at: number; type: 'monitoring'; edge: 'started' | 'ended'; window: MonitoringWindow }
  | { id: string; at: number; type: 'quality'; note: QualityNote; windowId: string }
  | { id: string; at: number; type: 'lifecycle'; edge: 'paused' | 'resumed' | 'finished' };

export interface SessionTimeline {
  start: number;
  end: number;
  phases: PhaseSpan[];
  items: TimelineItem[];
  /** Answer moments per question, in time order (only those with a recorded time). */
  answers: AnswerMoment[];
  samples: { pulse: (PhysiologySample & { t: number })[] };
  windows: MonitoringWindow[];
  /** True when any reading came from the development simulator. */
  simulated: boolean;
}

const time = (value?: string) => { const t = value ? Date.parse(value) : NaN; return Number.isFinite(t) ? t : undefined; };
const eventsOf = (session: PracticeSession, type: SessionEvent['type']) => (session.events ?? []).filter((event) => event.type === type);

/** Words that identify a concept in conversation text. Short or generic words are ignored. */
const STOP = new Set(['about', 'between', 'their', 'there', 'these', 'those', 'which', 'with', 'from', 'into', 'over', 'under', 'what', 'when', 'where', 'how', 'and', 'the', 'for', 'its', 'of', 'in', 'to', 'a', 'an']);
function conceptStems(concept: PracticeConcept): string[] {
  return concept.title.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 4 && !STOP.has(word)).map((word) => word.slice(0, word.length <= 5 ? 4 : 6));
}
/** A transparent lexical check: does this message name the concept? Not a judgement of understanding. */
export function mentionedConcepts(text: string, concepts: PracticeConcept[]): string[] {
  const lower = text.toLowerCase();
  return concepts.filter((concept) => {
    if (lower.includes(concept.title.toLowerCase())) return true;
    const stems = conceptStems(concept);
    if (!stems.length) return false;
    const hits = stems.filter((stem) => lower.includes(stem)).length;
    return hits >= Math.min(2, stems.length);
  }).map((concept) => concept.id);
}

function phaseSpans(session: PracticeSession, end: number): PhaseSpan[] {
  const baseline = session.attempts.find((attempt) => attempt.kind === 'baseline');
  const recheck = [...session.attempts].reverse().find((attempt) => attempt.kind === 'recheck');
  const startOf = (attempt?: AssessmentAttempt) => time(attempt?.startedAt) ?? time(eventsOf(session, 'assessment_started').find((event) => event.attemptId === attempt?.id)?.at);
  const marks: [TimelinePhase, number | undefined][] = [
    ['preparation', time(session.createdAt)],
    ['baseline', startOf(baseline)],
    ['teaching', time(baseline?.grade?.gradedAt)],
    ['recheck', startOf(recheck)],
    ['results', time(recheck?.grade?.gradedAt)],
  ];
  const known = marks.filter((mark): mark is [TimelinePhase, number] => mark[1] !== undefined).sort((a, b) => a[1] - b[1]);
  return known.map(([phase, start], index) => ({ phase, start, end: known[index + 1]?.[1] ?? end })).filter((span) => span.end > span.start || span.phase === 'results');
}

export function phaseAt(phases: PhaseSpan[], t: number): TimelinePhase | undefined {
  return [...phases].reverse().find((span) => t >= span.start)?.phase;
}

/** Builds the single, chronologically ordered session timeline from stored records. */
export function buildTimeline(session: PracticeSession): SessionTimeline {
  const items: TimelineItem[] = [];
  const answers: AnswerMoment[] = [];
  const seq = new Map<string, number>();
  for (const event of session.events ?? []) {
    const at = time(event.at); if (at === undefined) continue;
    seq.set(event.id, event.seq);
    if (event.type === 'answer_recorded' && event.attemptId && event.questionId) {
      const attempt = session.attempts.find((item) => item.id === event.attemptId);
      const index = attempt?.questions.findIndex((question) => question.id === event.questionId) ?? -1;
      if (!attempt || index < 0) continue;
      const question = attempt.questions[index]!; const answer = attempt.answers[index];
      const grade = attempt.grade?.questionGrades.find((item) => item.questionId === question.id);
      const moment: AnswerMoment = {
        kind: attempt.kind, attemptId: attempt.id, questionId: question.id, conceptId: question.conceptId, prompt: question.prompt,
        text: answer?.text ?? '', skipped: event.skipped ?? false, confidence: event.confidence, grade, calibration: calibrate(event.confidence, grade, event.skipped), revised: false,
      };
      answers.push(moment);
      items.push({ id: event.id, at, type: 'answer', answer: moment });
    } else if ((event.type === 'assessment_started' || event.type === 'assessment_submitted' || event.type === 'assessment_graded') && event.kind) {
      items.push({ id: event.id, at, type: 'assessment', kind: event.kind, edge: event.type === 'assessment_started' ? 'started' : event.type === 'assessment_submitted' ? 'submitted' : 'graded', score: event.score, maxScore: event.maxScore });
    } else if (event.type === 'nervousness_recorded' && event.when && event.value) {
      items.push({ id: event.id, at, type: 'nervousness', when: event.when, value: event.value });
    } else if (event.type === 'session_paused' || event.type === 'session_resumed' || event.type === 'session_finished') {
      items.push({ id: event.id, at, type: 'lifecycle', edge: event.type === 'session_paused' ? 'paused' : event.type === 'session_resumed' ? 'resumed' : 'finished' });
    }
  }
  // Only the last visit to each question was graded; earlier visits are marked as revised and keep their own confidence.
  const last = new Map<string, AnswerMoment>();
  for (const moment of answers) { const previous = last.get(`${moment.attemptId}:${moment.questionId}`); if (previous) { previous.revised = true; previous.text = ''; previous.grade = undefined; previous.calibration = calibrate(previous.confidence, undefined, previous.skipped); } last.set(`${moment.attemptId}:${moment.questionId}`, moment); }
  // The final graded answer uses the answer's saved confidence, which may have changed after moving on.
  for (const moment of last.values()) {
    const attempt = session.attempts.find((item) => item.id === moment.attemptId)!;
    const answer = attempt.answers.find((item) => item.questionId === moment.questionId);
    if (answer && answer.skipped === moment.skipped) { moment.confidence = answer.confidence; moment.calibration = calibrate(answer.confidence, moment.grade, answer.skipped); }
  }

  for (const cycle of session.cycles) for (const segment of cycle.conversations) {
    const channel = segment.channel ?? 'voice';
    const started = time(segment.startedAt); const ended = time(segment.endedAt);
    if (started !== undefined) items.push({ id: `${segment.id}:start`, at: started, type: 'conversation', edge: 'started', channel, conversationId: segment.id, transcriptStatus: segment.transcriptStatus });
    if (ended !== undefined) items.push({ id: `${segment.id}:end`, at: ended, type: 'conversation', edge: 'ended', channel, conversationId: segment.id, transcriptStatus: segment.transcriptStatus });
    for (const message of segment.messages) {
      const at = time(message.createdAt); if (at === undefined) continue;
      items.push({ id: `${segment.id}:${message.id}`, at, type: 'message', role: message.role, text: message.text, question: message.role === 'student' && message.text.includes('?'), conceptIds: mentionedConcepts(message.text, session.concepts), conversationId: segment.id });
    }
  }

  const windows = session.monitoring ?? [];
  const samples: SessionTimeline['samples'] = { pulse: [] };
  for (const window of windows) {
    const started = time(window.startedAt); const ended = time(window.endedAt);
    if (started !== undefined) items.push({ id: `${window.id}:start`, at: started, type: 'monitoring', edge: 'started', window });
    if (ended !== undefined) items.push({ id: `${window.id}:end`, at: ended, type: 'monitoring', edge: 'ended', window });
    for (const [index, note] of window.quality.entries()) { const at = time(note.at); if (at !== undefined) items.push({ id: `${window.id}:q${index}`, at, type: 'quality', note, windowId: window.id }); }
    // Breathing is no longer measured; rows from older windows are left out.
    for (const sample of window.samples) { const t = time(sample.at); if (t !== undefined && sample.metric === 'pulse') samples.pulse.push({ ...sample, t }); }
  }
  samples.pulse.sort((a, b) => a.t - b.t);

  // Chronological, with the server's sequence breaking ties between events at the same instant.
  items.sort((a, b) => a.at - b.at || (seq.get(a.id) ?? 0) - (seq.get(b.id) ?? 0));
  const start = Math.min(time(session.createdAt) ?? Infinity, items[0]?.at ?? Infinity);
  const end = Math.max(start, items.at(-1)?.at ?? start, samples.pulse.at(-1)?.t ?? start, time(session.completedAt) ?? start);
  return { start, end, phases: phaseSpans(session, end), items, answers, samples, windows, simulated: windows.some((window) => window.source === 'simulated') };
}

export interface ConceptJourney {
  concept: PracticeConcept;
  focus: boolean;
  baseline?: AnswerMoment;
  recheck?: AnswerMoment;
  baselineGrade?: QuestionGrade;
  recheckGrade?: QuestionGrade;
  /** Messages in the teaching conversation that name this concept. */
  mentions: { learner: number; alexQuestions: number; firstAt?: number };
}

/** Links each concept's first-check answer, its appearance in the conversation, and its matched follow-up answer. */
export function conceptJourneys(session: PracticeSession, timeline: SessionTimeline): ConceptJourney[] {
  const baseline = session.attempts.find((attempt) => attempt.kind === 'baseline');
  const recheck = [...session.attempts].reverse().find((attempt) => attempt.kind === 'recheck' && attempt.grade) ?? [...session.attempts].reverse().find((attempt) => attempt.kind === 'recheck');
  const cycle = session.cycles.find((item) => item.id === session.currentCycleId) ?? session.cycles[0];
  const finalMoment = (attempt: AssessmentAttempt | undefined, conceptId: string): AnswerMoment | undefined => {
    if (!attempt) return undefined;
    const fromTimeline = [...timeline.answers].reverse().find((moment) => moment.attemptId === attempt.id && moment.conceptId === conceptId);
    if (fromTimeline) return fromTimeline;
    // Older sessions have no answer events; still compare confidence and grade, just without a time.
    const index = attempt.questions.findIndex((question) => question.conceptId === conceptId);
    if (index < 0) return undefined;
    const question = attempt.questions[index]!; const answer = attempt.answers[index]; const grade = attempt.grade?.questionGrades.find((item) => item.questionId === question.id);
    return { kind: attempt.kind, attemptId: attempt.id, questionId: question.id, conceptId, prompt: question.prompt, text: answer?.text ?? '', skipped: answer?.skipped ?? false, confidence: answer?.confidence, grade, calibration: calibrate(answer?.confidence, grade, answer?.skipped), revised: false };
  };
  return session.concepts.map((concept) => {
    const messages = timeline.items.filter((item): item is Extract<TimelineItem, { type: 'message' }> => item.type === 'message' && item.conceptIds.includes(concept.id));
    const first = finalMoment(baseline, concept.id); const second = finalMoment(recheck, concept.id);
    return {
      concept, focus: cycle?.focusConceptIds.includes(concept.id) ?? false, baseline: first, recheck: second,
      baselineGrade: baseline?.grade?.questionGrades.find((grade) => grade.conceptId === concept.id),
      recheckGrade: recheck?.grade?.questionGrades.find((grade) => grade.conceptId === concept.id),
      mentions: { learner: messages.filter((item) => item.role === 'learner').length, alexQuestions: messages.filter((item) => item.role === 'student' && item.question).length, firstAt: messages[0]?.at },
    };
  });
}

export interface CalibrationSummary { rated: number; calibrated: number; mismatched: number; confidentIncorrect: number; correctUnsure: number }
export function calibrationSummary(moments: (AnswerMoment | undefined)[]): CalibrationSummary {
  const graded = moments.filter((moment): moment is AnswerMoment => Boolean(moment && moment.grade && moment.confidence && !moment.skipped));
  return {
    rated: graded.length,
    calibrated: graded.filter((moment) => moment.calibration.kind === 'calibrated').length,
    mismatched: graded.filter((moment) => moment.calibration.mismatch).length,
    confidentIncorrect: graded.filter((moment) => moment.calibration.kind === 'confident_incorrect').length,
    correctUnsure: graded.filter((moment) => moment.calibration.kind === 'correct_unsure').length,
  };
}

/** Valid readings within `windowMs` of a moment, for the event detail panel. Never interpolated. */
export function readingsNear(timeline: SessionTimeline, at: number, windowMs = 20_000) {
  const near = (list: (PhysiologySample & { t: number })[]) => {
    const valid = list.filter((sample) => sample.valid && Math.abs(sample.t - at) <= windowMs);
    if (!valid.length) return undefined;
    const values = valid.map((sample) => sample.value);
    return { count: valid.length, min: Math.min(...values), max: Math.max(...values), mean: Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10 };
  };
  return { pulse: near(timeline.samples.pulse) };
}

/** Mean of valid readings per phase, for the quick summary. */
export function phaseReadings(timeline: SessionTimeline) {
  return timeline.phases.map((span) => {
    const stats = (list: (PhysiologySample & { t: number })[]) => {
      const inside = list.filter((sample) => sample.t >= span.start && sample.t < (span.phase === 'results' ? Infinity : span.end));
      const valid = inside.filter((sample) => sample.valid);
      return { valid: valid.length, total: inside.length, mean: valid.length ? Math.round((valid.reduce((sum, sample) => sum + sample.value, 0) / valid.length) * 10) / 10 : undefined };
    };
    return { phase: span.phase, pulse: stats(timeline.samples.pulse) };
  });
}
