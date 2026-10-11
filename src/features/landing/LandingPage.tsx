import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { Link } from 'react-router';
import { Brand } from '../../components/AppLayout';
import { PracticeIcon } from '../../components/practice/PracticeIcon';
import { AlexAvatar } from '../study/AlexAvatar';
import { ALEX_LABELS, type AlexState } from '../study/alexState';
import { useAuth } from '../../state/useAuth';
import { CountUp } from './CountUp';
import { prefersReducedMotion, usePointerEffects } from './effects';
import { Ring } from './Ring';
import { StepsStory } from './StepsStory';
import { WelcomeBack } from './WelcomeBack';
import '../study/study.css';
import './landing.css';

/* Everything on this page is an illustration of the product; nothing here calls a provider. */
const BEATS: AlexState[] = ['user-speaking', 'thinking', 'speaking'];
const QUESTIONS = ['So where does the oxygen actually come from?', 'Why does it need light at all?', 'Could a plant do this in the dark?'];
// The ticker's bank: every kind of subject, from intro to niche. Shuffled per visit, so no two scrolls match.
const TOPICS = [
  'Photosynthesis', 'Supply & demand', 'Derivatives', 'The French Revolution', 'Recursion', 'Mitosis', 'Ohm’s law', 'Plate tectonics',
  'Bayes’ theorem', 'The Krebs cycle', 'Opportunity cost', 'Newton’s laws', 'Quantum entanglement', 'General relativity', 'Black holes',
  'Reaction mechanisms', 'Electronegativity', 'Le Chatelier’s principle', 'Stoichiometry', 'The periodic table', 'CRISPR', 'Natural selection',
  'The immune system', 'Action potentials', 'Protein folding', 'Epigenetics', 'The nitrogen cycle', 'Glycolysis', 'The cardiac cycle',
  'Pharmacokinetics', 'Eigenvalues', 'Group theory', 'Prime numbers', 'Fourier series', 'Integration by parts', 'Probability distributions',
  'Game theory', 'Graph theory', 'Big-O notation', 'Hash tables', 'Public-key cryptography', 'Neural networks', 'TCP/IP', 'Compilers',
  'Sorting algorithms', 'Git branching', 'Semiconductors', 'Circuit design', 'Aerodynamics', 'Bridge design', 'The Cold War',
  'The Roman Republic', 'The Silk Road', 'The Industrial Revolution', 'The Meiji Restoration', 'The Ottoman Empire', 'The Renaissance',
  'Apartheid', 'Existentialism', 'Kant’s ethics', 'Utilitarianism', 'Plato’s cave', 'Stoicism', 'Cognitive dissonance',
  'Classical conditioning', 'Confirmation bias', 'Maslow’s hierarchy', 'Monetary policy', 'Inflation', 'Compound interest',
  'Comparative advantage', 'Behavioral economics', 'Double-entry bookkeeping', 'Marketing funnels', 'Impressionism', 'Iambic pentameter',
  'The hero’s journey', 'Baroque music', 'Chord progressions', 'Color theory', 'Film noir', 'Constitutional law', 'Contract law',
  'The Bill of Rights', 'Climate feedback loops', 'Ocean currents', 'The water cycle', 'Phonetics', 'The Spanish subjunctive',
  'Japanese particles', 'Chess openings', 'Sleep cycles',
];

/** A fresh Fisher–Yates shuffle. */
function shuffled<T>(items: readonly T[]) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index--) {
    const swap = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap]!, copy[index]!];
  }
  return copy;
}
const CONCEPTS = [{ name: 'Light reactions', before: 0, after: 2 }, { name: 'Calvin cycle', before: 1, after: 2 }, { name: 'Chlorophyll', before: 0, after: 1 }];
// A mix of subjects and levels, intro to upper-level. Kept short enough to fit one line on a phone.
const ROTOR_TOPICS = [
  'photosynthesis', 'eigenvalues', 'the Cold War', 'entropy', 'game theory',
  'Bayes’ theorem', 'CRISPR', 'existentialism', 'big-O notation', 'the Krebs cycle',
  'monetary policy', 'superposition', 'impressionism', 'recursion', 'plate tectonics',
  'Kant’s ethics', 'Fourier series', 'opportunity cost', 'neural networks', 'the Renaissance',
  'the Big Bang', 'mitosis', 'the Silk Road', 'Ohm’s law', 'derivatives',
];
// "it" comes back every few topics, and gets the highlighter.
const ROTOR_WORDS = ROTOR_TOPICS.flatMap((topic, index) => (index % 5 === 0 ? ['it', topic] : [topic]));

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
    {available && <Link className="button button--secondary" to="/account" viewTransition>Sign in</Link>}
  </div>;
}

/** "Think you know ___?" The word rolls through topics; its width eases so the centred headline never jumps. */
/** One rotor word. "it" is drawn twice: dark text, and a white copy on a green marker stroke that sweeps across it. */
function RotorWord({ word, className }: { word: string; className: string }) {
  if (word !== 'it') return <span className={`lp-rotor-word ${className}`}>{word}</span>;
  return <span className={`lp-rotor-word lp-it ${className}`}>it<span className="lp-it-ink">it</span></span>;
}

