import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { Link } from 'react-router';
import { Brand } from '../../components/AppLayout';
import { PracticeIcon } from '../../components/practice/PracticeIcon';
import { AlexAvatar } from '../study/AlexAvatar';
import { ALEX_LABELS, type AlexState } from '../study/alexState';
import { useAuth } from '../../state/useAuth';
import { WelcomeBack } from './WelcomeBack';
import '../study/study.css';
import './landing.css';

/* Everything on this page is an illustration of the product; nothing here calls a provider. */
const BEATS: AlexState[] = ['user-speaking', 'thinking', 'speaking'];
const QUESTIONS = ['So where does the oxygen actually come from?', 'Why does it need light at all?', 'Could a plant do this in the dark?'];
const TOPICS = ['Photosynthesis', 'Supply & demand', 'Derivatives', 'The French Revolution', 'Recursion', 'Mitosis', 'Ohm’s law', 'Plate tectonics', 'Bayes’ theorem', 'The Krebs cycle', 'Opportunity cost', 'Newton’s laws'];
const CONCEPTS = [{ name: 'Light reactions', before: 0, after: 2 }, { name: 'Calvin cycle', before: 1, after: 2 }, { name: 'Chlorophyll', before: 0, after: 1 }];

const prefersReducedMotion = () => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

/** Steps through the demo conversation; holds still for reduced motion or a hidden tab. */
function useDemoBeat(reduced: boolean) {
  const [beat, setBeat] = useState(0);
  useEffect(() => {
    if (reduced) return;
    const id = window.setInterval(() => { if (!document.hidden) setBeat((current) => current + 1); }, 2600);
    return () => window.clearInterval(id);
  }, [reduced]);
  return reduced ? 2 : beat;
}

/** Adds `is-in` to each `[data-reveal]` element the first time it scrolls into view. */
function useReveal(root: RefObject<HTMLElement | null>, view: string) {
  useEffect(() => {
    const items = Array.from(root.current?.querySelectorAll<HTMLElement>('[data-reveal]') ?? []);
    if (!('IntersectionObserver' in window)) { items.forEach((item) => item.classList.add('is-in')); return; }
    const observer = new IntersectionObserver((entries) => entries.forEach((entry) => {
      if (entry.isIntersecting) { entry.target.classList.add('is-in'); observer.unobserve(entry.target); }
    }), { threshold: 0.18, rootMargin: '0px 0px -6% 0px' });
    items.forEach((item) => observer.observe(item));
    return () => observer.disconnect();
  }, [root, view]);
}

function NavActions() {
  const { user, available, loading, signOut } = useAuth();
  if (loading) return null;
  if (user) return <div className="lp-nav-end">
    <span className="lp-nav-email" title={user.email}>{user.email}</span>
    <button type="button" className="button button--quiet" onClick={() => void signOut().then(() => window.scrollTo(0, 0))}>Sign out</button>
  </div>;
  return <div className="lp-nav-end">
    {available && <Link className="button button--secondary" to="/account">Sign in</Link>}
  </div>;
}

function Ring({ value, total = 3, tone = 'accent' }: { value: number; total?: number; tone?: 'accent' | 'muted' }) {
  return <svg className={`lp-ring lp-ring--${tone}`} viewBox="0 0 40 40" aria-hidden="true">
    <circle cx="20" cy="20" r="16" className="lp-ring-track" />
    <circle cx="20" cy="20" r="16" className="lp-ring-fill" style={{ '--p': value / total } as CSSProperties} />
  </svg>;
}

