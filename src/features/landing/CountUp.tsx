import { useEffect, useState } from 'react';
import { prefersReducedMotion, useInView } from './effects';

interface CountUpProps {
  to: number;
  from?: number;
  /** Start when true; when omitted, starts the first time the number scrolls into view. */
  play?: boolean;
  delay?: number;
  duration?: number;
}

/** An integer that counts up when it's seen. Reduced motion shows the final value. */
export function CountUp({ to, from = 0, play, delay = 0, duration = 900 }: CountUpProps) {
  const [ref, inView] = useInView<HTMLSpanElement>();
  const go = play ?? inView;
  const [value, setValue] = useState(() => (prefersReducedMotion() ? to : from));

  useEffect(() => {
    if (prefersReducedMotion()) { setValue(to); return; }
    if (!go) { setValue(from); return; }
    let frame = 0;
    const start = performance.now() + delay;
    const tick = (now: number) => {
      const progress = Math.min(1, Math.max(0, (now - start) / duration));
      setValue(Math.round(from + (to - from) * (1 - (1 - progress) ** 3)));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [go, from, to, delay, duration]);

  return <span ref={ref} className="lp-count">{value}</span>;
}
