import type { FaceDetector, FaceDetectorOptions } from '@mediapipe/tasks-vision';
import wasmLoaderPath from '@mediapipe/tasks-vision/vision_wasm_internal.js?url';
import wasmBinaryPath from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url';
import { framingFor, type FaceObservation, type Framing } from './faceGeometry';

/*
 * Minimal on-device face box for the Presage camera panel (MediaPipe Face Detector, BlazeFace).
 *
 * It runs entirely in this browser tab: nothing it sees is uploaded. Presage SmartSpectra stays
 * the source of every physiological reading; this only draws the face square and gives basic
 * framing and lighting hints. It is deliberately small (a ~230 KB model, no landmark mesh) and
 * runs only a few times a second, so it never competes with frame capture for the main thread.
 * The model and WebAssembly runtime are served by this app, so no third-party request is made.
 */

const MODEL_PATH = `${import.meta.env.BASE_URL}models/blaze_face_short_range.tflite`;
/** Analysis rate cap (~10 per second); the camera preview itself always runs at full rate. */
const MIN_INTERVAL_MS = 100;
/** No face for this long after having one counts as lost tracking (not a momentary miss). */
const LOST_AFTER_MS = 900;
const BRIGHTNESS_EVERY_MS = 500;

export type TrackerStatus = 'loading' | 'ready' | 'unavailable';

/** A low-frequency summary of the tracker for React (the overlay reads the store directly). */
export interface TrackingSummary {
  tracker: TrackerStatus;
  face: 'none' | 'found' | 'lost';
  faces: number;
  framing?: Framing;
  error?: string;
}

/** Mutable tracker output shared with the overlay at frame rate, outside React state. */
export class TrackingStore {
  latest?: FaceObservation;
  face: TrackingSummary['face'] = 'none';
  faces = 0;
  status: TrackerStatus = 'loading';
  error?: string;
  private lastSeen?: number;

  record(observation: FaceObservation | undefined, now: number) {
    this.faces = observation?.faces ?? 0;
    if (observation) { this.latest = observation; this.lastSeen = now; this.face = 'found'; }
    else if (this.lastSeen !== undefined && now - this.lastSeen > LOST_AFTER_MS) this.face = 'lost';
  }

  /** The face is currently in view (a brief miss under LOST_AFTER_MS still counts as tracked). */
  tracked(now: number) { return this.face === 'found' && this.lastSeen !== undefined && now - this.lastSeen <= LOST_AFTER_MS; }

  summary(now: number): TrackingSummary {
    const latest = this.latest;
    const showing = this.tracked(now) && latest;
    return {
      // A stalled analysis loop (no recent results) must not keep claiming a tracked face.
      tracker: this.status, face: this.face === 'found' && !this.tracked(now) ? 'lost' : this.face, faces: this.faces,
      framing: showing ? framingFor(latest) : undefined, error: this.error,
    };
  }
}

/**
 * Runs the detector against a playing <video> until stopped. If the model can't load, the store
 * is marked unavailable and Presage keeps running without the on-screen box.
 */
export class FaceTrackLoop {
  readonly store = new TrackingStore();
  private detector?: FaceDetector;
  private handle?: number;
  private stopped = false;
  private lastRun = 0;
  private lastVideoTime = -1;
  private lastTimestamp = 0;
  private lastBrightness = 0;
  private brightness?: number;
  private probe?: CanvasRenderingContext2D | null;

  constructor(private readonly video: HTMLVideoElement) {}

  async start() {
    try {
      const vision = await import('@mediapipe/tasks-vision');
      const options = (delegate: 'GPU' | 'CPU'): FaceDetectorOptions => ({ baseOptions: { modelAssetPath: MODEL_PATH, delegate }, runningMode: 'VIDEO', minDetectionConfidence: 0.5 });
      const fileset = { wasmLoaderPath, wasmBinaryPath };
      try { this.detector = await vision.FaceDetector.createFromOptions(fileset, options('GPU')); }
      catch { this.detector = await vision.FaceDetector.createFromOptions(fileset, options('CPU')); }
      if (this.stopped) { this.detector.close(); return; }
      this.store.status = 'ready';
      this.handle = requestAnimationFrame(this.tick);
    } catch (error) {
      this.store.status = 'unavailable';
      this.store.error = error instanceof Error ? error.message : 'Face tracking could not load.';
    }
  }

  stop() {
    this.stopped = true;
    if (this.handle !== undefined) cancelAnimationFrame(this.handle);
    this.detector?.close(); this.detector = undefined;
  }

  private tick = () => {
    if (this.stopped || !this.detector) return;
    this.handle = requestAnimationFrame(this.tick);
    const now = performance.now();
    const video = this.video;
    if (video.readyState < 2 || !video.videoWidth || now - this.lastRun < MIN_INTERVAL_MS || video.currentTime === this.lastVideoTime) return;
    this.lastRun = now; this.lastVideoTime = video.currentTime;
    // MediaPipe requires strictly increasing timestamps.
    const timestamp = Math.max(this.lastTimestamp + 1, Math.round(now));
    this.lastTimestamp = timestamp;
    let detections;
    try { detections = this.detector.detectForVideo(video, timestamp).detections; } catch { return; }
    // The largest face is the learner; others only trigger the "more than one face" note.
    const boxes = detections.flatMap((detection) => detection.boundingBox ? [{ x: detection.boundingBox.originX / video.videoWidth, y: detection.boundingBox.originY / video.videoHeight, w: detection.boundingBox.width / video.videoWidth, h: detection.boundingBox.height / video.videoHeight }] : []);
    if (!boxes.length) { this.store.record(undefined, now); return; }
    const bounds = boxes.reduce((best, box) => (box.w * box.h > best.w * best.h ? box : best));
    if (now - this.lastBrightness >= BRIGHTNESS_EVERY_MS) { this.lastBrightness = now; this.brightness = this.sampleBrightness(bounds) ?? this.brightness; }
    this.store.record({ at: now, faces: boxes.length, bounds, brightness: this.brightness }, now);
  };

  /** Mean luma of the face region from a 16×16 downsample: a cheap, local lighting check. */
  private sampleBrightness(bounds: { x: number; y: number; w: number; h: number }) {
    const video = this.video;
    if (!this.probe) { const canvas = document.createElement('canvas'); canvas.width = 16; canvas.height = 16; this.probe = canvas.getContext('2d', { willReadFrequently: true }); }
    const context = this.probe;
    if (!context) return undefined;
    const sx = Math.max(0, bounds.x * video.videoWidth); const sy = Math.max(0, bounds.y * video.videoHeight);
    const sw = Math.min(video.videoWidth - sx, bounds.w * video.videoWidth); const sh = Math.min(video.videoHeight - sy, bounds.h * video.videoHeight);
    if (sw < 4 || sh < 4) return undefined;
    try {
      context.drawImage(video, sx, sy, sw, sh, 0, 0, 16, 16);
      const data = context.getImageData(0, 0, 16, 16).data;
      let sum = 0;
      for (let index = 0; index < data.length; index += 4) sum += 0.2126 * data[index]! + 0.7152 * data[index + 1]! + 0.0722 * data[index + 2]!;
      return sum / (data.length / 4);
    } catch { return undefined; }
  }
}
