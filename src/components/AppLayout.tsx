import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import { PracticeIcon } from './practice/PracticeIcon';
import { useSessions } from '../state/useSessions';
import { STEPS, sessionHref, statusLabel, stepIndex } from '../features/study/stages';
import './layout.css';

function Brand() {
  return <Link to="/" className="brand" aria-label="feynman.ai home"><span className="brand-mark" aria-hidden="true">f</span><span>feynman<span className="brand-suffix">.ai</span></span></Link>;
}

function ModeBadge({ mode }: { mode?: 'real' | 'mock' }) {
  if (mode === 'mock') return <span className="badge badge--warning badge--mono" title="Development mock provider: deterministic test questions and grades">DEV MOCK</span>;
  if (mode === 'real') return <span className="badge badge--accent"><span className="dot dot--accent" />Live</span>;
  return null;
}

export function AppLayout() {
  const { pathname, hash } = useLocation();
  const isStudy = pathname.startsWith('/study/');
  const isResults = pathname.startsWith('/results/');
  const { sessions, providerMode } = useSessions();
  const currentId = pathname.split('/')[2];
  const session = currentId ? sessions[currentId] : undefined;
  const mode = session?.providerMode ?? providerMode;
  const mock = mode === 'mock';
  const [menuOpen, setMenuOpen] = useState(false);
  const recent = Object.values(sessions).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 8);

  useEffect(() => {
    setMenuOpen(false);
    if (hash === '#sessions') {
      document.getElementById('sessions')?.scrollIntoView();
      document.getElementById('recent-heading')?.focus({ preventScroll: true });
    } else {
      window.scrollTo(0, 0);
      document.querySelector<HTMLElement>('main h1')?.focus({ preventScroll: true });
    }
    document.title = `${isStudy ? 'Study' : isResults ? 'Reflection' : 'Learn it by explaining it'} · feynman.ai`;
  }, [pathname, hash, isStudy, isResults]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenuOpen(false); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [menuOpen]);

  const mockBar = mock && <div className="mock-bar" role="status"><PracticeIcon name="info" size={14} /><span><strong>Development mock provider.</strong> Fixed arithmetic questions and deterministic test grades · not Gemini · no provider requests.</span></div>;

  // Focus mode: during a study session the navigation steps back so the learning stays in front.
  if (isStudy) {
    const current = session ? stepIndex(session.stage) : -1;
    return <div className="shell shell--focus">
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="focus-bar">
        <div className="focus-bar-start"><Link to="/" className="icon-button" aria-label="Back to home"><PracticeIcon name="back" size={18} /></Link><Brand /></div>
        {session && <ol className="stepper" aria-label="Study progress">{STEPS.map((step, index) => <li key={step} className={index < current ? 'is-done' : index === current ? 'is-current' : ''} aria-current={index === current ? 'step' : undefined}>
          <span className="stepper-mark">{index < current ? <PracticeIcon name="check" size={12} strokeWidth={2.2} /> : index + 1}</span><span className="stepper-label">{step}</span></li>)}</ol>}
        <div className="focus-bar-end"><ModeBadge mode={mode} /></div>
      </header>
      {mockBar}
      <main id="main" className="focus-main"><Outlet /></main>
    </div>;
  }

  return <div className={`shell ${menuOpen ? 'is-menu-open' : ''}`}>
    <a className="skip-link" href="#main">Skip to content</a>
    <header className="mobile-bar"><Brand /><div className="mobile-bar-end"><ModeBadge mode={mode} /><button type="button" className="icon-button" aria-expanded={menuOpen} aria-controls="sidebar" aria-label={menuOpen ? 'Close menu' : 'Open menu'} onClick={() => setMenuOpen((open) => !open)}><PracticeIcon name={menuOpen ? 'close' : 'menu'} /></button></div></header>
    <aside id="sidebar" className="sidebar">
      <div className="sidebar-top"><Brand /><ModeBadge mode={mode} /></div>
      <Link to="/" className="button button--secondary button--block sidebar-new" onClick={() => { if (pathname === '/') document.getElementById('topic')?.focus(); }}><PracticeIcon name="plus" size={16} />New session</Link>
      <nav aria-label="Main navigation" className="sidebar-nav">
        <Link to="/" aria-current={pathname === '/' && hash !== '#sessions' ? 'page' : undefined}><PracticeIcon name="home" size={18} />Home</Link>
        <Link to="/#sessions" aria-current={pathname === '/' && hash === '#sessions' ? 'page' : undefined}><PracticeIcon name="history" size={18} />All sessions</Link>
      </nav>
      {recent.length > 0 && <div className="sidebar-recent"><span className="sidebar-heading">Recent</span><ul>{recent.map((item) => <li key={item.id}>
        <Link to={sessionHref(item)} aria-current={item.id === currentId ? 'page' : undefined}><span className={`dot ${item.lifecycle === 'completed' ? 'dot--accent' : item.lifecycle === 'paused' ? '' : 'dot--warning'}`} aria-hidden="true" /><span className="sidebar-recent-title">{item.title}</span><span className="sidebar-recent-meta">{statusLabel(item)}</span></Link>
      </li>)}</ul></div>}
      <div className="sidebar-foot"><p className="sidebar-tagline"><PracticeIcon name="leaf" size={14} />You teach. Alex learns.</p><Link to="/preview" className="sidebar-preview">Design preview <span className="badge">Sample data</span></Link></div>
    </aside>
    <button type="button" className="scrim" aria-hidden="true" tabIndex={-1} onClick={() => setMenuOpen(false)} />
    <div className="workarea">{mockBar}<main id="main" className="page"><Outlet /></main></div>
  </div>;
}
