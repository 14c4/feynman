import type { EvaluationResult, TranscriptMessage } from '../../../shared/types';

// This fixture is an independent Recursion example, never a user's evaluation.
const sessionId = 'sample-recursion-session';

export const sampleTranscript: TranscriptMessage[] = [
  { id: 'sample-1', sessionId, role: 'learner', source: 'sample', createdAt: '2026-01-01T12:00:00Z', text: 'Recursion is when a function calls itself with a smaller problem. For example, a countdown function could call itself with a smaller number.' },
  { id: 'sample-2', sessionId, role: 'student', source: 'sample', createdAt: '2026-01-01T12:00:10Z', text: 'What stops the countdown? And what happens when a recursive call finishes?' },
  { id: 'sample-3', sessionId, role: 'learner', source: 'sample', createdAt: '2026-01-01T12:00:20Z', text: 'The number keeps getting smaller. I think it’s just one long function call, so nothing needs to return to earlier calls.' },
];

export const sampleFeedback: EvaluationResult = {
  id: 'sample-recursion-feedback', sessionId, source: 'sample', createdAt: '2026-01-01T12:01:00Z',
  summary: 'The learner explains self-calls with a useful countdown example. The stopping condition and the way results return through earlier calls need clarification.',
  conceptCoverage: [
    { conceptId: 'self-call', status: 'covered', feedback: 'You connected self-calls to a smaller version of the problem and used a concrete example.', evidenceMessageIds: ['sample-1'] },
    { conceptId: 'progress', status: 'partial', feedback: 'You described a decreasing number, but didn’t connect it to reaching a specific stopping condition.', evidenceMessageIds: ['sample-3'] },
    { conceptId: 'base-case', status: 'missing', feedback: 'The explanation never specifies the base case. Without a stopping condition, the calls may continue indefinitely.', evidenceMessageIds: [] },
    { conceptId: 'return-values', status: 'misunderstood', feedback: 'Each recursive call has its own execution context. When a call finishes, control returns to the previous call; a return value may also be passed back.', evidenceMessageIds: ['sample-3'] },
  ],
  recommendations: [
    'State the base case first: at zero, the countdown returns without calling itself again.',
    'Trace countdown(3) through 2, 1, and 0, then walk back through the waiting calls.',
  ],
  suggestedRetry: 'Explain the countdown again using two ideas: “when to stop” and “what happens after a call returns.”',
};
