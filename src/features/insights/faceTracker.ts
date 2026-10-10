import type { FaceLandmarker, FaceLandmarkerOptions } from '@mediapipe/tasks-vision';
import wasmLoaderPath from '@mediapipe/tasks-vision/vision_wasm_internal.js?url';
import wasmBinaryPath from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url';
import { BlinkCounter, boundsOf, framingFor, headPose, type FaceObservation, type Framing, type HeadPose } from './faceGeometry';

/*
 * Local, real-time face tracking for the Presage camera panel (MediaPipe Face Landmarker).
 *
 * It runs entirely in this browser tab: nothing it sees is uploaded. Presage SmartSpectra stays
 * the source of every physiological reading; this tracker only drives the on-screen face square,
 * landmark dots, framing and lighting feedback, and a local blink count. The WebAssembly runtime
 * and model are served by this app, so no third-party request is made while the camera is on.
 */

const MODEL_PATH = `${import.meta.env.BASE_URL}models/face_landmarker.task`;
/** Analysis rate cap; the camera preview itself always runs at full rate. */
const MIN_INTERVAL_MS = 45;
/** No face for this long after having one counts as lost tracking (not a momentary miss). */
const LOST_AFTER_MS = 700;
const BRIGHTNESS_EVERY_MS = 400;

export type TrackerStatus = 'loading' | 'ready' | 'unavailable';

/** A low-frequency summary of the tracker for React (the overlay reads the store directly). */
export interface TrackingSummary {
  tracker: TrackerStatus;
  face: 'none' | 'found' | 'lost';
  faces: number;
  framing?: Framing;
  pose?: HeadPose;
  blinksPerMinute?: number;
  /** Tracker analyses per second. */
  analysisFps?: number;
  delegate?: 'GPU' | 'CPU';
  error?: string;
}

/** Mutable tracker output shared with the overlay at frame rate, outside React state. */
export class TrackingStore {
  latest?: FaceObservation;
  face: TrackingSummary['face'] = 'none';
  faces = 0;
  status: TrackerStatus = 'loading';
  delegate?: 'GPU' | 'CPU';
  error?: string;
  readonly blinks = new BlinkCounter();
  private lastSeen?: number;
  private runs: number[] = [];

  record(observation: FaceObservation | undefined, now: number) {
    this.runs.push(now); while (this.runs.length && now - this.runs[0]! > 2000) this.runs.shift();
    this.faces = observation?.faces ?? 0;
    if (observation) {
      this.latest = observation; this.lastSeen = now; this.face = 'found';
      this.blinks.push(now, observation.eyeClosure);
    } else if (this.lastSeen !== undefined && now - this.lastSeen > LOST_AFTER_MS) {
      if (this.face === 'found') this.blinks.interrupt();
      this.face = 'lost';
    }
  }

  /** The face is currently in view (a brief miss under LOST_AFTER_MS still counts as tracked). */
  tracked(now: number) { return this.face === 'found' && this.lastSeen !== undefined && now - this.lastSeen <= LOST_AFTER_MS; }

  summary(now: number): TrackingSummary {
    const latest = this.latest;
    const showing = this.tracked(now) && latest;
    const fps = this.runs.length > 2 ? Math.round(((this.runs.length - 1) * 1000) / (this.runs.at(-1)! - this.runs[0]!)) : undefined;
    return {
      // A stalled analysis loop (no recent results) must not keep claiming a tracked face.
      tracker: this.status, face: this.face === 'found' && !this.tracked(now) ? 'lost' : this.face, faces: this.faces,
      framing: showing ? framingFor(latest) : undefined,
      pose: showing ? { yaw: Math.round(latest.pose.yaw), pitch: Math.round(latest.pose.pitch), roll: Math.round(latest.pose.roll) } : undefined,
      blinksPerMinute: this.blinks.perMinute(now), analysisFps: fps, delegate: this.delegate, error: this.error,
    };
  }
}

let indicesCache: Uint16Array | undefined;
/** Landmark indices for the face outline, eyes, brows, irises and lips: enough to show tracking without a mesh. */
function outlineIndices(statics: typeof FaceLandmarker) {
  if (indicesCache) return indicesCache;
  const set = new Set<number>();
  for (const list of [statics.FACE_LANDMARKS_FACE_OVAL, statics.FACE_LANDMARKS_LEFT_EYE, statics.FACE_LANDMARKS_RIGHT_EYE, statics.FACE_LANDMARKS_LEFT_EYEBROW, statics.FACE_LANDMARKS_RIGHT_EYEBROW, statics.FACE_LANDMARKS_LEFT_IRIS, statics.FACE_LANDMARKS_RIGHT_IRIS, statics.FACE_LANDMARKS_LIPS])
    for (const connection of list) { set.add(connection.start); set.add(connection.end); }
  indicesCache = Uint16Array.from([...set].sort((a, b) => a - b));
  return indicesCache;
}

