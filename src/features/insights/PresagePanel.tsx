import { useEffect, useRef, useState } from 'react';
import type { MonitoringStatus, PhysiologySample, PracticeSession, PresageFace } from '../../../shared/types';
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

const PRESAGE_FACE_FRESH_MS = 3000;
const freshFace = (face: PresageFace | undefined, now: number) => face && now - Date.parse(face.at) < PRESAGE_FACE_FRESH_MS ? face : undefined;

/* ---------- camera stage with the tracking overlay ---------- */

/**
 * Draws the local tracker's face square and landmarks over the mirrored preview at display rate,
 * plus Presage's own face lock (dashed) when the SDK reports landmarks. The canvas shares the
 * video's mirror transform and `object-fit: cover` mapping, so overlays stay aligned at any size.
 */
function TrackingOverlay({ video, store, presageFace }: { video: React.RefObject<HTMLVideoElement | null>; store?: TrackingStore; presageFace?: PresageFace }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const presage = useRef(presageFace);
  presage.current = presageFace;
  useEffect(() => {
    let handle = 0; let box: Box | undefined; let fade = 0;
    const styles = getComputedStyle(document.documentElement);
    const colors = { ok: styles.getPropertyValue('--presage-lock').trim() || '#5fd39a', warn: styles.getPropertyValue('--presage-warn').trim() || '#f0b84a', sdk: styles.getPropertyValue('--presage-sdk').trim() || '#7fb6e6' };
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

      // Presage's own face lock, from the SDK's landmarks (about once a second).
      const sdk = presage.current;
      if (sdk?.box) {
        context.save();
        context.strokeStyle = colors.sdk; context.lineWidth = 1.25; context.setLineDash([5, 4]); context.globalAlpha = 0.9;
        const x = map.x(sdk.box.x); const y = map.y(sdk.box.y);
        context.strokeRect(x, y, map.x(sdk.box.x + sdk.box.w) - x, map.y(sdk.box.y + sdk.box.h) - y);
        context.setLineDash([]); context.fillStyle = colors.sdk; context.globalAlpha = 0.7;
        for (const [px, py] of sdk.points ?? []) { context.beginPath(); context.arc(map.x(px), map.y(py), 1.3, 0, Math.PI * 2); context.fill(); }
        context.restore();
      }

      if (!box) return;
      const x = map.x(box.x); const y = map.y(box.y); const side = map.x(box.x + box.w) - x;
      const framed = tracked && latest ? latest.bounds.h >= 0.22 && latest.bounds.h <= 0.75 && latest.faces === 1 : false;
      context.save();
      context.globalAlpha = Math.max(0, fade);
      context.strokeStyle = tracked ? (framed ? colors.ok : colors.warn) : colors.warn;
      if (!tracked) context.setLineDash([6, 6]);
      // Soft full square plus bold corners: readable on any background without boxing the face in.
      context.lineWidth = 1; context.globalAlpha = Math.max(0, fade) * 0.45; context.strokeRect(x, y, side, side);
      context.globalAlpha = Math.max(0, fade); context.lineWidth = 3; context.lineCap = 'round';
      const arm = Math.max(12, side * 0.16);
      context.beginPath();
      for (const [cx, cy, dx, dy] of [[x, y, 1, 1], [x + side, y, -1, 1], [x, y + side, 1, -1], [x + side, y + side, -1, -1]] as const) {
        context.moveTo(cx + dx * arm, cy); context.lineTo(cx, cy); context.lineTo(cx, cy + dy * arm);
      }
      context.stroke();
      if (tracked && latest) {
        context.fillStyle = 'rgba(255,255,255,0.78)';
        const points = latest.points;
        for (let index = 0; index + 1 < points.length; index += 2) {
          if (!points[index] && !points[index + 1]) continue;
          context.beginPath(); context.arc(map.x(points[index]!), map.y(points[index + 1]!), 1.1, 0, Math.PI * 2); context.fill();
        }
      }
      context.restore();
    };
    handle = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(handle);
  }, [store, video]);
  return <canvas ref={canvas} className="presage-overlay" aria-hidden="true" />;
}

