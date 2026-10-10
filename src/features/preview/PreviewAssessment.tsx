import { useEffect, useState } from 'react';
import type { AssessmentAnswer } from '../../../shared/types';
import { Button } from '../../components/Button';
import { AssessmentView } from './AssessmentView';
import { PracticeSteps } from './PreviewLayout';
import { PreviewIcon } from './PreviewIcon';
import { fixtureQuestions, type PreviewFixture, type PreviewKind } from './previewFixtures';

export interface PreviewDraft { answers: AssessmentAnswer[]; index: number }

export function PreviewAssessment({ fixture, title, kind, draft, onDraft, onComplete, onPause, before, onBefore }: {
  fixture: PreviewFixture; title: string; kind: PreviewKind; draft: PreviewDraft;
  onDraft: (draft: PreviewDraft) => void; onComplete: () => void; onPause: () => void;
  before: number | undefined; onBefore: (value: number | undefined) => void;
}) {
  const [phase, setPhase] = useState<'answering' | 'loading' | 'error'>('answering');
  const [submitted, setSubmitted] = useState(false);
  const [fail, setFail] = useState(false);
  const [skipRating, setSkipRating] = useState(false);
  const questions = fixtureQuestions(fixture, kind);
  const answer = draft.answers[draft.index];
  useEffect(() => {
    if (!submitted || phase !== 'loading') return;
    const timer = setTimeout(() => { setSubmitted(false); if (fail) setPhase('error'); else onComplete(); }, 1100);
    return () => clearTimeout(timer);
  }, [submitted, phase, fail, onComplete]);
  function next(skip: boolean) {
    const answers = draft.answers.map((item, index) => index === draft.index && skip ? { ...item, text: '', working: '', skipped: true } : item);
    onDraft({ answers, index: Math.min(draft.index + 1, 2) });
    if (draft.index === 2) { setSubmitted(true); setPhase('loading'); }
  }
  return <><PracticeSteps current={kind === 'baseline' ? 0 : 2} /><header className="pv-study-heading"><div><span className="pv-eyebrow">{kind === 'baseline' ? 'BASELINE ASSESSMENT' : 'MATCHED FOLLOW-UP'}</span><h1 tabIndex={-1}>{kind === 'baseline' ? 'Let’s see what you remember.' : 'A fresh way to check your thinking.'}</h1><p>{title}</p></div><Button variant="secondary" onClick={onPause}>Pause preview</Button></header>
    <div className="pv-assessment-layout"><div>
      {phase === 'answering' ? <AssessmentView question={questions[draft.index]} answer={answer} index={draft.index} count={3} draftLabel="Draft held in preview tab" submitLabel="Submit preview answers" onChange={(updated) => onDraft({ ...draft, answers: draft.answers.map((item) => item.questionId === updated.questionId ? updated : item) })} onBack={() => onDraft({ ...draft, index: draft.index - 1 })} onNext={next} /> :
        <section className="pv-card pv-evaluation" aria-live="polite"><span className={`pv-evaluation-icon ${phase === 'loading' ? 'is-loading' : ''}`}><PreviewIcon name={phase === 'loading' ? 'practice' : 'close'} size={30} /></span><span className="pv-badge">PREVIEW TRANSITION</span><h2>{phase === 'loading' ? 'Making space for feedback…' : 'We couldn’t check your answers.'}</h2><p>{phase === 'loading' ? 'In the live app, Gemini checks the three responses against fixed criteria.' : 'This is a simulated provider failure. Your local preview responses are still here.'}</p><p className="pv-field-help">No grading request is made. The next screen shows a fixed example, not an evaluation of what you typed.</p><div className="pv-action-row">{phase === 'error' && <Button onClick={() => { setFail(false); setSubmitted(true); setPhase('loading'); }}>Retry preview transition</Button>}<Button variant="secondary" onClick={() => { setSubmitted(false); setPhase('answering'); }}>Return to questions</Button></div></section>}
      <p className="pv-assessment-foot"><PreviewIcon name="book" size={16} />{kind === 'baseline' ? 'No answers or corrections during the check.' : 'Different questions. The same three concepts.'}</p>
      <p className="pv-fixture-note">Sample questions: <strong>{fixture.title}</strong>. Local inputs are ungraded.</p>
    </div><aside className="pv-assessment-aside">
      {kind === 'baseline' && !skipRating && <section className="pv-card pv-rating"><h3>How nervous do you feel?</h3><p>Optional self-report · not a diagnosis</p><div className="pv-rating-buttons">{[1, 2, 3, 4, 5].map((value) => <button type="button" key={value} aria-label={`Before practice nervousness ${value} of 5`} aria-pressed={before === value} onClick={() => onBefore(value)}>{value}</button>)}</div><div className="pv-rating-labels"><span>Not at all</span><span>Very</span></div><button className="pv-text-button" type="button" onClick={() => { setSkipRating(true); onBefore(undefined); }}>Skip this check-in</button></section>}
      <details className="pv-state-tools"><summary>Explore assessment states</summary><label htmlFor="pv-assessment-state">Display state</label><select id="pv-assessment-state" value={phase} onChange={(event) => { setSubmitted(false); setPhase(event.target.value as typeof phase); }}><option value="answering">Answering</option><option value="loading">Evaluating (sample)</option><option value="error">Failed (sample)</option></select><label className="pv-checkbox"><input type="checkbox" checked={fail} onChange={(event) => setFail(event.target.checked)} />Simulate failure on submit</label><Button variant="secondary" onClick={() => { setPhase('answering'); onDraft({ ...draft, answers: draft.answers.map((item, index) => index === draft.index ? { ...item, text: kind === 'baseline' ? fixture.concepts[index].baselineAnswer : fixture.concepts[index].recheckAnswer, skipped: false } : item) }); }}>Use sample answer</Button></details>
    </aside></div></>;
}
