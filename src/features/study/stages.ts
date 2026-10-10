import type { PracticeSession, PracticeStage } from '../../../shared/types';

export const STEPS = ['Prepare', 'Check', 'Teach Alex', 'Recheck', 'Results'] as const;

export function stepIndex(stage: PracticeStage): number {
  switch (stage) {
    case 'preparing': return 0;
    case 'baseline': case 'baseline_evaluating': return 1;
    case 'teaching': return 2;
    case 'recheck': case 'recheck_evaluating': return 3;
    case 'results': return 4;
  }
}

export function sessionHref(session: PracticeSession) {
  return session.stage === 'results' ? `/results/${session.id}` : `/study/${session.id}`;
}

export function statusLabel(session: PracticeSession) {
  if (session.lifecycle === 'completed') return 'Completed';
  if (session.lifecycle === 'paused') return 'Paused';
  return STEPS[stepIndex(session.stage)];
}
