import { randomUUID } from 'node:crypto';
import type { MonitoringPurpose, MonitoringStatus, MonitoringWindow, PhysiologyHealth, PhysiologySample, PhysiologySource, PipelineStats, QualityNote } from '../shared/types.js';
import { MONITORING_LIMITS as LIMITS } from '../shared/types.js';
import { PracticeError } from './domain.js';
import { assertDevelopmentMode } from './developmentProviders.js';

/**
 * Optional camera monitoring.
 *
 * Presage SmartSpectra has no browser SDK; its supported JavaScript runtime is the Node SDK
 * (`@smartspectra/node-sdk`, native runtime loaded via koffi). The browser therefore captures
 * small RGB frames, posts them here, and this module feeds them to the SDK with
 * `useCustomInput()` + `sendFrame()`. Frames are processed in memory and dropped; only
 * downsampled readings with their quality indicators are kept.
 *
 * `PHYSIOLOGY_SOURCE=simulated` (development/test only) replaces the SDK with a deterministic
 * generator. Every simulated window and sample is labeled `source: 'simulated'`.
 */

const PRESAGE_PACKAGE = '@smartspectra/node-sdk';
const SAMPLE_SPACING_MS = 1000;
const QUALITY_NOTES_CAP = 200;

/** The parts of the SmartSpectra Node SDK this module uses (see docs/nodejs/api-reference). */
interface PresageSdk {
  useCustomInput(transform?: number): unknown;
  start(): void;
  stopAsync?(): Promise<void>;
  stop(): void;
  destroy(): Promise<void>;
  sendFrame(buffer: Uint8Array, width: number, height: number, stride: number, pixelFormat: number, timestampUs: number): boolean;
  on(event: string, callback: (...args: never[]) => void): unknown;
}
export interface PresageModule {
  SmartSpectraSDK: new (options: { apiKey: string; requestedMetrics?: number[]; logLevel?: number }) => PresageSdk;
  decodeMetrics?: (buffer: Buffer) => unknown;
  breathingMetrics?: number[];
  cardioMetrics?: number[];
}
type ModuleLoader = () => Promise<PresageModule>;

// Wire values from the SDK's ValidationCode enum. Unknown codes are kept as numbers.
const VALIDATION_CODES: Record<number, string> = {
  0: 'OK', 1: 'NO_FACE_FOUND', 2: 'MULTIPLE_FACES_FOUND', 3: 'FACE_NOT_CENTERED', 4: 'FACE_SIZE_OUT_OF_RANGE', 5: 'TOO_DARK', 6: 'TOO_BRIGHT',
  7: 'CHEST_NOT_VISIBLE', 10: 'CAMERA_TUNING', 11: 'FRAME_RATE_TOO_LOW', 12: 'EXCESSIVE_MOTION', 13: 'FACE_TOO_CLOSE', 14: 'FACE_TOO_FAR',
  15: 'FACE_TOO_HIGH', 16: 'FACE_TOO_LOW', 17: 'FACE_NOT_FORWARD',
};
const PIXEL_FORMAT_RGB = 0;
const FRAME_TRANSFORM_NONE = 0;
const PULSE_RATE = 15;
const PROCESSING_STATUS_ERROR = 5;
const SDK_REPORT_GRACE_MS = 1500;
/** Plain explanations for SmartSpectraErrorCode values the learner can act on (or report). */
const SDK_FAILURES: Record<number, string> = {
  2: 'Presage rejected the API key.',
  4: 'The Presage account has no remaining credits.',
  5: 'The server could not reach Presage to verify the API key (network or TLS error).',
  6: 'Presage’s service returned an error.',
};
const BREATHING_RATE = 2;

interface Reading { metric: PhysiologySample['metric']; value: number; confidence: number; stable: boolean; atMs: number }
interface Live {
  sessionId: string;
  window: MonitoringWindow;
  lastActivity: number;
  /** Epoch ms of the first frame (Presage) or window start (simulated); warm-up is measured from here. */
  originMs?: number;
  lastFrameUs: number;
  lastMetricUs: Record<PhysiologySample['metric'], number>;
  readings: Reading[];
  notes: QualityNote[];
  lastCode?: string;
  hint?: string;
  failure?: string;
  /** Last error the SDK reported, used to explain a later terminal state. */
  lastError?: string;
  /** sendFrame threw; the window closes shortly, once the SDK has delivered its own reason. */
  sendError?: string;
  failing?: boolean;
  sdk?: PresageSdk;
  /** Simulated: seconds already emitted. */
  emitted?: number;
  /** Capture times (ms) of recently accepted frames, for the delivered rate. */
  accepted: number[];
  /** Capture times (ms) of frames Presage reported consuming. */
  consumed: number[];
  stats: PipelineStats;
}

