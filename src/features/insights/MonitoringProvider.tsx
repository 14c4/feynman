import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import type { MonitoringPurpose, MonitoringStatus } from '../../../shared/types';
import { useSessions } from '../../state/useSessions';
import { MonitorContext, type MonitorState } from './monitoringContext';
import { MonitorDock } from './MonitorDock';
import {
  CAMERA_LADDER, constraintsFor, MAX_BATCH_BYTES, MAX_BATCH_FRAMES, MAX_QUEUE_MS, MIN_FPS, pickConfig,
  PROCESSING_LONG_SIDES, RecoveryController, TARGET_FPS, type CameraConfig, type ProbeResult,
} from './cameraPipeline';
import { FrameCapture, probeFps, type CapturedFrame } from './frameCapture';

function cameraError(error: unknown): string {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Camera access is blocked. Allow the camera for this site in your browser settings to use camera insights. Everything else works without it.';
  if (name === 'NotFoundError') return 'No camera was found. Camera insights are optional; you can keep studying without them.';
  if (name === 'NotReadableError') return 'Your camera is being used by another app. Close it and try again.';
  return 'The camera could not be started. Camera insights are optional; you can keep studying without them.';
}

interface Loop {
  capture?: FrameCapture;
  heartbeat?: ReturnType<typeof setInterval>;
  recovery?: ReturnType<typeof setInterval>;
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

/**
 * Owns the optional camera for the whole app so monitoring survives the move from the study
 * page to results. Every real camera frame is read once with its capture timestamp, downsized
 * (long side ≤ 480), converted to RGB and posted in small ordered batches to this app's server,
 * which forwards them to the Presage SDK. Frames are never stored, duplicated or re-timed.
 */
export function MonitoringProvider({ children }: { children: ReactNode }) {
  const { integration, startMonitoring, sendFrames, stopMonitoring } = useSessions();
  const [state, setState] = useState<MonitorState>({ phase: 'idle' });
  const [stream, setStream] = useState<MediaStream>();
  const loop = useRef<Loop>(newLoop());
  const live = useRef<{ sessionId?: string; windowId?: string; stream?: MediaStream }>({});
  const location = useLocation();

  const release = useCallback(() => {
    const current = loop.current;
    current.cancelled = true;
    current.capture?.stop();
    clearInterval(current.heartbeat); clearInterval(current.recovery); clearTimeout(current.checkin);
    if (current.video) { current.video.pause(); current.video.srcObject = null; current.video.remove(); }
    live.current.stream?.getTracks().forEach((track) => track.stop());
    loop.current = newLoop();
    live.current.stream = undefined; setStream(undefined);
  }, []);

  const finish = useCallback((status: MonitoringStatus | undefined, sessionId: string, error?: string) => {
    const samples = status?.window.samples ?? [];
    setState({ phase: error ? 'error' : 'idle', error, finished: status ? { sessionId, valid: samples.filter((sample) => sample.valid).length, total: samples.length, reason: status.window.status === 'error' ? status.window.endReason : undefined, source: status.window.source } : undefined });
  }, []);

  const stop = useCallback(async (reason?: 'camera_too_slow') => {
    const { sessionId, windowId } = live.current;
    release();
    live.current = {};
    if (!sessionId || !windowId) { setState((previous) => ({ ...previous, phase: 'idle' })); return; }
    setState((previous) => ({ ...previous, phase: 'stopping' }));
    try {
      const status = await stopMonitoring(sessionId, windowId, reason);
      finish(status, sessionId, reason ? status.window.endReason : undefined);
    } catch { finish(undefined, sessionId, 'Monitoring stopped, but the server could not confirm it. Readings received so far are kept.'); }
  }, [finish, release, stopMonitoring]);

  /** Sends queued frames in capture order, one request at a time, as soon as the last one returns. */
  const pump = useCallback((sessionId: string, windowId: string) => {
    const current = loop.current;
    if (current.inFlight || current.cancelled || !current.queue.length) return;
    const first = current.queue[0]!;
    const frameBytes = 8 + first.rgb.length;
    const count = Math.min(MAX_BATCH_FRAMES, Math.max(1, Math.floor(MAX_BATCH_BYTES / frameBytes)),
      current.queue.findIndex((frame) => frame.width !== first.width || frame.height !== first.height) === -1 ? current.queue.length : current.queue.findIndex((frame) => frame.width !== first.width || frame.height !== first.height));
    const batch = current.queue.splice(0, count);
    const body = new Uint8Array(batch.length * frameBytes);
    const view = new DataView(body.buffer);
    batch.forEach((frame, index) => { view.setFloat64(index * frameBytes, frame.timestampUs, true); body.set(frame.rgb, index * frameBytes + 8); });
    current.inFlight = true;
    void sendFrames(sessionId, windowId, body, first.width, first.height, current.capture?.camera.fps()).then((status) => {
      current.failures = 0; current.lastStatus = status;
      if (current.cancelled) return;
      if (status.window.status !== 'active') { release(); live.current = {}; finish(status, sessionId, status.window.status === 'error' ? status.window.endReason ?? 'Monitoring stopped.' : undefined); return; }
      const valid = status.window.samples.some((sample) => sample.valid);
      setState((previous) => previous.windowId === windowId ? { ...previous, status, phase: valid ? 'monitoring' : 'calibrating' } : previous);
    }).catch(() => {
      if (++current.failures >= 5 && !current.cancelled) { release(); live.current = {}; finish(undefined, sessionId, 'The connection to the server was lost, so monitoring stopped. Readings received before that are kept.'); }
    }).finally(() => { current.inFlight = false; pump(sessionId, windowId); });
  }, [finish, release, sendFrames]);

  const start = useCallback(async (sessionId: string, purpose: MonitoringPurpose, checkinSeconds?: number) => {
    const health = integration?.physiology;
    if (!health?.available) { setState({ phase: 'error', error: health?.reason ?? 'Camera insights are unavailable on this server.' }); return; }
    if (live.current.windowId) await stop();
    setState({ phase: 'requesting', sessionId, purpose, source: health.source });
    const current = loop.current;
    try {
      if (health.source === 'simulated') {
        // Simulated development readings never use the camera.
        const windowId = await startMonitoring(sessionId, purpose);
        live.current = { sessionId, windowId };
        const startedAt = Date.now();
        setState({ phase: 'calibrating', sessionId, windowId, purpose, source: health.source, startedAt, endsAt: checkinSeconds ? startedAt + checkinSeconds * 1000 : undefined });
        current.heartbeat = setInterval(() => {
          if (current.inFlight) return;
          current.inFlight = true;
          void sendFrames(sessionId, windowId, new Uint8Array(0), 0, 0).then((status) => {
            if (status.window.status !== 'active') { release(); live.current = {}; finish(status, sessionId); return; }
            setState((previous) => previous.windowId === windowId ? { ...previous, status, phase: status.window.samples.some((sample) => sample.valid) ? 'monitoring' : 'calibrating' } : previous);
          }).catch(() => undefined).finally(() => { current.inFlight = false; });
        }, 1000);
        if (checkinSeconds) current.checkin = setTimeout(() => { void stop(); }, checkinSeconds * 1000);
        return;
      }

      if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser cannot use a camera on this page.');
      // Ask for the camera before opening a server window, so a denial (or an unusable camera) costs nothing.
      const media = await navigator.mediaDevices.getUserMedia({ video: constraintsFor(CAMERA_LADDER[0]!), audio: false })
        .catch((error: unknown) => { throw new Error(cameraError(error)); });
      live.current = { stream: media };
      setStream(media);
      const track = media.getVideoTracks()[0]!;
      const video = document.createElement('video');
      video.muted = true; video.playsInline = true; video.srcObject = media;
      // Kept in the document (invisible) so frame callbacks keep firing in browsers without track processors.
      Object.assign(video.style, { position: 'fixed', width: '2px', height: '2px', opacity: '0', pointerEvents: 'none', left: '0', top: '0' });
      document.body.append(video);
      await video.play().catch(() => undefined);
      current.video = video;

      // Negotiate: measure what each configuration really delivers, rather than trusting advertised settings.
      const results: ProbeResult[] = [];
      let configIndex = 0;
      for (const [index, config] of CAMERA_LADDER.entries()) {
        if (current.cancelled) return;
        if (index > 0 && !(await applyConfig(track, config))) continue;
        setState((previous) => ({ ...previous, phase: 'requesting', probe: `Checking ${config.label}…` }));
        const fps = await probeFps(track, video);
        const settings = track.getSettings();
        results.push({ config, fps, width: settings.width ?? config.width, height: settings.height ?? config.height });
        setState((previous) => ({ ...previous, probe: `${settings.width ?? config.width}×${settings.height ?? config.height}: ${fps ? Math.round(fps) : '—'} fps` }));
        if ((fps ?? 0) >= TARGET_FPS) break;
      }
      let choice = pickConfig(results);
      // Some webcams lengthen exposure in dim light; asking for a minimum rate can keep them at speed.
      if (choice && (choice.fps ?? 0) < TARGET_FPS) {
        const strict = { ...choice.config, minFrameRate: TARGET_FPS };
        if (await applyConfig(track, strict)) {
          const fps = await probeFps(track, video);
          if ((fps ?? 0) > (choice.fps ?? 0)) choice = { ...choice, config: strict, fps };
        }
      }
      if (current.cancelled) return;
      if (!choice) {
        const best = Math.max(0, ...results.map((result) => result.fps ?? 0));
        release(); live.current = {};
        setState({ phase: 'error', sessionId, error: `Your camera delivered at most ${Math.round(best)} fps (tried ${results.map((result) => result.config.label).join(', ')}). Presage needs at least about ${MIN_FPS} fps, so camera insights are off for now. More light can help; your study session continues normally.` });
        return;
      }
      configIndex = CAMERA_LADDER.findIndex((config) => config.label === choice!.config.label);
      await applyConfig(track, choice.config);

      const windowId = await startMonitoring(sessionId, purpose);
      if (current.cancelled) return;
      live.current = { sessionId, windowId, stream: media };
      const startedAt = Date.now();
      setState({ phase: 'calibrating', sessionId, windowId, purpose, source: health.source, startedAt, endsAt: checkinSeconds ? startedAt + checkinSeconds * 1000 : undefined, camera: { label: choice.config.label, fps: choice.fps } });

      let longSideIndex = 0;
      const capture = new FrameCapture(track, video, PROCESSING_LONG_SIDES[0], (frame) => {
        current.queue.push(frame);
        // Bounded buffer: frames older than MAX_QUEUE_MS are dropped (and counted), never sent late.
        while (current.queue.length > 1 && frame.timestampUs - current.queue[0]!.timestampUs > MAX_QUEUE_MS * 1000) { current.queue.shift(); current.queueDrops++; }
        pump(sessionId, windowId);
      });
      current.capture = capture;
      capture.start();

      const controller = new RecoveryController();
      let lastDrops = 0;
      current.recovery = setInterval(() => {
        if (current.cancelled) return;
        const status = current.lastStatus;
        const drops = current.queueDrops - lastDrops; lastDrops = current.queueDrops;
        const action = controller.evaluate({
          elapsedMs: Date.now() - startedAt, captureFps: capture.camera.fps(), deliveredFps: status?.pipeline?.deliveredFps, queueDrops: drops,
          code: status?.code, validReadings: status?.window.samples.filter((sample) => sample.valid).length ?? 0,
        }, { canLowerCapture: configIndex < CAMERA_LADDER.length - 1, canLowerProcessing: longSideIndex < PROCESSING_LONG_SIDES.length - 1 });
        if (action.kind === 'lower_capture') {
          configIndex++;
          const next = CAMERA_LADDER[configIndex]!;
          void applyConfig(track, next).then(() => { capture.camera.reset(); setState((previous) => ({ ...previous, camera: { label: next.label, fps: undefined } })); });
        } else if (action.kind === 'lower_processing') {
          longSideIndex++; capture.longSide = PROCESSING_LONG_SIDES[longSideIndex];
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
      setState({ phase: 'error', sessionId, error: error instanceof Error ? error.message : 'Camera insights could not start.' });
    }
  }, [finish, integration?.physiology, pump, release, sendFrames, startMonitoring, stop]);

  const dismiss = useCallback(() => setState((previous) => previous.phase === 'error' || previous.phase === 'idle' ? { phase: 'idle' } : previous), []);

  // Leaving this session's pages ends monitoring; the camera never runs in the background.
  const activeSession = state.phase === 'requesting' || state.phase === 'calibrating' || state.phase === 'monitoring' ? state.sessionId : undefined;
  useEffect(() => {
    if (activeSession && !location.pathname.includes(activeSession)) void stop();
  }, [activeSession, location.pathname, stop]);
  useEffect(() => () => release(), [release]);

  return <MonitorContext.Provider value={{ state, stream, start, stop: () => stop(), dismiss }}>
    {children}
    <MonitorDock />
  </MonitorContext.Provider>;
}
