import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import type { MonitoringPurpose, MonitoringStatus } from '../../../shared/types';
import { useSessions } from '../../state/useSessions';
import { MonitorContext, type MonitorState } from './monitoringContext';
import {
  batchLength, CAMERA_LADDER, constraintsFor, GOOD_FPS, initialProcessingStep, MAX_QUEUE_MS, MIN_FPS, packBatch, pickConfig,
  PROCESSING_STEPS, RecoveryController, TARGET_FPS, type CameraConfig, type ProbeResult,
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
  const location = useLocation();

  const release = useCallback(() => {
    const current = loop.current;
    current.cancelled = true;
    current.capture?.stop(); current.tracker?.stop();
    clearInterval(current.heartbeat); clearInterval(current.recovery); clearInterval(current.summary); clearTimeout(current.checkin);
    if (current.video) { current.video.pause(); current.video.srcObject = null; current.video.remove(); }
    live.current.stream?.getTracks().forEach((track) => track.stop());
    loop.current = newLoop();
    live.current.stream = undefined; setStream(undefined); setTracking(undefined);
  }, []);

  const finish = useCallback((status: MonitoringStatus | undefined, sessionId: string, error?: string) => {
    const samples = status?.window.samples ?? [];
    setState({ phase: error ? 'error' : 'idle', sessionId, error, finished: status ? { sessionId, valid: samples.filter((sample) => sample.valid).length, total: samples.length, reason: status.window.status === 'error' ? status.window.endReason : undefined, source: status.window.source } : undefined });
  }, []);

  const stop = useCallback(async (reason?: 'camera_too_slow') => {
    const { sessionId, windowId } = live.current;
    release();
    live.current = {};
    if (!sessionId || !windowId) { setState((previous) => ({ ...previous, phase: 'idle', tracking: undefined })); return; }
    setState((previous) => ({ ...previous, phase: 'stopping' }));
    try {
      const status = await stopMonitoring(sessionId, windowId, reason);
      finish(status, sessionId, reason ? status.window.endReason : undefined);
    } catch { finish(undefined, sessionId, 'Presage stopped, but the server could not confirm it. Readings received so far are kept.'); }
  }, [finish, release, stopMonitoring]);

  /** Applies a status from the server to the panel, or closes the window if the server ended it. */
  const applyStatus = useCallback((status: MonitoringStatus, sessionId: string, windowId: string) => {
    const current = loop.current;
    current.failures = 0; current.lastStatus = status;
    if (current.cancelled) return;
    if (status.window.status !== 'active') { release(); live.current = {}; finish(status, sessionId, status.window.status === 'error' ? status.window.endReason ?? 'Presage stopped.' : undefined); return; }
    const valid = status.window.samples.some((sample) => sample.valid);
    setState((previous) => previous.windowId === windowId ? { ...previous, status, phase: valid ? 'monitoring' : 'calibrating' } : previous);
  }, [finish, release]);

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
        if (++current.failures >= 5 && !current.cancelled) { release(); live.current = {}; finish(undefined, sessionId, 'The connection to the server was lost, so Presage stopped. Readings received before that are kept.'); }
      }).finally(() => { current.inFlight = false; pump(sessionId, windowId); });
  }, [applyStatus, finish, release, sendFrames]);

  /** Starts the local face tracker on the hidden video and publishes a summary a few times a second. */
  const startTracking = useCallback((video: HTMLVideoElement) => {
    const current = loop.current;
    const tracker = new FaceTrackLoop(video);
    current.tracker = tracker;
    setTracking(tracker.store);
    void tracker.start();
    current.summary = setInterval(() => {
      if (current.cancelled) return;
      const summary = tracker.store.summary(performance.now());
      setState((previous) => sameSummary(previous.tracking, summary) ? previous : { ...previous, tracking: summary });
    }, 500);
  }, []);

  /** Opens the camera and a hidden <video> that keeps frames flowing for capture and tracking. */
  const openCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser cannot use a camera on this page.');
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
    if (!media) throw new Error(cameraError(failure));
    live.current = { stream: media };
    setStream(media);
    const video = document.createElement('video');
    video.muted = true; video.playsInline = true; video.srcObject = media;
    // Kept in the document (invisible) so frame callbacks keep firing in browsers without track processors.
    Object.assign(video.style, { position: 'fixed', width: '2px', height: '2px', opacity: '0', pointerEvents: 'none', left: '0', top: '0' });
    document.body.append(video);
    await video.play().catch(() => undefined);
    loop.current.video = video;
    return { media, video, track: media.getVideoTracks()[0]! };
  }, []);

  const start = useCallback(async (sessionId: string, purpose: MonitoringPurpose, checkinSeconds?: number) => {
    const health = integration?.physiology;
    if (!health?.available) { setState({ phase: 'error', sessionId, error: health?.reason ?? 'Presage is unavailable on this server.' }); return; }
    if (live.current.windowId) await stop();
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
            .catch(() => undefined).finally(() => { current.inFlight = false; });
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
        const best = Math.max(0, ...results.map((result) => result.fps ?? 0));
        release(); live.current = {};
        setState({ phase: 'error', sessionId, error: `Your camera delivered at most ${Math.round(best)} fps (tried ${results.map((result) => result.config.label).join(', ')}). Presage needs at least ${MIN_FPS} fps (it targets ${TARGET_FPS}), so it is off for now. More light can help; your study session continues normally.` });
        return;
      }
      let configIndex = CAMERA_LADDER.findIndex((config) => config.label === choice!.config.label);
      await applyConfig(track, choice.config);

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
      capture.start();
      // Started only now: the face box must not compete with the camera-rate probe or with frame capture.
      startTracking(video);

      const controller = new RecoveryController();
      let lastDrops = 0;
      current.recovery = setInterval(() => {
        if (current.cancelled) return;
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
          void stop('camera_too_slow');
          return;
        }
        const captureFps = capture.camera.fps();
        setState((previous) => previous.windowId === windowId ? { ...previous, advice: controller.advice, camera: previous.camera ? { ...previous.camera, fps: captureFps ?? previous.camera.fps } : previous.camera } : previous);
      }, 1000);

      if (checkinSeconds) current.checkin = setTimeout(() => { void stop(); }, checkinSeconds * 1000);
    } catch (error) {
      release(); live.current = {};
      setState({ phase: 'error', sessionId, error: error instanceof Error ? error.message : 'Presage could not start.' });
    }
  }, [applyStatus, integration?.physiology, openCamera, pump, release, sendFrames, startMonitoring, startTracking, stop]);

  const dismiss = useCallback(() => setState((previous) => previous.phase === 'error' || previous.phase === 'idle' ? { phase: 'idle' } : previous), []);

  // Leaving this session's pages ends monitoring; the camera never runs in the background.
  const activeSession = state.phase === 'requesting' || state.phase === 'calibrating' || state.phase === 'monitoring' ? state.sessionId : undefined;
  useEffect(() => {
    if (activeSession && !location.pathname.includes(activeSession)) void stop();
  }, [activeSession, location.pathname, stop]);
  useEffect(() => () => release(), [release]);

  return <MonitorContext.Provider value={{ state, stream, tracking, start, stop: () => stop(), dismiss }}>
    {children}
  </MonitorContext.Provider>;
}
