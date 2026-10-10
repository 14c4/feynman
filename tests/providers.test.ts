import assert from 'node:assert/strict';
import test from 'node:test';
import { createProviders, providerFailure } from '../server/providers.js';

test('provider errors preserve HTTP status and useful details without exposing credentials', () => {
  const secret = 'test-private-credential';
  const error = providerFailure('Gemini', 429, { error: { status: 'RESOURCE_EXHAUSTED', message: `Quota exhausted for ${secret}.\nLimit: 0` } }, [secret]);
  assert.equal(error.status, 429);
  assert.equal(error.code, 'RESOURCE_EXHAUSTED');
  assert.match(error.message, /HTTP 429/);
  assert.match(error.message, /Limit: 0/);
  assert.equal(error.message.includes(secret), false);
});

test('non-JSON provider failures still identify the failing service and HTTP status', () => {
  const error = providerFailure('Gemini', 400, null);
  assert.equal(error.status, 502);
  assert.match(error.message, /Gemini request failed \(HTTP 400/);
  assert.equal(error.code, 'PROVIDER_HTTP_400');
});

test('Gemini preparation requires a complete assessment shape rather than only a ready flag', async (context) => {
  context.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { generationConfig: { responseSchema: { required: string[] } } };
    assert.deepEqual(body.generationConfig.responseSchema.required, ['kind', 'question', 'title', 'scope', 'concepts']);
    const output = { kind: 'ready', question: '', title: 'Recursion', scope: 'Base cases and recursive calls', concepts: [1, 2, 3].map((number) => ({
      id: `c${number}`, title: `Concept ${number}`, description: 'A studied concept', rubric: '0 incorrect, 1 partial, 2 complete',
      baselinePrompt: `Initial question ${number}`, baselineExpectedAnswer: 'Expected baseline answer',
      recheckPrompt: `Different follow-up ${number}`, recheckExpectedAnswer: 'Expected follow-up answer', supportsWorking: true,
    })) };
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(output) }] } }] }), { status: 200 });
  });
  const result = await createProviders({ GEMINI_API_KEY: 'test-only-key' }).generate('Recursion', '');
  assert.equal(result.kind, 'ready');
  if (result.kind === 'ready') assert.equal(result.concepts.length, 3);
});
