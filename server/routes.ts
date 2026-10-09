import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ApiError } from '../shared/types.js';

const pendingRoutes: Record<string, string> = {
  '/api/voice/session': 'ElevenLabs session setup is awaiting integration. The connection payload is not defined yet.',
  '/api/student/reply': 'Gemini student reasoning is awaiting integration.',
  '/api/evaluations': 'Gemini post-session evaluation is awaiting integration.',
};

function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(body));
}

export function handleRequest(request: IncomingMessage, response: ServerResponse) {
  const path = new URL(request.url ?? '/', 'http://localhost').pathname;
  // No payload parsing or provider calls until the integration contracts are implemented.
  request.resume();

  if (request.method === 'GET' && path === '/api/health') {
    json(response, 200, { status: 'ok', service: 'feynman.ai', integrations: 'pending' });
    return;
  }

  const message = pendingRoutes[path];
  if (request.method === 'POST' && message) {
    const body: ApiError = { error: { code: 'INTEGRATION_PENDING', message } };
    json(response, 501, body);
    return;
  }

  const body: ApiError = { error: { code: 'NOT_FOUND', message: 'This API endpoint does not exist.' } };
  json(response, 404, body);
}
