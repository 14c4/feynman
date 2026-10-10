import { useEffect, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { PreviewIcon } from './PreviewIcon';
import type { PreviewScreen } from './previewFixtures';

const screenNames: Record<PreviewScreen, string> = { home: 'Home', practice: 'New practice', baseline: 'Baseline assessment', conversation: 'AI student conversation', followup: 'Follow-up assessment', results: 'Results & reflection', history: 'Session history' };

export function PreviewLayout({ screen, children }: { screen: PreviewScreen; children: ReactNode }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    document.title = `${screenNames[screen]} · Preview · feynman.ai`;
    window.scrollTo(0, 0);
    document.querySelector<HTMLElement>('#preview-main h1')?.focus({ preventScroll: true });
  }, [pathname, screen]);
  const practicing = !['home', 'history'].includes(screen);
  return <div className="preview-app">
    <a className="skip-link" href="#preview-main">Skip to content</a>
    <aside className="pv-sidebar">
      <Link to="/preview" className="pv-brand" aria-label="feynman.ai preview home"><span className="pv-brand-mark">f.</span>feynman<span>.ai</span></Link>
      <nav aria-label="Preview navigation" className="pv-nav">
        <Link to="/preview" aria-current={screen === 'home' ? 'page' : undefined}><PreviewIcon name="home" />Home</Link>
        <Link to="/preview/practice" aria-current={practicing ? 'page' : undefined}><PreviewIcon name="practice" />Practice</Link>
        <Link to="/preview/history" aria-current={screen === 'history' ? 'page' : undefined}><PreviewIcon name="history" />History</Link>
      </nav>
      <div className="pv-sidebar-bottom"><Link to="/" className="pv-live-link"><span className="pv-badge pv-badge-live">LIVE</span>Open live application <PreviewIcon name="arrow" size={16} /></Link></div>
    </aside>
    <div className="pv-workarea">
      <header className="pv-topbar"><strong>{screenNames[screen]}</strong><span className="pv-badge">PREVIEW</span></header>
      <div className="pv-preview-bar"><p><strong>Interactive design preview</strong><span>Sample data · no AI calls or microphone access · resets on refresh</span></p><label className="pv-screen-picker"><span className="sr-only">Explore preview screen</span><select value={screen} onChange={(event) => void navigate(event.target.value === 'home' ? '/preview' : `/preview/${event.target.value}`)}>{Object.entries(screenNames).map(([value, title]) => <option key={value} value={value}>{title}</option>)}</select></label></div>
      <main id="preview-main" className={`pv-main pv-main--${screen}`}>{children}</main>
    </div>
  </div>;
}

export function PracticeSteps({ current }: { current: number }) {
  return <nav aria-label="Preview practice stages" className="pv-steps">{[
    ['baseline', 'First check'], ['conversation', 'Explain it'], ['followup', 'Try again'], ['results', 'Reflect'],
  ].map(([path, label], index) => <Link key={path} to={`/preview/${path}`} className={index === current ? 'is-current' : index < current ? 'is-done' : ''} aria-current={index === current ? 'step' : undefined}><span>{index < current ? <PreviewIcon name="check" size={14} /> : index + 1}</span>{label}</Link>)}</nav>;
}