function CameraStage({ state, stream, tracking, stage, guidance, presageFace, simulated }: { state: MonitorState; stream?: MediaStream; tracking?: TrackingStore; stage: Stage; guidance?: string; presageFace?: PresageFace; simulated: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => { if (video.current) video.current.srcObject = stream ?? null; }, [stream]);
  return <div className="presage-stage" data-tone={stage.tone}>
    {stream ? <>
      <video ref={video} className="presage-video" autoPlay muted playsInline aria-label="Your camera preview. It is not recorded." />
      <TrackingOverlay video={video} store={tracking} presageFace={presageFace} />
    </> : <div className="presage-stage-empty"><PracticeIcon name="camera" size={28} /><span>{state.cameraNote ? 'Camera not in use' : 'Starting camera…'}</span></div>}
    <span className="presage-pill" data-tone={stage.tone}><i aria-hidden="true" />{stage.label}</span>
    {simulated && <span className="presage-tag presage-tag--sim">DEV SIMULATED</span>}
    {!simulated && stream && <span className="presage-tag">Not recorded</span>}
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
  const value = sample?.valid ? Math.round(sample.value) : undefined;
  const note = value !== undefined ? `confidence ${sample!.confidence}` : !collecting ? 'waiting for frames' : remaining ? `warming up · ${remaining}s` : sample ? `low confidence (${sample.confidence})` : 'collecting…';
  return <div className="presage-tile" data-state={value !== undefined ? 'live' : 'wait'}>
    <span className="presage-tile-label"><PracticeIcon name={icon} size={13} />{label}</span>
    <strong className="presage-tile-value">{value ?? '—'}<small>{value !== undefined ? unit : ''}</small></strong>
    {value === undefined && remaining ? <span className="presage-warmup" role="progressbar" aria-label={`${label} warm-up`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}><span style={{ width: `${progress * 100}%` }} /></span> : <Confidence value={sample?.confidence} threshold={threshold} />}
    <span className="presage-tile-note">{note}</span>
  </div>;
}

type CheckState = 'done' | 'active' | 'pending' | 'problem';
function Check({ state, title, detail }: { state: CheckState; title: string; detail?: string }) {
  return <li className="presage-check" data-state={state}>
    <span className="presage-check-icon" aria-hidden="true">{state === 'done' ? <PracticeIcon name="check" size={11} strokeWidth={2.4} /> : state === 'problem' ? '!' : null}</span>
    <span className="presage-check-text"><strong>{title}</strong>{detail && <small>{detail}</small>}</span>
    <span className="sr-only">{state === 'done' ? 'working' : state === 'active' ? 'in progress' : state === 'problem' ? 'needs attention' : 'not started'}</span>
  </li>;
}

