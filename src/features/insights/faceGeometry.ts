/*
 * DOM-free face-tracking helpers for the Presage camera panel, unit tested in Node.
 *
 * Coordinates are normalized to the camera frame (0–1, unmirrored, as the camera delivers it).
 * The preview is mirrored with CSS, and the overlay canvas gets the same transform, so drawing
 * code never has to flip anything itself.
 */

export interface Box { x: number; y: number; w: number; h: number }

/** One local face-tracker result (MediaPipe Face Landmarker, run in the browser). */
export interface FaceObservation {
  /** performance.now() of the analysed frame. */
  at: number;
  /** Faces found in the frame. */
  faces: number;
  /** Tight bounds of the primary face's landmarks. */
  bounds: Box;
  /** Landmark subset for drawing, as [x0, y0, x1, y1, …]. */
  points: Float32Array;
  pose: HeadPose;
  /** Average eye-blink blendshape score, 0 (open) – 1 (closed). */
  eyeClosure: number;
  /** Mean luma (0–255) of the face region, sampled a few times a second. */
  brightness?: number;
}

export interface HeadPose { yaw: number; pitch: number; roll: number }

export function boundsOf(points: ArrayLike<number>): Box {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (let index = 0; index + 1 < points.length; index += 2) {
    const x = points[index]!; const y = points[index + 1]!;
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return Number.isFinite(minX) ? { x: minX, y: minY, w: maxX - minX, h: maxY - minY } : { x: 0, y: 0, w: 0, h: 0 };
}

/**
 * A square (in pixels) around the face bounds with some padding, returned in normalized units.
 * `aspect` is the frame's width / height, so a square on screen is not a square in 0–1 units.
 */
export function squareAround(bounds: Box, aspect: number, padding = 0.22): Box {
  const cx = bounds.x + bounds.w / 2; const cy = bounds.y + bounds.h / 2;
  const sidePx = Math.max(bounds.w * aspect, bounds.h) * (1 + padding * 2);
  const w = sidePx / aspect; const h = sidePx;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/**
 * Exponential smoothing with a dead band: tiny landmark jitter is ignored, real movement is
 * followed quickly. A large jump (new face, re-acquired lock) snaps instead of sliding across.
 */
export function smoothBox(previous: Box | undefined, next: Box, alpha = 0.4, deadband = 0.003): Box {
  if (!previous) return next;
  const jump = Math.hypot(next.x - previous.x, next.y - previous.y) > Math.max(previous.w, previous.h) * 0.9;
  if (jump) return next;
  const blend = (from: number, to: number) => (Math.abs(to - from) < deadband ? from : from + (to - from) * alpha);
  return { x: blend(previous.x, next.x), y: blend(previous.y, next.y), w: blend(previous.w, next.w), h: blend(previous.h, next.h) };
}

/** Maps normalized frame coordinates into an element showing the frame with `object-fit: cover`. */
export function coverMapping(frameWidth: number, frameHeight: number, elementWidth: number, elementHeight: number) {
  const scale = Math.max(elementWidth / frameWidth, elementHeight / frameHeight);
  const width = frameWidth * scale; const height = frameHeight * scale;
  const offsetX = (elementWidth - width) / 2; const offsetY = (elementHeight - height) / 2;
  return { x: (u: number) => offsetX + u * width, y: (v: number) => offsetY + v * height, width, height };
}

const DEG = 180 / Math.PI;
/** Yaw, pitch and roll (degrees) from MediaPipe's 4×4 column-major facial transformation matrix. */
export function headPose(matrix: ArrayLike<number>): HeadPose {
  const r00 = matrix[0]!; const r10 = matrix[1]!; const r20 = matrix[2]!;
  const r21 = matrix[6]!; const r22 = matrix[10]!;
  return {
    yaw: Math.atan2(-r20, Math.hypot(r21, r22)) * DEG,
    pitch: Math.atan2(r21, r22) * DEG,
    roll: Math.atan2(r10, r00) * DEG,
  };
}

/**
 * Counts blinks from per-frame eye-closure scores with hysteresis. A closure longer than
 * `maxBlinkMs` counts as eyes closed, not a blink.
 */
export class BlinkCounter {
  private closedAt?: number;
  private blinks: number[] = [];
  private since?: number;
  constructor(private readonly closeAbove = 0.55, private readonly openBelow = 0.35, private readonly maxBlinkMs = 500, private readonly windowMs = 60_000) {}

  push(atMs: number, closure: number) {
    this.since ??= atMs;
    if (this.closedAt === undefined && closure >= this.closeAbove) this.closedAt = atMs;
    else if (this.closedAt !== undefined && closure <= this.openBelow) {
      if (atMs - this.closedAt <= this.maxBlinkMs) this.blinks.push(atMs);
      this.closedAt = undefined;
    }
    while (this.blinks.length && atMs - this.blinks[0]! > this.windowMs) this.blinks.shift();
  }

  get closed() { return this.closedAt !== undefined; }

  /** Blinks per minute over the last minute; undefined until `minMs` of face time has passed. */
  perMinute(nowMs: number, minMs = 20_000): number | undefined {
    if (this.since === undefined) return undefined;
    const span = Math.min(this.windowMs, nowMs - this.since);
    return span >= minMs ? Math.round((this.blinks.length * 60_000) / span) : undefined;
  }

  /** Face left the frame: keep counts, but a half-finished blink is discarded. */
  interrupt() { this.closedAt = undefined; }
}

export type FramingCode = 'ok' | 'multiple' | 'too_far' | 'too_close' | 'off_center' | 'turned' | 'too_dark' | 'too_bright';
export interface Framing { code: FramingCode; message: string }

/** Plain camera framing feedback from the local tracker, most important issue first. */
export function framingFor(observation: Pick<FaceObservation, 'faces' | 'bounds' | 'pose' | 'brightness'>): Framing {
  const { bounds, pose, brightness } = observation;
  const cx = bounds.x + bounds.w / 2; const cy = bounds.y + bounds.h / 2;
  if (observation.faces > 1) return { code: 'multiple', message: 'More than one face is in view. Presage measures one person at a time.' };
  if (brightness !== undefined && brightness < 55) return { code: 'too_dark', message: 'Your face is in shadow. Face a window or lamp.' };
  if (brightness !== undefined && brightness > 215) return { code: 'too_bright', message: 'Your face is overexposed. Move away from direct light.' };
  if (bounds.h < 0.22) return { code: 'too_far', message: 'Move a little closer to the camera.' };
  if (bounds.h > 0.75) return { code: 'too_close', message: 'Sit back a little so your whole face fits.' };
  if (Math.abs(cx - 0.5) > 0.22 || Math.abs(cy - 0.48) > 0.22) return { code: 'off_center', message: 'Centre your face in the frame.' };
  if (Math.abs(pose.yaw) > 25 || Math.abs(pose.pitch) > 25) return { code: 'turned', message: 'Face the camera directly.' };
  return { code: 'ok', message: 'Well framed.' };
}

/* ---------- operational status ---------- */

export type PresageStageId =
  | 'off' | 'camera' | 'loading' | 'searching' | 'detected' | 'tracking' | 'collecting' | 'measuring' | 'adjust' | 'lost' | 'saving' | 'error';

export interface StageInput {
  phase: 'idle' | 'requesting' | 'calibrating' | 'monitoring' | 'stopping' | 'error';
  simulated: boolean;
  /** The camera is open (false when it was declined in simulated mode, or not yet granted). */
  camera: boolean;
  /** A measurement window exists on the server. */
  windowOpen: boolean;
  /** Local tracker state. */
  tracker: 'loading' | 'ready' | 'unavailable';
  face: 'none' | 'found' | 'lost';
  /** Frames accepted by Presage so far in this window. */
  framesReceived: number;
  /** Presage SDK processing state, when reported. */
  processing?: string;
  /** Latest Presage validation code. */
  code?: string;
  /** Metrics packets Presage has produced. */
  metricsPackets: number;
  /** A reliable reading exists from the last few seconds. */
  freshValid: boolean;
  /** Any reliable reading exists in this window. */
  anyValid: boolean;
}

export interface Stage { id: PresageStageId; label: string; tone: 'idle' | 'wait' | 'live' | 'warn' | 'error' }

const PRESAGE_FACE_LOST = new Set(['NO_FACE_FOUND']);
const PRESAGE_ADJUST = new Set(['MULTIPLE_FACES_FOUND', 'FACE_NOT_CENTERED', 'FACE_SIZE_OUT_OF_RANGE', 'TOO_DARK', 'TOO_BRIGHT', 'CHEST_NOT_VISIBLE', 'FRAME_RATE_TOO_LOW', 'EXCESSIVE_MOTION', 'FACE_TOO_CLOSE', 'FACE_TOO_FAR', 'FACE_TOO_HIGH', 'FACE_TOO_LOW', 'FACE_NOT_FORWARD']);

/**
 * One honest headline for the panel, derived only from real signals: camera state, the local
 * tracker, and what the Presage SDK reports (processing state, validation codes, metrics packets,
 * validated readings). Warm-up is "collecting", never a failure.
 */
export function presageStage(input: StageInput): Stage {
  if (input.phase === 'error') return { id: 'error', label: 'Processing error', tone: 'error' };
  if (input.phase === 'stopping') return { id: 'saving', label: 'Saving readings', tone: 'wait' };
  if (input.phase === 'idle') return { id: 'off', label: 'Camera off', tone: 'idle' };
  if (input.phase === 'requesting' && !input.camera) return { id: 'camera', label: 'Initializing camera', tone: 'wait' };
  if (!input.windowOpen || (input.camera && input.tracker === 'loading' && input.face === 'none')) return { id: 'loading', label: 'Loading analysis', tone: 'wait' };
  if (input.processing === 'error') return { id: 'error', label: 'Processing error', tone: 'error' };
  // Presage's own validation outranks the on-device tracker: a validated reading means it sees the face.
  if (!input.simulated && input.freshValid && input.code === 'OK') return { id: 'measuring', label: 'Measurements available', tone: 'live' };
  const localFace = input.camera && input.tracker === 'ready' ? input.face : undefined;
  if (localFace === 'lost' || (localFace !== 'none' && input.code && PRESAGE_FACE_LOST.has(input.code) && input.anyValid)) return { id: 'lost', label: 'Tracking lost', tone: 'warn' };
  if (localFace === 'none' || (localFace === undefined && input.code && PRESAGE_FACE_LOST.has(input.code))) return { id: 'searching', label: 'Searching for face', tone: 'wait' };
  if (input.freshValid) return { id: 'measuring', label: 'Measurements available', tone: 'live' };
  if (input.code && PRESAGE_ADJUST.has(input.code)) return { id: 'adjust', label: 'Adjust position or light', tone: 'warn' };
  if (input.simulated) return { id: 'collecting', label: 'Collecting measurement data', tone: 'live' };
  if (input.metricsPackets > 0) return { id: 'collecting', label: 'Collecting measurement data', tone: 'live' };
  if (input.code === 'OK' && input.framesReceived > 0) return { id: 'tracking', label: 'Tracking active', tone: 'live' };
  return { id: 'detected', label: 'Face detected', tone: 'wait' };
}

/** Warm-up progress 0–1 for a metric whose readings become reliable after `warmupMs`. */
export function warmupProgress(elapsedMs: number | undefined, warmupMs: number) {
  return elapsedMs === undefined ? 0 : Math.max(0, Math.min(1, elapsedMs / warmupMs));
}
