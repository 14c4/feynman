import { useLayoutEffect, useRef, useState } from 'react';
import type { PracticeSession } from '../../shared/types';
import { useSessions } from '../state/useSessions';
import { START_RECHECK_EVENT, STEPS, stepIndex } from '../features/study/stages';
import { PracticeIcon } from './practice/PracticeIcon';

/**
 * Study progress as a glass slider: a highlight glides under the current step, and the steps the
 * session can genuinely move to (Teach Alex and Recheck, in either direction) are clickable.
 */
export function StudyStepper({ session }: { session: PracticeSession }) {
  const { busy, returnToTeaching } = useSessions();
  const list = useRef<HTMLOListElement>(null);
  const [thumb, setThumb] = useState<{ x: number; w: number }>();
  const current = stepIndex(session.stage);
  const cycle = session.cycles.find((item) => item.id === session.currentCycleId) ?? session.cycles[0];
  const taught = Boolean(cycle?.conversations.some((segment) => segment.messages.some((message) => message.role === 'learner') || segment.channel !== 'text'));
  const ready = session.lifecycle === 'active' && !busy[session.id];

  /** What clicking a step does, or nothing when the session cannot move there right now. */
  function jump(index: number): (() => void) | undefined {
    if (!ready) return undefined;
    if (index === 2 && session.stage === 'recheck') return () => void returnToTeaching(session.id).catch(() => undefined);
    // The teaching panel owns hanging up a live voice call before the follow-up begins.
    if (index === 3 && session.stage === 'teaching' && taught) return () => window.dispatchEvent(new Event(START_RECHECK_EVENT));
    return undefined;
  }

  useLayoutEffect(() => {
    const measure = () => {
      const item = list.current?.children[current] as HTMLElement | undefined;
      if (item) setThumb({ x: item.offsetLeft, w: item.offsetWidth });
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (list.current) observer.observe(list.current);
    return () => observer.disconnect();
  }, [current]);

  return <nav className="stepper" aria-label="Study progress">
    {thumb && <span className="stepper-thumb" aria-hidden="true" style={{ width: thumb.w, transform: `translateX(${thumb.x}px)` }} />}
    <ol ref={list}>{STEPS.map((step, index) => {
      const action = jump(index);
      const isCurrent = index === current;
      return <li key={step} className={index < current ? 'is-done' : isCurrent ? 'is-current' : ''}>
        <button type="button" className="stepper-item" aria-current={isCurrent ? 'step' : undefined} aria-disabled={!isCurrent && !action ? true : undefined}
          title={action ? `Go to ${step}` : undefined} onClick={action}>
          <span className="stepper-mark">{index < current ? <PracticeIcon name="check" size={12} strokeWidth={2.2} /> : index + 1}</span>
          <span className="stepper-label">{step}</span>
        </button>
      </li>;
    })}</ol>
  </nav>;
}
