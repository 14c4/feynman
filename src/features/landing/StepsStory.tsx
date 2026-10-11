import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { PracticeIcon } from '../../components/practice/PracticeIcon';
import { AlexAvatar } from '../study/AlexAvatar';
import { CountUp } from './CountUp';
import { Ring } from './Ring';

const STEPS = [
  { title: 'Check', text: 'Three quick questions show where you stand.' },
  { title: 'Teach', text: 'Explain it to Alex by voice or text. Alex asks back.' },
  { title: 'Recheck', text: 'New questions on the same ideas. See what stuck.' },
];
/** The landing nav's height on wider screens; the pinned stage sits just under it. */
const NAV = 68;

function CheckVisual() {
  return <div className="lp-step-visual lp-v-check" aria-hidden="true">
    <div className="lp-v-card">
      <div className="lp-v-progress"><i className="is-done" /><i className="is-now" /><i /></div>
      <span className="lp-line" style={{ width: '82%' }} /><span className="lp-line" style={{ width: '56%' }} />
      <div className="lp-v-input"><span className="lp-v-typed" /><span className="lp-caret" /></div>
      <span className="lp-v-flag"><PracticeIcon name="info" size={12} />Not sure</span>
    </div>
  </div>;
}

function TeachVisual() {
  return <div className="lp-step-visual lp-v-teach" aria-hidden="true">
    <div className="lp-v-msg lp-v-msg--you"><span className="lp-line" style={{ width: '90%' }} /><span className="lp-line" style={{ width: '64%' }} /></div>
    <div className="lp-v-row"><AlexAvatar state="idle" size="sm" /><div className="lp-v-msg lp-v-msg--alex"><span className="lp-typing"><i /><i /><i /></span><span className="lp-v-ask">But why?</span></div></div>
  </div>;
}

function RecheckVisual({ play }: { play?: boolean }) {
  return <div className="lp-step-visual lp-v-recheck" aria-hidden="true">
    <div className="lp-v-score"><span className="lp-v-ring"><Ring value={1} tone="muted" /><strong><CountUp to={1} play={play} delay={300} /><small>/3</small></strong></span><span>Before</span></div>
    <PracticeIcon name="arrow" size={18} />
    <div className="lp-v-score"><span className="lp-v-ring"><Ring value={3} /><strong><CountUp to={3} play={play} delay={900} /><small>/3</small></strong></span><span>After</span></div>
  </div>;
}

const visual = (index: number, play?: boolean) => index === 0 ? <CheckVisual /> : index === 1 ? <TeachVisual /> : <RecheckVisual play={play} />;

/**
 * How it works. Wider screens get a pinned story: the steps stay put while scrolling moves through them.
 * Phones get a swipeable row with dots. Only one of the two is ever displayed.
 */
export function StepsStory({ reduced }: { reduced: boolean }) {
  const track = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const element = track.current;
    if (!element) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const box = element.getBoundingClientRect();
      if (!box.height) return;
      const travel = box.height - (window.innerHeight - NAV);
      const progress = travel > 0 ? Math.min(1, Math.max(0, (NAV - box.top) / travel)) : 0;
      element.style.setProperty('--progress', progress.toFixed(4));
      setActive(Math.min(STEPS.length - 1, Math.floor(progress * STEPS.length)));
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    measure();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('scroll', schedule); window.removeEventListener('resize', schedule); };
  }, []);

  /** Scroll the page to the middle of a step's stretch of the story. */
  const jumpTo = (index: number) => {
    const element = track.current;
    if (!element) return;
    const top = element.getBoundingClientRect().top + window.scrollY - NAV;
    const travel = element.offsetHeight - (window.innerHeight - NAV);
    window.scrollTo({ top: top + travel * ((index + 0.5) / STEPS.length), behavior: reduced ? 'auto' : 'smooth' });
  };

  // Phones: swipeable row whose dots follow the swipe and jump to a step.
  const row = useRef<HTMLOListElement>(null);
  const [activeCard, setActiveCard] = useState(0);
  const offsetOf = (index: number) => {
    const list = row.current; const first = list?.children[0] as HTMLElement | undefined; const card = list?.children[index] as HTMLElement | undefined;
    return first && card ? card.offsetLeft - first.offsetLeft : 0;
  };
  const onRowScroll = () => {
    const list = row.current; if (!list) return;
    setActiveCard(Math.min(STEPS.length - 1, Math.max(0, Math.round(list.scrollLeft / (offsetOf(1) || 1)))));
  };
  const goToCard = (index: number) => row.current?.scrollTo({ left: offsetOf(index), behavior: reduced ? 'auto' : 'smooth' });

  return <section id="how" className="lp-section lp-how" aria-labelledby="how-title">
    <div className="lp-section-head" data-reveal>
      <span className="eyebrow">How it works</span>
      <h2 id="how-title">Learn it by teaching it.</h2>
    </div>

    <div ref={track} className="lp-story">
      <div className="lp-story-stage">
        <ol className="lp-story-steps">
          {STEPS.map((step, index) => <li key={step.title} className={index === active ? 'is-active' : index < active ? 'is-past' : ''}>
            <button type="button" aria-current={index === active ? 'step' : undefined} onClick={() => jumpTo(index)}>
              <span className="lp-step-num">0{index + 1}</span><h3>{step.title}</h3><p>{step.text}</p>
            </button>
          </li>)}
        </ol>
        <div className="lp-story-card" data-glow aria-hidden="true">
          {STEPS.map((step, index) => <div key={step.title} className={`lp-story-panel${index === active ? ' is-in' : ''}`}>{visual(index, active === index)}</div>)}
        </div>
      </div>
    </div>

    <ol ref={row} className="lp-steps" onScroll={onRowScroll}>
      {STEPS.map((step, index) => <li key={step.title} className="lp-step" data-reveal style={{ '--d': index } as CSSProperties}>
        {visual(index)}
        <span className="lp-step-num">0{index + 1}</span>
        <h3>{step.title}</h3>
        <p>{step.text}</p>
      </li>)}
    </ol>
    <div className="lp-dots">{STEPS.map((step, index) => <button key={step.title} type="button" aria-label={`Show step ${index + 1}: ${step.title}`} aria-current={activeCard === index || undefined} onClick={() => goToCard(index)} />)}</div>
  </section>;
}