const RATE_WINDOW_MS = 4000;
/** Frames per second over a rolling window of timestamps (ms); prunes old entries in place. */
export function rollingFps(times: number[], now: number, windowMs = RATE_WINDOW_MS): number | undefined {
  while (times.length && now - times[0]! > windowMs) times.shift();
  if (times.length < 5) return undefined;
  const span = times[times.length - 1]! - times[0]!;
  return span > 0 ? Math.round(((times.length - 1) * 1000 / span) * 10) / 10 : undefined;
}

const toNumber = (value: unknown): number => {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (value && typeof value === 'object' && 'toString' in value) return Number(String(value));
  return Number(value);
};

/** Applies Presage's published reliability rules: warm-up window, stability, confidence threshold and valid range. */
export function isValidReading(metric: PhysiologySample['metric'], value: number, confidence: number, stable: boolean, sinceOriginMs: number): boolean {
  const [low, high] = metric === 'pulse' ? LIMITS.pulseRange : LIMITS.breathingRange;
  const warmup = metric === 'pulse' ? LIMITS.pulseWarmupMs : LIMITS.breathingWarmupMs;
  const threshold = metric === 'pulse' ? LIMITS.pulseMinConfidence : LIMITS.breathingMinConfidence;
  return Number.isFinite(value) && stable && confidence >= threshold && sinceOriginMs >= warmup && value >= low && value <= high;
}

/** Extracts pulse and breathing rate readings from a decoded Metrics message (camelCase protobuf fields). */
export function readingsFromMetrics(decoded: unknown): Reading[] {
  if (!decoded || typeof decoded !== 'object') return [];
  const data = decoded as { cardio?: { pulseRate?: unknown[] }; breathing?: { rate?: unknown[] } };
  const pick = (metric: Reading['metric'], list: unknown[] | undefined): Reading[] => (Array.isArray(list) ? list : []).flatMap((item) => {
    const row = item as { value?: unknown; confidence?: unknown; stable?: unknown; timestamp?: unknown };
    const value = toNumber(row.value); const timestampUs = toNumber(row.timestamp);
    if (!Number.isFinite(value) || !Number.isFinite(timestampUs) || timestampUs <= 0) return [];
    return [{ metric, value, confidence: Math.max(0, Math.min(100, toNumber(row.confidence) || 0)), stable: row.stable === true, atMs: timestampUs / 1000 }];
  });
  return [...pick('pulse', data.cardio?.pulseRate), ...pick('breathing', data.breathing?.rate)];
}

/** Deterministic, obviously-synthetic values for development. Never used outside development/test. */
function simulatedReadings(second: number, originMs: number): Reading[] {
  const atMs = originMs + second * 1000;
  // A short simulated motion episode exercises the invalid/gap handling in the UI.
  const moving = second % 90 >= 40 && second % 90 < 46;
  const ramp = (warmupS: number) => Math.min(85, Math.round((second / warmupS) * 60 + (second > warmupS ? 25 : 0)));
  return [
    { metric: 'pulse', value: Math.round((72 + 5 * Math.sin(second / 25) + 2 * Math.sin(second / 7)) * 10) / 10, confidence: moving ? 20 : ramp(12), stable: !moving, atMs },
    { metric: 'breathing', value: Math.round((14 + 2 * Math.sin(second / 40)) * 10) / 10, confidence: moving ? 20 : ramp(30), stable: !moving, atMs },
  ];
}

export interface MonitoringOptions { env?: NodeJS.ProcessEnv; loadPresage?: ModuleLoader; /** Server-wide cap on concurrently active windows (each runs a native Presage pipeline). */ maxActive?: number }

export class MonitoringService {
  private readonly windows = new Map<string, MonitoringWindow[]>();
  private readonly live = new Map<string, Live>();
  private readonly env: NodeJS.ProcessEnv;
  private readonly source: PhysiologySource;
  private readonly loadPresage: ModuleLoader;
  private presage?: Promise<PresageModule>;
  private readonly sweeper: ReturnType<typeof setInterval>;
  private readonly maxActive?: number;

