import { PracticeError, validateGeneratedConcepts } from './domain.js';
import type { Providers } from './providers.js';

// Backend-only test data, deliberately unrelated to arbitrary learner material.
// It goes through the same private blueprint, validation and grading endpoints.
const concepts = validateGeneratedConcepts([
  { id: 'addition', title: 'Addition', description: 'Combine two quantities.', baselinePrompt: 'What is 2 + 3? Show how you combine the quantities.', baselineExpectedAnswer: '5', recheckPrompt: 'What is 4 + 3? Show how you combine the quantities.', recheckExpectedAnswer: '7', rubric: '0 = wrong; 1 = correct total only; 2 = correct total with working.', supportsWorking: true },
  { id: 'multiplication', title: 'Multiplication', description: 'Combine equal groups.', baselinePrompt: 'What is 3 × 4? Show the equal groups.', baselineExpectedAnswer: '12', recheckPrompt: 'What is 2 × 4? Show the equal groups.', recheckExpectedAnswer: '8', rubric: '0 = wrong; 1 = correct total only; 2 = correct total with working.', supportsWorking: true },
  { id: 'division', title: 'Division', description: 'Share into equal groups.', baselinePrompt: 'What is 12 ÷ 3? Show the equal groups.', baselineExpectedAnswer: '4', recheckPrompt: 'What is 10 ÷ 2? Show the equal groups.', recheckExpectedAnswer: '5', rubric: '0 = wrong; 1 = correct total only; 2 = correct total with working.', supportsWorking: true },
]);

export function assertDevelopmentMode(env: NodeJS.ProcessEnv): void {
  if (env.NODE_ENV !== 'development' && env.NODE_ENV !== 'test') {
    throw new Error('Mock providers require NODE_ENV=development or test and are unavailable in production.');
  }
}

export function createDevelopmentProviders(env: NodeJS.ProcessEnv): Providers {
  assertDevelopmentMode(env);
  const scenario = env.MOCK_PROVIDER_SCENARIO || 'normal';
  if (!['normal', 'clarification', 'prepare-error-once', 'grade-error-once', 'reply-error-once'].includes(scenario)) throw new Error('Unknown MOCK_PROVIDER_SCENARIO.');
  const delay = Number(env.MOCK_PROVIDER_DELAY_MS ?? 350);
  if (!Number.isInteger(delay) || delay < 0 || delay > 10_000) throw new Error('MOCK_PROVIDER_DELAY_MS must be an integer from 0 to 10000.');
  let preparationFailed = false;
  let gradingFailed = false;
  let replyFailed = false;
  const wait = () => new Promise<void>((resolve) => setTimeout(resolve, delay));
  const unavailable = async (): Promise<never> => { throw new PracticeError('DEV MOCK: conversation providers are disabled. No ElevenLabs or Gemini request was made.', 503, 'MOCK_VOICE_UNAVAILABLE'); };
  return {
    mode: 'mock',
    async generate(_description, _notes, clarification) {
      await wait();
      if (scenario === 'prepare-error-once' && !preparationFailed) { preparationFailed = true; throw new PracticeError('DEV MOCK: simulated preparation failure. Retry to recover.', 503, 'MOCK_PREPARATION_ERROR'); }
      if (scenario === 'clarification' && !clarification?.trim()) return { kind: 'clarification', question: 'DEV MOCK: which arithmetic skill would you like to practise?' };
      return { kind: 'ready', title: 'Development arithmetic fixture', scope: 'DEV MOCK: fixed addition, multiplication and division fixtures. Submitted topic, notes and uploaded files are not interpreted.', concepts: structuredClone(concepts) };
    },
    async grade({ text, working, expectedAnswer }) {
      await wait();
      if (scenario === 'grade-error-once' && !gradingFailed) { gradingFailed = true; throw new PracticeError('DEV MOCK: simulated grading failure. Your answers are saved; retry to recover.', 429, 'MOCK_GRADING_ERROR'); }
      const correct = text.trim() === expectedAnswer || (!text.trim() && working.trim() === expectedAnswer);
      const score = correct ? working.trim() && text.trim() ? 2 : 1 : 0;
      return { score, feedback: `DEV MOCK: ${score === 2 ? 'Expected fixture total with working.' : score === 1 ? 'Expected fixture total; add working for the second test point.' : 'Response does not match the fixture total.'} This is deterministic test feedback, not Gemini evaluation.`, evidence: text.trim() || working.trim() };
    },
    // Scripted, clearly labeled test turns. They exercise the real text-conversation
    // lifecycle without pretending to be an AI response.
    async alexReply(context, messages) {
      await wait();
      if (scenario === 'reply-error-once' && !replyFailed) { replyFailed = true; throw new PracticeError('DEV MOCK: simulated Alex reply failure. Your message is saved; retry to recover.', 503, 'MOCK_REPLY_ERROR'); }
      const turn = messages.filter((message) => message.role === 'learner').length;
      const concepts = context.focusConcepts.map((concept) => concept.title);
      const concept = concepts[(turn - 1) % Math.max(1, concepts.length)] ?? 'this idea';
      const prompts = [
        `Can you give me a concrete example of ${concept}?`,
        `Why does that step work for ${concept}? I want to understand the reasoning.`,
        `Is there an everyday analogy for ${concept}?`,
        `How does ${concept} connect to what you explained earlier?`,
      ];
      return `DEV MOCK scripted Alex (test message, not AI): ${prompts[(turn - 1) % prompts.length]}`;
    },
    voice: unavailable,
    history: unavailable,
  };
}