function SignalChecklist({ state, status, simulated, now }: { state: MonitorState; status?: MonitoringStatus; simulated: boolean; now: number }) {
  const tracking = state.tracking; const presage = status?.presage; const pipeline = status?.pipeline;
  const valid = status?.window.samples.filter((sample) => sample.valid).length ?? 0;
  const face = freshFace(presage?.face, now);
  const cameraState: CheckState = state.cameraOn ? 'done' : state.cameraNote ? 'problem' : 'active';
  const trackerState: CheckState = !state.cameraOn ? 'pending' : !tracking || tracking.tracker === 'loading' ? 'active' : tracking.tracker === 'unavailable' ? 'problem' : tracking.face === 'found' ? 'done' : tracking.face === 'lost' ? 'problem' : 'active';
  const trackerDetail = !state.cameraOn ? 'Needs the camera' : !tracking || tracking.tracker === 'loading' ? 'Loading the face model…' : tracking.tracker === 'unavailable' ? 'Couldn’t load here; Presage still measures' :
    tracking.face === 'found' ? `On this device${tracking.analysisFps ? ` · ${tracking.analysisFps} fps` : ''}${tracking.delegate ? ` · ${tracking.delegate}` : ''}` : tracking.face === 'lost' ? 'Face left the frame' : 'Looking for your face…';
  const presageState: CheckState = simulated ? 'done' : !state.windowId ? (state.phase === 'requesting' ? 'pending' : 'active') : presage?.processing === 'error' ? 'problem' : (status?.window.framesReceived ?? 0) > 0 ? 'done' : 'active';
  const presageDetail = simulated ? 'Simulated in development; no SDK' : !state.windowId ? (state.probe ? `Measuring camera: ${state.probe}` : 'Starting…')
    : (status?.window.framesReceived ?? 0) > 0 ? [pipeline?.processedFps ? `${Math.round(pipeline.processedFps)} fps analysed` : 'Receiving frames', state.encoding === 'jpeg' ? 'JPEG upload' : state.encoding === 'rgb' ? 'raw upload' : '', presage?.processing && presage.processing !== 'running' ? presage.processing : ''].filter(Boolean).join(' · ') : 'Waiting for the first frames';
  const lockState: CheckState = simulated ? 'pending' : status?.code === 'OK' || face?.box ? 'done' : status?.code ? 'problem' : 'pending';
  const lockDetail = simulated ? 'Not available in simulation' : status?.code === 'OK' ? (face?.box ? 'Face landmarks locked' : 'Presage validation: OK') : status?.code ? status.hint || status.code.replaceAll('_', ' ').toLowerCase() : 'Waiting for Presage’s validation';
  const readingState: CheckState = valid ? 'done' : (presage?.metricsPackets ?? 0) > 0 || (simulated && status) ? 'active' : 'pending';
  const readingDetail = valid ? `${valid} reliable ${valid === 1 ? 'reading' : 'readings'} saved` : (presage?.metricsPackets ?? 0) > 0 || (simulated && status) ? 'Collecting; readings appear once reliable' : 'Starts after the face is locked';
  return <ul className="presage-checks" aria-label="What’s working">
    <Check state={cameraState} title="Camera" detail={state.cameraNote ?? (state.camera ? `${state.camera.label}${state.camera.fps ? ` · ${Math.round(state.camera.fps)} fps` : ''}` : state.cameraOn ? 'On' : 'Waiting for permission')} />
    <Check state={trackerState} title="Face tracking" detail={trackerDetail} />
    <Check state={presageState} title="Presage analysis" detail={presageDetail} />
    <Check state={lockState} title="Presage face lock" detail={lockDetail} />
    <Check state={readingState} title="Measurements" detail={readingDetail} />
  </ul>;
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
        <li>Readings are kept only when Presage reports them as reliable, with their quality noted.</li>
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
  const presageFace = freshFace(status?.presage?.face, now);
  const framing = tracker?.framing;
  const guidance = state.phase === 'requesting' && state.probe ? `Measuring what your camera really delivers (${state.probe}).`
    : stage.id === 'searching' ? 'Look at the screen with your face in the frame.'
      : stage.id === 'lost' ? 'Move back into view; tracking resumes on its own.'
        : framing && framing.code !== 'ok' ? framing.message
          : status?.hint ? status.hint : state.advice;
  const remaining = state.endsAt ? Math.max(0, Math.ceil((state.endsAt - now) / 1000)) : undefined;
  const collecting = simulated ? Boolean(status) : (status?.window.framesReceived ?? 0) > 0;
  const blinks = status?.presage?.face?.blinksPerMinute ?? tracker?.blinksPerMinute;
  const blinkSource = status?.presage?.face?.blinksPerMinute !== undefined ? 'Presage' : 'on device';
  const hrv = status?.presage?.hrv;

  if (minimized) return <section className={className} aria-label="Presage camera insights">
    <div className="presage-mini">
      <span className="presage-pill presage-pill--inline" data-tone={stage.tone}><i aria-hidden="true" />{stage.label}</span>
      {latest?.pulse?.valid && <span className="mono small"><PracticeIcon name="heart" size={12} />{Math.round(latest.pulse.value)} bpm</span>}
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
    <CameraStage state={state} stream={stream} tracking={tracking} stage={stage} guidance={guidance} presageFace={presageFace} simulated={simulated} />
    {(presageFace?.box || stream) && <ul className="presage-legend" aria-label="Overlay key">
      {stream && <li><i className="lg-local" />Face tracking (on device)</li>}
      {presageFace?.box && <li><i className="lg-sdk" />Presage face lock</li>}
    </ul>}

    <div className="presage-tiles">
      <VitalTile icon="heart" label="Pulse" unit="bpm" sample={latest?.pulse} warmupMs={MONITORING_LIMITS.pulseWarmupMs} threshold={MONITORING_LIMITS.pulseMinConfidence} elapsedMs={status?.elapsedMs} collecting={collecting} />
      <VitalTile icon="wave" label="Breathing" unit="/min" sample={latest?.breathing} warmupMs={MONITORING_LIMITS.breathingWarmupMs} threshold={MONITORING_LIMITS.breathingMinConfidence} elapsedMs={status?.elapsedMs} collecting={collecting} />
    </div>
    <dl className="presage-facts">
      <div><dt>Blinks</dt><dd>{blinks !== undefined ? <>{blinks}<small>/min · {blinkSource}</small></> : <small>after 20s of tracking</small>}</dd></div>
      <div><dt>Head</dt><dd>{tracker?.pose ? <>{framing?.code === 'ok' ? 'Facing camera' : framing?.code === 'turned' ? 'Turned away' : 'In view'}<small>{`yaw ${tracker.pose.yaw}° · pitch ${tracker.pose.pitch}°`}</small></> : <small>—</small>}</dd></div>
      {status?.presage?.face?.talking !== undefined && <div><dt>Talking</dt><dd>{status.presage.face.talking ? 'Detected' : 'Not detected'}<small>Presage</small></dd></div>}
      {hrv && <div><dt>HRV</dt><dd>{hrv.valid ? <>{hrv.rmssdMs}<small> ms RMSSD</small></> : <small>low confidence ({hrv.confidence})</small>}</dd></div>}
    </dl>

    <details className="presage-details" open={layout === 'rail'}>
      <summary>What’s working<PracticeIcon name="chevron" size={12} /></summary>
      <SignalChecklist state={state} status={status} simulated={simulated} now={now} />
    </details>

    <footer className="presage-foot">
      <span className="small muted">{simulated ? 'Synthetic readings for testing.' : 'Reflective readings, not a diagnosis.'} Video isn’t stored.</span>
      <Button variant="secondary" size="sm" disabled={state.phase === 'stopping'} onClick={() => void stop()}><PracticeIcon name="stop" size={12} />{state.phase === 'stopping' ? 'Saving…' : 'Stop'}</Button>
    </footer>
  </section>;
}
