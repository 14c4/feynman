/*
 * Camera pipeline for optional Presage monitoring.
 *
 * Presage's own browser capture (`@smartspectra/node-sdk/renderer`) reads every camera
 * frame with MediaStreamTrackProcessor and anchors VideoFrame.timestamp to epoch time.
 * This module follows the same approach: it never samples on a timer, never duplicates a
 * frame and never rewrites a capture timestamp. A frame whose timestamp is not newer than
 * the last one is dropped, not re-stamped.
 *
 * This file holds the DOM-free parts (FPS measurement, configuration choice, recovery
 * decisions) so they can be unit tested in Node; frameCapture.ts is the browser-only part.
 */

/** Measured capture rate we aim for. Presage tunes for 30 fps; ordinary webcams jitter around it. */
export const TARGET_FPS = 24;
/**
 * Below this measured rate no configuration is worth sending. Between this and TARGET_FPS the
 * camera is tried, and Presage's own FRAME_RATE_TOO_LOW validation decides whether it is usable.
 */
export const MIN_FPS = 12;
/** Processing frames are downscaled so their long side is at most this many pixels (see PROCESSING_STEPS). */
export const PROCESSING_LONG_SIDES = [480, 400, 320] as const;
/** Frames queued in the browser beyond this age are dropped (and counted) instead of sent late. */
export const MAX_QUEUE_MS = 1500;
export const MAX_BATCH_BYTES = 6_000_000;
export const MAX_BATCH_FRAMES = 12;

export interface CameraConfig { label: string; width: number; height: number; frameRate: number; minFrameRate?: number }

/** Tried in order. Requests use `ideal`, so a camera that cannot match exactly still opens. */
export const CAMERA_LADDER: CameraConfig[] = [
  { label: '640×480', width: 640, height: 480, frameRate: 30 },
  { label: '1280×720', width: 1280, height: 720, frameRate: 30 },
  { label: '640×360', width: 640, height: 360, frameRate: 30 },
  { label: '320×240', width: 320, height: 240, frameRate: 30 },
];

/** getUserMedia / applyConstraints video constraints (plain object so this module stays DOM-free). */
export function constraintsFor(config: CameraConfig) {
  return { width: { ideal: config.width }, height: { ideal: config.height }, frameRate: config.minFrameRate ? { ideal: config.frameRate, min: config.minFrameRate } : { ideal: config.frameRate }, facingMode: 'user' };
}

/** Frames per second from real capture timestamps (ms). Needs at least a handful of frames. */
export function measureFps(timestampsMs: number[]): number | undefined {
  if (timestampsMs.length < 5) return undefined;
  const span = timestampsMs[timestampsMs.length - 1]! - timestampsMs[0]!;
  return span > 0 ? ((timestampsMs.length - 1) * 1000) / span : undefined;
}

/** Rolling frame-rate meter over capture timestamps, with gap (missed frame) estimation. */
export class FpsMeter {
  private stamps: number[] = [];
  missed = 0;
  total = 0;
  constructor(private readonly windowMs = 4000) {}
  private interval?: number;
  push(atMs: number) {
    const previous = this.stamps.at(-1);
    if (previous !== undefined) {
      const gap = atMs - previous;
      // A gap well beyond the smoothed frame interval means frames were skipped upstream;
      // gaps are kept out of the average so they cannot hide themselves.
      if (this.interval === undefined) this.interval = gap;
      else if (gap > this.interval * 1.6) this.missed += Math.max(1, Math.round(gap / this.interval) - 1);
      else this.interval = this.interval * 0.9 + gap * 0.1;
    }
    this.stamps.push(atMs); this.total++;
    while (this.stamps.length > 2 && atMs - this.stamps[0]! > this.windowMs) this.stamps.shift();
  }
  fps(): number | undefined { return measureFps(this.stamps); }
  reset() { this.stamps = []; this.missed = 0; this.total = 0; this.interval = undefined; }
}

export interface ProbeResult { config: CameraConfig; fps?: number; width: number; height: number }

