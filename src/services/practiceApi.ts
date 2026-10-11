import type { IntegrationHealth, MonitoringStatus, PracticeSession, SessionAccess, SessionSummary, VoiceCredentials } from '../../shared/types';
import type { PracticeService } from './contracts/practice';
import { accessToken } from './supabase';

export class PracticeApiError extends Error {
  constructor(message: string, readonly session?: PracticeSession, readonly status?: number) { super(message); }
}

async function request<T>(path: string, method: string, token?: string, input?: unknown): Promise<T> {
  let response: Response;
  const user = await accessToken();
  try {
    const binary = input instanceof Uint8Array;
    response = await fetch(`/api${path}`, {
      method, headers: { 'Content-Type': binary ? 'application/octet-stream' : 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(user ? { 'X-User-Token': user } : {}) },
      body: input === undefined ? undefined : binary ? input as Uint8Array<ArrayBuffer> : JSON.stringify(input), signal: AbortSignal.timeout(binary ? 15_000 : 100_000),
    });
  } catch { throw new PracticeApiError('The server could not be reached. Your local drafts are kept; reconnect and try again.'); }
  const value: unknown = await response.json().catch(() => null);
  if (!value || typeof value !== 'object') throw new PracticeApiError('The practice server returned an unreadable response. Please try again.');
  if (!response.ok) {
    const data = value as { error?: { message?: string }; session?: PracticeSession };
    throw new PracticeApiError(data.error?.message ?? 'The request could not be completed. Please try again.', data.session, response.status);
  }
  return value as T;
}

const path = (id: string) => `/sessions/${encodeURIComponent(id)}`;
export const loadIntegrationHealth = () => request<IntegrationHealth>('/health', 'GET');
/** Saved sessions for the signed-in learner (the account token is attached automatically). */
export const listMySessions = () => request<{ sessions: SessionSummary[] }>('/me/sessions', 'GET').then((result) => result.sessions);
export const resumeSavedSession = (id: string) => request<SessionAccess>(`${path(id)}/reopen`, 'POST', undefined, {});
export const practiceApi: PracticeService = {
  create: (input) => request<SessionAccess>('/sessions', 'POST', undefined, input),
  load: (id, token) => request<PracticeSession>(path(id), 'GET', token),
  update: (id, token, input) => request<PracticeSession>(path(id), 'PATCH', token, input),
  action: (id, token, action, input = {}) => request<PracticeSession>(`${path(id)}/${action}`, 'POST', token, input),
  voice: (id, token) => request<VoiceCredentials>(`${path(id)}/voice`, 'POST', token, {}),
  review: (id, token, regenerate) => request<PracticeSession>(`${path(id)}/review`, 'POST', token, regenerate ? { regenerate: true } : {}),
  registerConversation: (id, token, conversationId) => request<PracticeSession>(`${path(id)}/conversations`, 'POST', token, { conversationId }),
  finalizeConversation: (id, token, conversationId) => request<PracticeSession>(`${path(id)}/conversations/${encodeURIComponent(conversationId)}/finalize`, 'POST', token, {}),
  remove: (id, token) => request<{ deleted: true }>(path(id), 'DELETE', token),
  startTextConversation: (id, token) => request<PracticeSession>(`${path(id)}/conversations/text`, 'POST', token, {}),
  startMonitoring: (id, token, purpose) => request<PracticeSession>(`${path(id)}/monitoring`, 'POST', token, { purpose }),
  sendFrames: (id, token, windowId, frames, width, height, captureFps, encoding) => request<MonitoringStatus>(`${path(id)}/monitoring/${encodeURIComponent(windowId)}/frames?w=${width}&h=${height}${captureFps ? `&cfps=${captureFps.toFixed(1)}` : ''}${encoding === 'jpeg' ? '&enc=jpeg' : ''}`, 'POST', token, frames),
  stopMonitoring: (id, token, windowId, reason) => request<{ status: MonitoringStatus; session: PracticeSession }>(`${path(id)}/monitoring/${encodeURIComponent(windowId)}/stop`, 'POST', token, reason ? { reason } : {}),
  sendTextMessage: (id, token, conversationId, text) => request<PracticeSession>(`${path(id)}/conversations/${encodeURIComponent(conversationId)}/messages`, 'POST', token, text === undefined ? {} : { text }),
};
