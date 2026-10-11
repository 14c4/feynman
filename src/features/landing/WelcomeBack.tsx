import { useState, type CSSProperties } from 'react';
import { Link } from 'react-router';
import type { PracticeStage, SessionSummary } from '../../../shared/types';
import { Button } from '../../components/Button';
import { PracticeIcon, type PracticeIconName } from '../../components/practice/PracticeIcon';
import { AlexAvatar } from '../study/AlexAvatar';
import { STAGE_LABEL, savedWhen, useSavedSessions } from '../topics/useSavedSessions';

const STEPS = ['Check', 'Teach', 'Recheck', 'Results'] as const;
const STEP_OF: Record<PracticeStage, number> = { preparing: 0, baseline: 0, baseline_evaluating: 0, teaching: 1, recheck: 2, recheck_evaluating: 2, results: 3 };
const ICONS: PracticeIconName[] = ['target', 'message', 'refresh', 'check'];
const SHOWN = 6;

function greeting() {
  const hour = new Date().getHours();
  return hour < 5 ? 'Up late' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

/** Check → Teach → Recheck → Results, filled up to where the session is. */
function StageTrack({ stage }: { stage: PracticeStage }) {
  const at = STEP_OF[stage];
  return <ol className="wb-track" style={{ '--at': at / (STEPS.length - 1) } as CSSProperties} aria-label={`Stage: ${STAGE_LABEL[stage]}`}>
    {STEPS.map((step, index) => <li key={step} className={index < at || stage === 'results' ? 'is-done' : index === at ? 'is-now' : ''}>
      <span className="wb-track-dot" aria-hidden="true" /><span className="wb-track-label">{step}</span>
    </li>)}
  </ol>;
}

function OpenButton({ item, opening, onOpen, primary }: { item: SessionSummary; opening?: string; onOpen: (item: SessionSummary) => void; primary?: boolean }) {
  const done = item.stage === 'results';
  return <Button variant={primary ? 'primary' : 'secondary'} size={primary ? 'lg' : 'sm'} className={primary ? 'wb-open' : ''} disabled={Boolean(opening)} onClick={() => onOpen(item)}>
    {opening === item.id ? <><span className="spinner" aria-hidden="true" />Opening…</> : <>{done ? 'View results' : 'Continue'}{primary && <span className="button-arrow"><PracticeIcon name="arrow" size={14} /></span>}</>}
  </Button>;
}

/** Home for a signed-in learner: where they left off, and everything they've studied. */
export function WelcomeBack() {
  const { items, error, opening, load, open } = useSavedSessions();
  const [showAll, setShowAll] = useState(false);
  const onOpen = (item: SessionSummary) => void open(item);
  const featured = items?.find((item) => item.stage !== 'results' && item.lifecycle !== 'completed') ?? items?.[0];
  const unfinished = Boolean(featured && featured.stage !== 'results');
  const completed = items?.filter((item) => item.stage === 'results').length ?? 0;
  const shown = items && (showAll ? items : items.slice(0, SHOWN));

  return <>
    <section className="lp-hero wb-hero">
      <div className="lp-aurora" aria-hidden="true"><span /><span /><span /></div>
      <div className="lp-grid" aria-hidden="true"><i /><i /><i /><i /></div>

      <div className="lp-hero-copy wb-head">
        <p className="wb-greet">{greeting()}</p>
        <h1 className="lp-title wb-title" tabIndex={-1}><span>Welcome back.</span></h1>
        <p className="lp-lede">{items?.length ? unfinished ? 'Pick up where you left off, or teach something new.' : 'What do you want to teach today?' : 'Ready when you are.'}</p>
      </div>

      <div className="wb-feature">
        {!items && !error && <div className="wb-card wb-card--loading" aria-busy="true"><span className="skeleton" /><span className="skeleton" /><span className="skeleton" /></div>}
        {items && !featured && <div className="wb-card wb-card--first">
          <AlexAvatar state="idle" size="lg" />
          <div className="wb-card-copy"><span className="lp-w-label">Your first session</span><h2>Teach Alex something.</h2>
            <Link className="button button--primary button--lg wb-open" to="/app">Start<span className="button-arrow"><PracticeIcon name="arrow" size={14} /></span></Link></div>
        </div>}
        {featured && <div className="wb-card">
          <AlexAvatar state={unfinished ? 'listening' : 'idle'} size="lg" />
          <div className="wb-card-copy">
            <span className="lp-w-label">{unfinished ? 'Continue' : 'Latest results'} · {savedWhen(featured.updatedAt)}</span>
            <h2>{featured.title}</h2>
            <StageTrack stage={featured.stage} />
            <div className="wb-card-actions">
              <OpenButton item={featured} opening={opening} onOpen={onOpen} primary />
              <Link className="button button--secondary button--lg wb-open" to="/app">New session<span className="button-arrow wb-arrow-soft"><PracticeIcon name="plus" size={14} /></span></Link>
            </div>
          </div>
        </div>}
      </div>
      {error && <p className="form-error wb-error" role="alert"><PracticeIcon name="alert" size={16} />{error} <button type="button" className="text-button" onClick={() => void load()}>Try again</button></p>}
    </section>

    {shown && shown.length > 0 && <section className="lp-section wb-history" aria-labelledby="history-title">
      <header className="wb-history-head">
        <h2 id="history-title">History</h2>
        <span className="muted small">{items.length} {items.length === 1 ? 'session' : 'sessions'} · {completed} completed</span>
      </header>
      <ul className="wb-list">
        {shown.map((item, index) => {
          const step = STEP_OF[item.stage];
          return <li key={item.id} style={{ '--i': index } as CSSProperties}>
            <span className={`wb-list-icon${item.stage === 'results' ? ' is-done' : ''}`} aria-hidden="true"><PracticeIcon name={ICONS[step]!} size={16} /></span>
            <div className="wb-list-copy"><strong>{item.title}</strong><span>{STAGE_LABEL[item.stage]} · {savedWhen(item.updatedAt)}</span></div>
            <span className="wb-mini" aria-hidden="true">{STEPS.map((step_, position) => <i key={step_} className={position < step || item.stage === 'results' ? 'is-done' : position === step ? 'is-now' : ''} />)}</span>
            <OpenButton item={item} opening={opening} onOpen={onOpen} />
          </li>;
        })}
      </ul>
      {items.length > SHOWN && <button type="button" className="text-button wb-more" onClick={() => setShowAll((value) => !value)}>{showAll ? 'Show less' : `Show all ${items.length}`}</button>}
    </section>}
  </>;
}