function Rotor({ reduced }: { reduced: boolean }) {
  const [count, setCount] = useState(0);
  const [hidden, setHidden] = useState(false);
  const [width, setWidth] = useState<number>();
  const sizer = useRef<HTMLSpanElement>(null);
  const total = ROTOR_WORDS.length;
  const word = ROTOR_WORDS[count % total]!;
  const previous = ROTOR_WORDS[(count + total - 1) % total]!;

  useEffect(() => {
    const onVisibility = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);
  // "it" lingers a little longer so the highlighter can finish its stroke.
  useEffect(() => {
    if (reduced || hidden) return;
    const id = window.setTimeout(() => setCount((current) => current + 1), word === 'it' ? 3600 : 2400);
    return () => window.clearTimeout(id);
  }, [count, word, reduced, hidden]);
  // Measures the incoming word (and re-measures when fonts load or the viewport resizes).
  useEffect(() => {
    const element = sizer.current;
    if (!element || !('ResizeObserver' in window)) return;
    const observer = new ResizeObserver(() => setWidth(element.offsetWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return <span className="lp-rotor" style={width ? { width } : undefined}>
    <span ref={sizer} className={`lp-rotor-sizer${word === 'it' ? ' is-it' : ''}`}>{word}</span>
    {count > 0 && <RotorWord key={`out-${count}`} word={previous} className="is-leaving" />}
    <RotorWord key={`in-${count}`} word={word} className={count > 0 ? 'is-entering' : 'is-first'} />
  </span>;
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
    <div className="lp-teach lp-float" data-glow style={widget(0.35, 260)}>
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
      <div><span className="lp-w-label">Recheck</span><strong className="lp-w-big"><CountUp from={1} to={3} delay={900} /><small>/3</small></strong></div>
      <span className="lp-delta">+2</span>
    </div>

    <span className="lp-chip lp-chip--a lp-float" style={widget(2, 980)}><i />Light reactions</span>
    <span className="lp-chip lp-chip--b lp-float" style={widget(1.8, 1080)}><i />Calvin cycle</span>
    <span className="lp-chip lp-chip--c lp-float" style={widget(2.2, 1180)}><i />Chlorophyll</span>
  </div>;
}

/** The guest view: what feynman.ai is, shown rather than told. */
function Showcase({ reduced, onHow }: { reduced: boolean; onHow: () => void }) {
  const [topics] = useState(() => shuffled(TOPICS));
  return <>
    <section className="lp-hero">
      <div className="lp-aurora" aria-hidden="true"><span /><span /><span /></div>
      <div className="lp-grid" aria-hidden="true"><i /><i /><i /><i /></div>

      <div className="lp-hero-copy">
        <h1 className="lp-title" aria-label="Think you know it? Prove it."><span aria-hidden="true">Think you know <span className="lp-title-line"><Rotor reduced={reduced} />?</span></span> <em aria-hidden="true">Prove it.</em></h1>
        <p className="lp-lede">Explain it to Alex. Find your gaps. Get that A+.</p>
        <div className="lp-cta">
          <Link className="button button--primary button--lg" to="/app" viewTransition data-magnetic>Try it out<span className="button-arrow"><PracticeIcon name="arrow" size={14} /></span></Link>
          <button type="button" className="button button--secondary button--lg" onClick={onHow}>How it works</button>
        </div>
      </div>

      <HeroStage reduced={reduced} />
      <p className="sr-only">An example session: Alex, an AI student, asks questions while you explain photosynthesis. Your baseline score is 1 of 3; after teaching, your recheck score is 3 of 3.</p>
    </section>

    <div className="lp-ticker" aria-hidden="true">
      <div className="lp-ticker-track" style={{ '--ticker-duration': `${topics.length * 2.6}s` } as CSSProperties}>{[...topics, ...topics].map((topic, index) => <span key={index}>{topic}<i /></span>)}</div>
    </div>

    <StepsStory reduced={reduced} />

    <section className="lp-section lp-split" aria-labelledby="results-title">
      <div className="lp-split-copy" data-reveal>
        <span className="eyebrow">Your results</span>
        <h2 id="results-title">See what actually changed.</h2>
        <p>Every concept, before and after you taught it.</p>
      </div>
      <div className="lp-results card" data-reveal data-glow aria-hidden="true">
        <div className="lp-results-head">
          <div><span className="lp-w-label">Photosynthesis</span><strong className="lp-results-score">1 <PracticeIcon name="arrow" size={18} /> <span><CountUp from={1} to={3} delay={700} /><small>/3</small></span></strong></div>
          <span className="badge badge--accent"><PracticeIcon name="trend" size={12} />Improved</span>
        </div>
        <ul className="lp-concepts">
          {CONCEPTS.map((concept, index) => <li key={concept.name} style={{ '--i': index } as CSSProperties}>
            <span className="lp-concept-name">{concept.name}</span>
            <span className="lp-bars"><span className="lp-bar lp-bar--before" style={{ '--v': concept.before / 2 } as CSSProperties} /><span className="lp-bar lp-bar--after" style={{ '--v': concept.after / 2 } as CSSProperties} /></span>
            <span className="lp-concept-delta mono">{concept.after > concept.before ? <>+<CountUp to={concept.after - concept.before} delay={900 + index * 140} /></> : '='}</span>
          </li>)}
        </ul>
        <div className="lp-results-legend"><span><i className="lp-key lp-key--before" />Before</span><span><i className="lp-key lp-key--after" />After</span></div>
      </div>
    </section>

    <section className="lp-final" aria-labelledby="final-title" data-reveal>
      <div className="lp-final-glow" aria-hidden="true" />
      <div className="lp-final-alex"><AlexAvatar state="listening" size="md" /></div>
      <h2 id="final-title">Your turn to teach.</h2>
      <Link className="button button--lg lp-button-light" to="/app" viewTransition data-magnetic>Try it out<span className="button-arrow"><PracticeIcon name="arrow" size={14} /></span></Link>
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
  usePointerEffects(root, !reduced);

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
