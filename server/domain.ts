import { randomUUID } from 'node:crypto';
import type { AssessmentGrade, PracticeQuestion, QuestionGrade } from '../shared/types.js';

export class PracticeError extends Error {
  constructor(message: string, readonly status = 400, readonly code = 'INVALID_INPUT') { super(message); }
}

export interface PrivateConcept { id: string; title: string; description: string; rubric: string }
export interface PrivateQuestion extends PracticeQuestion { expectedAnswer: string }
export interface PrivateBlueprint {
  concepts: PrivateConcept[];
  baseline: PrivateQuestion[];
  reserved: PrivateQuestion[];
  questions: Record<string, PrivateQuestion>;
  version: number;
}
export interface GeneratedConcept extends PrivateConcept {
  baselinePrompt: string;
  baselineExpectedAnswer: string;
  recheckPrompt: string;
  recheckExpectedAnswer: string;
  supportsWorking: boolean;
}

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PracticeError('The response was not a valid object.');
  return value as Record<string, unknown>;
}
export function text(value: unknown, max = 6000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new PracticeError('The response contained missing or invalid text.');
  return value.trim();
}
export const normalizePrompt = (prompt: string) => prompt.trim().replace(/\s+/g, ' ').toLowerCase();

export function validateGeneratedConcepts(value: unknown): GeneratedConcept[] {
  if (!Array.isArray(value) || value.length !== 3) throw new PracticeError('Question generation did not return three matched concepts.', 502, 'INVALID_ASSESSMENT');
  const ids = new Set<string>();
  const prompts = new Set<string>();
  return value.map((item: unknown) => {
    const row = object(item);
    const id = text(row.id, 80);
    if (!/^[a-zA-Z0-9_-]+$/.test(id) || ids.has(id)) throw new PracticeError('Question generation returned invalid concept IDs.', 502, 'INVALID_ASSESSMENT');
    ids.add(id);
    const concept: GeneratedConcept = {
      id, title: text(row.title, 120), description: text(row.description, 1000), rubric: text(row.rubric, 3000),
      baselinePrompt: text(row.baselinePrompt, 2000), baselineExpectedAnswer: text(row.baselineExpectedAnswer),
      recheckPrompt: text(row.recheckPrompt, 2000), recheckExpectedAnswer: text(row.recheckExpectedAnswer),
      supportsWorking: row.supportsWorking === true,
    };
    for (const prompt of [concept.baselinePrompt, concept.recheckPrompt]) {
      const normalized = normalizePrompt(prompt);
      if (prompts.has(normalized)) throw new PracticeError('Question generation repeated a question. Please try again.', 502, 'INVALID_ASSESSMENT');
      prompts.add(normalized);
    }
    return concept;
  });
}

export function makeQuestions(concepts: GeneratedConcept[], kind: 'baseline' | 'recheck'): PrivateQuestion[] {
  return concepts.map((concept) => ({
    id: randomUUID(), conceptId: concept.id,
    prompt: kind === 'baseline' ? concept.baselinePrompt : concept.recheckPrompt,
    expectedAnswer: kind === 'baseline' ? concept.baselineExpectedAnswer : concept.recheckExpectedAnswer,
    supportsWorking: concept.supportsWorking,
  }));
}
export function publicQuestion(question: PrivateQuestion): PracticeQuestion {
  return { id: question.id, conceptId: question.conceptId, prompt: question.prompt, supportsWorking: question.supportsWorking };
}

export function validateGrade(value: unknown, answer: string, working: string): { score: 0 | 1 | 2; feedback: string; evidence: string } {
  const row = object(value);
  if ((row.score !== 0 && row.score !== 1 && row.score !== 2) || typeof row.evidence !== 'string' || row.evidence.length > 6000 ||
    (row.evidence && !answer.includes(row.evidence) && !working.includes(row.evidence)) || (row.score > 0 && !row.evidence.trim())) {
    throw new PracticeError('Grading returned unsupported evidence. Your answers are saved; please retry.', 502, 'INVALID_GRADE');
  }
  return { score: row.score, feedback: text(row.feedback, 1500), evidence: row.evidence };
}
export function totalGrades(grades: QuestionGrade[]): AssessmentGrade {
  if (grades.length !== 3 || new Set(grades.map((grade) => grade.questionId)).size !== 3 || grades.some((grade) => ![0, 1, 2].includes(grade.score))) {
    throw new PracticeError('Three valid question grades are required.', 502, 'INVALID_GRADE');
  }
  return { questionGrades: grades, totalScore: grades.reduce((sum, grade) => sum + grade.score, 0), maxScore: 6,
    summary: 'These results describe your responses to these three questions.', gradedAt: new Date().toISOString() };
}
