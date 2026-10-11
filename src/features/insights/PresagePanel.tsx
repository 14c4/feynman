import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { PhysiologySample, PracticeSession } from '../../../shared/types';
import { MONITORING_LIMITS } from '../../../shared/types';
import { Button } from '../../components/Button';
import { PracticeIcon, type PracticeIconName } from '../../components/practice/PracticeIcon';
import { useSessions } from '../../state/useSessions';
import { coverMapping, framingFor, ghostVisible, HEAD_SHOULDERS_TARGET, presageStage, smoothBox, squareAround, warmupProgress, type Box, type Stage } from './faceGeometry';
import type { TrackingStore } from './faceTracker';
import { PURPOSE_LABELS, purposeFor, useMonitor, type MonitorState } from './monitoringContext';
import './presage.css';

function useNow(active: boolean, every = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (!active) return; const timer = setInterval(() => setNow(Date.now()), every); return () => clearInterval(timer); }, [active, every]);
  return now;
}

/** `value` once it has held for `ms`; undefined while it is still changing. Keeps brief flickers off screen. */
function useSettled<T>(value: T, ms: number): T | undefined {
  const [settled, setSettled] = useState<T>();
  useEffect(() => { const timer = setTimeout(() => setSettled(() => value), ms); return () => clearTimeout(timer); }, [value, ms]);
  return settled === value ? value : undefined;
}

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- camera stage with the tracking overlay ---------- */

/** A faint head-and-shoulders outline around HEAD_SHOULDERS_TARGET, in element pixels. */
function drawGhost(context: CanvasRenderingContext2D, map: ReturnType<typeof coverMapping>) {
  const face = map.height * HEAD_SHOULDERS_TARGET.h;
  const cx = map.x(HEAD_SHOULDERS_TARGET.cx); const cy = map.y(HEAD_SHOULDERS_TARGET.cy);
  const rx = face * 0.62; const ry = face * 0.8;
  const neckX = rx * 0.55; const neckY = cy + ry * 0.92; const shoulderX = face * 1.7; const bottom = map.y(1);
  context.beginPath();
  context.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  for (const side of [-1, 1]) {
    context.moveTo(cx + side * neckX, neckY);
    context.bezierCurveTo(cx + side * neckX, neckY + face * 0.35, cx + side * shoulderX, neckY + face * 0.2, cx + side * shoulderX, bottom);
  }
  context.stroke();
}

/**
 * Draws the local tracker's face brackets over the mirrored preview at display rate, plus a faint
 * head-and-shoulders guide that shows where to sit and steps aside once the learner is framed.
 * The canvas shares the video's mirror transform and `object-fit: cover` mapping, so overlays
 * stay aligned at any size.
 */
