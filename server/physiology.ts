import { randomUUID } from 'node:crypto';
import jpeg from 'jpeg-js';
import type { FrameEncoding, MonitoringPurpose, MonitoringStatus, MonitoringWindow, PhysiologyHealth, PhysiologySample, PhysiologySource, PipelineStats, PresageFace, PresageLiveState, PresageProcessing, QualityNote } from '../shared/types.js';
import { MONITORING_LIMITS as LIMITS } from '../shared/types.js';
import { PracticeError } from './domain.js';
import { assertDevelopmentMode } from './developmentProviders.js';

/**
 * Optional camera monitoring.
 *
 * Presage SmartSpectra has no browser SDK; its supported JavaScript runtime is the Node SDK
 * (`@smartspectra/node-sdk`, native runtime loaded via koffi). The browser therefore captures
 * small RGB frames, posts them here, and this module feeds them to the SDK with
 * `useCustomInput()` + `sendFrame()`. Frames arrive as raw RGB (same machine) or high-quality
 * JPEG (remote servers, roughly 15× less upload) and are decoded here. Frames are processed in
 * memory and dropped; only downsampled readings with their quality indicators are kept.
 *
 * Only pulse (and HRV) is kept: it needs nothing but the face, so the learner can sit naturally.
 * The SDK is still configured with its documented breathing + cardio bundles (every Presage example
 * includes breathing, and a cardio-only graph is undocumented), but breathing readings are
 * discarded and its chest-visibility warnings are never shown. The SDK's face metrics (landmarks, blinking, talking) are
 * requested so the learner can see that Presage itself has locked onto their face. Expression
 * metrics are deliberately not requested: the app does not interpret expressions.
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
  breathingMetrics?: readonly number[];
  cardioMetrics?: readonly number[];
  faceMetrics?: readonly number[];
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
const REJECT_NOTE_AFTER = 5;
const REJECT_FAIL_AFTER = 60;
/** Plain explanations for SmartSpectraErrorCode values the learner can act on (or report). */
const SDK_FAILURES: Record<number, string> = {
  2: 'Presage rejected the API key.',
  4: 'The Presage account has no remaining credits.',
  5: 'The server could not reach Presage to verify the API key (network or TLS error).',
  6: 'Presage’s service returned an error.',
};
/** Account problems a new window cannot fix; the browser stops retrying when a window ends with one. */
const FATAL_SDK_ERRORS = new Set([2, 4]);
const BREATHING_RATE = 2;
const HRV = 17;
/**
 * Part of the SDK's cardio bundle, but its model (phasic-bp-inference) needs a Vulkan GPU. On a
 * server without one it fails to load, and Presage processing later fails (error 8). The app
 * never shows it, so it is never requested.
 */
const ARTERIAL_PRESSURE_TRACE = 16;
const EXPRESSIONS = 14;
const PROCESSING: Record<number, PresageProcessing> = { 0: 'uninitialized', 1: 'idle', 2: 'starting', 3: 'running', 4: 'stopping', 5: 'error' };
const HRV_MIN_CONFIDENCE = 50;
const FACE_POINTS_MAX = 96;
const BLINK_WINDOW_MS = 60_000;

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
  /** The SDK reported an error retrying cannot fix (see FATAL_SDK_ERRORS). */
  fatal?: boolean;
  /** Last error the SDK reported, used to explain a later terminal state. */
  lastError?: string;
  /** sendFrame threw; the window closes shortly, once the SDK has delivered its own reason. */
  sendError?: string;
  failing?: boolean;
  /** Consecutive frames sendFrame() refused. */
  rejectedRun: number;
  sdk?: PresageSdk;
  /** Simulated: seconds already emitted. */
  emitted?: number;
  /** Capture times (ms) of recently accepted frames, for the delivered rate. */
  accepted: number[];
  /** Capture times (ms) of frames Presage reported consuming. */
  consumed: number[];
  stats: PipelineStats;
  presage: PresageLiveState;
  /** Capture times (ms) of blink onsets Presage reported, and the last blink state seen. */
  blinks: number[];
  lastBlink?: { atUs: number; detected: boolean };
  /** Capture time (ms) of the first face packet, so a blink rate is only given with enough data. */
  faceSinceMs?: number;
}

