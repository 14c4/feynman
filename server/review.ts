import { createHash } from 'node:crypto';
import type { AssessmentAttempt, ReviewSheet, ReviewStatus } from '../shared/types.js';
import { PracticeError, type PrivateBlueprint } from './domain.js';
import { materialExcerpt } from './materials.js';
import type { StoredRecord } from './store.js';

// The personalized review sheet. Code decides each concept's status from the existing 0–2 grades and
// verifies every learner quotation; Gemini only writes the explanations. Confidence ratings,
// nervousness and physiology are deliberately not inputs: they are not evidence of correctness.

/** One graded question. `score` is null when the learner skipped it (no evidence). */
export interface ReviewAnswer { question: string; expectedAnswer: string; answer: string; working: string; score: 0 | 1 | 2 | null; feedback: string }
export interface ReviewConcept { id: string; title: string; description: string; status: ReviewStatus; firstCheck?: ReviewAnswer; followUp?: ReviewAnswer }
export interface ReviewTurn { speaker: 'learner' | 'alex'; channel: 'text' | 'voice'; text: string }
export interface ReviewInput { topic: string; scope: string; notes: string; studyMaterial: string; concepts: ReviewConcept[]; teaching: ReviewTurn[] }

const GAPS: ReviewStatus[] = ['persistent_gap', 'new_gap', 'unrechecked_gap', 'improved_incomplete', 'resolved_gap'];
const LABELS: Record<ReviewStatus, string> = {
  persistent_gap: 'Still a gap', improved_incomplete: 'Improved, not complete yet', resolved_gap: 'Gap resolved',
  new_gap: 'Newly spotted gap', unrechecked_gap: 'Gap from the first check (not rechecked)', strength: 'Solid', insufficient: 'Not enough evidence',
};
const TEACHING_BUDGET = 14_000;

/** Score-based classification. A skipped answer is missing evidence, not a wrong answer. */
export function classifyConcept(first: number | null, followUp: number | null): ReviewStatus {
  if (first === null && followUp === null) return 'insufficient';
  if (first === null) return followUp === 2 ? 'strength' : 'new_gap';
  if (followUp === null) return first === 2 ? 'strength' : 'unrechecked_gap';
  if (first === 2) return followUp === 2 ? 'strength' : 'new_gap';
  if (followUp === 2) return 'resolved_gap';
  return followUp > first ? 'improved_incomplete' : 'persistent_gap';
}

function answerFor(attempt: AssessmentAttempt | undefined, conceptId: string, blueprint: PrivateBlueprint): ReviewAnswer | undefined {
  const index = attempt?.questions.findIndex((question) => question.conceptId === conceptId) ?? -1;
  if (!attempt?.grade || index < 0) return undefined;
  const question = attempt.questions[index]!; const answer = attempt.answers[index]; const grade = attempt.grade.questionGrades.find((item) => item.questionId === question.id);
  if (!answer || !grade) return undefined;
  return { question: question.prompt, expectedAnswer: blueprint.questions[question.id]?.expectedAnswer ?? '', answer: answer.skipped ? '' : answer.text.slice(0, 3000), working: answer.skipped ? '' : answer.working.slice(0, 3000), score: answer.skipped ? null : grade.score, feedback: grade.feedback.slice(0, 1000) };
}

/** Everything the generator may use, bounded. Throws when the session has no graded results to review. */
export function reviewInput(record: StoredRecord): ReviewInput {
  const session = record.session; const blueprint = record.blueprint;
  const baseline = session.attempts.find((attempt) => attempt.kind === 'baseline' && attempt.grade);
  const recheck = [...session.attempts].reverse().find((attempt) => attempt.kind === 'recheck' && attempt.grade);
  if (!blueprint || !baseline) throw new PracticeError('A review sheet needs graded results from this session.', 409, 'INVALID_STAGE');
  const concepts = blueprint.concepts.map((concept) => {
    const firstCheck = answerFor(baseline, concept.id, blueprint); const followUp = answerFor(recheck, concept.id, blueprint);
    return { id: concept.id, title: concept.title, description: concept.description, status: classifyConcept(firstCheck?.score ?? null, followUp?.score ?? null), ...(firstCheck ? { firstCheck } : {}), ...(followUp ? { followUp } : {}) };
  });
  // Only saved transcripts: pending or incomplete voice segments contribute nothing rather than guesses.
  const turns: ReviewTurn[] = session.cycles.flatMap((cycle) => cycle.conversations).filter((segment) => segment.transcriptStatus === 'ready' || segment.channel === 'text')
    .flatMap((segment) => segment.messages.map((message) => ({ speaker: message.role === 'learner' ? 'learner' as const : 'alex' as const, channel: segment.channel ?? 'voice', text: message.text.slice(0, 1500) })));
  // Keep the most recent turns within budget.
  const teaching: ReviewTurn[] = []; let used = 0;
  for (const turn of [...turns].reverse()) { used += turn.text.length; if (used > TEACHING_BUDGET) break; teaching.unshift(turn); }
  return { topic: session.title, scope: session.scope.slice(0, 1500), notes: session.notes.slice(0, 8000), studyMaterial: materialExcerpt(record.materials, 8000), concepts, teaching };
}

