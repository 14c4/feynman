import { useEffect, useRef, useState } from 'react';
import type { PracticeSession } from '../../../shared/types';
import { MONITORING_LIMITS } from '../../../shared/types';
import { Button } from '../../components/Button';
import { PracticeIcon } from '../../components/practice/PracticeIcon';
import { useSessions } from '../../state/useSessions';
import { CHECKIN_SECONDS, PURPOSE_LABELS, purposeFor, useMonitor } from './monitoringContext';
import './insights.css';

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (!active) return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [active]);
  return now;
}

/** Floating status while the camera is on, plus the outcome of the last window. */
export function MonitorDock() {
  const { state, stream, stop, dismiss } = useMonitor();
  const video = useRef<HTMLVideoElement>(null);
  const active = state.phase === 'requesting' || state.phase === 'calibrating' || state.phase === 'monitoring' || state.phase === 'stopping';
  const now = useNow(active);
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => { if (video.current) video.current.srcObject = stream ?? null; }, [stream, collapsed]);
  // A saved check-in note clears itself; errors stay until dismissed.
  const saved = state.phase === 'idle' && Boolean(state.finished);
  useEffect(() => { if (!saved) return; const timer = setTimeout(dismiss, 8000); return () => clearTimeout(timer); }, [saved, dismiss]);
  if (!active && !state.finished && state.phase !== 'error') return null;
  const simulated = state.source === 'simulated' || state.finished?.source === 'simulated';

  if (!active) return <aside className="monitor-dock monitor-dock--done card enter" aria-label="Camera insights">
    <div className="monitor-dock-head"><span className="monitor-dot" data-tone={state.phase === 'error' ? 'error' : 'done'} aria-hidden="true" /><strong>{state.phase === 'error' ? 'Camera insights stopped' : 'Check-in saved'}</strong>
      <button type="button" className="icon-button" aria-label="Dismiss" onClick={dismiss}><PracticeIcon name="close" size={14} /></button></div>
    {state.error && <p className="small">{state.error}</p>}
    {state.finished && <p className="small muted">{state.finished.valid ? `${state.finished.valid} reliable ${simulated ? 'simulated ' : ''}readings were added to your timeline.` : 'No readings were reliable enough to keep. That’s common with movement or low light; your learning results are unaffected.'}{state.finished.reason ? ` ${state.finished.reason}` : ''}</p>}
  </aside>;

  const elapsed = state.startedAt ? now - state.startedAt : 0;
  const pulse = state.status?.latest.pulse; const breathing = state.status?.latest.breathing;
  const pulseWait = Math.max(0, Math.ceil((MONITORING_LIMITS.pulseWarmupMs - elapsed) / 1000));
  const breathingWait = Math.max(0, Math.ceil((MONITORING_LIMITS.breathingWarmupMs - elapsed) / 1000));
  const remaining = state.endsAt ? Math.max(0, Math.ceil((state.endsAt - now) / 1000)) : undefined;
  const headline = state.phase === 'requesting' ? (state.probe ? 'Checking camera…' : 'Starting camera…') : state.phase === 'stopping' ? 'Saving readings…' : state.phase === 'calibrating' ? 'Calibrating' : 'Monitoring';

  return <aside className={`monitor-dock card enter ${collapsed ? 'is-collapsed' : ''}`} aria-label="Camera insights" aria-live="polite">
    <div className="monitor-dock-head">
      <span className="monitor-dot" data-tone={state.phase === 'monitoring' ? 'live' : 'wait'} aria-hidden="true" />
      <strong>{headline}</strong>
      {simulated && <span className="badge badge--warning badge--mono">{collapsed ? 'SIM' : 'DEV SIMULATED'}</span>}
      {collapsed && pulse?.valid && <span className="mono small">{Math.round(pulse.value)} bpm</span>}
      {remaining !== undefined && <span className="monitor-time mono">{remaining}s</span>}
      <button type="button" className="icon-button monitor-toggle" aria-expanded={!collapsed} aria-label={collapsed ? 'Expand camera insights' : 'Minimise camera insights'} onClick={() => setCollapsed((value) => !value)}><PracticeIcon name="chevron" size={14} /></button>
      {collapsed && <button type="button" className="icon-button monitor-toggle" aria-label="Stop camera insights" disabled={state.phase === 'stopping'} onClick={() => void stop()}><PracticeIcon name="stop" size={12} /></button>}
    </div>
    {!collapsed && <>
    <div className="monitor-dock-body">
      {stream ? <video ref={video} className="monitor-preview" autoPlay muted playsInline aria-label="Your camera preview (not recorded)" /> : <span className="monitor-preview monitor-preview--none" aria-hidden="true"><PracticeIcon name="camera" size={18} /></span>}
      <dl className="monitor-readings">
        <div><dt><PracticeIcon name="heart" size={12} />Pulse</dt><dd className="mono">{pulse?.valid ? `${Math.round(pulse.value)} bpm` : pulseWait ? `ready in ${pulseWait}s` : '—'}</dd></div>
        <div><dt><PracticeIcon name="wave" size={12} />Breathing</dt><dd className="mono">{breathing?.valid ? `${Math.round(breathing.value)} /min` : breathingWait ? `ready in ${breathingWait}s` : '—'}</dd></div>
      </dl>
    </div>
    {!simulated && state.camera && <p className="monitor-pipeline mono" title="Measured from capture timestamps, not the camera's advertised setting">
      Camera {state.camera.label}{state.camera.fps ? ` · ${Math.round(state.camera.fps)} fps` : ''}{state.status?.pipeline?.processedFps ? ` · Presage ${Math.round(state.status.pipeline.processedFps)} fps` : ''}</p>}
    <p className="monitor-hint small">{state.phase === 'requesting' && state.probe ? `Measuring what your camera really delivers (${state.probe}).` : state.advice ? state.advice : state.status?.hint ? state.status.hint : simulated ? 'Synthetic test values, not a measurement. No camera is used.' : state.phase === 'monitoring' ? 'Sit comfortably and keep your face in view.' : 'Keep your face centred and well lit. Readings appear once they’re reliable.'}</p>
    <div className="monitor-dock-foot">
      <span className="small muted">{state.purpose ? PURPOSE_LABELS[state.purpose] : ''} · video is not stored</span>
      <Button variant="quiet" size="sm" disabled={state.phase === 'stopping'} onClick={() => void stop()}><PracticeIcon name="stop" size={12} />Stop</Button>
    </div>
    </>}
  </aside>;
}

