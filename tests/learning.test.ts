import test from 'node:test';
import assert from 'node:assert/strict';
import { makeQuestions, publicQuestion, totalGrades, validateGeneratedConcepts, validateGrade, type GeneratedConcept } from '../server/domain.js';

export const concepts: GeneratedConcept[] = [1, 2, 3].map((number) => ({
  id: `c${number}`, title: `Concept ${number}`, description: `Description ${number}`,
  rubric: '0 incorrect, 1 partial, 2 explains the causal relation', supportsWorking: true,
  baselineExpectedAnswer: `Initial answer ${number}`, recheckExpectedAnswer: `Different answer ${number}`,
  baselinePrompt: `Explain concept ${number}`, recheckPrompt: `Apply concept ${number}`,
}));

test('three unique paired questions retain their own expected answers', () => {
  assert.equal(validateGeneratedConcepts(concepts).length, 3);
  assert.throws(() => validateGeneratedConcepts([concepts[0], concepts[1], concepts[0]]));
  const baseline = makeQuestions(concepts, 'baseline'); const recheck = makeQuestions(concepts, 'recheck');
  assert.notEqual(baseline[0].expectedAnswer, recheck[0].expectedAnswer);
  assert.equal(new Set([...baseline, ...recheck].map((question) => question.prompt)).size, 6);
  assert.equal('expectedAnswer' in publicQuestion(baseline[0]), false);
});

test('grading rejects invented evidence and computes the total from valid question scores', () => {
  assert.deepEqual(validateGrade({ score: 1, feedback: 'Partial evidence.', evidence: 'base case' }, 'A base case stops.', ''), { score: 1, feedback: 'Partial evidence.', evidence: 'base case' });
  assert.throws(() => validateGrade({ score: 2, feedback: 'Complete.', evidence: 'never said' }, 'A base case stops.', ''));
  const grades = concepts.map((concept, index) => ({ questionId: `q${index}`, conceptId: concept.id, score: index as 0 | 1 | 2, maxScore: 2 as const, feedback: 'Feedback', evidence: '' }));
  assert.equal(totalGrades(grades).totalScore, 3);
  assert.equal(totalGrades(grades).maxScore, 6);
});
