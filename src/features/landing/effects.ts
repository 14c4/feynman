import { useEffect, useRef, useState, type RefObject } from 'react';

export const prefersReducedMotion = () => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

/** True once the element has scrolled into view; it stays true. */
export function useInView<T extends Element>(threshold = 0.4): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || inView) return;
    if (!('IntersectionObserver' in window)) { setInView(true); return; }
    const observer = new IntersectionObserver(([entry]) => { if (entry?.isIntersecting) { setInView(true); observer.disconnect(); } }, { threshold });
    observer.observe(element);
    return () => observer.disconnect();
  }, [inView, threshold]);
  return [ref, inView];
}

/**
 * Desktop pointer delights, driven by one listener:
 * - `[data-glow]` surfaces get a light that follows the pointer (`--px/--py`);
 * - `[data-magnetic]` buttons lean toward the pointer (`--magx/--magy`).
 * Off for touch screens and reduced motion.
 */
export function usePointerEffects(root: RefObject<HTMLElement | null>, enabled: boolean) {
  useEffect(() => {
    const container = root.current;
    if (!container || !enabled || !window.matchMedia?.('(hover: hover) and (pointer: fine)').matches) return;
    let frame = 0;
    let last: PointerEvent | undefined;
    let magnet: HTMLElement | null = null;

    const release = (button: HTMLElement) => { button.style.removeProperty('--magx'); button.style.removeProperty('--magy'); };
    const update = () => {
      frame = 0;
      const event = last;
      if (!event) return;
      const target = event.target instanceof Element ? event.target : null;
      const glow = target?.closest<HTMLElement>('[data-glow]');
      if (glow) {
        const box = glow.getBoundingClientRect();
        glow.style.setProperty('--px', `${Math.round(event.clientX - box.left)}px`);
        glow.style.setProperty('--py', `${Math.round(event.clientY - box.top)}px`);
      }
      const next = target?.closest<HTMLElement>('[data-magnetic]') ?? null;
      if (magnet && magnet !== next) release(magnet);
      magnet = next;
      if (next) {
        const box = next.getBoundingClientRect();
        next.style.setProperty('--magx', ((event.clientX - (box.left + box.width / 2)) / (box.width / 2)).toFixed(3));
        next.style.setProperty('--magy', ((event.clientY - (box.top + box.height / 2)) / (box.height / 2)).toFixed(3));
      }
    };
    const move = (event: PointerEvent) => { last = event; if (!frame) frame = requestAnimationFrame(update); };
    const leave = (event: MouseEvent) => {
      if (event.relatedTarget) return;
      if (magnet) { release(magnet); magnet = null; }
    };
    window.addEventListener('pointermove', move, { passive: true });
    document.addEventListener('mouseout', leave);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('pointermove', move); document.removeEventListener('mouseout', leave); };
  }, [root, enabled]);
}
