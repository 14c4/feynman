import type { IncomingMessage } from 'node:http';

/*
 * Basic per-client abuse protection for a single API process. Counts are kept in memory, so they
 * reset on restart and are not shared between replicas. Provider-backed routes get tighter limits
 * than ordinary reads and draft saves; camera frame uploads get their own generous bucket.
 */

export interface RateRule { limit: number; windowMs: number }
export type RateBucket = 'create' | 'provider' | 'voice' | 'frames' | 'api';

const MINUTE = 60_000;
export const DEFAULT_RULES: Record<RateBucket, RateRule> = {
  /** New sessions (each may upload up to 8 MB and later spends Gemini requests). */
  create: { limit: 20, windowMs: 60 * MINUTE },
  /** Gemini-backed or provider-checking operations: prepare, submit, Alex replies, transcript checks. */
  provider: { limit: 60, windowMs: 10 * MINUTE },
  /** ElevenLabs signed URLs; each one can start a billed voice call. */
  voice: { limit: 12, windowMs: 10 * MINUTE },
  /** Camera frame batches are sent back-to-back while monitoring is on. */
  frames: { limit: 3000, windowMs: MINUTE },
  /** Everything else under /api (loads, draft saves, health). */
  api: { limit: 300, windowMs: MINUTE },
};

/** Which bucket a request counts against. */
export function bucketFor(method: string | undefined, path: string): RateBucket {
  if (method !== 'POST') return 'api';
  if (path === '/api/sessions') return 'create';
  if (/\/monitoring\/[0-9a-f-]{36}\/frames$/i.test(path)) return 'frames';
  if (/\/voice$/.test(path)) return 'voice';
  if (/\/(prepare|submit)$/.test(path) || /\/conversations\/[A-Za-z0-9_-]{1,128}\/(messages|finalize)$/.test(path)) return 'provider';
  return 'api';
}

/**
 * The client address. Behind a reverse proxy (Railway, Fly, Render…) the socket address is the
 * proxy, so with `trustProxy` the last X-Forwarded-For entry (the one the proxy appended) is used.
 */
export function clientAddress(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    const value = Array.isArray(forwarded) ? forwarded.join(',') : forwarded;
    const last = value?.split(',').map((item) => item.trim()).filter(Boolean).at(-1);
    if (last && last.length <= 64) return last;
  }
  return req.socket.remoteAddress ?? 'unknown';
}

export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();
  private lastPrune = 0;
  constructor(private readonly rules: Record<RateBucket, RateRule> = DEFAULT_RULES, private readonly clock: () => number = Date.now) {}

  /** Counts one request; returns how long to wait when the client is over the limit. */
  hit(client: string, bucket: RateBucket): { ok: true } | { ok: false; retryAfterMs: number } {
    const now = this.clock(); const rule = this.rules[bucket]; const key = `${bucket}:${client}`;
    if (now - this.lastPrune > MINUTE) { this.lastPrune = now; for (const [name, entry] of this.hits) if (entry.resetAt <= now) this.hits.delete(name); }
    let entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) { entry = { count: 0, resetAt: now + rule.windowMs }; this.hits.set(key, entry); }
    if (entry.count >= rule.limit) return { ok: false, retryAfterMs: entry.resetAt - now };
    entry.count++;
    return { ok: true };
  }
}

/** Rate limiting is on in production and opt-in elsewhere; `RATE_LIMIT=off` disables it explicitly. */
export function rateLimitEnabled(env: NodeJS.ProcessEnv): boolean {
  if (env.RATE_LIMIT === 'off') return false;
  return env.RATE_LIMIT === 'on' || env.NODE_ENV === 'production';
}

export const positiveInteger = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};