/**
 * Inline, opt-in prompt for a check-in at a natural pause. Explains what happens to the camera
 * feed before anything starts. Hidden while monitoring is already running.
 */
export function MonitorPrompt({ session, compact = false }: { session: PracticeSession; compact?: boolean }) {
  const { integration } = useSessions();
  const { state, start } = useMonitor();
  const [open, setOpen] = useState(false);
  const health = integration?.physiology;
  if (!health || session.lifecycle !== 'active') return null;
  if (state.phase === 'requesting' || state.phase === 'calibrating' || state.phase === 'monitoring' || state.phase === 'stopping') return null;
  const purpose = purposeFor(session);
  const simulated = health.source === 'simulated';
  const title = purpose === 'before_assessment' ? 'Optional: a calm 60-second check-in before you start' : purpose === 'after_teaching' ? 'Optional: a 60-second check-in after teaching' : purpose === 'after_reassessment' ? 'Optional: a 60-second check-in to close the session' : 'Optional camera insights';

  if (!health.available) return compact ? null : <section className="monitor-prompt monitor-prompt--off card" aria-label="Camera insights">
    <span className="monitor-prompt-icon"><PracticeIcon name="camera" size={16} /></span>
    <div><strong>Camera insights are off</strong><p className="small muted">{health.reason} Your learning results and confidence tracking work without it.</p></div>
  </section>;

  return <section className={`monitor-prompt card ${compact ? 'monitor-prompt--compact' : ''}`} aria-labelledby={`monitor-${purpose}`}>
    <span className="monitor-prompt-icon"><PracticeIcon name="camera" size={16} /></span>
    <div className="monitor-prompt-main">
      <strong id={`monitor-${purpose}`}>{title}{simulated && <span className="badge badge--warning badge--mono">DEV SIMULATED</span>}</strong>
      {!open ? <p className="small muted">See pulse and breathing readings alongside your learning timeline. Entirely optional.</p> : <>
        <ul className="monitor-consent small">
          {simulated ? <li><strong>Development mode:</strong> readings are synthetic test values and the camera is not used.</li>
            : <li>Your browser sends small, low-resolution camera frames to this app’s server, where Presage SmartSpectra estimates pulse and breathing. Frames are processed and discarded; <strong>no video is stored</strong>.</li>}
          <li>Readings are kept only when the SDK reports them as reliable, with their quality noted.</li>
          <li>They are reflective information, <strong>not a diagnosis</strong> and not a measure of anxiety or confidence.</li>
          <li>You can stop at any time. Leaving the session turns the camera off.</li>
        </ul>
        <div className="button-row">
          <Button size="sm" onClick={() => { setOpen(false); void start(session.id, purpose, CHECKIN_SECONDS); }}><PracticeIcon name="clock" size={14} />Start {CHECKIN_SECONDS}-second check-in</Button>
          <Button size="sm" variant="secondary" onClick={() => { setOpen(false); void start(session.id, 'in_session'); }}>Keep on while I study</Button>
          <button type="button" className="text-button" onClick={() => setOpen(false)}>Not now</button>
        </div>
      </>}
      {state.phase === 'error' && state.sessionId === session.id && state.error && !open && <p className="small notice notice--warning" role="alert"><PracticeIcon name="alert" size={14} />{state.error}</p>}
    </div>
    {!open && <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>Set up</Button>}
  </section>;
}
