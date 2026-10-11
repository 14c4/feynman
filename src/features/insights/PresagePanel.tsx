import { useEffect, useRef, useState } from 'react';
import type { PhysiologySample, PracticeSession } from '../../../shared/types';
import { MONITORING_LIMITS } from '../../../shared/types';
import { Button } from '../../components/Button';
import { PracticeIcon, type PracticeIconName } from '../../components/practice/PracticeIcon';
import { useSessions } from '../../state/useSessions';
import { coverMapping, presageStage, smoothBox, squareAround, warmupProgress, type Box, type Stage } from './faceGeometry';
import type { TrackingStore } from './faceTracker';
import { CHECKIN_SECONDS, PURPOSE_LABELS, purposeFor, useMonitor, type MonitorState } from './monitoringContext';
import './presage.css';

function useNow(active: boolean, every = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (!active) return; const timer = setInterval(() => setNow(Date.now()), every); return () => clearInterval(timer); }, [active, every]);
  return now;
}

/* ---------- camera stage with the tracking overlay ---------- */

/**
 * Draws the local tracker's face square and landmarks over the mirrored preview at display rate,
 * plus Presage's own face lock (dashed) when the SDK reports one. Boxes only, no landmark dots. The canvas shares the
 * video's mirror transform and `object-fit: cover` mapping, so overlays stay aligned at any size.
 */