/**
 * Runs the tracker against a playing <video> on animation frames until stopped. Resolves once
 * the model is loaded (or marks the store unavailable if it can't load; Presage keeps running).
 */
export class FaceTrackLoop {
  readonly store = new TrackingStore();
  private landmarker?: FaceLandmarker;
  private handle?: number;
  private stopped = false;
  private lastRun = 0;
  private lastVideoTime = -1;
  private lastTimestamp = 0;
  private lastBrightness = 0;
  private brightness?: number;
  private indices?: Uint16Array;
  private probe?: CanvasRenderingContext2D | null;

  constructor(private readonly video: HTMLVideoElement) {}

  async start() {
    try {
      const vision = await import('@mediapipe/tasks-vision');
      const options = (delegate: 'GPU' | 'CPU'): FaceLandmarkerOptions => ({
        baseOptions: { modelAssetPath: MODEL_PATH, delegate }, runningMode: 'VIDEO', numFaces: 2,
        outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true,
        minFaceDetectionConfidence: 0.5, minFacePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
      });
      const fileset = { wasmLoaderPath, wasmBinaryPath };
      try { this.landmarker = await vision.FaceLandmarker.createFromOptions(fileset, options('GPU')); this.store.delegate = 'GPU'; }
      catch { this.landmarker = await vision.FaceLandmarker.createFromOptions(fileset, options('CPU')); this.store.delegate = 'CPU'; }
      if (this.stopped) { this.landmarker.close(); return; }
      this.indices = outlineIndices(vision.FaceLandmarker);
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
    this.landmarker?.close(); this.landmarker = undefined;
  }

  private tick = () => {
    if (this.stopped || !this.landmarker) return;
    this.handle = requestAnimationFrame(this.tick);
    const now = performance.now();
    const video = this.video;
    if (video.readyState < 2 || !video.videoWidth || now - this.lastRun < MIN_INTERVAL_MS || video.currentTime === this.lastVideoTime) return;
    this.lastRun = now; this.lastVideoTime = video.currentTime;
    // MediaPipe requires strictly increasing timestamps.
    const timestamp = Math.max(this.lastTimestamp + 1, Math.round(now));
    this.lastTimestamp = timestamp;
    let result;
    try { result = this.landmarker.detectForVideo(video, timestamp); } catch { return; }
    const faces = result.faceLandmarks;
    if (!faces.length) { this.store.record(undefined, now); return; }
    // The largest face is the learner; others only trigger the "more than one face" note.
    let primary = 0; let largest = -1;
    const allBounds = faces.map((landmarks) => {
      const flat = new Float32Array(landmarks.length * 2);
      landmarks.forEach((point, index) => { flat[index * 2] = point.x; flat[index * 2 + 1] = point.y; });
      return boundsOf(flat);
    });
    allBounds.forEach((bounds, index) => { const area = bounds.w * bounds.h; if (area > largest) { largest = area; primary = index; } });
    const landmarks = faces[primary]!;
    const indices = this.indices!;
    const points = new Float32Array(indices.length * 2);
    indices.forEach((landmark, index) => { const point = landmarks[landmark]; if (point) { points[index * 2] = point.x; points[index * 2 + 1] = point.y; } });
    const shapes = result.faceBlendshapes?.[primary]?.categories ?? [];
    const score = (name: string) => shapes.find((category) => category.categoryName === name)?.score ?? 0;
    const matrix = result.facialTransformationMatrixes?.[primary]?.data;
    const bounds = allBounds[primary]!;
    if (now - this.lastBrightness >= BRIGHTNESS_EVERY_MS) { this.lastBrightness = now; this.brightness = this.sampleBrightness(bounds) ?? this.brightness; }
    this.store.record({
      at: now, faces: faces.length, bounds, points,
      pose: matrix ? headPose(matrix) : { yaw: 0, pitch: 0, roll: 0 },
      eyeClosure: (score('eyeBlinkLeft') + score('eyeBlinkRight')) / 2,
      brightness: this.brightness,
    }, now);
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
