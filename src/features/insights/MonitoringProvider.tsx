import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import type { MonitoringPurpose, MonitoringStatus } from '../../../shared/types';
import { PracticeApiError } from '../../services/practiceApi';
import { useSessions } from '../../state/useSessions';
import { MonitorContext, type MonitorState } from './monitoringContext';
import {
  batchLength, CAMERA_LADDER, constraintsFor, GOOD_FPS, HEALTHY_RESET_MS, initialProcessingStep, MAX_QUEUE_MS, MIN_FPS, packBatch, pickConfig,
  PROCESSING_STEPS, RecoveryController, retryDelay, STALL_MS, TARGET_FPS, type CameraConfig, type ProbeResult,
} from './cameraPipeline';
import { FrameCapture, probeFps, type CapturedFrame } from './frameCapture';
import { FaceTrackLoop, type TrackingStore, type TrackingSummary } from './faceTracker';

function cameraError(error: unknown): string {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Camera access is blocked. Allow the camera for this site in your browser settings to use Presage. Everything else works without it.';
  if (name === 'NotFoundError') return 'No camera was found. Presage is optional; you can keep studying without it.';
  if (name === 'NotReadableError') return 'Your camera is being used by another app. Close it and try again.';
  return 'The camera could not be started. Presage is optional; you can keep studying without it.';
}

/** A failure starting Presage; `fatal` means retrying cannot help, so the learner sees it instead. */
class StartError extends Error {
  constructor(message: string, readonly fatal: boolean) { super(message); }
}
/** Blocked, missing or unsupported cameras need the learner; a busy or glitching camera may free up. */
const FATAL_CAMERA_ERRORS = new Set(['NotAllowedError', 'SecurityError', 'NotFoundError']);
/** Server answers that a new window cannot change. */
const FATAL_API_CODES = new Set(['MONITORING_UNAVAILABLE', 'UNAUTHORIZED', 'NOT_FOUND', 'INVALID_STAGE']);
function isFatal(error: unknown) {
  if (error instanceof StartError) return error.fatal;
  return error instanceof PracticeApiError && Boolean(error.code && FATAL_API_CODES.has(error.code));
}
const errorMessage = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;
/** Longest wait for the face tracker's model before frame capture starts anyway. */
const TRACKER_LOAD_WAIT_MS = 8000;
/**
 * The same server-side Presage failure this many times in a row, with no reading in between, means
 * restarting will not help (e.g. a server without the GPU support Presage needs). Retries stop there.
 */
const MAX_REPEATED_SERVER_FAILURES = 3;

interface Loop {
  capture?: FrameCapture;
  tracker?: FaceTrackLoop;
  heartbeat?: ReturnType<typeof setInterval>;
  recovery?: ReturnType<typeof setInterval>;
  summary?: ReturnType<typeof setInterval>;
  checkin?: ReturnType<typeof setTimeout>;
  video?: HTMLVideoElement;
  queue: CapturedFrame[];
  queueDrops: number;
  inFlight: boolean;
  failures: number;
  cancelled: boolean;
  /** Removes the camera-disconnect listener. */
  unwatch?: () => void;
  lastStatus?: MonitoringStatus;
}
const newLoop = (): Loop => ({ queue: [], queueDrops: 0, inFlight: false, failures: 0, cancelled: false });

/** Applies a ladder configuration to a live track; resolves false if the camera refuses it. */
async function applyConfig(track: MediaStreamTrack, config: CameraConfig) {
  try { await track.applyConstraints(constraintsFor(config)); return true; } catch { return false; }
}

const sameSummary = (a?: TrackingSummary, b?: TrackingSummary) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Owns the optional camera for the whole app so Presage survives the move from the study page to
 * results. Every real camera frame is read once with its capture timestamp, downsized, encoded
 * (raw RGB to a server on this machine, high-quality JPEG otherwise) and posted in small ordered
 * batches to this app's server, which feeds the Presage SDK. In parallel, a local face tracker
 * analyses the same camera feed in the browser for the on-screen tracking overlay. Frames are
 * never stored, duplicated or re-timed.
 */
