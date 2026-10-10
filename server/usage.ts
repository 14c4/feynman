/*
 * Lightweight provider observability. Records counts, latency, token usage and an optional
 * cost estimate per provider operation. Never records prompts, answers, study material,
 * transcripts, keys or signed URLs: only numbers, operation names and HTTP status codes.
 */

export interface TokenUsage { input: number; output: number; thinking: number; cached: number }
export interface UsageEvent {
  provider: 'gemini' | 'elevenlabs';
  operation: string;
  ok: boolean;
  status?: number;
  latencyMs: number;
  tokens?: TokenUsage;
  /** ElevenLabs: billed conversation length, when the provider reports it. */
  seconds?: number;
  /** Requests answered locally without calling the provider (cache, dedupe, quota block). */
  avoided?: 'cache' | 'dedupe' | 'quota_block' | 'throttle';
}
interface Bucket { requests: number; failures: number; rateLimited: number; avoided: number; latencyMs: number; tokens: TokenUsage; seconds: number }

const empty = (): Bucket => ({ requests: 0, failures: 0, rateLimited: 0, avoided: 0, latencyMs: 0, tokens: { input: 0, output: 0, thinking: 0, cached: 0 }, seconds: 0 });

/** Gemini daily quotas reset at midnight Pacific time. */
export function pacificDay(now = Date.now()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date(now));
}

export class UsageTracker {
  private buckets = new Map<string, Bucket>();
  private day = pacificDay();
  private geminiToday = 0;
  constructor(private readonly env: NodeJS.ProcessEnv = process.env, private readonly log: (line: string) => void = (line) => console.info(line)) {}

  record(event: UsageEvent) {
    const key = `${event.provider}:${event.operation}`;
    const bucket = this.buckets.get(key) ?? empty();
    if (event.avoided) bucket.avoided++;
    else {
      bucket.requests++; bucket.latencyMs += event.latencyMs;
      if (!event.ok) bucket.failures++;
      if (event.status === 429) bucket.rateLimited++;
      if (event.seconds) bucket.seconds += event.seconds;
      if (event.tokens) for (const name of ['input', 'output', 'thinking', 'cached'] as const) bucket.tokens[name] += event.tokens[name];
      if (event.provider === 'gemini') { if (pacificDay() !== this.day) { this.day = pacificDay(); this.geminiToday = 0; } this.geminiToday++; }
    }
    this.buckets.set(key, bucket);
    const tokens = event.tokens ? ` in=${event.tokens.input} out=${event.tokens.output} think=${event.tokens.thinking} cached=${event.tokens.cached}` : '';
    this.log(`[usage] ${key} ${event.avoided ? `avoided:${event.avoided}` : `${event.ok ? 'ok' : `fail${event.status ? ` ${event.status}` : ''}`} ${Math.round(event.latencyMs)}ms${tokens}`}`);
  }

  /** Aggregate numbers only; safe to expose to the operator. */
  snapshot() {
    const price = (name: string) => { const value = Number(this.env[name]); return Number.isFinite(value) && value > 0 ? value : undefined; };
    const inputPrice = price('GEMINI_PRICE_INPUT_PER_M'); const outputPrice = price('GEMINI_PRICE_OUTPUT_PER_M');
    const operations = Object.fromEntries([...this.buckets].map(([key, bucket]) => {
      const cost = key.startsWith('gemini:') && inputPrice !== undefined && outputPrice !== undefined
        // Estimate only: thinking tokens bill as output; cached input is counted at the full rate (conservative).
        ? Math.round(((bucket.tokens.input * inputPrice + (bucket.tokens.output + bucket.tokens.thinking) * outputPrice) / 1e6) * 1e6) / 1e6 : undefined;
      return [key, { ...bucket, avgLatencyMs: bucket.requests ? Math.round(bucket.latencyMs / bucket.requests) : 0, estimatedCostUsd: cost }];
    }));
    const limit = price('GEMINI_DAILY_REQUEST_LIMIT');
    return { geminiRequestsToday: this.geminiToday, geminiDailyLimit: limit, quotaDay: this.day, operations };
  }
}