/** The hero: Alex mid-lesson, surrounded by the pieces of a real session. */
function HeroStage({ reduced }: { reduced: boolean }) {
  const stage = useRef<HTMLDivElement>(null);
  const beat = useDemoBeat(reduced);
  const state = BEATS[beat % BEATS.length]!;
  const question = QUESTIONS[Math.floor(beat / BEATS.length) % QUESTIONS.length]!;
  const stateRef = useRef(state);
  stateRef.current = state;
  // A gentle synthetic level so Alex's rings and mouth move with the demo "voice".
  const getLevel = useCallback(() => {
    const now = performance.now();
    return stateRef.current === 'thinking' ? 0 : 0.35 + 0.3 * Math.sin(now / 110) * Math.sin(now / 290);
  }, []);

  useEffect(() => {
    const element = stage.current;
    if (!element || reduced || !window.matchMedia?.('(pointer: fine)').matches) return;
    let frame = 0;
    const move = (event: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const box = element.getBoundingClientRect();
        element.style.setProperty('--mx', (((event.clientX - box.left) / box.width) * 2 - 1).toFixed(3));
        element.style.setProperty('--my', (((event.clientY - box.top) / box.height) * 2 - 1).toFixed(3));
      });
    };
    const leave = () => { element.style.setProperty('--mx', '0'); element.style.setProperty('--my', '0'); };
    window.addEventListener('pointermove', move, { passive: true });
    document.addEventListener('pointerleave', leave);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('pointermove', move); document.removeEventListener('pointerleave', leave); };
  }, [reduced]);

  const widget = (depth: number, delay: number): CSSProperties => ({ '--depth': depth, '--delay': `${delay}ms` } as CSSProperties);

  return <div ref={stage} className="lp-stage" aria-hidden="true">
    <div className="lp-teach lp-float" style={widget(0.35, 260)}>
      <div className="lp-teach-head"><span className="lp-live-dot" />Teaching Alex<span className="lp-tag-mono">Photosynthesis</span></div>
      <div className="lp-teach-body">
        <AlexAvatar state={state} size="lg" getLevel={getLevel} />
        <p className="alex-state"><span className={`alex-state-dot alex-state-dot--${state}`} />{ALEX_LABELS[state]}</p>
      </div>
      <div className={`lp-wave${state === 'user-speaking' ? ' is-live' : ''}`}>{Array.from({ length: 28 }, (_, index) => <span key={index} style={{ '--i': index } as CSSProperties} />)}</div>
    </div>

    <div className="lp-w lp-w--bubble lp-float" style={widget(1.1, 520)}>
      <span className="lp-w-label">Alex</span>
      {state === 'speaking'
        ? <p key={question} className="lp-bubble-text">{question}</p>
        : <span className="lp-typing"><i /><i /><i /></span>}
    </div>

    <div className="lp-w lp-w--score lp-float" style={widget(1.4, 640)}>
      <Ring value={1} tone="muted" />
      <div><span className="lp-w-label">Baseline</span><strong className="lp-w-big">1<small>/3</small></strong></div>
    </div>

    <div className="lp-w lp-w--file lp-float" style={widget(0.9, 760)}>
      <span className="file-kind">PDF</span>
      <div><strong>biology-notes.pdf</strong><span>3 concepts ready</span></div>
      <span className="lp-check"><PracticeIcon name="check" size={13} strokeWidth={2.2} /></span>
    </div>

    <div className="lp-w lp-w--recheck lp-float" style={widget(1.6, 880)}>
      <Ring value={3} />
      <div><span className="lp-w-label">Recheck</span><strong className="lp-w-big">3<small>/3</small></strong></div>
      <span className="lp-delta">+2</span>
    </div>

    <span className="lp-chip lp-chip--a lp-float" style={widget(2, 980)}><i />Light reactions</span>
    <span className="lp-chip lp-chip--b lp-float" style={widget(1.8, 1080)}><i />Calvin cycle</span>
    <span className="lp-chip lp-chip--c lp-float" style={widget(2.2, 1180)}><i />Chlorophyll</span>
  </div>;
}

