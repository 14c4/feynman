import { useEffect } from 'react';
import { Link, Outlet, useLocation } from 'react-router';

export function AppLayout() {
  const { pathname } = useLocation();
  const isStudy = pathname.startsWith('/study/');
  const isResults = pathname.startsWith('/results/');

  useEffect(() => {
    window.scrollTo(0, 0);
    document.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
    document.title = `${isStudy ? 'Study' : isResults ? 'Reflection' : 'Learn by explaining'} · feynman.ai`;
  }, [pathname, isStudy, isResults]);

  return (
    <>
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="app-header">
        <div className="header-inner">
          <Link to="/" className="brand" aria-label="feynman.ai home">
            <span className="brand-mark" aria-hidden="true">f.</span>
            <span>feynman<span className="brand-suffix">.ai</span></span>
          </Link>
          <nav aria-label="Main navigation" className="header-nav">
            <Link to="/" aria-current={!isStudy && !isResults ? 'page' : undefined}>Practice</Link>
            <span className="build-label">Test readiness</span>
          </nav>
        </div>
      </header>
      <main id="main" className="main-content"><Outlet /></main>
    </>
  );
}
