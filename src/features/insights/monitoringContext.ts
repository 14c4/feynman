import { createContext, useContext } from 'react';
import type { MonitoringPurpose, MonitoringStatus, PhysiologySource, PracticeSession } from '../../../shared/types';
import type { FrameEncoding } from './cameraPipeline';
import type { TrackingStore, TrackingSummary } from './faceTracker';

export type MonitorPhase = 'idle' | 'requesting' | 'calibrating' | 'monitoring' | 'stopping' | 'error';

export interface MonitorState {
  phase: MonitorPhase;
  sessionId?: string;
  windowId?: string;
  purpose?: MonitoringPurpose;
  source?: PhysiologySource;
  /** Epoch ms when the window started (for warm-up countdowns). */
  startedAt?: number;
  /** Epoch ms when a timed check-in ends; continuous monitoring has none. */
  endsAt?: number;
  status?: MonitoringStatus;
  /** Camera negotiation progress, e.g. "640×480: 18 fps". */
  probe?: string;
  /** Chosen camera configuration and its measured capture rate. */
  camera?: { label: string; fps?: number };
  /** Plain-language suggestion when the frame rate is low or frames are being lost. */
  advice?: string;
  /** The camera is open for this window (simulated windows continue without it if it is declined). */
  cameraOn?: boolean;
  /** Why the camera is not in use, when the window continues without it. */
  cameraNote?: string;
  /** How frames are currently uploaded to Presage. */
  encoding?: FrameEncoding;
  /** Local face-tracker summary, refreshed a few times a second. */
  tracking?: TrackingSummary;
  error?: string;
  /** Summary of the last finished window, shown until dismissed. */
  finished?: { sessionId: string; valid: number; total: number; reason?: string; source: PhysiologySource };
}

export interface MonitorContextValue {
  state: MonitorState;
  stream?: MediaStream;
  /** Frame-rate tracker output for the overlay (outside React state). */
  tracking?: TrackingStore;
  start: (sessionId: string, purpose: MonitoringPurpose, checkinSeconds?: number) => Promise<void>;
  stop: () => Promise<void>;
  dismiss: () => void;
}

export const MonitorContext = createContext<MonitorContextValue | null>(null);

export function useMonitor() {
  const context = useContext(MonitorContext);
  if (!context) throw new Error('useMonitor must be used within MonitoringProvider');
  return context;
}

export const PURPOSE_LABELS: Record<MonitoringPurpose, string> = {
  before_assessment: 'Before the first check',
  after_teaching: 'After teaching Alex',
  after_reassessment: 'After the follow-up check',
  in_session: 'During the session',
};

/** The check-in that fits where the learner is right now. */
export function purposeFor(session: PracticeSession): MonitoringPurpose {
  const baseline = session.attempts.find((attempt) => attempt.kind === 'baseline');
  if (session.stage === 'preparing' || (session.stage === 'baseline' && !baseline?.startedAt)) return 'before_assessment';
  if (session.stage === 'teaching') return 'after_teaching';
  if (session.stage === 'results') return 'after_reassessment';
  return 'in_session';
}

/** Long enough for Presage's 30-second breathing warm-up plus some valid readings. */
export const CHECKIN_SECONDS = 60;
