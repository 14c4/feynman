import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import type { PracticeSession, SessionAccess } from '../shared/types.js';
import { createProviders } from '../server/providers.js';
import { createPracticeHandler } from '../server/routes.js';
import { reviewPdf, winAnsi } from '../shared/reviewPdf.js';
import { buildReviewSheet, classifyConcept, reviewFingerprint, reviewInput, type ReviewAnswer, type ReviewConcept, type ReviewInput } from '../server/review.js';
import type { StoredRecord } from '../server/store.js';

const answer = (score: 0 | 1 | 2 | null, text: string, feedback = 'Grader feedback.'): ReviewAnswer => ({ question: 'Explain it.', expectedAnswer: 'Expected.', answer: score === null ? '' : text, working: '', score, feedback });
const concept = (id: string, first?: ReviewAnswer, followUp?: ReviewAnswer): ReviewConcept => ({ id, title: `Title ${id}`, description: `About ${id}`, status: classifyConcept(first?.score ?? null, followUp?.score ?? null), ...(first ? { firstCheck: first } : {}), ...(followUp ? { followUp } : {}) });
const input = (concepts: ReviewConcept[], learnerTurns: string[] = []): ReviewInput => ({ topic: 'Photosynthesis', scope: '', notes: 'Notes', studyMaterial: '', concepts, teaching: learnerTurns.map((text) => ({ speaker: 'learner', channel: 'text', text })) });
const entry = (conceptId: string, extra: Record<string, unknown> = {}) => ({ conceptId, status: 'persistent_gap', originalExplanation: '', originalIsQuote: false, misconception: 'The missing condition.', correctedUnderstanding: `Corrected idea for ${conceptId}.`, workedExample: '1. Step one\n2. Step two', whatChanged: `Change for ${conceptId}.`, remember: '', ...extra });
/** The Markdown section for one concept title (up to the next heading of the same level or a top-level section). */
const sectionOf = (markdown: string, title: string) => { const start = markdown.indexOf(`### ${title}`); assert.ok(start >= 0, `missing section ${title}`); const rest = markdown.slice(start + 4); const end = rest.search(/\n#{2,3} /); return end < 0 ? rest : rest.slice(0, end); };

test('concept status comes from grades; skipped answers are missing evidence, not wrong answers', () => {
  assert.equal(classifyConcept(0, 0), 'persistent_gap');
  assert.equal(classifyConcept(1, 1), 'persistent_gap');
  assert.equal(classifyConcept(0, 1), 'improved_incomplete');
  assert.equal(classifyConcept(1, 2), 'resolved_gap');
  assert.equal(classifyConcept(2, 1), 'new_gap');
  assert.equal(classifyConcept(2, 2), 'strength');
  assert.equal(classifyConcept(null, null), 'insufficient');
  assert.equal(classifyConcept(0, null), 'unrechecked_gap');
  assert.equal(classifyConcept(null, 2), 'strength');
});

test('a misconception that persists keeps the original wording, the remaining gap and no mastery claim', () => {
  const data = input([concept('a', answer(0, 'Plants eat soil to grow.'), answer(0, 'They get food from the soil.'))]);
  const sheet = buildReviewSheet(data, { concepts: [entry('a', { originalExplanation: 'Plants eat soil to grow.', originalIsQuote: true, whatChanged: 'Both answers still treat soil as food (0/2 → 0/2).' })], reviewNext: [{ conceptId: 'a', focus: 'Trace where the mass of a plant comes from.' }] }, 'gemini');
  const section = sectionOf(sheet.markdown, 'Title a');
  assert.deepEqual(sheet.concepts, [{ conceptId: 'a', status: 'persistent_gap' }]);
  assert.match(section, /Still a gap · First check 0\/2 · Follow-up 0\/2/);
  assert.match(section, /> “Plants eat soil to grow\.”\n>\n> — your first-check answer/);
  assert.match(section, /\*\*Your corrected understanding\*\*\n\nCorrected idea for a\./);
  assert.match(section, /\*\*What changed\*\*\n\nBoth answers still treat soil as food/);
  assert.match(sheet.markdown, /^# Your Personal Review Sheet\n\n## Photosynthesis\n/);
  assert.match(sheet.markdown, /## What to review next\n\n1\. \*\*Title a\*\* — Trace where the mass/);
});

test('a corrected misconception keeps the original next to the correction and records what changed', () => {
  const data = input([concept('b', answer(0, 'Light is only needed for warmth.'), answer(2, 'Light energy drives the reactions that make glucose.'))]);
  const sheet = buildReviewSheet(data, { concepts: [entry('b', { status: 'resolved_gap', originalExplanation: 'Light is only needed for warmth.', originalIsQuote: true, whatChanged: 'Your follow-up named light as the energy source (0/2 → 2/2).' })], reviewNext: [] }, 'gemini');
  const section = sectionOf(sheet.markdown, 'Title b');
  assert.equal(sheet.concepts[0]!.status, 'resolved_gap');
  assert.match(section, /Gap resolved · First check 0\/2 · Follow-up 2\/2/);
  assert.ok(section.indexOf('Light is only needed for warmth') < section.indexOf('Corrected idea for b'), 'original appears before the correction');
  assert.match(section, /What changed\*\*\n\nYour follow-up named light/);
  // A resolved gap is not pushed as the next thing to practice when nothing else is open.
  assert.match(sheet.markdown, /## What to review next\n\n- Explain one of these ideas again/);
});

test('a partially correct answer is quoted faithfully; a claimed quote the learner never wrote is replaced by their real answer', () => {
  const data = input([concept('c', answer(1, 'Chlorophyll absorbs light.'), answer(1, 'Chlorophyll absorbs light, mostly green.'))]);
  const sheet = buildReviewSheet(data, { concepts: [entry('c', { originalExplanation: 'Chlorophyll reflects all light.', originalIsQuote: true })], reviewNext: [] }, 'gemini');
  const section = sectionOf(sheet.markdown, 'Title c');
  assert.equal(section.includes('reflects all light'), false, 'fabricated quotation is not shown');
  assert.match(section, /> “Chlorophyll absorbs light\.”\n>\n> — your first-check answer/);
  assert.match(section, /Still a gap · First check 1\/2 · Follow-up 1\/2/);
});

test('a useful but incomplete learner metaphor is refined with its limits; an unattributable one is not credited to the learner', () => {
  const turns = ['Basically the leaf is like a kitchen that cooks sugar from sunlight.'];
  const data = input([concept('d', answer(1, 'Leaves make sugar.'), answer(1, 'Leaves make sugar using light.')), concept('e', answer(0, 'No idea.'), answer(1, 'Something about stomata.'))], turns);
  const sheet = buildReviewSheet(data, { concepts: [
    entry('d', { studentMetaphor: 'the leaf is like a kitchen that cooks sugar from sunlight', refinedMetaphor: 'The kitchen also needs ingredients: CO₂ and water.', metaphorLimits: 'Nothing is heated; light energy is captured by chlorophyll.' }),
    entry('e', { status: 'improved_incomplete', studentMetaphor: 'stomata are like doors', refinedMetaphor: 'Think of stomata as adjustable vents.' }),
  ], reviewNext: [] }, 'gemini');
  const own = sectionOf(sheet.markdown, 'Title d');
  assert.match(own, /\*\*Building on your mental model\*\*\n\n> “the leaf is like a kitchen that cooks sugar from sunlight” — what you wrote to Alex/);
  assert.match(own, /The kitchen also needs ingredients/);
  assert.match(own, /\*Where the picture stops working:\* Nothing is heated/);
  const other = sectionOf(sheet.markdown, 'Title e');
  assert.equal(other.includes('stomata are like doors'), false);
  assert.equal(other.includes('Building on your mental model'), false);
  assert.match(other, /\*\*A way to picture it\*\*\n\nThink of stomata as adjustable vents\./);
  assert.match(other, /Improved, not complete yet · First check 0\/2 · Follow-up 1\/2/);
});

test('a correct answer gets no manufactured correction, unless the transcript shows a quoted misconception', () => {
  const data = input([concept('f', answer(2, 'Oxygen is released.'), answer(2, 'O₂ is a by-product.')), concept('g', answer(2, 'Glucose is stored as starch.'), answer(2, 'Starch stores glucose.'))], ['Starch is made in the roots only, never in leaves.']);
  const sheet = buildReviewSheet(data, { concepts: [
    entry('f', { status: 'persistent_gap', originalExplanation: 'Oxygen is released.', originalIsQuote: true }),
    entry('g', { status: 'new_gap', newGapEvidence: 'Starch is made in the roots only', correctedUnderstanding: 'Leaves make and store starch too.' }),
    entry('f-unknown'),
  ], reviewNext: [{ conceptId: 'f', focus: 'Practice oxygen.' }] }, 'gemini');
  assert.deepEqual(sheet.concepts, [{ conceptId: 'f', status: 'strength' }, { conceptId: 'g', status: 'new_gap' }]);
  assert.equal(sheet.markdown.includes('### Title f'), false, 'no correction section for a demonstrated strength');
  assert.match(sheet.markdown, /## Already solid\n\n- \*\*Title f\*\* — First check 2\/2 · Follow-up 2\/2/);
  assert.match(sectionOf(sheet.markdown, 'Title g'), /Newly spotted gap/);
  assert.equal(sheet.markdown.includes('Practice oxygen'), false, 'review-next only lists concepts that need review');
  // Without exact evidence the override is refused.
  const unsupported = buildReviewSheet(data, { concepts: [entry('g', { status: 'new_gap', newGapEvidence: 'roots make all the starch' })], reviewNext: [] }, 'gemini');
  assert.equal(unsupported.concepts[1]!.status, 'strength');
  assert.match(unsupported.markdown, /did not show gaps that need correcting/);
});

test('missing assessment or transcript data produces no fabricated correction', () => {
  const data = input([concept('h', answer(null, ''), answer(null, '')), concept('i', answer(0, 'Water is not needed.'))]);
  const sheet = buildReviewSheet(data, { concepts: [entry('h', { originalExplanation: 'You thought water was optional.', originalIsQuote: false }), entry('i', { originalExplanation: 'Water is not needed.', originalIsQuote: true })], reviewNext: [] }, 'gemini');
  assert.deepEqual(sheet.concepts.map((item) => item.status), ['insufficient', 'unrechecked_gap']);
  assert.equal(sheet.markdown.includes('You thought water was optional'), false);
  assert.match(sheet.markdown, /## Not enough evidence yet\n\n- \*\*Title h\*\* — both questions were skipped/);
  const section = sectionOf(sheet.markdown, 'Title i');
  assert.match(section, /First check 0\/2 · Follow-up not checked/);
  assert.equal(section.includes('What changed'), false, 'no progress claim without a follow-up answer');
  // A paraphrase is only shown when the learner said something; reviewInput refuses sessions without graded results.
  const record = { session: { title: 'T', scope: '', notes: '', attempts: [], cycles: [] }, blueprint: null } as unknown as StoredRecord;
  assert.throws(() => reviewInput(record), /needs graded results/);
});

test('malformed or incomplete generator output is rejected or degrades to real grader feedback', () => {
  const data = input([concept('j', answer(0, 'Plants breathe in oxygen only.', 'Plants also take in CO₂ for photosynthesis.'), answer(1, 'Plants use CO₂ sometimes.', 'Partly right: name when CO₂ is used.'))]);
  for (const raw of [null, 'not json', [], { concepts: 'nope' }, {}]) assert.throws(() => buildReviewSheet(data, raw, 'gemini'), (error: Error & { code?: string }) => error.code === 'INVALID_REVIEW');
  const sheet = buildReviewSheet(data, { concepts: [null, 7, { conceptId: 'j', status: 'persistent_gap' }], reviewNext: 'bad' }, 'gemini');
  const section = sectionOf(sheet.markdown, 'Title j');
  assert.match(section, /\*\*What the grader noted\*\*\n\nPartly right: name when CO₂ is used\./);
  assert.match(section, /> “Plants breathe in oxygen only\.”/);
  assert.match(sheet.markdown, /1\. \*\*Title j\*\* — Partly right/);
  // Headings inside fields cannot break the sheet's hierarchy.
  const headed = buildReviewSheet(data, { concepts: [entry('j', { correctedUnderstanding: '# Big heading\nReal text.' })], reviewNext: [] }, 'gemini');
  assert.equal(/^# Big heading/m.test(headed.markdown), false);
});

test('review input carries no physiology, nervousness or confidence data', () => {
  const blueprint = { concepts: [{ id: 'k', title: 'K', description: 'D', rubric: 'R' }], baseline: [], reserved: [], questions: { q1: { id: 'q1', conceptId: 'k', prompt: 'P', supportsWorking: false, expectedAnswer: 'E' } }, version: 1 };
  const attempt = { id: 'a1', kind: 'baseline', cycleId: 'c', blueprintVersion: 1, questions: [{ id: 'q1', conceptId: 'k', prompt: 'P', supportsWorking: false }], answers: [{ questionId: 'q1', text: 'Ans', working: '', skipped: false, uncertain: true, confidence: 'low' }], currentQuestionIndex: 0,
    grade: { questionGrades: [{ questionId: 'q1', conceptId: 'k', score: 1, maxScore: 2, feedback: 'F', evidence: 'Ans' }], totalScore: 1, maxScore: 6, summary: '', gradedAt: '' } };
  const record = { session: { title: 'T', scope: 'S', notes: 'N', attempts: [attempt], cycles: [], nervousnessBefore: 5, monitoring: [{ samples: [{ metric: 'pulse', value: 120 }] }] }, blueprint } as unknown as StoredRecord;
  const data = reviewInput(record);
  const serialized = JSON.stringify(data);
  for (const key of ['nervousness', 'monitoring', 'pulse', 'confidence', 'uncertain']) assert.equal(serialized.includes(key), false, key);
  assert.equal(data.concepts[0]!.status, 'unrechecked_gap');
  assert.equal(data.concepts[0]!.firstCheck!.expectedAnswer, 'E');
});

test('DEV MOCK: review endpoint generates once at results, is stored, and reports malformed output safely', async (context) => {
  const env = { NODE_ENV: 'test', PRACTICE_PROVIDER_MODE: 'mock', MOCK_PROVIDER_DELAY_MS: '0' };
  const providers = createProviders(env); const original = providers.reviewSheet!; let calls = 0; let malformed = false;
  providers.reviewSheet = async (data) => { calls++; return malformed ? { concepts: 'broken' } : original(data); };
  const server = createServer(createPracticeHandler({ env, providers }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`; let token = '';
  const call = async <T = PracticeSession,>(path: string, method = 'POST', body: unknown = {}, status = 200): Promise<T> => {
    const response = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: method === 'GET' ? undefined : JSON.stringify(body) });
    const value: unknown = await response.json(); assert.equal(response.status, status, JSON.stringify(value)); return value as T;
  };
  const access = await call<SessionAccess>('/sessions', 'POST', { description: 'Arithmetic' }, 201); token = access.token; const path = `/sessions/${access.session.id}`;
  const prepared = await call(`${path}/prepare`); const baseline = prepared.attempts[0]!;
  await call(path, 'PATCH', { attemptId: baseline.id, answers: baseline.answers.map((item, index) => ({ ...item, text: ['5', '12', '9'][index], working: index === 0 ? '2 + 3 = 5' : '' })) });
  await call(`${path}/submit`, 'POST', { attemptId: baseline.id });
  await call(`${path}/review`, 'POST', {}, 409);
  const recheck = (await call(`${path}/recheck`)).attempts[1]!;
  await call(path, 'PATCH', { attemptId: recheck.id, answers: recheck.answers.map((item, index) => ({ ...item, text: ['7', '8', ''][index], working: index < 2 ? 'Equal groups' : '', skipped: index === 2 })) });
  await call(`${path}/submit`, 'POST', { attemptId: recheck.id });

  malformed = true;
  const failed = await call<{ error: { code: string }; session: PracticeSession }>(`${path}/review`, 'POST', {}, 502);
  assert.equal(failed.error.code, 'INVALID_REVIEW');
  assert.equal(failed.session.review, undefined);
  assert.equal(failed.session.stage, 'results', 'results are untouched by a failed review');

  malformed = false;
  const reviewed = await call(`${path}/review`);
  const sheet = reviewed.review!;
  assert.equal(sheet.source, 'mock');
  assert.match(sheet.markdown, /DEV MOCK/);
  // Baseline [2,1,0], follow-up [2,2,skipped].
  assert.deepEqual(sheet.concepts.map((item) => item.status), ['strength', 'resolved_gap', 'unrechecked_gap']);
  assert.match(sheet.markdown, /> “12”\n>\n> — your first-check answer/);
  assert.equal(JSON.stringify(reviewed).includes('rubric'), false);
  await call(`${path}/review`);
  assert.equal(calls, 2, 'a stored sheet is reused instead of generated again');
  assert.deepEqual((await call(path, 'GET')).review, sheet);
  const renewed = await call(`${path}/review`, 'POST', { regenerate: true });
  assert.equal(calls, 3, 'an explicit request creates a new version');
  assert.ok(renewed.review!.generatedAt >= sheet.generatedAt);
  // A failed new version is reported as a failure, while the previous sheet stays saved.
  malformed = true;
  const failedAgain = await call<{ error: { code: string }; session: PracticeSession }>(`${path}/review`, 'POST', { regenerate: true }, 502);
  assert.equal(failedAgain.error.code, 'INVALID_REVIEW');
  assert.deepEqual(failedAgain.session.review, renewed.review);

  // The PDF is built from this session's saved sheet.
  const pdf = new TextDecoder('latin1').decode(reviewPdf(renewed.review!.markdown, 'Your Personal Review Sheet'));
  const text = pdfText(pdf);
  for (const expected of ['Your Personal Review Sheet', 'Multiplication', 'Your original explanation', '12', 'What to review next']) assert.ok(text.includes(expected), expected);
});

/** Checks the cross-reference table points at each object, and returns the drawn text decoded from WinAnsi hex strings. */
function pdfText(pdf: string): string {
  assert.ok(pdf.startsWith('%PDF-1.4\n')); assert.ok(pdf.trimEnd().endsWith('%%EOF'));
  const start = Number(pdf.match(/startxref\n(\d+)/)![1]); assert.ok(pdf.slice(start).startsWith('xref'));
  const offsets = [...pdf.slice(start).matchAll(/^(\d{10}) 00000 n $/gm)].map((match) => Number(match[1]));
  offsets.forEach((offset, index) => assert.ok(pdf.slice(offset).startsWith(`${index + 1} 0 obj`), `object ${index + 1}`));
  for (const stream of pdf.matchAll(/<< \/Length (\d+) >>\nstream\n/g)) assert.equal(pdf.slice(stream.index + stream[0].length + Number(stream[1]), stream.index + stream[0].length + Number(stream[1]) + 10), '\nendstream');
  return [...pdf.matchAll(/<([0-9a-f]+)> Tj/g)].map((match) => String.fromCharCode(...match[1]!.match(/../g)!.map((byte) => Number.parseInt(byte, 16)))).join(' ');
}

test('PDF export lays out the same Markdown across pages with readable maths', () => {
  const markdown = ['# Your Personal Review Sheet', '', '## Photosynthesis', '', '### Light reactions', '', '*Still a gap · First check 0/2 · Follow-up 1/2*', '', '**Your original explanation**', '', '> “Light is just for warmth.”', '>', '> — your first-check answer', '',
    '**Worked example**', '', '1. 6CO₂ + 6H₂O → C₆H₁₂O₆ + 6O₂', '2. Rate ≤ max when x² ≥ √4', '', ...Array.from({ length: 80 }, (_, index) => `Line ${index} ${'filler words to wrap '.repeat(6)}`)].join('\n');
  const pdf = new TextDecoder('latin1').decode(reviewPdf(markdown, 'Your Personal Review Sheet – Photosynthesis'));
  const text = pdfText(pdf);
  assert.ok(Number(pdf.match(/\/Count (\d+)/)![1]) >= 2, 'long sheets continue on more pages');
  for (const expected of ['Light reactions', 'Your original explanation', '\x93Light is just for warmth.\x94', '6CO2 + 6H2O -> C6H12O6 + 6O2', '<= max when x² >= sqrt4', 'page 2 of']) assert.ok(text.includes(expected), expected);
  assert.equal(text.includes('**'), false, 'Markdown markers are not printed');
  assert.deepEqual(winAnsi('é…—'), [0xe9, 0x85, 0x97]);
});

test('the stored sheet is regenerated only when the session evidence changes', () => {
  const base = input([concept('a', answer(0, 'Plants eat soil.'), answer(1, 'Plants use CO₂.'))]);
  assert.equal(reviewFingerprint(base), reviewFingerprint(structuredClone(base)));
  assert.notEqual(reviewFingerprint(base), reviewFingerprint({ ...base, teaching: [{ speaker: 'learner', channel: 'voice', text: 'A transcript saved after results.' }] }));
});