/** The guest view: what feynman.ai is, shown rather than told. */
function Showcase({ reduced, onHow }: { reduced: boolean; onHow: () => void }) {
  // On phones the three steps become a swipeable row; the dots follow the swipe and jump to a step.
  const steps = useRef<HTMLOListElement>(null);
  const [activeStep, setActiveStep] = useState(0);
  const offsetOf = (index: number) => {
    const list = steps.current; const first = list?.children[0] as HTMLElement | undefined; const card = list?.children[index] as HTMLElement | undefined;
    return first && card ? card.offsetLeft - first.offsetLeft : 0;
  };
  const onStepsScroll = () => {
    const list = steps.current; if (!list) return;
    const width = offsetOf(1) || 1;
    setActiveStep(Math.min(2, Math.max(0, Math.round(list.scrollLeft / width))));
  };
  const goToStep = (index: number) => steps.current?.scrollTo({ left: offsetOf(index), behavior: reduced ? 'auto' : 'smooth' });

  return <>
    <section className="lp-hero">
      <div className="lp-aurora" aria-hidden="true"><span /><span /><span /></div>
      <div className="lp-grid" aria-hidden="true"><i /><i /><i /><i /></div>

      <div className="lp-hero-copy">
        <h1 className="lp-title"><span>Think you know it?</span> <em>Prove it.</em></h1>
        <p className="lp-lede">Explain it to Alex. Find the gaps. Walk into the exam knowing what you know.</p>
        <div className="lp-cta">
          <Link className="button button--primary button--lg" to="/app">Try it out<span className="button-arrow"><PracticeIcon name="arrow" size={14} /></span></Link>
          <button type="button" className="button button--secondary button--lg" onClick={onHow}>How it works</button>
        </div>
      </div>

      <HeroStage reduced={reduced} />
      <p className="sr-only">An example session: Alex, an AI student, asks questions while you explain photosynthesis. Your baseline score is 1 of 3; after teaching, your recheck score is 3 of 3.</p>
    </section>

    <div className="lp-ticker" aria-hidden="true">
      <div className="lp-ticker-track">{[...TOPICS, ...TOPICS].map((topic, index) => <span key={index}>{topic}<i /></span>)}</div>
    </div>

    <section id="how" className="lp-section" aria-labelledby="how-title">
      <div className="lp-section-head" data-reveal>
        <span className="eyebrow">How it works</span>
        <h2 id="how-title">Learn it by teaching it.</h2>
      </div>
      <ol ref={steps} className="lp-steps" onScroll={onStepsScroll}>
        <li className="lp-step" data-reveal style={{ '--d': 0 } as CSSProperties}>
          <div className="lp-step-visual lp-v-check" aria-hidden="true">
            <div className="lp-v-card">
              <div className="lp-v-progress"><i className="is-done" /><i className="is-now" /><i /></div>
              <span className="lp-line" style={{ width: '82%' }} /><span className="lp-line" style={{ width: '56%' }} />
              <div className="lp-v-input"><span className="lp-v-typed" /><span className="lp-caret" /></div>
              <span className="lp-v-flag"><PracticeIcon name="info" size={12} />Not sure</span>
            </div>
          </div>
          <span className="lp-step-num">01</span>
          <h3>Check</h3>
          <p>Three quick questions show where you stand.</p>
        </li>
        <li className="lp-step" data-reveal style={{ '--d': 1 } as CSSProperties}>
          <div className="lp-step-visual lp-v-teach" aria-hidden="true">
            <div className="lp-v-msg lp-v-msg--you"><span className="lp-line" style={{ width: '90%' }} /><span className="lp-line" style={{ width: '64%' }} /></div>
            <div className="lp-v-row"><AlexAvatar state="idle" size="sm" /><div className="lp-v-msg lp-v-msg--alex"><span className="lp-typing"><i /><i /><i /></span><span className="lp-v-ask">But why?</span></div></div>
          </div>
          <span className="lp-step-num">02</span>
          <h3>Teach</h3>
          <p>Explain it to Alex by voice or text. Alex asks back.</p>
        </li>
        <li className="lp-step" data-reveal style={{ '--d': 2 } as CSSProperties}>
          <div className="lp-step-visual lp-v-recheck" aria-hidden="true">
            <div className="lp-v-score"><Ring value={1} tone="muted" /><span>Before</span></div>
            <PracticeIcon name="arrow" size={18} />
            <div className="lp-v-score"><Ring value={3} /><span>After</span></div>
          </div>
          <span className="lp-step-num">03</span>
          <h3>Recheck</h3>
          <p>New questions on the same ideas. See what stuck.</p>
        </li>
      </ol>
      <div className="lp-dots">{['Check', 'Teach', 'Recheck'].map((label, index) => <button key={label} type="button" aria-label={`Show step ${index + 1}: ${label}`} aria-current={activeStep === index || undefined} onClick={() => goToStep(index)} />)}</div>
    </section>

    <section className="lp-section lp-split" aria-labelledby="results-title">
      <div className="lp-split-copy" data-reveal>
        <span className="eyebrow">Your results</span>
        <h2 id="results-title">See what actually changed.</h2>
        <p>Every concept, before and after you taught it.</p>
      </div>
      <div className="lp-results card" data-reveal aria-hidden="true">
        <div className="lp-results-head">
          <div><span className="lp-w-label">Photosynthesis</span><strong className="lp-results-score">1 <PracticeIcon name="arrow" size={18} /> <span>3<small>/3</small></span></strong></div>
          <span className="badge badge--accent"><PracticeIcon name="trend" size={12} />Improved</span>
        </div>
        <ul className="lp-concepts">
          {CONCEPTS.map((concept, index) => <li key={concept.name} style={{ '--i': index } as CSSProperties}>
            <span className="lp-concept-name">{concept.name}</span>
            <span className="lp-bars"><span className="lp-bar lp-bar--before" style={{ '--v': concept.before / 2 } as CSSProperties} /><span className="lp-bar lp-bar--after" style={{ '--v': concept.after / 2 } as CSSProperties} /></span>
            <span className="lp-concept-delta mono">{concept.after > concept.before ? `+${concept.after - concept.before}` : '='}</span>
          </li>)}
        </ul>
        <div className="lp-results-legend"><span><i className="lp-key lp-key--before" />Before</span><span><i className="lp-key lp-key--after" />After</span></div>
      </div>
    </section>

    <section className="lp-final" aria-labelledby="final-title" data-reveal>
      <div className="lp-final-glow" aria-hidden="true" />
      <div className="lp-final-alex"><AlexAvatar state="listening" size="md" /></div>
      <h2 id="final-title">Your turn to teach.</h2>
      <Link className="button button--lg lp-button-light" to="/app">Try it out<span className="button-arrow"><PracticeIcon name="arrow" size={14} /></span></Link>
    </section>
  </>;
}

export function LandingPage() {
  const root = useRef<HTMLDivElement>(null);
  const [reduced] = useState(prefersReducedMotion);
  const [scrolled, setScrolled] = useState(false);
  const { user, loading } = useAuth();
  // Signed-in learners get their own home; nothing renders until the saved sign-in has been checked, so it never flashes.
  const view = loading ? 'loading' : user ? 'home' : 'guest';
  useReveal(root, view);

  useEffect(() => {
    window.scrollTo(0, 0);
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => { document.title = view === 'home' ? 'Welcome back · feynman.ai' : 'feynman.ai · Learn by explaining'; }, [view]);

  const toHow = () => document.getElementById('how')?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });

  return <div ref={root} className="lp">
    <a className="skip-link" href="#lp-main">Skip to content</a>
    <header className={`lp-nav${scrolled ? ' is-scrolled' : ''}`}><Brand /><NavActions /></header>

    <main id="lp-main">
      {view === 'guest' ? <Showcase reduced={reduced} onHow={toHow} /> : view === 'home' ? <WelcomeBack /> : <div className="lp-pending" aria-busy="true" />}
    </main>

    <footer className="lp-footer"><Brand /><span>Learn by explaining.</span><span className="mono">© 2026</span></footer>
  </div>;
}
