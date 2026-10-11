import assert from 'node:assert/strict';
import test from 'node:test';
import type { PracticeSession } from '../shared/types.js';
import { initialSessionState, sessionReducer } from '../src/state/sessionReducer.js';

const session: PracticeSession = {
  id: 'one', title: 'Recursion', description: 'Recursive functions', notes: '', scope: 'Base cases', concepts: [], blueprintVersion: 1,
  stage: 'baseline', lifecycle: 'active', preparation: { status: 'ready' }, cycles: [], currentCycleId: 'cycle',
  createdAt: '2026-01-01', updatedAt: '2026-01-01', attempts: [{
    id: 'baseline', kind: 'baseline', cycleId: 'cycle', blueprintVersion: 1, currentQuestionIndex: 0,
    questions: [{ id: 'q1', conceptId: 'base-case', prompt: 'Why stop?', supportsWorking: true }],
    answers: [{ questionId: 'q1', text: '', working: '', skipped: false, uncertain: false }],
  }],
};

test('draft answers update the one session without losing working or uncertainty', () => {
  const state = sessionReducer(initialSessionState, { type: 'receive', session });
  const answer = { questionId: 'q1', text: 'A base case stops further calls.', working: 'n reaches zero', skipped: false, uncertain: true };
  const next = sessionReducer(state, { type: 'draft', sessionId: 'one', attemptId: 'baseline', answer });
  assert.deepEqual(next.sessions.one.attempts[0].answers[0], answer);
  assert.equal(state.sessions.one.attempts[0].answers[0].text, '');
});

test('paused and submitted assessments cannot be edited locally', () => {
  const answer = { questionId: 'q1', text: 'changed', working: '', skipped: false, uncertain: false };
  for (const frozen of [{ ...session, lifecycle: 'paused' as const }, { ...session, stage: 'baseline_evaluating' as const },
    { ...session, attempts: [{ ...session.attempts[0], submittedAt: '2026-01-01' }] }]) {
    const state = sessionReducer(initialSessionState, { type: 'receive', session: frozen });
    assert.equal(sessionReducer(state, { type: 'draft', sessionId: 'one', attemptId: 'baseline', answer }), state);
  }
});

test('missing-server errors retain browser drafts and clear their status on retry', () => {
  const state = sessionReducer(initialSessionState, { type: 'receive', session });
  const missing = sessionReducer(state, { type: 'error', sessionId: 'one', message: 'Practice session not found.', status: 404 });
  assert.equal(missing.sessions.one, session);
  assert.equal(missing.errorStatuses.one, 404);
  const retry = sessionReducer(missing, { type: 'error', sessionId: 'one', message: '' });
  assert.equal(retry.errorStatuses.one, undefined);
});