export function MonitoringProvider({ children }: { children: ReactNode }) {
  const { integration, startMonitoring, sendFrames, stopMonitoring } = useSessions();
  const [state, setState] = useState<MonitorState>({ phase: 'idle' });
  const [stream, setStream] = useState<MediaStream>();
  const [tracking, setTracking] = useState<TrackingStore>();
  const loop = useRef<Loop>(newLoop());
  const live = useRef<{ sessionId?: string; windowId?: string; stream?: MediaStream }>({});
  /** What the learner turned on. While set, failures restart Presage instead of ending it. */
  const intent = useRef<{ sessionId: string; purpose: MonitoringPurpose; checkinEndsAt?: number }>(undefined);
  const retry = useRef<{ attempt: number; timer?: ReturnType<typeof setTimeout>; onVisible?: () => void; serverFailure?: { reason: string; count: number } }>({ attempt: 0 });
  const beginRef = useRef<(sessionId: string, purpose: MonitoringPurpose, checkinSeconds?: number) => Promise<void>>(undefined);
  const location = useLocation();

  const release = useCallback(() => {
    const current = loop.current;
    current.cancelled = true;
    current.capture?.stop(); current.tracker?.stop();
    clearInterval(current.heartbeat); clearInterval(current.recovery); clearInterval(current.summary); clearTimeout(current.checkin); current.unwatch?.();
    clearTimeout(retry.current.timer); retry.current.timer = undefined;
    if (retry.current.onVisible) { document.removeEventListener('visibilitychange', retry.current.onVisible); retry.current.onVisible = undefined; }
    if (current.video) { current.video.pause(); current.video.srcObject = null; current.video.remove(); }
    live.current.stream?.getTracks().forEach((track) => track.stop());
    loop.current = newLoop();
    live.current.stream = undefined; setStream(undefined); setTracking(undefined);
  }, []);

  const finish = useCallback((status: MonitoringStatus | undefined, sessionId: string, error?: string) => {
    const samples = status?.window.samples ?? [];
    setState({ phase: error ? 'error' : 'idle', sessionId, error, finished: status ? { sessionId, valid: samples.filter((sample) => sample.valid).length, total: samples.length, reason: status.window.status === 'error' ? status.window.endReason : undefined, source: status.window.source } : undefined });
  }, []);

  /** The learner's stop (or leaving the session): ends the window and any automatic restarts. */
  const stop = useCallback(async () => {
    intent.current = undefined; retry.current.attempt = 0;
    const { sessionId, windowId } = live.current;
    release();
    live.current = {};
    if (!sessionId || !windowId) { setState((previous) => ({ ...previous, phase: 'idle', tracking: undefined, retry: undefined })); return; }
    setState((previous) => ({ ...previous, phase: 'stopping' }));
    try {
      const status = await stopMonitoring(sessionId, windowId);
      finish(status, sessionId);
    } catch { finish(undefined, sessionId, 'Presage stopped, but the server could not confirm it. Readings received so far are kept.'); }
  }, [finish, release, stopMonitoring]);

  /** Ends Presage with a message the learner needs to see; no automatic restart follows. */
  const fail = useCallback((sessionId: string, error: string) => {
    intent.current = undefined; retry.current.attempt = 0;
    release(); live.current = {};
    setState({ phase: 'error', sessionId, error });
  }, [release]);

  /**
   * Something a fresh start can fix went wrong: close this window (its readings are kept), wait
   * with backoff, then start again on its own. A background tab waits until it is visible again,
   * since most browsers stop delivering camera frames to hidden pages.
   */
  const recover = useCallback((reason: string, slow = false) => {
    const target = intent.current;
    if (!target) return;
    const { sessionId, windowId } = live.current;
    release(); live.current = {};
    if (sessionId && windowId) void stopMonitoring(sessionId, windowId, slow ? 'camera_too_slow' : undefined).catch(() => undefined);
    const attempt = retry.current.attempt++;
    const delay = retryDelay(attempt, slow);
    setState((previous) => ({ phase: 'reconnecting', sessionId: target.sessionId, purpose: target.purpose, source: previous.source, retry: { attempt: attempt + 1, at: Date.now() + delay, reason } }));
    const resume = () => {
      retry.current.timer = undefined;
      if (intent.current !== target) return;
      if (document.visibilityState === 'hidden') {
        setState((previous) => previous.phase === 'reconnecting' && previous.retry ? { ...previous, retry: { ...previous.retry, waitingForTab: true } } : previous);
        const onVisible = () => {
          if (document.visibilityState !== 'visible') return;
          document.removeEventListener('visibilitychange', onVisible); retry.current.onVisible = undefined;
          resume();
        };
        retry.current.onVisible = onVisible;
        document.addEventListener('visibilitychange', onVisible);
        return;
      }
      const remaining = target.checkinEndsAt ? Math.ceil((target.checkinEndsAt - Date.now()) / 1000) : undefined;
      if (remaining !== undefined && remaining <= 0) { intent.current = undefined; setState({ phase: 'idle', sessionId: target.sessionId }); return; }
      void beginRef.current?.(target.sessionId, target.purpose, remaining);
    };
    retry.current.timer = setTimeout(resume, delay);
  }, [release, stopMonitoring]);

  /** Applies a status from the server to the panel, or closes the window if the server ended it. */
  const applyStatus = useCallback((status: MonitoringStatus, sessionId: string, windowId: string) => {
    const current = loop.current;
    // A late reply for a window that has since been replaced (after a restart) is ignored.
    if (current.cancelled || live.current.windowId !== windowId) return;
    current.failures = 0; current.lastStatus = status;
    if (status.window.status !== 'active') {
      // The server ended the window without the learner asking: start a new one unless retrying cannot help.
      const reason = status.window.endReason ?? 'Presage stopped.';
      if (status.window.status === 'error' && !status.window.samples.some((sample) => sample.valid)) {
        const previous = retry.current.serverFailure;
        retry.current.serverFailure = { reason, count: previous?.reason === reason ? previous.count + 1 : 1 };
      }
      if (intent.current && (retry.current.serverFailure?.count ?? 0) >= MAX_REPEATED_SERVER_FAILURES) {
        fail(sessionId, `${reason.replace(/\.$/, '')}, ${MAX_REPEATED_SERVER_FAILURES} times in a row, so Presage stopped retrying. The server may not support it right now; your study session continues normally.`); return;
      }
      if (intent.current && !status.window.fatal) { recover(reason); return; }
      if (status.window.fatal) { intent.current = undefined; retry.current.attempt = 0; }
      release(); live.current = {}; finish(status, sessionId, status.window.status === 'error' ? status.window.endReason ?? 'Presage stopped.' : undefined); return;
    }
    const valid = status.window.samples.some((sample) => sample.valid);
    if (valid) { retry.current.attempt = 0; retry.current.serverFailure = undefined; }
    setState((previous) => previous.windowId === windowId ? { ...previous, status, phase: valid ? 'monitoring' : 'calibrating' } : previous);
  }, [fail, finish, recover, release]);

  /** Sends queued frames in capture order, one request at a time, as soon as the last one returns. */
  const pump = useCallback((sessionId: string, windowId: string) => {
    const current = loop.current;
    if (current.inFlight || current.cancelled || !current.queue.length) return;
    const batch = current.queue.splice(0, batchLength(current.queue));
    const first = batch[0]!;
    current.inFlight = true;
    void sendFrames(sessionId, windowId, packBatch(batch), first.width, first.height, current.capture?.camera.fps(), first.encoding)
      .then((status) => applyStatus(status, sessionId, windowId))
      .catch(() => {
        if (++current.failures >= 5 && !current.cancelled) recover('The connection to the server was lost.');
      }).finally(() => { current.inFlight = false; pump(sessionId, windowId); });
  }, [applyStatus, recover, sendFrames]);

  /** Starts the local face tracker on the hidden video and publishes a summary a few times a second. Resolves once its model has loaded (or failed to). */
  const startTracking = useCallback((video: HTMLVideoElement) => {
    const current = loop.current;
    const tracker = new FaceTrackLoop(video);
    current.tracker = tracker;
    setTracking(tracker.store);
    const ready = tracker.start();
    current.summary = setInterval(() => {
      if (current.cancelled) return;
      const summary = tracker.store.summary(performance.now());
      setState((previous) => sameSummary(previous.tracking, summary) ? previous : { ...previous, tracking: summary });
    }, 500);
    return ready;
  }, []);

  /** Opens the camera and a hidden <video> that keeps frames flowing for capture and tracking. */
  const openCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) throw new StartError('This browser cannot use a camera on this page.', true);
    // Like Presage's reference app: ask for HD at a hard 25 fps minimum first, then relax. Only a
    // permission or device error ends the attempts; an unsatisfiable constraint just moves on.
    const first = CAMERA_LADDER[0]!;
    const attempts: MediaStreamConstraints[] = [
      { video: constraintsFor({ ...first, minFrameRate: MIN_FPS }), audio: false },
      { video: constraintsFor(first), audio: false },
      { video: { frameRate: { ideal: first.frameRate } }, audio: false },
      { video: true, audio: false },
    ];
    let media: MediaStream | undefined; let failure: unknown;
    for (const constraints of attempts) {
      try { media = await navigator.mediaDevices.getUserMedia(constraints); break; }
      catch (error) { failure = error; if (!(error instanceof DOMException) || error.name !== 'OverconstrainedError') break; }
    }
    if (!media) throw new StartError(cameraError(failure), failure instanceof DOMException && FATAL_CAMERA_ERRORS.has(failure.name));
    live.current = { stream: media };
    setStream(media);
    const video = document.createElement('video');
    video.muted = true; video.playsInline = true; video.srcObject = media;
    // Kept in the document (invisible) so frame callbacks keep firing in browsers without track processors.
    Object.assign(video.style, { position: 'fixed', width: '2px', height: '2px', opacity: '0', pointerEvents: 'none', left: '0', top: '0' });
    document.body.append(video);
    await video.play().catch(() => undefined);
    const current = loop.current;
    current.video = video;
    const track = media.getVideoTracks()[0]!;
    // Unplugged, taken by another app, or the computer slept: start over once it is back.
    const onEnded = () => { if (!current.cancelled) recover('The camera was disconnected.'); };
    track.addEventListener('ended', onEnded);
    current.unwatch = () => track.removeEventListener('ended', onEnded);
    return { media, video, track };
  }, [recover]);

  /** One attempt at starting Presage. Failures go to `recover` (retry) or `fail` (needs the learner). */
  const begin = useCallback(async (sessionId: string, purpose: MonitoringPurpose, checkinSeconds?: number) => {
    const health = integration?.physiology;
    if (!health?.available) { fail(sessionId, health?.reason ?? 'Presage is unavailable on this server.'); return; }
    setState({ phase: 'requesting', sessionId, purpose, source: health.source });
    const current = loop.current;
    try {
      if (health.source === 'simulated') {
        // Readings are synthetic, but the camera (if allowed) still drives the real local face tracker.
        let cameraNote: string | undefined;
        try { const { video } = await openCamera(); startTracking(video); }
        catch (error) { cameraNote = error instanceof Error ? error.message : 'The camera could not be started.'; }
        if (current.cancelled) return;
        const windowId = await startMonitoring(sessionId, purpose);
        if (current.cancelled) return;
        live.current = { ...live.current, sessionId, windowId };
        const startedAt = Date.now();
        setState((previous) => ({ ...previous, phase: 'calibrating', sessionId, windowId, purpose, source: health.source, startedAt, endsAt: checkinSeconds ? startedAt + checkinSeconds * 1000 : undefined, cameraOn: !cameraNote, cameraNote }));
        current.heartbeat = setInterval(() => {
          if (current.inFlight) return;
          current.inFlight = true;
          void sendFrames(sessionId, windowId, new Uint8Array(0), 0, 0).then((status) => applyStatus(status, sessionId, windowId))
            .catch(() => { if (++current.failures >= 5 && !current.cancelled) recover('The connection to the server was lost.'); })
            .finally(() => { current.inFlight = false; });
        }, 1000);
        if (checkinSeconds) current.checkin = setTimeout(() => { void stop(); }, checkinSeconds * 1000);
        return;
      }

      // Ask for the camera before opening a server window, so a denial (or an unusable camera) costs nothing.
      const { media, video, track } = await openCamera();
      setState((previous) => ({ ...previous, cameraOn: true }));

      // Negotiate: measure what each configuration really delivers, rather than trusting advertised settings.
      const results: ProbeResult[] = [];
      for (const [index, config] of CAMERA_LADDER.entries()) {
        if (current.cancelled) return;
        if (index > 0 && !(await applyConfig(track, config))) continue;
        setState((previous) => ({ ...previous, phase: 'requesting', probe: `Checking ${config.label}…` }));
        const fps = await probeFps(track, video);
        const settings = track.getSettings();
        results.push({ config, fps, width: settings.width ?? config.width, height: settings.height ?? config.height });
        setState((previous) => ({ ...previous, probe: `${settings.width ?? config.width}×${settings.height ?? config.height}: ${fps ? Math.round(fps) : '—'} fps` }));
        if ((fps ?? 0) >= GOOD_FPS) break;
      }
      let choice = pickConfig(results);
      // Some webcams lengthen exposure in dim light; asking for a minimum rate can keep them at speed.
      if (choice && (choice.fps ?? 0) < GOOD_FPS) {
        const strict = { ...choice.config, minFrameRate: MIN_FPS };
        if (await applyConfig(track, strict)) {
          const fps = await probeFps(track, video);
          if ((fps ?? 0) > (choice.fps ?? 0)) choice = { ...choice, config: strict, fps };
        }
      }
      if (current.cancelled) return;
      if (!choice) {
        // Webcams speed up when the light improves, so this is worth another try later.
        const best = Math.max(0, ...results.map((result) => result.fps ?? 0));
        recover(`Your camera delivered at most ${Math.round(best)} fps; Presage needs ${MIN_FPS} (it targets ${TARGET_FPS}). More light helps.`, true);
        return;
      }
      let configIndex = CAMERA_LADDER.findIndex((config) => config.label === choice!.config.label);
      await applyConfig(track, choice.config);
      // The face tracker loads its model first. Loading blocks the page for a second or two, and if that
      // happened during capture, Presage would see a gap of over 2 s between frames and stop the window.
      await Promise.race([startTracking(video), new Promise((resolve) => setTimeout(resolve, TRACKER_LOAD_WAIT_MS))]);
      if (current.cancelled) return;

      const windowId = await startMonitoring(sessionId, purpose);
      if (current.cancelled) return;
      live.current = { sessionId, windowId, stream: media };
      const startedAt = Date.now();
      let stepIndex = initialProcessingStep(window.location.hostname);
      const step = PROCESSING_STEPS[stepIndex]!;
      setState((previous) => ({ ...previous, phase: 'calibrating', sessionId, windowId, purpose, source: health.source, startedAt, endsAt: checkinSeconds ? startedAt + checkinSeconds * 1000 : undefined, camera: { label: choice.config.label, fps: choice.fps }, encoding: step.encoding, probe: undefined }));

      const capture = new FrameCapture(track, video, step.longSide, (frame) => {
        current.queue.push(frame);
        // Bounded buffer: frames older than MAX_QUEUE_MS are dropped (and counted), never sent late.
        while (current.queue.length > 1 && frame.timestampUs - current.queue[0]!.timestampUs > MAX_QUEUE_MS * 1000) { current.queue.shift(); current.queueDrops++; }
        pump(sessionId, windowId);
      });
      capture.encoding = step.encoding;
      current.capture = capture;
      try { capture.start(); } catch (error) { throw new StartError(errorMessage(error, 'This browser cannot read camera frames.'), true); }

      const controller = new RecoveryController();
      let lastDrops = 0; let lastTotal = -1; let progressAt = Date.now();
      current.recovery = setInterval(() => {
        if (current.cancelled) return;
        // Watchdog: a camera that stops delivering frames (frozen driver, device taken) is restarted.
        if (capture.camera.total !== lastTotal) { lastTotal = capture.camera.total; progressAt = Date.now(); }
        else if (Date.now() - progressAt >= STALL_MS) { recover('The camera stopped sending frames.'); return; }
        if (Date.now() - startedAt >= HEALTHY_RESET_MS) retry.current.attempt = 0;
        const status = current.lastStatus;
        const drops = current.queueDrops + capture.encoderDrops - lastDrops; lastDrops = current.queueDrops + capture.encoderDrops;
        const action = controller.evaluate({
          elapsedMs: Date.now() - startedAt, captureFps: capture.camera.fps(), deliveredFps: status?.pipeline?.deliveredFps, queueDrops: drops,
          code: status?.code, validReadings: status?.window.samples.filter((sample) => sample.valid).length ?? 0,
        }, { canLowerCapture: configIndex < CAMERA_LADDER.length - 1, canLowerProcessing: stepIndex < PROCESSING_STEPS.length - 1 });
        if (action.kind === 'lower_capture') {
          configIndex++;
          const next = CAMERA_LADDER[configIndex]!;
          void applyConfig(track, next).then(() => { capture.camera.reset(); setState((previous) => ({ ...previous, camera: { label: next.label, fps: undefined } })); });
        } else if (action.kind === 'lower_processing') {
          stepIndex++;
          const next = PROCESSING_STEPS[stepIndex]!;
          capture.longSide = next.longSide; capture.encoding = next.encoding;
          setState((previous) => ({ ...previous, encoding: next.encoding }));
        } else if (action.kind === 'give_up') {
          recover(action.reason, true);
          return;
        }
        const captureFps = capture.camera.fps();
        setState((previous) => previous.windowId === windowId ? { ...previous, advice: controller.advice, camera: previous.camera ? { ...previous.camera, fps: captureFps ?? previous.camera.fps } : previous.camera } : previous);
      }, 1000);

      if (checkinSeconds) current.checkin = setTimeout(() => { void stop(); }, checkinSeconds * 1000);
    } catch (error) {
      if (current.cancelled) return;
      if (isFatal(error)) fail(sessionId, errorMessage(error, 'Presage could not start.'));
      // A server answer without a code means it was unreachable or broken; its "try again" wording does not fit an automatic retry.
      else recover(error instanceof PracticeApiError && !error.code ? 'The server can’t be reached right now.' : errorMessage(error, 'Presage could not start.'));
    }
  }, [applyStatus, fail, integration?.physiology, openCamera, pump, recover, sendFrames, startMonitoring, startTracking, stop]);
  useEffect(() => { beginRef.current = begin; }, [begin]);

  /** The learner turns Presage on. From here it keeps itself running until they stop or leave. */
  const start = useCallback(async (sessionId: string, purpose: MonitoringPurpose, checkinSeconds?: number) => {
    if (live.current.windowId || intent.current) await stop();
    intent.current = { sessionId, purpose, checkinEndsAt: checkinSeconds ? Date.now() + checkinSeconds * 1000 : undefined };
    retry.current.attempt = 0; retry.current.serverFailure = undefined;
    await begin(sessionId, purpose, checkinSeconds);
  }, [begin, stop]);

  const dismiss = useCallback(() => setState((previous) => previous.phase === 'error' || previous.phase === 'idle' ? { phase: 'idle' } : previous), []);

  // Leaving this session's pages ends monitoring; the camera never runs in the background.
  const activeSession = state.phase === 'requesting' || state.phase === 'calibrating' || state.phase === 'monitoring' || state.phase === 'reconnecting' ? state.sessionId : undefined;
  useEffect(() => {
    if (activeSession && !location.pathname.includes(activeSession)) void stop();
  }, [activeSession, location.pathname, stop]);
  useEffect(() => () => { intent.current = undefined; release(); }, [release]);

  return <MonitorContext.Provider value={{ state, stream, tracking, start, stop: () => stop(), dismiss }}>
    {children}
  </MonitorContext.Provider>;
}
