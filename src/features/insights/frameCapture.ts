import { FpsMeter, JPEG_QUALITY, measureFps, processingSize, rgbaToRgb, type EncodedFrame, type FrameEncoding } from './cameraPipeline';

/*
 * Browser-only camera reading. Like Presage's own renderer, every real frame is read once via
 * MediaStreamTrackProcessor with its capture timestamp; requestVideoFrameCallback is the fallback
 * (it pauses while the page is hidden, so background tabs stop sending frames on those browsers).
 */
export type CapturedFrame = EncodedFrame;
/** JPEG encodes allowed in flight before new frames are dropped (and counted) instead of piling up. */
const MAX_PENDING_ENCODES = 4;

type Processor = new (init: { track: MediaStreamTrack }) => { readable: ReadableStream<VideoFrame> };
type FrameCallbackVideo = HTMLVideoElement & { requestVideoFrameCallback?: (callback: (now: number, metadata: { captureTime?: number; mediaTime: number }) => void) => number; cancelVideoFrameCallback?: (handle: number) => void };

/**
 * Pulls each real camera frame once, downsizes it, converts to RGB and hands it on.
 * Prefers MediaStreamTrackProcessor (true capture timestamps, as in Presage's renderer);
 * falls back to requestVideoFrameCallback (one callback per new frame).
 */
export class FrameCapture {
  readonly camera = new FpsMeter();
  readonly processed = new FpsMeter();
  /** Frames dropped because their capture time was not newer than the previous frame. */
  duplicates = 0;
  /** Frames dropped because JPEG encoding fell behind the camera. */
  encoderDrops = 0;
  encoding: FrameEncoding = 'rgb';
  private pending = 0;
  private chain: Promise<void> = Promise.resolve();
  method: 'track-processor' | 'video-frame-callback' = 'video-frame-callback';
  private active = false;
  private canvas: OffscreenCanvas | HTMLCanvasElement;
  private context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
  private lastUs = 0;
  private epochOffsetUs?: number;
  private reader?: ReadableStreamDefaultReader<VideoFrame>;
  private clone?: MediaStreamTrack;
  private handle?: number;
  /** JPEG worker; null when the browser cannot run one (main-thread encoding is the fallback). */
  private worker?: Worker | null;
  private nextJob = 0;
  private readonly jobs = new Map<number, { timestampUs: number; width: number; height: number }>();

  constructor(private readonly track: MediaStreamTrack, private readonly video: HTMLVideoElement, public longSide: number, private readonly onFrame: (frame: CapturedFrame) => void) {
    this.canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas');
    this.context = this.canvas.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
  }

  start() {
    this.active = true;
    const TrackProcessor = (globalThis as unknown as { MediaStreamTrackProcessor?: Processor }).MediaStreamTrackProcessor;
    if (TrackProcessor) {
      this.method = 'track-processor';
      // A clone keeps the preview <video> independent of this reader.
      this.clone = this.track.clone();
      this.reader = new TrackProcessor({ track: this.clone }).readable.getReader();
      void this.readLoop();
    } else {
      this.method = 'video-frame-callback';
      const video = this.video as FrameCallbackVideo;
      if (!video.requestVideoFrameCallback) throw new Error('This browser cannot read individual camera frames. Try a current Chrome, Edge or Safari.');
      const tick = (_now: number, metadata: { captureTime?: number; mediaTime: number }) => {
        if (!this.active) return;
        // captureTime is the camera's capture instant (ms since timeOrigin) when the browser knows it.
        const atMs = metadata.captureTime ?? performance.now();
        this.process(video, video.videoWidth, video.videoHeight, Math.round((performance.timeOrigin + atMs) * 1000));
        this.handle = video.requestVideoFrameCallback!(tick);
      };
      this.handle = video.requestVideoFrameCallback(tick);
    }
  }

  stop() {
    this.active = false;
    void this.reader?.cancel().catch(() => undefined);
    this.clone?.stop();
    const video = this.video as FrameCallbackVideo;
    if (this.handle !== undefined) video.cancelVideoFrameCallback?.(this.handle);
    this.worker?.terminate(); this.worker = undefined; this.jobs.clear();
  }

  /**
   * Hands a frame to the JPEG worker. Returns false when no worker can be used, so the caller
   * encodes on the main thread instead. On the main thread, canvas JPEG encoding competes with the
   * face tracker and falls to a few fps (measured: 2.7 fps), which makes Presage reject the stream.
   */
  private encodeInWorker(source: CanvasImageSource, width: number, height: number, timestampUs: number) {
    const worker = this.encoderWorker();
    if (!worker) return false;
    if (this.pending >= MAX_PENDING_ENCODES) { this.encoderDrops++; return true; }
    let frame: VideoFrame;
    try { frame = source instanceof VideoFrame ? source.clone() : new VideoFrame(source, { timestamp: Math.round(timestampUs) }); } catch { return false; }
    const id = ++this.nextJob;
    this.jobs.set(id, { timestampUs, width, height }); this.pending++;
    worker.postMessage({ id, frame, width, height, quality: JPEG_QUALITY }, [frame]);
    return true;
  }

