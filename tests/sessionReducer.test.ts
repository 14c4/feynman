import assert from 'node:assert/strict';
import test from 'node:test';
import type { StudySession, TranscriptMessage } from '../shared/types.js';
import { initialSessionState, sessionReducer } from '../src/state/sessionReducer.js';

const at = '2026-01-01T12:00:00Z';
const session: StudySession = { id: 'one', topicId: 'recursion', attemptNumber: 1, status: 'preparing', createdAt: at, transcript: [] };
const message: TranscriptMessage = { id: 'message-one', sessionId: 'one', role: 'learner', text: '  A function calls itself.  ', createdAt: at, source: 'text' };

test('requires preparation and a saved explanation before completion; completed transcripts are immutable', () => {
  let state = sessionReducer(initialSessionState, { type: 'create', session });
  assert.equal(state.evaluationStatus.one, 'unavailable');
  assert.equal(sessionReducer(state, { type: 'append', message }), state);
  assert.equal(sessionReducer(state, { type: 'finish', sessionId: 'one', at }), state);
  state = sessionReducer(state, { type: 'start', sessionId: 'one', at });
  assert.equal(state.sessions.one.startedAt, at);
  assert.equal(sessionReducer(state, { type: 'finish', sessionId: 'one', at }), state);
  assert.equal(sessionReducer(state, { type: 'append', message: { ...message, text: ' ' } }), state);
  state = sessionReducer(state, { type: 'append', message });
  assert.equal(state.sessions.one.transcript[0].text, 'A function calls itself.');
  assert.equal(sessionReducer(state, { type: 'append', message }), state);
  state = sessionReducer(state, { type: 'finish', sessionId: 'one', at });
  assert.equal(state.sessions.one.status, 'completed');
  assert.equal(state.sessions.one.endedAt, at);
  assert.equal(sessionReducer(state, { type: 'append', message: { ...message, id: 'later' } }), state);
  assert.equal(sessionReducer(state, { type: 'start', sessionId: 'one', at }), state);
  assert.deepEqual(state.evaluations, {});
});

test('navigation abandons only unfinished sessions and preserves saved text and retry links', () => {
  let state = sessionReducer(initialSessionState, { type: 'create', session });
  state = sessionReducer(state, { type: 'start', sessionId: 'one', at });
  state = sessionReducer(state, { type: 'append', message });
  state = sessionReducer(state, { type: 'finish', sessionId: 'one', at });
  state = sessionReducer(state, { type: 'create', session: { ...session, id: 'two', previousSessionId: 'one', attemptNumber: 2 } });
  state = sessionReducer(state, { type: 'leave', keepSessionId: 'two', at });
  assert.equal(state.sessions.one.status, 'completed');
  assert.equal(state.sessions.two.status, 'preparing');
  assert.equal(state.sessions.two.previousSessionId, 'one');
  state = sessionReducer(state, { type: 'start', sessionId: 'two', at });
  state = sessionReducer(state, { type: 'append', message: { ...message, id: 'message-two', sessionId: 'two' } });
  state = sessionReducer(state, { type: 'leave', at });
  assert.equal(state.sessions.two.status, 'abandoned');
  assert.equal(state.sessions.two.transcript.length, 1);
  assert.equal(state.sessions.one.status, 'completed');
  assert.equal(sessionReducer(state, { type: 'leave', at }), state);
});