/** Changes whenever the evidence changes (e.g. a voice transcript saved after results), so a stored sheet is reused only while it is current. */
export const reviewFingerprint = (input: ReviewInput) => createHash('sha256').update(JSON.stringify(input)).digest('hex');

const normalize = (value: string) => value.toLowerCase().replace(/[“”"‘’'`*_]/g, '').replace(/\s+/g, ' ').trim();
const unquote = (value: string) => value.trim().replace(/^[“"'‘]+|[”"'’]+$/g, '').replace(/^(\.\.\.|…)\s*|\s*(\.\.\.|…)$/g, '').trim();

/** Where an exact learner quotation came from, or undefined when it is not the learner's own words. */
function quoteSource(quote: string, concept: ReviewConcept, teaching: ReviewTurn[]): string | undefined {
  const needle = normalize(unquote(quote));
  if (needle.length < 4) return undefined;
  const found = (value?: string) => Boolean(value && normalize(value).includes(needle));
  if (found(concept.firstCheck?.answer) || found(concept.firstCheck?.working)) return 'your first-check answer';
  if (found(concept.followUp?.answer) || found(concept.followUp?.working)) return 'your follow-up answer';
  const turn = teaching.find((item) => item.speaker === 'learner' && found(item.text));
  if (turn) return turn.channel === 'voice' ? 'what you said to Alex (voice transcript)' : 'what you wrote to Alex';
  return undefined;
}

/** Model text made safe for the sheet: bounded, no stray headings that would break the hierarchy. */
function clean(value: unknown, max = 1500): string {
  if (typeof value !== 'string') return '';
  const text = value.replace(/\r\n?/g, '\n').split('\n').map((line) => line.replace(/^\s*#{1,6}\s+/, '').trimEnd()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
const quoteBlock = (text: string) => text.split('\n').map((line) => `> ${line}`.trimEnd()).join('\n');
const score = (answer?: ReviewAnswer) => !answer ? 'not checked' : answer.score === null ? 'skipped' : `${answer.score}/2`;
const evidenceLine = (concept: ReviewConcept) => `First check ${score(concept.firstCheck)} · Follow-up ${score(concept.followUp)}`;
const latestFeedback = (concept: ReviewConcept) => [concept.followUp, concept.firstCheck].find((answer) => answer && answer.score !== null)?.feedback ?? '';

interface Section { concept: ReviewConcept; status: ReviewStatus; group: string; body: string[] }

function section(concept: ReviewConcept, status: ReviewStatus, entry: Record<string, unknown> | undefined, teaching: ReviewTurn[]): Section {
  const body: string[] = []; const add = (label: string, text: string) => { if (text) body.push(`**${label}**`, text); };
  const corrected = clean(entry?.correctedUnderstanding);
  // The learner's own words are preserved verbatim when verifiable; a claimed quote that is not theirs is never shown as one.
  const original = clean(entry?.originalExplanation, 1200); const source = original ? quoteSource(original, concept, teaching) : undefined;
  const ownAnswer = [concept.firstCheck, concept.followUp].find((answer) => answer && answer.score !== null && answer.answer.trim());
  if (original && source && entry?.originalIsQuote === true) add('Your original explanation', `${quoteBlock(`“${unquote(original)}”`)}\n>\n> — ${source}`);
  else if (original && entry?.originalIsQuote !== true && (ownAnswer || teaching.some((turn) => turn.speaker === 'learner'))) add('Your original explanation', `In your words (paraphrased): ${original}`);
  else if (ownAnswer) add('Your original explanation', `${quoteBlock(`“${clean(ownAnswer.answer, 800)}”`)}\n>\n> — your ${ownAnswer === concept.firstCheck ? 'first-check' : 'follow-up'} answer`);
  if (!corrected) {
    // Incomplete model output for this gap: fall back to the real grader feedback rather than inventing a correction.
    const feedback = latestFeedback(concept);
    add('What the grader noted', feedback || 'No detailed feedback is available for this concept. Revisit it in your notes.');
    return { concept, status, group: '', body };
  }
  add('What was missing or incorrect', clean(entry?.misconception));
  add('Your corrected understanding', corrected);
  const metaphor = clean(entry?.studentMetaphor, 600); const refined = clean(entry?.refinedMetaphor); const limits = clean(entry?.metaphorLimits, 800);
  const metaphorSource = metaphor ? quoteSource(metaphor, concept, teaching) : undefined;
  if (metaphorSource && refined) add('Building on your mental model', `${quoteBlock(`“${unquote(metaphor)}” — ${metaphorSource}`)}\n\n${refined}${limits ? `\n\n*Where the picture stops working:* ${limits}` : ''}`);
  else if (refined) add('A way to picture it', `${refined}${limits ? `\n\n*Where the picture stops working:* ${limits}` : ''}`);
  add('Worked example', clean(entry?.workedExample, 2000));
  // Progress claims need both checks answered.
  if (concept.firstCheck?.score != null && concept.followUp?.score != null) add('What changed', clean(entry?.whatChanged, 1000));
  const remember = clean(entry?.remember, 400); if (remember) body.push(`**Remember:** ${remember}`);
  return { concept, status, group: clean(entry?.group, 80).replace(/\n/g, ' '), body };
}

/**
 * Validates generator output against the session evidence and renders the canonical Markdown.
 * Throws INVALID_REVIEW when the output is unusable as a whole; incomplete entries degrade per concept.
 */
export function buildReviewSheet(input: ReviewInput, raw: unknown, source: 'gemini' | 'mock'): ReviewSheet {
  const root = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : undefined;
  if (!root || !Array.isArray(root.concepts)) throw new PracticeError('The review sheet came back incomplete. Your results are saved; please retry.', 502, 'INVALID_REVIEW');
  const entries = root.concepts.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item));
  const sections: Section[] = []; const solid: ReviewConcept[] = []; const unknown: ReviewConcept[] = []; const statuses: ReviewSheet['concepts'] = [];
  for (const concept of input.concepts) {
    const entry = entries.find((item) => item.conceptId === concept.id);
    let status = concept.status;
    // The only override: a gap the transcript reveals in a concept both checks graded as solid, backed by an exact quote.
    if (status === 'strength' && entry?.status === 'new_gap' && typeof entry.newGapEvidence === 'string' && quoteSource(entry.newGapEvidence, { ...concept, firstCheck: undefined, followUp: undefined }, input.teaching) && clean(entry.correctedUnderstanding)) status = 'new_gap';
    statuses.push({ conceptId: concept.id, status });
    if (status === 'strength') solid.push(concept); else if (status === 'insufficient') unknown.push(concept);
    else sections.push(section(concept, status, entry, input.teaching));
  }
  const order = (item: Section) => GAPS.indexOf(item.status);
  sections.sort((a, b) => order(a) - order(b));

  const lines: string[] = ['# Your Personal Review Sheet', '', `## ${clean(input.topic, 120).replace(/\n/g, ' ')}`, ''];
  if (source === 'mock') lines.push('> **DEV MOCK:** deterministic test content from the development fixture, not Gemini output.', '');
  lines.push(sections.length ? '*Built from your answers and explanations in this session. It covers only what needs another look; scores describe these questions, not overall mastery.*' : '*Your answers in this session did not show gaps that need correcting. Scores describe these questions, not overall mastery.*', '');
  const grouped = sections.length > 1 && sections.every((item) => item.group);
  let currentGroup = '';
  for (const item of sections) {
    if (grouped && item.group !== currentGroup) { currentGroup = item.group; lines.push(`### ${currentGroup}`, ''); }
    lines.push(`${grouped ? '####' : '###'} ${item.concept.title}`, '', `*${LABELS[item.status]} · ${evidenceLine(item.concept)}*`, '');
    for (const part of item.body) lines.push(part, '');
  }
  if (solid.length) { lines.push('## Already solid', ''); for (const concept of solid) lines.push(`- **${concept.title}** — ${evidenceLine(concept)}`); lines.push(''); }
  if (unknown.length) { lines.push('## Not enough evidence yet', ''); for (const concept of unknown) lines.push(`- **${concept.title}** — both questions were skipped, so there is nothing to correct yet. Try explaining it once in your own words.`); lines.push(''); }

  lines.push('## What to review next', '');
  const reviewable = new Set(sections.map((item) => item.concept.id));
  const next = (Array.isArray(root.reviewNext) ? root.reviewNext : []).flatMap((item: unknown) => {
    const row = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    const concept = input.concepts.find((candidate) => candidate.id === row.conceptId); const focus = clean(row.focus, 400).replace(/\n/g, ' ');
    return concept && focus && reviewable.has(concept.id) ? [{ concept, focus }] : [];
  }).filter((item, index, all) => all.findIndex((other) => other.concept.id === item.concept.id) === index).slice(0, 3);
  if (!next.length) for (const item of sections.filter((candidate) => candidate.status !== 'resolved_gap').slice(0, 3)) next.push({ concept: item.concept, focus: clean(latestFeedback(item.concept), 400).replace(/\n/g, ' ') || 'Explain it again in your own words, then check it against your notes.' });
  if (next.length) next.forEach((item, index) => lines.push(`${index + 1}. **${item.concept.title}** — ${item.focus}`));
  else lines.push('- Explain one of these ideas again with a fresh example, or teach Alex a new topic.');
  return { markdown: `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`, source, generatedAt: new Date().toISOString(), concepts: statuses };
}