function TrackingOverlay({ video, store }: { video: React.RefObject<HTMLVideoElement | null>; store?: TrackingStore }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let handle = 0; let box: Box | undefined; let fade = 0;
    const styles = getComputedStyle(document.documentElement);
    const colors = { ok: styles.getPropertyValue('--presage-lock').trim() || '#5fd39a', warn: styles.getPropertyValue('--presage-warn').trim() || '#f0b84a' };
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
      if (tracked && latest) { box = smoothBox(box, squareAround(latest.bounds, aspect)); fade = 1; }
      else if (box) { fade -= 0.04; if (fade <= 0) box = undefined; }

      if (!box) return;
      const x = map.x(box.x); const y = map.y(box.y); const side = map.x(box.x + box.w) - x;
      const framed = tracked && latest ? latest.bounds.h >= 0.22 && latest.bounds.h <= 0.75 && latest.faces === 1 : false;
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

function CameraStage({ state, stream, tracking, stage, guidance, simulated }: { state: MonitorState; stream?: MediaStream; tracking?: TrackingStore; stage: Stage; guidance?: string; simulated: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => { if (video.current) video.current.srcObject = stream ?? null; }, [stream]);
  return <div className="presage-stage" data-tone={stage.tone}>
    {stream ? <>
      <video ref={video} className="presage-video" autoPlay muted playsInline aria-label="Your camera preview. It is not recorded." />
      <TrackingOverlay video={video} store={tracking} />
    </> : <div className="presage-stage-empty"><PracticeIcon name="camera" size={28} /><span>{state.cameraNote ? 'Camera not in use' : 'Starting camera…'}</span></div>}
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

function VitalTile({ icon, label, unit, sample, warmupMs, threshold, elapsedMs, collecting }: { icon: PracticeIconName; label: string; unit: string; sample?: PhysiologySample; warmupMs: number; threshold: number; elapsedMs?: number; collecting: boolean }) {
  const progress = warmupProgress(elapsedMs, warmupMs);
  const remaining = elapsedMs === undefined ? undefined : Math.max(0, Math.ceil((warmupMs - elapsedMs) / 1000));
  // Real SDK values show as soon as they exist; until they pass Presage's reliability rules they are labeled preliminary.
  const reliable = Boolean(sample?.valid);
  const shown = sample && Number.isFinite(sample.value) ? Math.round(sample.value) : undefined;
  const why = !sample ? undefined : !sample.stable ? 'not yet stable' : sample.confidence < threshold ? `confidence ${sample.confidence} (reliable from ${threshold})` : remaining ? 'still warming up' : 'outside the usual range';
  const note = shown !== undefined ? (reliable ? `reliable · confidence ${sample!.confidence}` : `preliminary · ${why}`) : !collecting ? 'waiting for frames' : remaining ? `warming up · ${remaining}s` : 'waiting for Presage to report…';
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
    <dl>{rows.map((row) => <div key={row.label} title={row.title}><dt>{row.label}</dt><dd data-tone={row.tone}>{row.value}</dd></div>)}</dl>
    {problem && <p className="presage-diag-error" role="alert">{problem}</p>}
  </div>;
}

/* ---------- the panel ---------- */

/**
 * Presage, as a first-class part of the study screen: a large camera stage with live tracking,
 * an honest status built only from real signals, and readings with their quality. Off by default;
 * the camera starts only after the learner chooses to, and stops when they leave the session.
 */
export function PresagePanel({ session, layout = 'rail' }: { session: PracticeSession; layout?: 'rail' | 'inline' }) {
  const { integration } = useSessions();
  const { state, stream, tracking, start, stop, dismiss } = useMonitor();
  const [minimized, setMinimized] = useState(false);
  const [explain, setExplain] = useState(false);
  const health = integration?.physiology;
  const mine = !state.sessionId || state.sessionId === session.id;
  const active = mine && (state.phase === 'requesting' || state.phase === 'calibrating' || state.phase === 'monitoring' || state.phase === 'stopping');
  const now = useNow(active, 500);
  // A saved check-in note clears itself; errors stay until dismissed.
  const saved = mine && state.phase === 'idle' && Boolean(state.finished);
  useEffect(() => { if (!saved) return; const timer = setTimeout(dismiss, 12_000); return () => clearTimeout(timer); }, [saved, dismiss]);
  if (!health || session.lifecycle !== 'active' && !active) return null;
  const simulated = (active ? state.source : health.source) === 'simulated';
  const className = `presage-panel card presage-panel--${layout} ${active ? 'is-active' : ''} ${minimized && active ? 'is-minimized' : ''}`;

  if (!health.available) return <section className={`${className} presage-panel--off`} aria-label="Presage camera insights">
    <header className="presage-head"><span className="presage-mark"><PracticeIcon name="camera" size={15} /></span><div><strong>Presage is off on this server</strong><small>{health.reason}</small></div></header>
    <p className="small muted">Your learning results and confidence tracking work without it.</p>
  </section>;

  if (!active) {
    const purpose = purposeFor(session);
    const error = mine && state.phase === 'error' ? state.error : undefined;
    const finished = mine ? state.finished : undefined;
    return <section className={className} aria-labelledby="presage-title">
      <header className="presage-head">
        <span className="presage-mark"><PracticeIcon name="camera" size={15} /></span>
        <div><strong id="presage-title">Presage camera insights</strong><small>Pulse, breathing and face tracking from your camera</small></div>
        {simulated && <span className="badge badge--warning badge--mono">DEV SIMULATED</span>}
      </header>
      <div className="presage-stage presage-stage--off"><div className="presage-stage-empty"><PracticeIcon name="camera" size={30} /><span>Camera is off</span></div></div>
      {finished && <p className="notice notice--accent presage-note" role="status"><PracticeIcon name="check" size={14} />{finished.valid ? `${finished.valid} reliable ${finished.source === 'simulated' ? 'simulated ' : ''}readings were added to your timeline.` : 'No readings were reliable enough to keep. That’s common with movement or low light; your learning results are unaffected.'}{finished.reason ? ` ${finished.reason}` : ''}</p>}
      {error && <p className="notice notice--warning presage-note" role="alert"><PracticeIcon name="alert" size={14} /><span>{error}</span><button type="button" className="icon-button" aria-label="Dismiss" onClick={dismiss}><PracticeIcon name="close" size={12} /></button></p>}
      <p className="small muted presage-lede">See Presage track your face live, and keep pulse and breathing readings alongside your learning timeline. Optional, and you can stop any time.</p>
      <div className="presage-actions">
        <Button variant="secondary" onClick={() => void start(session.id, purpose)}><PracticeIcon name="camera" size={15} />Turn on camera</Button>
        <Button variant="quiet" onClick={() => void start(session.id, purpose, CHECKIN_SECONDS)}><PracticeIcon name="clock" size={14} />{CHECKIN_SECONDS}-second check-in</Button>
      </div>
      <button type="button" className="text-button presage-explain" aria-expanded={explain} onClick={() => setExplain((value) => !value)}>What happens to my video?<PracticeIcon name="chevron" size={12} /></button>
      {explain && <ul className="presage-consent small">
        <li>Face tracking runs <strong>on this device</strong>; nothing it sees is uploaded.</li>
        {simulated ? <li><strong>Development mode:</strong> pulse and breathing are synthetic test values; no frames are sent.</li>
          : <li>Small, low-resolution frames go to this app’s server, where Presage SmartSpectra estimates pulse and breathing. Frames are processed and discarded; <strong>no video is stored</strong>.</li>}
        <li>Live values appear as soon as Presage reports them, marked preliminary until they meet Presage’s reliability rules. Only reliable readings are kept in your timeline.</li>
        <li>They are reflective information, <strong>not a diagnosis</strong>, and not a measure of anxiety, attention or understanding.</li>
        <li>Leaving the session turns the camera off.</li>
      </ul>}
    </section>;
  }

  const status = state.status;
  const latest = status?.latest;
  const freshValid = Boolean(latest?.pulse?.valid || latest?.breathing?.valid);
  const tracker = state.tracking;
  const stage = presageStage({
    phase: state.phase, simulated, camera: Boolean(state.cameraOn && stream), windowOpen: Boolean(state.windowId),
    tracker: tracker?.tracker ?? 'loading', face: tracker?.face ?? 'none', framesReceived: status?.window.framesReceived ?? 0,
    processing: status?.presage?.processing, code: status?.code, metricsPackets: status?.presage?.metricsPackets ?? 0,
    freshValid, anyValid: status?.window.samples.some((sample) => sample.valid) ?? false,
  });
  const framing = tracker?.framing;
  const guidance = state.phase === 'requesting' && state.probe ? `Measuring what your camera really delivers (${state.probe}).`
    : stage.id === 'searching' ? 'Look at the screen with your face in the frame.'
      : stage.id === 'lost' ? 'Move back into view; tracking resumes on its own.'
        : framing && framing.code !== 'ok' ? framing.message
          : status?.hint ? status.hint : state.advice;
  const remaining = state.endsAt ? Math.max(0, Math.ceil((state.endsAt - now) / 1000)) : undefined;
  const collecting = simulated ? Boolean(status) : (status?.window.framesReceived ?? 0) > 0;

  if (minimized) return <section className={className} aria-label="Presage camera insights">
    <div className="presage-mini">
      <span className="presage-pill presage-pill--inline" data-tone={stage.tone}><i aria-hidden="true" />{stage.label}</span>
      {latest?.pulse && <span className="mono small"><PracticeIcon name="heart" size={12} />{Math.round(latest.pulse.value)} bpm{latest.pulse.valid ? '' : ' (prelim.)'}</span>}
      {remaining !== undefined && <span className="mono small muted">{remaining}s</span>}
      <button type="button" className="icon-button" aria-label="Show the Presage camera" onClick={() => setMinimized(false)}><PracticeIcon name="camera" size={14} /></button>
      <button type="button" className="icon-button" aria-label="Stop Presage" disabled={state.phase === 'stopping'} onClick={() => void stop()}><PracticeIcon name="stop" size={12} /></button>
    </div>
  </section>;

  return <section className={className} aria-labelledby="presage-title">
    <header className="presage-head">
      <span className="presage-mark"><PracticeIcon name="camera" size={15} /></span>
      <div><strong id="presage-title">Presage</strong><small>{state.purpose ? PURPOSE_LABELS[state.purpose] : 'Camera insights'}{remaining !== undefined ? ` · ${remaining}s left` : ''}</small></div>
      <button type="button" className="icon-button" aria-label="Minimise the Presage panel" onClick={() => setMinimized(true)}><PracticeIcon name="chevron" size={14} /></button>
    </header>
    <p className="sr-only" aria-live="polite">{stage.label}</p>
    <CameraStage state={state} stream={stream} tracking={tracking} stage={stage} guidance={guidance} simulated={simulated} />
    <Diagnostics state={state} simulated={simulated} />
    <div className="presage-tiles">
      <VitalTile icon="heart" label="Pulse" unit="bpm" sample={latest?.pulse} warmupMs={MONITORING_LIMITS.pulseWarmupMs} threshold={MONITORING_LIMITS.pulseMinConfidence} elapsedMs={status?.elapsedMs} collecting={collecting} />
      <VitalTile icon="wave" label="Breathing" unit="/min" sample={latest?.breathing} warmupMs={MONITORING_LIMITS.breathingWarmupMs} threshold={MONITORING_LIMITS.breathingMinConfidence} elapsedMs={status?.elapsedMs} collecting={collecting} />
    </div>
    <footer className="presage-foot">
      <span className="small muted">{simulated ? 'Synthetic readings for testing.' : 'Reflective readings, not a diagnosis.'} Video isn’t stored.</span>
      <Button variant="secondary" size="sm" disabled={state.phase === 'stopping'} onClick={() => void stop()}><PracticeIcon name="stop" size={12} />{state.phase === 'stopping' ? 'Saving…' : 'Stop'}</Button>
    </footer>
  </section>;
}