/** First configuration that reaches the target; otherwise the fastest one above the floor. */
export function pickConfig(results: ProbeResult[]): ProbeResult | undefined {
  const good = results.find((result) => (result.fps ?? 0) >= TARGET_FPS);
  if (good) return good;
  const usable = results.filter((result) => (result.fps ?? 0) >= MIN_FPS).sort((a, b) => (b.fps ?? 0) - (a.fps ?? 0));
  return usable[0];
}

/** Even-sized processing dimensions that keep the camera's aspect ratio. */
export function processingSize(sourceWidth: number, sourceHeight: number, longSide: number) {
  const scale = Math.min(1, longSide / Math.max(sourceWidth, sourceHeight));
  const even = (value: number) => Math.max(64, Math.floor((value * scale) / 2) * 2);
  return { width: Math.min(640, even(sourceWidth)), height: Math.min(480, even(sourceHeight)) };
}

/** RGBA → packed RGB. Reads 32-bit words; about 4× faster than per-byte indexing. */
export function rgbaToRgb(rgba: Uint8ClampedArray | Uint8Array, out: Uint8Array, offset = 0) {
  const words = new Uint32Array(rgba.buffer, rgba.byteOffset, rgba.byteLength >> 2);
  for (let index = 0, target = offset; index < words.length; index++, target += 3) {
    const pixel = words[index]!;
    out[target] = pixel & 255; out[target + 1] = (pixel >>> 8) & 255; out[target + 2] = (pixel >>> 16) & 255;
  }
  return out;
}

export interface PipelineSample {
  elapsedMs: number;
  /** Rate the camera actually produced frames, from capture timestamps. */
  captureFps?: number;
  /** Rate at which frames were accepted by the server. */
  deliveredFps?: number;
  /** Frames dropped in the browser queue since the last sample. */
  queueDrops: number;
  /** Latest Presage validation code, if any. */
  code?: string;
  validReadings: number;
}
export type RecoveryAction =
  | { kind: 'none' }
  | { kind: 'lower_capture' }
  | { kind: 'lower_processing' }
  | { kind: 'give_up'; reason: string };
export interface RecoveryState { canLowerCapture: boolean; canLowerProcessing: boolean }

/**
 * Decides when to adapt. A problem must persist (not a momentary dip) before acting, and each
 * adaptation is followed by a settling period. Presage's FRAME_RATE_TOO_LOW is treated as the
 * authority for "too slow"; our own measurement only decides *where* the slowdown happens.
 */
export class RecoveryController {
  private lowCaptureSince?: number;
  private lowDeliverySince?: number;
  private tooLowSince?: number;
  private settleUntil = 5000;
  private validAtTooLow = 0;
  advice?: string;
  constructor(private readonly sustainMs = 6000, private readonly giveUpMs = 30_000) {}

  evaluate(sample: PipelineSample, state: RecoveryState): RecoveryAction {
    const { elapsedMs: now, captureFps, deliveredFps } = sample;
    const slowCapture = captureFps !== undefined && captureFps < TARGET_FPS;
    const sdkTooLow = sample.code === 'FRAME_RATE_TOO_LOW';
    const lossy = captureFps !== undefined && captureFps >= TARGET_FPS && ((deliveredFps !== undefined && deliveredFps < captureFps * 0.85) || sample.queueDrops > 2);
    this.lowCaptureSince = slowCapture || (sdkTooLow && !lossy) ? this.lowCaptureSince ?? now : undefined;
    this.lowDeliverySince = lossy ? this.lowDeliverySince ?? now : undefined;
    if (sdkTooLow) { if (this.tooLowSince === undefined) { this.tooLowSince = now; this.validAtTooLow = sample.validReadings; } } else this.tooLowSince = undefined;

    this.advice = slowCapture
      ? `Your camera is delivering about ${Math.round(captureFps)} fps. Webcams slow down in dim light: face a window or lamp, and close other apps using the camera.`
      : lossy ? `Frames are being lost after capture (${Math.round(deliveredFps ?? 0)} of ${Math.round(captureFps)} fps arrive). Close other tabs or apps, or plug in your laptop.`
        : sdkTooLow ? 'Presage reports the frame rate is too low. More light usually helps a webcam keep up.' : undefined;

    if (now < this.settleUntil) return { kind: 'none' };
    if (this.lowDeliverySince !== undefined && now - this.lowDeliverySince >= this.sustainMs && state.canLowerProcessing) return this.acted(now, { kind: 'lower_processing' });
    if (this.lowCaptureSince !== undefined && now - this.lowCaptureSince >= this.sustainMs && state.canLowerCapture) return this.acted(now, { kind: 'lower_capture' });
    if (!state.canLowerCapture) {
      if (captureFps !== undefined && captureFps < MIN_FPS && this.lowCaptureSince !== undefined && now - this.lowCaptureSince >= this.sustainMs)
        return { kind: 'give_up', reason: `Your camera only delivered about ${Math.round(captureFps)} fps, below what Presage can measure reliably.` };
      // Presage keeps rejecting the rate and nothing reliable has come through: stop honestly.
      if (this.tooLowSince !== undefined && now - this.tooLowSince >= this.giveUpMs && sample.validReadings === this.validAtTooLow)
        return { kind: 'give_up', reason: `Presage reported the camera frame rate as too low for ${Math.round(this.giveUpMs / 1000)} seconds${captureFps ? ` (about ${Math.round(captureFps)} fps)` : ''}.` };
    }
    return { kind: 'none' };
  }

