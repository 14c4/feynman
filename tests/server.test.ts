import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import type { PracticeSession, SessionAccess, VoiceCredentials } from '../shared/types.js';
import { createPracticeHandler } from '../server/routes.js';
import { MemorySessionStore } from '../server/store.js';
import type { Providers } from '../server/providers.js';

test('one practice cycle connects baseline grading, focused voice context, and follow-up comparison', async () => {
  let voiceContext = '';
  const providers: Providers = {
    generate: async () => ({ kind: 'ready', title: 'Recursion practice', scope: 'Three recursive concepts', concepts: [1, 2, 3].map((number) => ({
      id: `c${number}`, title: `Concept ${number}`, description: `Description ${number}`, rubric: '0 incorrect, 1 partial, 2 complete', supportsWorking: true,
      baselinePrompt: `Explain concept ${number}`, recheckPrompt: `Apply concept ${number}`, baselineExpectedAnswer: `Answer ${number}`, recheckExpectedAnswer: `Follow-up answer ${number}`,
    })) }),
    grade: async ({ text }) => ({ score: text === 'correct' ? 2 : 0, feedback: text === 'correct' ? 'Demonstrated clearly.' : 'Practice the causal relation.', evidence: text }),
    voice: async (sessionId, title, context, opening) => { voiceContext = context; return { signedUrl: 'wss://test.invalid', dynamicVariables: { session_id: sessionId, session_title: title, focus_context: context, opening_question: opening } }; },
    history: async () => ({ status: 'processing' }),
  };
  const server = createServer(createPracticeHandler({ store: new MemorySessionStore(), providers, env: {} }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  let token = '';
  const call = async <T,>(path: string, method = 'POST', body: unknown = {}) => {
    const response = await fetch(`${base}/api${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: method === 'GET' ? undefined : JSON.stringify(body) });
    const value: unknown = await response.json();
    assert.ok(response.ok, JSON.stringify(value)); return value as T;
  };
  try {
    const access = await call<SessionAccess>('/sessions', 'POST', { description: 'Recursion and base cases' }); token = access.token;
    const path = `/sessions/${access.session.id}`;
    let session = await call<PracticeSession>(`${path}/prepare`);
    assert.equal(session.attempts[0].questions.length, 3);
    assert.equal(session.stage, 'baseline');
    const baseline = session.attempts[0];
    session = await call<PracticeSession>(path, 'PATCH', { attemptId: baseline.id, answers: baseline.answers.map((answer, index) => ({ ...answer, text: index === 0 ? 'correct' : 'incorrect' })) });
    session = await call<PracticeSession>(`${path}/submit`, 'POST', { attemptId: baseline.id });
    assert.equal(session.stage, 'teaching'); assert.equal(session.attempts[0].grade?.totalScore, 2);
    assert.deepEqual(session.cycles[0].focusConceptIds, ['c2', 'c3']);
    const credential = await call<VoiceCredentials>(`${path}/voice`); assert.equal(credential.dynamicVariables.session_id, session.id);
    assert.ok(voiceContext.includes('Concept 2')); assert.ok(voiceContext.includes('Practice the causal relation.'));
    session = await call<PracticeSession>(`${path}/recheck`);
    const followup = session.attempts[1]; assert.notEqual(followup.questions[0].prompt, baseline.questions[0].prompt);
    await call<PracticeSession>(path, 'PATCH', { attemptId: followup.id, answers: followup.answers.map((answer) => ({ ...answer, text: 'correct' })) });
    session = await call<PracticeSession>(`${path}/submit`, 'POST', { attemptId: followup.id });
    assert.equal(session.stage, 'results'); assert.equal(session.attempts[1].grade?.totalScore, 6); assert.equal(session.attempts[0].grade?.totalScore, 2);
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
});