function TrackingOverlay({ video, store, anyValid }: { video: React.RefObject<HTMLVideoElement | null>; store?: TrackingStore; anyValid: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const valid = useRef(anyValid);
  useEffect(() => { valid.current = anyValid; }, [anyValid]);
  useEffect(() => {
    let handle = 0; let box: Box | undefined; let fade = 0;
    let ghost = true; let ghostAlpha = 1; let framedSince: number | undefined; let offSince: number | undefined;
    // Tokens are defined on the panel, so read them from the canvas inside it.
    const styles = getComputedStyle(canvas.current ?? document.documentElement);
    const colors = { ok: styles.getPropertyValue('--presage-lock').trim() || '#5fd39a', warn: styles.getPropertyValue('--presage-warn').trim() || '#f0b84a', ghost: styles.getPropertyValue('--presage-ghost').trim() || 'rgb(255 255 255 / 0.55)' };
    const still = reducedMotion();
    const draw = () => {
      handle = requestAnimationFrame(draw);
      const element = canvas.current; const source = video.current;
      if (!element || !source) return;
      const width = element.clientWidth; const height = element.clientHeight; const ratio = window.devicePixelRatio || 1;
      if (element.width !== Math.round(width * ratio) || element.height !== Math.round(height * ratio)) { element.width = Math.round(width * ratio); element.height = Math.round(height * ratio); }
      const context = element.getContext('2d');
      if (!context) return;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      if (!source.videoWidth || !source.videoHeight) return;
      const map = coverMapping(source.videoWidth, source.videoHeight, width, height);
      const aspect = source.videoWidth / source.videoHeight;
      const now = performance.now();
      const latest = store?.latest;
      const tracked = Boolean(store && latest && store.tracked(now));
      const framed = tracked && latest ? framingFor(latest).code === 'ok' : false;
      if (framed) { offSince = undefined; framedSince ??= now; } else { framedSince = undefined; offSince ??= now; }
      ghost = ghostVisible(ghost, { framedForMs: framedSince === undefined ? 0 : now - framedSince, offForMs: offSince === undefined ? 0 : now - offSince, anyValid: valid.current });
      ghostAlpha = still ? (ghost ? 1 : 0) : Math.max(0, Math.min(1, ghostAlpha + (ghost ? 0.05 : -0.03)));
      if (ghostAlpha > 0) {
        context.save();
        context.globalAlpha = ghostAlpha; context.strokeStyle = framed ? colors.ok : colors.ghost;
        context.lineWidth = 1.5; context.setLineDash([6, 6]); context.lineCap = 'round';
        drawGhost(context, map);
        context.restore();
      }
      if (tracked && latest) { box = smoothBox(box, squareAround(latest.bounds, aspect)); fade = 1; }
      else if (box) { fade -= 0.04; if (fade <= 0) box = undefined; }

      if (!box) return;
      const x = map.x(box.x); const y = map.y(box.y); const side = map.x(box.x + box.w) - x;
      context.save();
      context.globalAlpha = Math.max(0, fade);
      context.strokeStyle = tracked ? (framed ? colors.ok : colors.warn) : colors.warn;
      // Corner brackets only: readable on any background without boxing the face in.
      context.globalAlpha = Math.max(0, fade); context.lineWidth = 2.5; context.lineCap = 'round';
      const arm = Math.max(12, side * 0.16);
      context.beginPath();
      for (const [cx, cy, dx, dy] of [[x, y, 1, 1], [x + side, y, -1, 1], [x, y + side, 1, -1], [x + side, y + side, -1, -1]] as const) {
        context.moveTo(cx + dx * arm, cy); context.lineTo(cx, cy); context.lineTo(cx, cy + dy * arm);
      }
      context.stroke();
      context.restore();
    };
    handle = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(handle);
  }, [store, video]);
  return <canvas ref={canvas} className="presage-overlay" aria-hidden="true" />;
}

function CameraStage({ state, stream, tracking, stage, guidance, simulated, anyValid }: { state: MonitorState; stream?: MediaStream; tracking?: TrackingStore; stage: Stage; guidance?: string; simulated: boolean; anyValid: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => { if (video.current) video.current.srcObject = stream ?? null; }, [stream]);
  return <div className="presage-stage" data-tone={stage.tone}>
    {stream ? <>
      <video ref={video} className="presage-video" autoPlay muted playsInline aria-label="Your camera preview. It is not recorded." />
      <TrackingOverlay video={video} store={tracking} anyValid={anyValid} />
    </> : <div className="presage-stage-empty"><PracticeIcon name="camera" size={28} /><span>{state.phase === 'reconnecting' ? 'Reconnecting…' : state.cameraNote ? 'Camera not in use' : 'Starting camera…'}</span></div>}
    <span className="presage-pill" data-tone={stage.tone}><i aria-hidden="true" />{stage.label}</span>
    {simulated && <span className="presage-tag presage-tag--sim">DEV SIMULATED</span>}
    {guidance && <p className="presage-guidance">{guidance}</p>}
  </div>;
}

/* ---------- readouts ---------- */

function Confidence({ value, threshold }: { value?: number; threshold: number }) {
  return <span className="presage-conf" title={`Presage confidence ${value ?? 0}/100 (reliable from ${threshold})`}>
    <span className="presage-conf-fill" style={{ width: `${Math.max(2, value ?? 0)}%` }} data-ok={(value ?? 0) >= threshold || undefined} />
    <span className="presage-conf-mark" style={{ left: `${threshold}%` }} />
  </span>;
}

function VitalTile({ icon, label, unit, sample, warmupMs, threshold, elapsedMs, collecting, waiting }: { icon: PracticeIconName; label: string; unit: string; sample?: PhysiologySample; warmupMs: number; threshold: number; elapsedMs?: number; collecting: boolean; waiting?: string }) {
  const progress = warmupProgress(elapsedMs, warmupMs);
  const remaining = elapsedMs === undefined ? undefined : Math.max(0, Math.ceil((warmupMs - elapsedMs) / 1000));
  // Real SDK values show as soon as they exist; until they pass Presage's reliability rules they are labeled preliminary.
  const reliable = Boolean(sample?.valid);
  const shown = sample && Number.isFinite(sample.value) ? Math.round(sample.value) : undefined;
  const why = !sample ? undefined : !sample.stable ? 'not yet stable' : sample.confidence < threshold ? `confidence ${sample.confidence} (reliable from ${threshold})` : remaining ? 'still warming up' : 'outside the usual range';
  const note = shown !== undefined ? (reliable ? `reliable · confidence ${sample!.confidence}` : `preliminary · ${why}`) : !collecting ? 'waiting for frames' : remaining ? `warming up · ${remaining}s` : waiting ?? 'waiting for Presage to report…';
  return <div className="presage-tile" data-state={reliable ? 'live' : shown !== undefined ? 'prelim' : 'wait'}>
    <span className="presage-tile-label"><PracticeIcon name={icon} size={13} />{label}{shown !== undefined && !reliable && <em className="presage-prelim-tag">preliminary</em>}</span>
    <strong className="presage-tile-value">{shown ?? '—'}<small>{shown !== undefined ? unit : ''}</small></strong>
    {shown === undefined && remaining ? <span className="presage-warmup" role="progressbar" aria-label={`${label} warm-up`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}><span style={{ width: `${progress * 100}%` }} /></span> : <Confidence value={sample?.confidence} threshold={threshold} />}
    <span className="presage-tile-note">{note}</span>
  </div>;
}

const SIGNAL_LABELS: Record<string, string> = {
  OK: 'Good signal', NO_FACE_FOUND: 'No face found', MULTIPLE_FACES_FOUND: 'More than one face', FACE_NOT_CENTERED: 'Face not centred', FACE_SIZE_OUT_OF_RANGE: 'Face size off',
  TOO_DARK: 'Too dark', TOO_BRIGHT: 'Too bright', CHEST_NOT_VISIBLE: 'Chest not visible', CAMERA_TUNING: 'Camera adjusting', FRAME_RATE_TOO_LOW: 'Frame rate too low',
  EXCESSIVE_MOTION: 'Too much motion', FACE_TOO_CLOSE: 'Too close', FACE_TOO_FAR: 'Too far', FACE_TOO_HIGH: 'Face too high', FACE_TOO_LOW: 'Face too low', FACE_NOT_FORWARD: 'Face not forward',
  FRAMES_REJECTED: 'Frames refused',
};

/** Plain, actionable wording for what Presage needs; its own hint text is the fallback. */
const PRESAGE_ADVICE: Record<string, string> = {
  CHEST_NOT_VISIBLE: 'Sit back a little so your shoulders and upper chest are in view, like the outline.',
  NO_FACE_FOUND: 'Look at the screen with your face in the frame.',
  FACE_TOO_CLOSE: 'Sit back a little.', FACE_TOO_FAR: 'Move a little closer.',
  FACE_TOO_HIGH: 'Tilt your screen back a little.', FACE_TOO_LOW: 'Sit up a little, or tilt your screen toward you.',
  FACE_NOT_CENTERED: 'Shift a little toward the middle of the frame.', FACE_NOT_FORWARD: 'Face the screen.',
  TOO_DARK: 'Face a window or lamp.', TOO_BRIGHT: 'Move away from direct light.', EXCESSIVE_MOTION: 'Hold still for a moment.',
};

/** Measured pipeline facts, each from a real counter: camera rate, frames accepted, frames Presage consumed, SDK state, signal. */
function Diagnostics({ state, simulated }: { state: MonitorState; simulated: boolean }) {
  const status = state.status; const pipe = status?.pipeline; const sdk = status?.presage;
  const cameraFps = state.camera?.fps;
  const fpsTone = cameraFps === undefined ? undefined : cameraFps >= 27 ? 'ok' : cameraFps >= 25 ? 'fair' : 'bad';
  const fmt = (value?: number) => value === undefined ? '—' : value.toFixed(value < 10 ? 1 : 0);
  const signal = status?.code ? SIGNAL_LABELS[status.code] ?? status.code : undefined;
  const signalTone = !status?.code ? undefined : status.code === 'OK' ? 'ok' : status.code === 'NO_FACE_FOUND' || status.code === 'FRAMES_REJECTED' ? 'bad' : 'fair';
  const rows: { label: string; value: string; tone?: string; title?: string }[] = [
    { label: 'Camera', value: state.camera ? `${state.camera.label} · ${fmt(cameraFps)} fps` : '—', tone: fpsTone, title: 'Measured from camera capture timestamps. Presage needs 25 fps or more.' },
  ];
  if (!simulated) rows.push(
    { label: 'Sent', value: pipe ? `${pipe.accepted ?? 0} accepted · ${fmt(pipe.deliveredFps)} fps${pipe.rejected ? ` · ${pipe.rejected} refused` : ''}` : '—', tone: pipe?.rejected ? 'bad' : undefined, title: 'Frames the Presage SDK accepted. Accepted does not mean analysed.' },
    { label: 'Analysed', value: pipe ? `${pipe.processed ?? 0} frames · ${fmt(pipe.processedFps)} fps` : '—', title: 'Frames Presage reports it actually fed into analysis.' },
    { label: 'Presage', value: `${sdk?.processing ?? 'starting'} · ${sdk?.metricsPackets ?? 0} updates`, tone: sdk?.processing === 'error' ? 'bad' : sdk?.processing === 'running' ? 'ok' : undefined },
    { label: 'Signal', value: signal ?? (sdk?.metricsPackets ? 'Receiving' : 'Waiting for Presage'), tone: signalTone },
  );
  const problem = sdk?.decodeErrors ? `${sdk.decodeErrors} Presage updates could not be read${sdk.lastDecodeError ? `: ${sdk.lastDecodeError}` : '.'}` : sdk?.decoder === 'unavailable' ? sdk.lastDecodeError : undefined;
  return <div className="presage-diag">
    {problem && <p className="presage-diag-error" role="alert">{problem}</p>}
    <details>
      <summary>Signal details</summary>
      <dl>{rows.map((row) => <div key={row.label} title={row.title}><dt>{row.label}</dt><dd data-tone={row.tone}>{row.value}</dd></div>)}</dl>
    </details>
  </div>;
}

/* ---------- the panel ---------- */

/**
 * Presage, as a first-class part of the study screen: a large camera stage with live tracking,
 * an honest status built only from real signals, and readings with their quality. Off by default;
 * the camera starts only after the learner chooses to, and stops when they leave the session.
 */
/** A section whose height animates to zero when closed; hidden content leaves the tab order. */
function Collapsible({ open, id, children }: { open: boolean; id?: string; children: ReactNode }) {
  return <div className="presage-collapse" id={id} data-open={open}><div className="presage-collapse-inner" aria-hidden={!open}>{children}</div></div>;
}

export function PresagePanel({ session, layout = 'rail' }: { session: PracticeSession; layout?: 'rail' | 'inline' }) {
  const { integration } = useSessions();
  const { state, stream, tracking, start, stop, dismiss } = useMonitor();
  const [hidden, setHidden] = useState<boolean>();
  const health = integration?.physiology;
  const minimized = hidden ?? health?.available === false;
  const mine = !state.sessionId || state.sessionId === session.id;
  const active = mine && (state.phase === 'requesting' || state.phase === 'calibrating' || state.phase === 'monitoring' || state.phase === 'stopping' || state.phase === 'reconnecting');
  const now = useNow(active, 500);
  // A saved check-in note clears itself; errors stay until dismissed.
  const saved = mine && state.phase === 'idle' && Boolean(state.finished);
  useEffect(() => { if (!saved) return; const timer = setTimeout(dismiss, 12_000); return () => clearTimeout(timer); }, [saved, dismiss]);
  // Positioning hints count only once they persist, so ordinary movement never triggers them.
  const settledCode = useSettled(state.status?.code, 5000);
  const settledFraming = useSettled(state.tracking?.framing?.code, 4000);
  if (!health || session.lifecycle !== 'active' && !active) return null;
  const simulated = (active ? state.source : health.source) === 'simulated';
  const className = `presage-panel card presage-panel--${layout} ${active ? 'is-active' : ''} ${minimized ? 'is-minimized' : ''}`;
  // The arrow is always available: it hides or shows everything below the header, camera on or off.
  const toggle = <button type="button" className="icon-button presage-toggle" aria-expanded={!minimized} aria-controls="presage-body"
    aria-label={minimized ? 'Show the Presage panel' : 'Hide the Presage panel'} onClick={() => setHidden(!minimized)}><PracticeIcon name="chevron" size={14} /></button>;

  if (!health.available) return <section className={`${className} presage-panel--off`} aria-label="Presage camera insights">
    <header className="presage-head"><span className="presage-mark"><PracticeIcon name="camera" size={15} /></span><div><strong>Presage is off on this server</strong><small>{health.reason}</small></div>{toggle}</header>
    <Collapsible open={!minimized} id="presage-body"><p className="small muted">Your learning results and confidence tracking work without it.</p></Collapsible>
  </section>;

  if (!active) {
    const purpose = purposeFor(session);
    const error = mine && state.phase === 'error' ? state.error : undefined;
    const finished = mine ? state.finished : undefined;
    // Starting the camera always reveals the panel so the learner sees what is being captured.
    const begin = () => { setHidden(false); void start(session.id, purpose); };
    return <section className={className} aria-labelledby="presage-title">
      <header className="presage-head">
        <span className="presage-mark"><PracticeIcon name="camera" size={15} /></span>
        <div><strong id="presage-title">Presage camera insights</strong><small>Pulse and face tracking from your camera</small></div>
        {simulated && <span className="badge badge--warning badge--mono">DEV SIMULATED</span>}
        {toggle}
      </header>
      <Collapsible open={!minimized} id="presage-body">
        <div className="presage-stage presage-stage--off"><div className="presage-stage-empty"><PracticeIcon name="camera" size={30} /><span>Camera is off</span></div></div>
        {finished && <p className="notice notice--accent presage-note" role="status"><PracticeIcon name="check" size={14} />{finished.valid ? `${finished.valid} reliable ${finished.source === 'simulated' ? 'simulated ' : ''}readings were added to your timeline.` : 'No readings were reliable enough to keep. That’s common with movement or low light; your learning results are unaffected.'}{finished.reason ? ` ${finished.reason}` : ''}</p>}
        {error && <p className="notice notice--warning presage-note" role="alert"><PracticeIcon name="alert" size={14} /><span>{error}</span><button type="button" className="icon-button" aria-label="Dismiss" onClick={dismiss}><PracticeIcon name="close" size={12} /></button></p>}
        <div className="presage-actions">
          <Button variant="secondary" onClick={() => begin()}><PracticeIcon name="camera" size={15} />Turn on camera</Button>
        </div>
      </Collapsible>
    </section>;
  }

  const status = state.status;
  const latest = status?.latest;
  const freshValid = Boolean(latest?.pulse?.valid);
  const tracker = state.tracking;
  const anyValid = status?.window.samples.some((sample) => sample.valid) ?? false;
  // A good face signal shows at once; problems only once they have held for a few seconds.
  const code = status?.code === 'OK' ? 'OK' : settledCode;
  const stage = presageStage({
    phase: state.phase, simulated, camera: Boolean(state.cameraOn && stream), windowOpen: Boolean(state.windowId),
    tracker: tracker?.tracker ?? 'loading', face: tracker?.face ?? 'none', framesReceived: status?.window.framesReceived ?? 0,
    processing: status?.presage?.processing, code, metricsPackets: status?.presage?.metricsPackets ?? 0,
    freshValid, anyValid,
  });
  const framing = tracker?.framing && tracker.framing.code === settledFraming ? tracker.framing : undefined;
  const retry = state.phase === 'reconnecting' ? state.retry : undefined;
  const retryIn = retry ? Math.max(0, Math.ceil((retry.at - now) / 1000)) : 0;
  const guidance = retry ? `${retry.reason.replace(/\.$/, '')}. ${retry.waitingForTab ? 'Presage restarts when you return to this tab' : retryIn ? `Presage restarts on its own in ${retryIn}s` : 'Presage is restarting'}; calibration starts over.`
    : state.phase === 'requesting' && state.probe ? `Measuring what your camera really delivers (${state.probe}).`
      : stage.id === 'searching' ? 'Sit comfortably with your head and shoulders in the outline. Small movements are fine.'
        : stage.id === 'lost' ? 'Move back into view; tracking resumes on its own.'
          : framing && framing.code !== 'ok' ? framing.message
            // Presage's own advice only while it is holding readings back; once pulse flows, a lingering warning is not a problem.
            : !freshValid && code && code === status?.code && code !== 'OK' ? PRESAGE_ADVICE[code] ?? status.hint ?? state.advice : state.advice;
  const waiting = !freshValid && code && code !== 'OK' && code === status?.code ? `Presage is waiting: ${(SIGNAL_LABELS[code] ?? code).toLowerCase()}` : undefined;
  const remaining = state.endsAt ? Math.max(0, Math.ceil((state.endsAt - now) / 1000)) : undefined;
  const collecting = simulated ? Boolean(status) : (status?.window.framesReceived ?? 0) > 0;

  return <section className={className} aria-labelledby="presage-title">
    <header className="presage-head">
      <span className="presage-mark"><PracticeIcon name="camera" size={15} /></span>
      <div><strong id="presage-title">Presage</strong><small>{state.purpose ? PURPOSE_LABELS[state.purpose] : 'Camera insights'}{remaining !== undefined ? ` · ${remaining}s left` : ''}</small></div>
      {toggle}
    </header>
    <p className="sr-only" aria-live="polite">{stage.label}</p>
    <Collapsible open={minimized}>
      <div className="presage-mini">
        <span className="presage-pill presage-pill--inline" data-tone={stage.tone}><i aria-hidden="true" /><span className="presage-pill-label">{stage.label}</span></span>
        {latest?.pulse && <span className="mono small"><PracticeIcon name="heart" size={12} />{Math.round(latest.pulse.value)}<span className="presage-unit"> bpm{latest.pulse.valid ? '' : ' (prelim.)'}</span></span>}
        <button type="button" className="icon-button" aria-label="Stop Presage" disabled={state.phase === 'stopping'} onClick={() => void stop()}><PracticeIcon name="stop" size={12} /></button>
      </div>
    </Collapsible>
    <Collapsible open={!minimized} id="presage-body">
      <CameraStage state={state} stream={stream} tracking={tracking} stage={stage} guidance={guidance} simulated={simulated} anyValid={anyValid} />
      <Diagnostics state={state} simulated={simulated} />
      <div className="presage-tiles">
        <VitalTile icon="heart" label="Pulse" unit="bpm" sample={latest?.pulse} warmupMs={MONITORING_LIMITS.pulseWarmupMs} threshold={MONITORING_LIMITS.pulseMinConfidence} elapsedMs={status?.elapsedMs} collecting={collecting} waiting={waiting} />
      </div>
      <footer className="presage-foot">
        <span className="small muted">{simulated ? 'Synthetic readings for testing.' : 'Reflective readings, not a diagnosis.'} Video isn’t stored.</span>
        <Button variant="secondary" size="sm" disabled={state.phase === 'stopping'} onClick={() => void stop()}><PracticeIcon name="stop" size={12} />{state.phase === 'stopping' ? 'Saving…' : 'Stop'}</Button>
      </footer>
    </Collapsible>
  </section>;
}