const RATE_WINDOW_MS = 4000;
/** Frames per second over a rolling window of timestamps (ms); prunes old entries in place. */
export function rollingFps(times: number[], now: number, windowMs = RATE_WINDOW_MS): number | undefined {
  while (times.length && now - times[0]! > windowMs) times.shift();
  if (times.length < 5) return undefined;
  const span = times[times.length - 1]! - times[0]!;
  return span > 0 ? Math.round(((times.length - 1) * 1000 / span) * 10) / 10 : undefined;
}

/**
 * ISO time for epoch milliseconds. Never throws: `new Date(x).toISOString()` throws a RangeError for
 * out-of-range values, and inside an SDK callback that would crash the whole server.
 */
export function isoAt(ms: number): string {
  const date = new Date(ms);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

const toNumber = (value: unknown): number => {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (value && typeof value === 'object' && 'toString' in value) return Number(String(value));
  return Number(value);
};

/** Applies Presage's published reliability rules: warm-up window, stability, confidence threshold and valid range. */
export function isValidReading(metric: PhysiologySample['metric'], value: number, confidence: number, stable: boolean, sinceOriginMs: number): boolean {
  if (metric !== 'pulse') return false;
  const [low, high] = LIMITS.pulseRange;
  return Number.isFinite(value) && stable && confidence >= LIMITS.pulseMinConfidence && sinceOriginMs >= LIMITS.pulseWarmupMs && value >= low && value <= high;
}

/** Extracts pulse readings from a decoded Metrics message (camelCase protobuf fields). */
export function readingsFromMetrics(decoded: unknown): Reading[] {
  if (!decoded || typeof decoded !== 'object') return [];
  const data = decoded as { cardio?: { pulseRate?: unknown[] } };
  const pick = (metric: Reading['metric'], list: unknown[] | undefined): Reading[] => (Array.isArray(list) ? list : []).flatMap((item) => {
    const row = item as { value?: unknown; confidence?: unknown; stable?: unknown; timestamp?: unknown };
    const value = toNumber(row.value); const timestampUs = toNumber(row.timestamp);
    if (!Number.isFinite(value) || !Number.isFinite(timestampUs) || timestampUs <= 0) return [];
    return [{ metric, value, confidence: Math.max(0, Math.min(100, toNumber(row.confidence) || 0)), stable: row.stable === true, atMs: timestampUs / 1000 }];
  });
  return pick('pulse', data.cardio?.pulseRate);
}

type Point = { x?: unknown; y?: unknown };
export type DetectionRow = { detected?: unknown; stable?: unknown; timestamp?: unknown };

/**
 * Reads Presage's face metrics. Landmark coordinates are documented only as floating-point 2D
 * points, so both pixel and already-normalized coordinates are accepted and normalized to 0–1
 * of the frame; anything that still falls well outside the frame is dropped rather than drawn
 * in the wrong place.
 */
export function faceFromMetrics(decoded: unknown, frameWidth?: number, frameHeight?: number): (Omit<PresageFace, 'blinksPerMinute'> & { blinkRows: DetectionRow[] }) | undefined {
  const face = (decoded as { face?: { landmarks?: { value?: Point[]; stable?: unknown; timestamp?: unknown }[]; blinking?: DetectionRow[]; talking?: DetectionRow[] } } | undefined)?.face;
  if (!face) return undefined;
  const blinkRows = Array.isArray(face.blinking) ? face.blinking : [];
  const talking = Array.isArray(face.talking) ? face.talking.at(-1) : undefined;
  const landmarks = Array.isArray(face.landmarks) ? face.landmarks.at(-1) : undefined;
  if (!landmarks && !blinkRows.length && !talking) return undefined;
  const raw = (landmarks?.value ?? []).map((point) => [toNumber(point.x), toNumber(point.y)] as [number, number]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  let points: [number, number][] | undefined;
  if (raw.length >= 3) {
    const max = Math.max(...raw.map(([x, y]) => Math.max(x, y)));
    if (max <= 1.5) points = raw;
    else if (frameWidth && frameHeight) points = raw.map(([x, y]) => [x / frameWidth, y / frameHeight]);
  }
  let box: PresageFace['box'];
  if (points) {
    const xs = points.map(([x]) => x); const ys = points.map(([, y]) => y);
    const x = Math.min(...xs); const y = Math.min(...ys); const w = Math.max(...xs) - x; const h = Math.max(...ys) - y;
    if (x > -0.2 && y > -0.2 && x + w < 1.2 && y + h < 1.2 && w > 0.02 && h > 0.02) box = { x, y, w, h }; else points = undefined;
  }
  const step = points && points.length > FACE_POINTS_MAX ? points.length / FACE_POINTS_MAX : 1;
  const sampled = points?.filter((_, index) => index % step < 1).map(([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000] as [number, number]);
  const stamp = toNumber(landmarks?.timestamp ?? blinkRows.at(-1)?.timestamp ?? talking?.timestamp);
  return {
    at: isoAt(Number.isFinite(stamp) && stamp > 0 ? stamp / 1000 : Date.now()),
    box, points: sampled, stable: landmarks?.stable === true,
    blinking: blinkRows.length ? blinkRows.at(-1)!.detected === true : undefined,
    talking: talking ? talking.detected === true : undefined,
    blinkRows,
  };
}

/** Latest HRV (RMSSD) estimate; valid only at Presage's published ±5 ms standard (confidence ≥ 50). */
export function hrvFromMetrics(decoded: unknown): PresageLiveState['hrv'] {
  const list = (decoded as { cardio?: { hrv?: { rmssd?: unknown; confidence?: unknown; timestamp?: unknown }[] } } | undefined)?.cardio?.hrv;
  const row = Array.isArray(list) ? list.at(-1) : undefined;
  if (!row) return undefined;
  const rmssd = toNumber(row.rmssd); const confidence = toNumber(row.confidence) || 0; const stamp = toNumber(row.timestamp);
  if (!Number.isFinite(rmssd) || rmssd <= 0) return undefined;
  return { rmssdMs: Math.round(rmssd), confidence: Math.round(confidence), valid: confidence >= HRV_MIN_CONFIDENCE && rmssd < 300, at: isoAt(Number.isFinite(stamp) && stamp > 0 ? stamp / 1000 : Date.now()) };
}

/** Deterministic, obviously-synthetic values for development. Never used outside development/test. */
function simulatedReadings(second: number, originMs: number): Reading[] {
  const atMs = originMs + second * 1000;
  // A short simulated motion episode exercises the invalid/gap handling in the UI.
  const moving = second % 90 >= 40 && second % 90 < 46;
  const ramp = (warmupS: number) => Math.min(85, Math.round((second / warmupS) * 60 + (second > warmupS ? 25 : 0)));
  return [
    { metric: 'pulse', value: Math.round((72 + 5 * Math.sin(second / 25) + 2 * Math.sin(second / 7)) * 10) / 10, confidence: moving ? 20 : ramp(12), stable: !moving, atMs },
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
  private decoderError?: string;
  private readonly sweeper: ReturnType<typeof setInterval>;
  private readonly maxActive?: number;
  /** SDK sessions still shutting down. SDK state is process-global: a new session must not start until these finish. */
  private readonly teardowns = new Set<Promise<void>>();
  private memoryLoggedAt = 0;

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
      try { const messages = (await import(`${name}/messages`)) as { decodeMetrics?: PresageModule['decodeMetrics'] }; if (messages.decodeMetrics) return { ...sdk, decodeMetrics: messages.decodeMetrics }; this.decoderError = 'The SDK messages entry has no decodeMetrics.'; }
      catch (error) { this.decoderError = `The SDK metrics decoder failed to load: ${error instanceof Error ? error.message.slice(0, 160) : 'unknown error'}`; console.warn(`[presage] ${this.decoderError}`); }
      // The main entry bundles the same decoder; use it before giving up.
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
    const live: Live = { sessionId, window, lastActivity: Date.now(), lastFrameUs: 0, lastMetricUs: { pulse: 0, breathing: 0 }, readings: [], notes: [], accepted: [], consumed: [], rejectedRun: 0, stats: { outOfOrder: 0, notProcessed: 0, received: 0, accepted: 0, rejected: 0, processed: 0 }, presage: { metricsPackets: 0, decodeErrors: 0 }, blinks: [] };
    if (this.source === 'simulated') { live.originMs = Date.now(); live.emitted = 0; }
    else await this.startPresage(live);
    this.live.set(window.id, live);
    const list = this.windows.get(sessionId) ?? [];
    list.push(window); this.windows.set(sessionId, list);
    return structuredClone(window);
  }

  /**
   * Accepts a batch of frames. `rgb`: `count` × [float64 LE capture timestamp in epoch µs, width×height×3 RGB bytes].
   * `jpeg`: `count` × [float64 LE timestamp, uint32 LE byte length, JPEG bytes], decoded here to RGB.
   * Simulated windows accept an empty body as a heartbeat.
   */
  ingest(sessionId: string, windowId: string, body: Buffer, width: number, height: number, captureFps?: number, encoding: FrameEncoding = 'rgb'): MonitoringStatus {
    const live = this.owned(sessionId, windowId);
    live.lastActivity = Date.now();
    // The browser's own measurement from capture timestamps; kept for diagnosis only.
    if (captureFps !== undefined && Number.isFinite(captureFps) && captureFps > 0 && captureFps <= 120) live.stats.captureFps = Math.round(captureFps * 10) / 10;
    if (live.window.status === 'active' && this.source === 'presage') {
      if (!Number.isInteger(width) || !Number.isInteger(height) || width < 64 || height < 64 || width > LIMITS.maxWidth || height > LIMITS.maxHeight) throw new PracticeError('Frame size is invalid.');
      for (const frame of encoding === 'jpeg' ? jpegFrames(body) : rgbFrames(body, width, height)) {
        if (live.sendError) break;
        const timestampUs = Math.round(frame.timestampUs);
        // The SDK rejects non-monotonic timestamps; late or duplicate frames are dropped before any decoding.
        if (!Number.isFinite(timestampUs) || timestampUs <= live.lastFrameUs) { live.stats.outOfOrder++; continue; }
        const image = frame.decode();
        if (image.width < 64 || image.height < 64 || image.width > LIMITS.maxWidth || image.height > LIMITS.maxHeight) throw new PracticeError('Frame size is invalid.');
        live.stats.width = image.width; live.stats.height = image.height;
        live.lastFrameUs = timestampUs; live.originMs ??= timestampUs / 1000;
        live.stats.received = (live.stats.received ?? 0) + 1;
        try {
          // true = the SDK queued the frame; false = refused (wrong state, bad timestamp or size). Neither means analysed.
          const taken = live.sdk?.sendFrame(image.rgb, image.width, image.height, image.width * 3, PIXEL_FORMAT_RGB, timestampUs);
          if (taken === false) { live.stats.rejected = (live.stats.rejected ?? 0) + 1; live.rejectedRun++; if (live.rejectedRun >= REJECT_FAIL_AFTER) { live.sendError = 'Presage kept refusing camera frames.'; break; } if (live.rejectedRun === REJECT_NOTE_AFTER) live.notes.push({ at: new Date().toISOString(), code: 'FRAMES_REJECTED', hint: 'Presage is refusing camera frames.' }); }
          else { live.rejectedRun = 0; live.stats.accepted = (live.stats.accepted ?? 0) + 1; live.window.framesReceived++; live.accepted.push(timestampUs / 1000); }
        }
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
    // Two SDK sessions must never overlap (an automatic restart can follow a stop within seconds).
    while (this.teardowns.size) await Promise.all(this.teardowns);
    // Face metrics cost extra SDK processing and the app does not display them, so they are opt-in (PRESAGE_FACE_METRICS=on).
    const face = this.env.PRESAGE_FACE_METRICS !== 'on' ? [] : (sdkModule.faceMetrics ?? []).filter((metric) => metric !== EXPRESSIONS);
    // Default: the documented bundle known to produce pulse readings (it needs the upper chest in view);
    // breathing output is discarded in readingsFromMetrics. PRESAGE_METRICS=pulse is an experiment:
    // a cardio-only graph that may need only the face, but is undocumented by Presage.
    const pulseOnly = this.env.PRESAGE_METRICS === 'pulse';
    const cardio = (sdkModule.cardioMetrics ?? [PULSE_RATE, HRV]).filter((metric) => metric !== ARTERIAL_PRESSURE_TRACE);
    const requested = pulseOnly ? [PULSE_RATE, HRV, ...face] : [...(sdkModule.breathingMetrics ?? [BREATHING_RATE]), ...cardio, ...face];
    const sdk = new sdkModule.SmartSpectraSDK({ apiKey: this.env.PRESAGE_API_KEY ?? '', requestedMetrics: [...new Set(requested)] });
    live.presage.decoder = sdkModule.decodeMetrics ? 'ready' : 'unavailable';
    if (!sdkModule.decodeMetrics) { live.presage.lastDecodeError = this.decoderError ?? 'The SDK metrics decoder is not available.'; console.warn(`[presage] ${live.presage.lastDecodeError}`); }
    // SDK events arrive outside any request, so an exception in a handler would be uncaught and take
    // the whole server (and every in-memory session) down. Each handler is isolated and logged instead.
    const on = (event: string, handler: (...args: never[]) => void) => sdk.on(event, ((...args: never[]) => {
      try { handler(...args); }
      catch (error) { console.error(`[presage] window ${live.window.id}: '${event}' handler failed:`, error instanceof Error ? error.stack ?? error.message : error); }
    }) as (...args: never[]) => void);
    on('metrics', ((buffer: Buffer) => {
      live.presage.metricsPackets++;
      let decoded: unknown;
      try { decoded = sdkModule.decodeMetrics ? sdkModule.decodeMetrics(buffer) : undefined; }
      catch (error) { decoded = undefined; live.presage.lastDecodeError = error instanceof Error ? error.message.slice(0, 200) : 'Metrics could not be decoded.'; }
      if (!decoded || Buffer.isBuffer(decoded)) {
        live.presage.decodeErrors = (live.presage.decodeErrors ?? 0) + 1;
        live.presage.lastDecodeError ??= 'Metrics arrived but could not be decoded.';
        if (live.presage.decodeErrors === 1) console.warn(`[presage] window ${live.window.id}: ${live.presage.lastDecodeError}`);
        return;
      }
      this.trackFace(live, decoded);
      const hrv = hrvFromMetrics(decoded); if (hrv) live.presage.hrv = hrv;
      for (const reading of readingsFromMetrics(decoded)) {
        const timestampUs = reading.atMs * 1000;
        if (timestampUs <= live.lastMetricUs[reading.metric]) continue;
        live.lastMetricUs[reading.metric] = timestampUs; live.readings.push(reading);
      }
    }) as (...args: never[]) => void);
    on('validationStatus', ((code: number, timestampUs: number, hint: string) => {
      const name = VALIDATION_CODES[code] ?? `CODE_${code}`;
      const at = isoAt(Number.isFinite(timestampUs) && timestampUs > 0 ? timestampUs / 1000 : Date.now());
      live.notes.push({ at, code: name, hint: typeof hint === 'string' ? hint.slice(0, 200) : '' });
    }) as (...args: never[]) => void);
    // Presage's own report of whether each frame entered processing: the true processing rate.
    on('frameSentThrough', ((sent: boolean, timestampUs: number) => { if (sent && Number.isFinite(timestampUs)) { live.consumed.push(timestampUs / 1000); live.stats.processed = (live.stats.processed ?? 0) + 1; } else if (!sent) live.stats.notProcessed++; }) as (...args: never[]) => void);
    on('error', ((code: number, message: string, retryable: boolean) => {
      const detail = typeof message === 'string' ? message.slice(0, 200) : '';
      live.notes.push({ at: new Date().toISOString(), code: `ERROR_${code}`, hint: detail || 'Processing error.' });
      live.lastError = SDK_FAILURES[code] ?? (detail || 'Presage processing stopped.');
      console.warn(`[presage] window ${live.window.id}: SDK error ${code}${retryable ? ' (retryable)' : ''}: ${detail}`);
      if (FATAL_SDK_ERRORS.has(code)) live.fatal = true;
      if (!retryable) live.failure = live.lastError;
    }) as (...args: never[]) => void);
    // A retryable error can still leave the pipeline in its error state (e.g. the key could not be verified).
    on('processingStatus', ((status: number) => {
      live.presage.processing = PROCESSING[status] ?? live.presage.processing;
      if (status === PROCESSING_STATUS_ERROR) live.failure ??= live.lastError ?? 'Presage processing stopped.';
    }) as (...args: never[]) => void);
    sdk.useCustomInput(FRAME_TRANSFORM_NONE);
    sdk.start();
    live.sdk = sdk;
  }

  /** Keeps the latest Presage face lock and counts the blink onsets the SDK reports. */
  private trackFace(live: Live, decoded: unknown) {
    const face = faceFromMetrics(decoded, live.stats.width, live.stats.height);
    if (!face) return;
    const { blinkRows, ...current } = face;
    for (const row of blinkRows) {
      const atUs = toNumber(row.timestamp); const detected = row.detected === true;
      if (!Number.isFinite(atUs) || (live.lastBlink && atUs <= live.lastBlink.atUs)) continue;
      if (detected && live.lastBlink && !live.lastBlink.detected) live.blinks.push(atUs / 1000);
      live.lastBlink = { atUs, detected };
    }
    const nowMs = Date.parse(current.at);
    live.faceSinceMs ??= nowMs;
    while (live.blinks.length && nowMs - live.blinks[0]! > BLINK_WINDOW_MS) live.blinks.shift();
    const span = Math.min(BLINK_WINDOW_MS, nowMs - live.faceSinceMs);
    const blinksPerMinute = live.lastBlink && span >= 20_000 ? Math.round((live.blinks.length * 60_000) / span) : undefined;
    live.presage.face = { ...current, blinksPerMinute };
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
        at: isoAt(reading.atMs), metric: reading.metric, value: Math.round(reading.value * 10) / 10,
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
    const elapsedMs = live.originMs === undefined ? undefined : this.source === 'presage' ? Math.max(0, live.lastFrameUs / 1000 - live.originMs) : Date.now() - live.originMs;
    return {
      window: structuredClone(live.window), hint: live.hint, code: live.lastCode, latest: { pulse: latest('pulse') }, pipeline: live.window.pipeline,
      elapsedMs: elapsedMs === undefined ? undefined : Math.round(elapsedMs),
      presage: this.source === 'presage' ? structuredClone(live.presage) : undefined,
    };
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
    if (status === 'error' && live.fatal) live.window.fatal = true;
    if (status === 'error') console.warn(`[presage] window ${live.window.id} ended with an error after ${live.window.framesReceived} frames: ${reason}`);
    const sdk = live.sdk; live.sdk = undefined;
    if (!sdk) return;
    const teardown = (async () => {
      try { if (sdk.stopAsync) await sdk.stopAsync(); else sdk.stop(); } catch { /* already stopped */ }
      try { await sdk.destroy(); } catch { /* already released */ }
    })();
    this.teardowns.add(teardown);
    try { await teardown; } finally { this.teardowns.delete(teardown); }
  }

  private sweep() {
    const cutoff = Date.now() - LIMITS.idleMs;
    for (const live of this.live.values()) if (live.window.status === 'active' && live.lastActivity < cutoff) void this.finish(live, 'ended', 'No frames arrived (tab closed, refreshed or disconnected).');
    this.logMemory();
  }

  /**
   * While Presage runs, logs the process memory every 15 s. The native runtime (and a CPU Vulkan
   * driver on GPU-less hosts) can use far more than Node's heap; a host's out-of-memory kill leaves
   * no other trace, so this shows how close it got.
   */
  private logMemory() {
    const active = [...this.live.values()].filter((live) => live.window.status === 'active' && live.sdk).length;
    if (!active || Date.now() - this.memoryLoggedAt < 15_000) return;
    this.memoryLoggedAt = Date.now();
    const { rss, heapUsed } = process.memoryUsage();
    console.log(`[presage] memory: rss ${Math.round(rss / 1048576)} MB, js heap ${Math.round(heapUsed / 1048576)} MB, ${active} active window${active === 1 ? '' : 's'}`);
  }
}

interface IncomingFrame { timestampUs: number; decode(): { width: number; height: number; rgb: Uint8Array } }

/** Splits an RGB batch; frame pixels are referenced, not copied. */
function* rgbFrames(body: Buffer, width: number, height: number): Generator<IncomingFrame> {
  const stride = 8 + width * height * 3;
  if (!body.length || body.length % stride !== 0) throw new PracticeError('Frame batch is malformed.');
  for (let offset = 0; offset < body.length; offset += stride) {
    const start = offset;
    yield { timestampUs: body.readDoubleLE(start), decode: () => ({ width, height, rgb: body.subarray(start + 8, start + stride) }) };
  }
}

/** Splits a JPEG batch and validates its framing up front; each frame is decoded only if it will be sent. */
function* jpegFrames(body: Buffer): Generator<IncomingFrame> {
  const frames: { timestampUs: number; start: number; end: number }[] = [];
  for (let offset = 0; offset < body.length;) {
    if (offset + 12 > body.length) throw new PracticeError('Frame batch is malformed.');
    const length = body.readUInt32LE(offset + 8); const start = offset + 12; const end = start + length;
    if (!length || end > body.length) throw new PracticeError('Frame batch is malformed.');
    frames.push({ timestampUs: body.readDoubleLE(offset), start, end }); offset = end;
  }
  if (!frames.length) throw new PracticeError('Frame batch is malformed.');
  for (const { timestampUs, start, end } of frames) yield {
    timestampUs,
    decode: () => {
      try {
        const image = jpeg.decode(body.subarray(start, end), { useTArray: true, formatAsRGBA: false, maxResolutionInMP: 0.4, maxMemoryUsageInMB: 32 });
        return { width: image.width, height: image.height, rgb: image.data };
      } catch { throw new PracticeError('A camera frame could not be decoded.'); }
    },
  };
}
