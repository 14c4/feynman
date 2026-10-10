import type { AssessmentAnswer, PracticeSession } from '../../shared/types.js';

export interface SessionState {
  sessions: Record<string, PracticeSession>;
  busy: Record<string, boolean>;
  errors: Record<string, string>;
}

export const initialSessionState: SessionState = { sessions: {}, busy: {}, errors: {} };

export type SessionAction =
  | { type: 'receive'; session: PracticeSession }
  | { type: 'draft'; sessionId: string; attemptId: string; answer: AssessmentAnswer; index?: number }
  | { type: 'busy'; sessionId: string; busy: boolean }
  | { type: 'error'; sessionId: string; message: string };

export function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  if (action.type === 'receive') return { ...state, sessions: { ...state.sessions, [action.session.id]: action.session } };
  if (action.type === 'busy') return { ...state, busy: { ...state.busy, [action.sessionId]: action.busy } };
  if (action.type === 'error') return { ...state, errors: { ...state.errors, [action.sessionId]: action.message } };
  const session = state.sessions[action.sessionId];
  const attempt = session?.attempts.find((item) => item.id === action.attemptId);
  if (!session || !attempt || session.lifecycle !== 'active' || session.stage !== attempt.kind || attempt.submittedAt ||
    !attempt.questions.some((question) => question.id === action.answer.questionId) ||
    (action.index !== undefined && (!Number.isInteger(action.index) || action.index < 0 || action.index >= attempt.questions.length))) return state;
  const updated = {
    ...attempt,
    answers: attempt.answers.map((answer) => answer.questionId === action.answer.questionId ? action.answer : answer),
    currentQuestionIndex: action.index ?? attempt.currentQuestionIndex,
  };
  return { ...state, sessions: { ...state.sessions, [session.id]: {
    ...session, updatedAt: new Date().toISOString(), attempts: session.attempts.map((item) => item.id === updated.id ? updated : item),
  } } };
}
