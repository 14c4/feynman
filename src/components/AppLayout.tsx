import { useEffect } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import { PracticeIcon } from './practice/PracticeIcon';
import { useSessions } from '../state/useSessions';
import './practice/practice.css';

export function AppLayout() {
  const { pathname, hash } = useLocation();
  const isStudy = pathname.startsWith('/study/');
  const isResults = pathname.startsWith('/results/');
  const { sessions, providerMode } = useSessions();
  const session = sessions[pathname.split('/')[2]];
  const mode = session?.providerMode ?? providerMode;
  const mock = mode === 'mock';

  useEffect(() => {
    if (hash === '#sessions') {
      document.getElementById('sessions')?.scrollIntoView();
      document.getElementById('recent-heading')?.focus({ preventScroll: true });
    } else {
      window.scrollTo(0, 0);
      document.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
    }
    document.title = `${isStudy ? 'Study' : isResults ? 'Reflection' : 'Learn by explaining'} · feynman.ai`;
  }, [pathname, hash, isStudy, isResults]);

  return (
    <div className="preview-app live-practice-app">
      <a className="skip-link" href="#main">Skip to content</a>
      <aside className="pv-sidebar"><Link to="/" className="pv-brand" aria-label="feynman.ai home"><span className="pv-brand-mark">f.</span>feynman<span>.ai</span></Link>
        <nav aria-label="Main navigation" className="pv-nav"><Link to="/" aria-current={!isStudy && !isResults ? 'page' : undefined}><PracticeIcon name="home" />Home</Link><Link to="/#sessions"><PracticeIcon name="history" />History</Link></nav>
        <div className="pv-sidebar-bottom"><Link to="/preview" className="pv-live-link"><span className="pv-badge">PREVIEW</span>Design preview<PracticeIcon name="arrow" size={16} /></Link></div>
      </aside>
      <div className="pv-workarea"><header className="pv-topbar"><strong>{isStudy ? 'Practice session' : isResults ? 'Results & reflection' : 'Home'}</strong><span className="pv-badge">{mock ? 'DEV MOCK' : mode === 'real' ? 'LIVE' : 'API'}</span></header>
        {mock && <div className="pv-preview-bar" role="status"><p><strong>Development mock provider</strong><span>Fixed arithmetic questions and deterministic test grades · not Gemini · no provider requests</span></p></div>}
        <main id="main" className={`pv-main ${!isStudy && !isResults ? 'pv-main--home' : ''}`}><Outlet /></main></div>
    </div>
  );
}
