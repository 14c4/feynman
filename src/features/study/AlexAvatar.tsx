import { useEffect, useRef } from 'react';
import type { AlexState } from './alexState';

interface AlexAvatarProps {
  state: AlexState;
  size?: 'sm' | 'md' | 'lg';
  /** Optional 0–1 audio level source (ElevenLabs volume). Sampled per frame, never stored. */
  getLevel?: () => number;
}

/**
 * Alex: an original, minimal character. Rings and face respond to state; when an
 * audio level source is provided they also follow the real voice volume.
 */
export function AlexAvatar({ state, size = 'md', getLevel }: AlexAvatarProps) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    element.style.setProperty('--level', '0');
    if (!getLevel || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    let frame = 0; let smooth = 0;
    const tick = () => {
      const raw = Math.min(1, Math.max(0, getLevel() || 0));
      smooth += (raw - smooth) * 0.25;
      element.style.setProperty('--level', smooth.toFixed(3));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [getLevel]);

  return <div ref={root} className={`alex alex--${size}`} data-state={state} aria-hidden="true">
    <span className="alex-ring alex-ring--outer" />
    <span className="alex-ring alex-ring--inner" />
    <span className="alex-orbit"><span /></span>
    <svg className="alex-face" viewBox="0 0 100 100">
      <circle className="alex-head" cx="50" cy="50" r="46" />
      <path className="alex-tuft" d="M43 6c3-5 10-6 14-2-4 0-6 2-7 5" />
      <g className="alex-eyes">
        <rect className="alex-eye" x="31" y="40" width="9" height="13" rx="4.5" />
        <rect className="alex-eye" x="60" y="40" width="9" height="13" rx="4.5" />
      </g>
      <path className="alex-mouth alex-mouth--smile" d="M41 66q9 7 18 0" />
      <ellipse className="alex-mouth alex-mouth--open" cx="50" cy="67" rx="6" ry="4.5" />
      <path className="alex-mouth alex-mouth--flat" d="M43 67h14" />
    </svg>
  </div>;
}