  constructor(options: MonitoringOptions = {}) {
    this.env = options.env ?? process.env;
    this.maxActive = options.maxActive;
    const configured = this.env.PHYSIOLOGY_SOURCE || 'presage';
    if (configured !== 'presage' && configured !== 'simulated') throw new Error('PHYSIOLOGY_SOURCE must be presage or simulated.');
    if (configured === 'simulated') assertDevelopmentMode(this.env);
    this.source = configured;
    this.loadPresage = options.loadPresage ?? (async () => {
      const name = PRESAGE_PACKAGE;
      const module = (await import(name)) as PresageModule & { default?: PresageModule };
      const sdk = module.SmartSpectraSDK ? module : module.default;
      if (!sdk?.SmartSpectraSDK) throw new Error('SmartSpectra SDK export not found.');
      // The /messages entry registers the protobuf class so metrics decode to objects.
      try { const messages = (await import(`${name}/messages`)) as { decodeMetrics?: PresageModule['decodeMetrics'] }; if (messages.decodeMetrics) return { ...sdk, decodeMetrics: messages.decodeMetrics }; } catch { /* fall back to the main export */ }
      return sdk;
    });
    this.sweeper = setInterval(() => this.sweep(), 5000);
    this.sweeper.unref?.();
  }

  async health(): Promise<PhysiologyHealth> {
    if (this.source === 'simulated') return { source: 'simulated', available: true };
    if (!this.env.PRESAGE_API_KEY) return { source: 'presage', available: false, reason: 'Camera insights need a Presage API key on the server (PRESAGE_API_KEY).' };
    try { await this.module(); return { source: 'presage', available: true }; }
    catch { return { source: 'presage', available: false, reason: `The Presage SmartSpectra SDK is not installed on the server (npm install ${PRESAGE_PACKAGE}) or does not support this platform.` }; }
  }

  list(sessionId: string): MonitoringWindow[] | undefined {
    this.sweep();
    const list = this.windows.get(sessionId);
    return list?.length ? structuredClone(list) : undefined;
  }

  async start(sessionId: string, purpose: unknown): Promise<MonitoringWindow> {
    const purposes: MonitoringPurpose[] = ['before_assessment', 'after_teaching', 'after_reassessment', 'in_session'];
    if (typeof purpose !== 'string' || !purposes.includes(purpose as MonitoringPurpose)) throw new PracticeError('Choose a valid monitoring window.');
    const health = await this.health();
    if (!health.available) throw new PracticeError(health.reason ?? 'Camera insights are unavailable.', 503, 'MONITORING_UNAVAILABLE');
    for (const item of this.live.values()) if (item.sessionId === sessionId) await this.finish(item, 'ended', 'A new monitoring window started.');
    this.sweep();
    if (this.maxActive && [...this.live.values()].filter((item) => item.window.status === 'active').length >= this.maxActive) throw new PracticeError('Camera insights are at capacity on the server right now. Your session continues without them; try again in a few minutes.', 503, 'MONITORING_BUSY');
    const window: MonitoringWindow = { id: randomUUID(), source: this.source, purpose: purpose as MonitoringPurpose, startedAt: new Date().toISOString(), status: 'active', framesReceived: 0, samples: [], quality: [] };
    const live: Live = { sessionId, window, lastActivity: Date.now(), lastFrameUs: 0, lastMetricUs: { pulse: 0, breathing: 0 }, readings: [], notes: [], accepted: [], consumed: [], stats: { outOfOrder: 0, notProcessed: 0 } };
    if (this.source === 'simulated') { live.originMs = Date.now(); live.emitted = 0; }
    else await this.startPresage(live);
    this.live.set(window.id, live);
    const list = this.windows.get(sessionId) ?? [];
    list.push(window); this.windows.set(sessionId, list);
    return structuredClone(window);
  }

