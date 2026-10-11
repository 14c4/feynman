import { useEffect } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import { PracticeIcon } from './practice/PracticeIcon';
import { useSessions } from '../state/useSessions';
import { StudyStepper } from './StudyStepper';
import './layout.css';

function Brand() {
  return <Link to="/" className="brand" aria-label="feynman.ai home"><span className="brand-mark" aria-hidden="true">f</span><span>feynman<span className="brand-suffix">.ai</span></span></Link>;
}

function ModeBadge({ mode }: { mode?: 'real' | 'mock' }) {
  if (mode === 'mock') return <span className="badge badge--warning badge--mono" title="Development mock provider: deterministic test questions and grades">DEV MOCK</span>;
  return null;
}

export function AppLayout() {
  const { pathname } = useLocation();
  const isStudy = pathname.startsWith('/study/');
  const isResults = pathname.startsWith('/results/');
  const { sessions, providerMode } = useSessions();
  const currentId = pathname.split('/')[2];
  const session = currentId ? sessions[currentId] : undefined;
  const mode = session?.providerMode ?? providerMode;
  const mock = mode === 'mock';

  useEffect(() => {
    window.scrollTo(0, 0);
    document.querySelector<HTMLElement>('main h1')?.focus({ preventScroll: true });
    document.title = `${isStudy ? 'Study' : isResults ? 'Reflection' : 'Learn it by explaining it'} · feynman.ai`;
  }, [pathname, isStudy, isResults]);

  const mockBar = mock && <div className="mock-bar" role="status"><PracticeIcon name="info" size={14} /><span><strong>Development mock provider.</strong> Fixed arithmetic questions and deterministic test grades · not Gemini · no provider requests.</span></div>;

  // During a study session, through to its results, the header keeps the progress stepper in front.
  if (isStudy || isResults) {
    return <div className="shell shell--focus">
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="focus-bar">
        <div className="focus-bar-start"><Link to="/" className="icon-button" aria-label="Back to home"><PracticeIcon name="back" size={18} /></Link><Brand /></div>
        {session && <StudyStepper session={session} />}
        <div className="focus-bar-end"><ModeBadge mode={mode} /></div>
      </header>
      {mockBar}
      <main id="main" className="focus-main"><Outlet /></main>
    </div>;
  }

  return <div className="shell">
    <a className="skip-link" href="#main">Skip to content</a>
    <header className="topbar"><Brand /><ModeBadge mode={mode} /></header>
    {mockBar}
    <main id="main" className="page"><Outlet /></main>
  </div>;
}