  private acted(now: number, action: RecoveryAction): RecoveryAction {
    this.settleUntil = now + 8000; this.lowCaptureSince = undefined; this.lowDeliverySince = undefined; this.tooLowSince = undefined;
    return action;
  }
}

/**
 * Processing steps, best fidelity first. Raw RGB is lossless but heavy (~15 MB/s at 480 px and
 * 30 fps), so it is only the starting point when the server runs on this machine; a remote server
 * starts with high-quality JPEG. When frames are lost after capture, recovery moves one step down.
 */
export type FrameEncoding = 'rgb' | 'jpeg';
export interface ProcessingStep { encoding: FrameEncoding; longSide: number }
export const PROCESSING_STEPS: ProcessingStep[] = [
  { encoding: 'rgb', longSide: 480 },
  { encoding: 'jpeg', longSide: 480 },
  { encoding: 'jpeg', longSide: 400 },
  { encoding: 'jpeg', longSide: 320 },
];
export const JPEG_QUALITY = 0.9;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
export function initialProcessingStep(hostname: string) { return LOCAL_HOSTS.has(hostname) ? 0 : 1; }

/** A frame ready to upload: packed RGB, or JPEG bytes. */
export interface EncodedFrame { timestampUs: number; width: number; height: number; encoding: FrameEncoding; bytes: Uint8Array }

/** How many leading frames share the first frame's encoding and size and fit one request. */
export function batchLength(queue: EncodedFrame[], maxFrames = MAX_BATCH_FRAMES, maxBytes = MAX_BATCH_BYTES) {
  const first = queue[0];
  if (!first) return 0;
  let count = 0; let bytes = 0;
  for (const frame of queue) {
    if (frame.encoding !== first.encoding || frame.width !== first.width || frame.height !== first.height) break;
    const size = frame.bytes.length + (frame.encoding === 'jpeg' ? 12 : 8);
    if (count && (count >= maxFrames || bytes + size > maxBytes)) break;
    count++; bytes += size;
  }
  return count;
}

/** Wire format: rgb = [f64 LE timestamp µs][RGB]; jpeg = [f64 LE timestamp µs][u32 LE length][JPEG]. */
export function packBatch(frames: EncodedFrame[]): Uint8Array {
  const jpeg = frames[0]?.encoding === 'jpeg';
  const header = jpeg ? 12 : 8;
  const body = new Uint8Array(frames.reduce((sum, frame) => sum + header + frame.bytes.length, 0));
  const view = new DataView(body.buffer);
  let offset = 0;
  for (const frame of frames) {
    view.setFloat64(offset, frame.timestampUs, true);
    if (jpeg) view.setUint32(offset + 8, frame.bytes.length, true);
    body.set(frame.bytes, offset + header);
    offset += header + frame.bytes.length;
  }
  return body;
}