  /**
   * Accepts a batch of frames: `count` × [float64 LE capture timestamp in epoch µs, width×height×3 RGB bytes].
   * Simulated windows accept an empty body as a heartbeat.
   */
  ingest(sessionId: string, windowId: string, body: Buffer, width: number, height: number, captureFps?: number): MonitoringStatus {
    const live = this.owned(sessionId, windowId);
    live.lastActivity = Date.now();
    // The browser's own measurement from capture timestamps; kept for diagnosis only.
    if (captureFps !== undefined && Number.isFinite(captureFps) && captureFps > 0 && captureFps <= 120) live.stats.captureFps = Math.round(captureFps * 10) / 10;
    if (live.window.status === 'active' && this.source === 'presage') {
      if (!Number.isInteger(width) || !Number.isInteger(height) || width < 64 || height < 64 || width > LIMITS.maxWidth || height > LIMITS.maxHeight) throw new PracticeError('Frame size is invalid.');
      live.stats.width = width; live.stats.height = height;
      const frameBytes = width * height * 3; const stride = 8 + frameBytes;
      if (!body.length || body.length % stride !== 0) throw new PracticeError('Frame batch is malformed.');
      for (let offset = 0; offset < body.length; offset += stride) {
        if (live.sendError) break;
        const timestampUs = Math.round(body.readDoubleLE(offset));
        // The SDK rejects non-monotonic timestamps; late or duplicate frames are dropped.
        if (!Number.isFinite(timestampUs) || timestampUs <= live.lastFrameUs) { live.stats.outOfOrder++; continue; }
        live.lastFrameUs = timestampUs; live.originMs ??= timestampUs / 1000;
        try { live.sdk?.sendFrame(body.subarray(offset + 8, offset + stride), width, height, width * 3, PIXEL_FORMAT_RGB, timestampUs); live.window.framesReceived++; live.accepted.push(timestampUs / 1000); }
        catch (error) { live.sendError = error instanceof Error ? error.message : 'Frame processing failed.'; break; }
      }
    } else if (live.window.status === 'active' && live.emitted !== undefined && live.originMs !== undefined) {
      const elapsed = Math.floor((Date.now() - live.originMs) / 1000);
      for (; live.emitted <= elapsed; live.emitted++) live.readings.push(...simulatedReadings(live.emitted, live.originMs));
      live.window.framesReceived++;
    }
    this.drain(live);
    if (live.failure && live.window.status === 'active') void this.finish(live, 'error', live.failure);
    else if (live.sendError && live.window.status === 'active') this.failAfterSdkReport(live);
    return this.status(live);
  }

  async stop(sessionId: string, windowId: string, reason?: unknown): Promise<MonitoringStatus> {
    const live = this.owned(sessionId, windowId);
    // The browser may stop a window because the camera could not keep a usable frame rate.
    const slow = reason === 'camera_too_slow';
    if (live.window.status === 'active') await this.finish(live, slow ? 'error' : 'ended', slow
      ? `The camera could not keep a frame rate Presage can measure reliably${live.stats.captureFps ? ` (about ${Math.round(live.stats.captureFps)} fps)` : ''}. No readings were invented; your session continues without camera insights.`
      : 'Stopped by the learner.');
    return this.status(live);
  }

  delete(sessionId: string) {
    for (const item of [...this.live.values()]) if (item.sessionId === sessionId) void this.finish(item, 'ended', 'Session deleted.');
    this.windows.delete(sessionId);
    for (const [id, item] of this.live) if (item.sessionId === sessionId) this.live.delete(id);
  }

  close() { clearInterval(this.sweeper); for (const item of this.live.values()) void this.finish(item, 'ended', 'Server stopped.'); }

  private module() { this.presage ??= this.loadPresage().catch((error: unknown) => { this.presage = undefined; throw error; }); return this.presage; }

  private async startPresage(live: Live) {
    const sdkModule = await this.module();
    const requested = [...(sdkModule.breathingMetrics ?? [BREATHING_RATE]), ...(sdkModule.cardioMetrics ?? [PULSE_RATE])];
    const sdk = new sdkModule.SmartSpectraSDK({ apiKey: this.env.PRESAGE_API_KEY ?? '', requestedMetrics: [...new Set(requested)] });
    sdk.on('metrics', ((buffer: Buffer) => {
      const decoded = sdkModule.decodeMetrics ? sdkModule.decodeMetrics(buffer) : undefined;
      if (!decoded || Buffer.isBuffer(decoded)) return;
      for (const reading of readingsFromMetrics(decoded)) {
        const timestampUs = reading.atMs * 1000;
        if (timestampUs <= live.lastMetricUs[reading.metric]) continue;
        live.lastMetricUs[reading.metric] = timestampUs; live.readings.push(reading);
      }
    }) as (...args: never[]) => void);
    sdk.on('validationStatus', ((code: number, timestampUs: number, hint: string) => {
      const name = VALIDATION_CODES[code] ?? `CODE_${code}`;
      const at = Number.isFinite(timestampUs) && timestampUs > 0 ? new Date(timestampUs / 1000).toISOString() : new Date().toISOString();
      live.notes.push({ at, code: name, hint: typeof hint === 'string' ? hint.slice(0, 200) : '' });
    }) as (...args: never[]) => void);
    // Presage's own report of whether each frame entered processing: the true processing rate.
    sdk.on('frameSentThrough', ((sent: boolean, timestampUs: number) => { if (sent && Number.isFinite(timestampUs)) live.consumed.push(timestampUs / 1000); else if (!sent) live.stats.notProcessed++; }) as (...args: never[]) => void);
    sdk.on('error', ((code: number, message: string, retryable: boolean) => {
      const detail = typeof message === 'string' ? message.slice(0, 200) : '';
      live.notes.push({ at: new Date().toISOString(), code: `ERROR_${code}`, hint: detail || 'Processing error.' });
      live.lastError = SDK_FAILURES[code] ?? (detail || 'Presage processing stopped.');
      console.warn(`[presage] window ${live.window.id}: SDK error ${code}${retryable ? ' (retryable)' : ''}: ${detail}`);
      if (!retryable) live.failure = live.lastError;
    }) as (...args: never[]) => void);
    // A retryable error can still leave the pipeline in its error state (e.g. the key could not be verified).
    sdk.on('processingStatus', ((status: number) => { if (status === PROCESSING_STATUS_ERROR) live.failure ??= live.lastError ?? 'Presage processing stopped.'; }) as (...args: never[]) => void);
    sdk.useCustomInput(FRAME_TRANSFORM_NONE);
    sdk.start();
    live.sdk = sdk;
  }

