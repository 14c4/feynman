import type { CSSProperties } from 'react';

/** A small score ring; the fill draws in when its section is revealed. */
export function Ring({ value, total = 3, tone = 'accent' }: { value: number; total?: number; tone?: 'accent' | 'muted' }) {
  return <svg className={`lp-ring lp-ring--${tone}`} viewBox="0 0 40 40" aria-hidden="true">
    <circle cx="20" cy="20" r="16" className="lp-ring-track" />
    <circle cx="20" cy="20" r="16" className="lp-ring-fill" style={{ '--p': value / total } as CSSProperties} />
  </svg>;
}
