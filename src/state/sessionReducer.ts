import type { EvaluationResult, EvaluationStatus, StudySession, TranscriptMessage } from '../../shared/types.js';

export interface SessionState {
  sessions: Record<string, StudySession>;
  evaluations: Record<string, EvaluationResult>;
  evaluationStatus: Record<string, EvaluationStatus>;
}

export const initialSessionState: SessionState = {
  sessions: {}, evaluations: {}, evaluationStatus: {},
};

export type SessionAction =
  | { type: 'create'; session: StudySession }
  | { type: 'start'; sessionId: string; at: string }
  | { type: 'append'; message: TranscriptMessage }
  | { type: 'finish'; sessionId: string; at: string }
  | { type: 'leave'; keepSessionId?: string; at: string };

export function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  if (action.type === 'create') {
    if (state.sessions[action.session.id]) return state;
    return {
      ...state,
      sessions: { ...state.sessions, [action.session.id]: action.session },
      evaluationStatus: { ...state.evaluationStatus, [action.session.id]: 'unavailable' },
    };
  }

  if (action.type === 'leave') {
    const sessions = { ...state.sessions };
    let changed = false;
    for (const session of Object.values(sessions)) {
      if (session.id !== action.keepSessionId && ['preparing', 'active'].includes(session.status)) {
        sessions[session.id] = { ...session, status: 'abandoned', endedAt: action.at };
        changed = true;
      }
    }
    return changed ? { ...state, sessions } : state;
  }

  const id = action.type === 'append' ? action.message.sessionId : action.sessionId;
  const session = state.sessions[id];
  if (!session) return state;

  let updated: StudySession;
  switch (action.type) {
    case 'start':
      if (session.status !== 'preparing') return state;
      updated = { ...session, status: 'active', startedAt: action.at };
      break;
    case 'append':
      if (session.status !== 'active' || !action.message.text.trim() ||
        session.transcript.some((message) => message.id === action.message.id)) return state;
      updated = { ...session, transcript: [...session.transcript, { ...action.message, text: action.message.text.trim() }] };
      break;
    case 'finish':
      if (session.status !== 'active' || !session.transcript.some((message) => message.role === 'learner')) return state;
      updated = { ...session, status: 'completed', endedAt: action.at };
      break;
  }
  return { ...state, sessions: { ...state.sessions, [id]: updated } };
}