  /**
   * A rejected frame usually follows an SDK error (bad key, no network) whose event arrives
   * moments later. Waiting briefly lets the learner see that reason instead of a generic state error.
   */
  private failAfterSdkReport(live: Live) {
    if (live.failing) return;
    live.failing = true;
    const timer = setTimeout(() => { if (live.window.status === 'active') void this.finish(live, 'error', live.failure ?? live.lastError ?? live.sendError ?? 'Presage processing stopped.'); }, SDK_REPORT_GRACE_MS);
    timer.unref?.();
  }

  private drain(live: Live) {
    const window = live.window;
    for (const note of live.notes.splice(0)) {
      // Only changes are kept, so a flickering borderline status does not flood the timeline.
      if (note.code === live.lastCode) continue;
      live.lastCode = note.code; live.hint = note.code === 'OK' ? undefined : note.hint;
      if (window.quality.length < QUALITY_NOTES_CAP) window.quality.push(note);
    }
    for (const reading of live.readings.splice(0).sort((a, b) => a.atMs - b.atMs)) {
      const sample: PhysiologySample = {
        at: new Date(reading.atMs).toISOString(), metric: reading.metric, value: Math.round(reading.value * 10) / 10,
        confidence: Math.round(reading.confidence), stable: reading.stable,
        valid: isValidReading(reading.metric, reading.value, reading.confidence, reading.stable, reading.atMs - (live.originMs ?? reading.atMs)),
      };
      // Keep at most one reading per metric per second (the latest).
      const previous = [...window.samples].reverse().find((item) => item.metric === sample.metric);
      if (previous && Date.parse(sample.at) - Date.parse(previous.at) < SAMPLE_SPACING_MS) Object.assign(previous, sample);
      else if (window.samples.length < LIMITS.maxSamplesPerWindow) window.samples.push(sample);
    }
  }

  private status(live: Live): MonitoringStatus {
    const latest = (metric: PhysiologySample['metric']) => [...live.window.samples].reverse().find((item) => item.metric === metric);
    if (this.source === 'presage') {
      if (live.window.status === 'active') {
        live.stats.deliveredFps = rollingFps(live.accepted, live.accepted.at(-1) ?? 0);
        live.stats.processedFps = rollingFps(live.consumed, live.consumed.at(-1) ?? 0);
      }
      live.window.pipeline = { ...live.stats };
    }
    return { window: structuredClone(live.window), hint: live.hint, code: live.lastCode, latest: { pulse: latest('pulse'), breathing: latest('breathing') }, pipeline: live.window.pipeline };
  }

  private owned(sessionId: string, windowId: string): Live {
    const live = this.live.get(windowId);
    if (!live || live.sessionId !== sessionId) throw new PracticeError('Monitoring window not found.', 404, 'NOT_FOUND');
    return live;
  }

  private async finish(live: Live, status: 'ended' | 'error', reason: string) {
    if (live.window.status !== 'active') return;
    this.drain(live);
    live.window.status = status; live.window.endedAt = new Date().toISOString(); live.window.endReason = reason;
    if (status === 'error') console.warn(`[presage] window ${live.window.id} ended with an error after ${live.window.framesReceived} frames: ${reason}`);
    const sdk = live.sdk; live.sdk = undefined;
    if (sdk) { try { if (sdk.stopAsync) await sdk.stopAsync(); else sdk.stop(); } catch { /* already stopped */ } try { await sdk.destroy(); } catch { /* already released */ } }
  }

  private sweep() {
    const cutoff = Date.now() - LIMITS.idleMs;
    for (const live of this.live.values()) if (live.window.status === 'active' && live.lastActivity < cutoff) void this.finish(live, 'ended', 'No frames arrived (tab closed, refreshed or disconnected).');
  }
}