  private encoderWorker() {
    if (this.worker !== undefined) return this.worker;
    try {
      if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined' || typeof VideoFrame === 'undefined') throw new Error('unsupported');
      const worker = new Worker(new URL('./jpegEncoder.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent<{ id: number; buffer?: ArrayBuffer }>) => {
        const job = this.jobs.get(event.data.id);
        if (!job) return;
        this.jobs.delete(event.data.id); this.pending--;
        if (!this.active) return;
        if (!event.data.buffer) { this.encoderDrops++; return; }
        this.processed.push(job.timestampUs / 1000);
        this.onFrame({ timestampUs: job.timestampUs, width: job.width, height: job.height, encoding: 'jpeg', bytes: new Uint8Array(event.data.buffer) });
      };
      // If the worker fails, frames it held are lost (counted) and encoding continues on the main thread.
      worker.onerror = () => { worker.terminate(); this.worker = null; this.encoderDrops += this.jobs.size; this.pending -= this.jobs.size; this.jobs.clear(); };
      this.worker = worker;
    } catch { this.worker = null; }
    return this.worker;
  }

  private async readLoop() {
    while (this.active && this.reader) {
      let result: ReadableStreamReadResult<VideoFrame>;
      try { result = await this.reader.read(); } catch { break; }
      if (result.done || !result.value) break;
      const frame = result.value;
      try {
        // VideoFrame.timestamp is µs on the media clock; anchor it once to epoch time (no ratchet).
        this.epochOffsetUs ??= Math.round((performance.timeOrigin + performance.now()) * 1000) - frame.timestamp;
        this.process(frame, frame.displayWidth, frame.displayHeight, frame.timestamp + this.epochOffsetUs);
      } finally { frame.close(); }
    }
  }

  private process(source: CanvasImageSource, sourceWidth: number, sourceHeight: number, timestampUs: number) {
    if (!sourceWidth || !sourceHeight || !this.context) return;
    this.camera.push(timestampUs / 1000);
    // Strictly increasing capture times only; an equal or older frame is a duplicate and is dropped.
    if (timestampUs <= this.lastUs) { this.duplicates++; return; }
    this.lastUs = timestampUs;
    const { width, height } = processingSize(sourceWidth, sourceHeight, this.longSide);
    if (this.encoding === 'jpeg' && this.encodeInWorker(source, width, height, timestampUs)) return;
    if (this.canvas.width !== width || this.canvas.height !== height) { this.canvas.width = width; this.canvas.height = height; }
    this.context.drawImage(source, 0, 0, sourceWidth, sourceHeight, 0, 0, width, height);
    if (this.encoding === 'rgb') {
      const rgba = this.context.getImageData(0, 0, width, height).data;
      this.processed.push(timestampUs / 1000);
      this.onFrame({ timestampUs, width, height, encoding: 'rgb', bytes: rgbaToRgb(rgba, new Uint8Array(width * height * 3)) });
      return;
    }
    if (this.pending >= MAX_PENDING_ENCODES) { this.encoderDrops++; return; }
    // The blob request snapshots the canvas now; the chain delivers frames in capture order.
    const canvas = this.canvas;
    const blob = 'convertToBlob' in canvas ? canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY })
      : new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
    this.pending++;
    this.chain = this.chain.then(async () => {
      try {
        const result = await blob;
        if (!result || !this.active) return;
        const bytes = new Uint8Array(await result.arrayBuffer());
        this.processed.push(timestampUs / 1000);
        this.onFrame({ timestampUs, width, height, encoding: 'jpeg', bytes });
      } catch { this.encoderDrops++; } finally { this.pending--; }
    });
  }
}

/** Measures what the camera really delivers for `durationMs`, from capture timestamps. */
export async function probeFps(track: MediaStreamTrack, video: HTMLVideoElement, durationMs = 1600, settleMs = 400): Promise<number | undefined> {
  const stamps: number[] = [];
  const TrackProcessor = (globalThis as unknown as { MediaStreamTrackProcessor?: Processor }).MediaStreamTrackProcessor;
  const started = performance.now();
  if (TrackProcessor) {
    const clone = track.clone();
    const reader = new TrackProcessor({ track: clone }).readable.getReader();
    try {
      while (performance.now() - started < settleMs + durationMs) {
        const result = await Promise.race([reader.read(), new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), settleMs + durationMs))]);
        if (!result || result.done || !result.value) break;
        if (performance.now() - started >= settleMs) stamps.push(result.value.timestamp / 1000);
        result.value.close();
      }
    } finally { void reader.cancel().catch(() => undefined); clone.stop(); }
    return measureFps(stamps);
  }
  const element = video as FrameCallbackVideo;
  if (!element.requestVideoFrameCallback) return undefined;
  await new Promise<void>((resolve) => {
    const tick = (now: number, metadata: { captureTime?: number }) => {
      if (now - started >= settleMs) stamps.push(metadata.captureTime ?? now);
      if (now - started < settleMs + durationMs) element.requestVideoFrameCallback!(tick); else resolve();
    };
    element.requestVideoFrameCallback!(tick);
    setTimeout(resolve, settleMs + durationMs + 500);
  });
  return measureFps(stamps);
}
