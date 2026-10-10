import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { useEffect, useRef } from 'react';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { PracticeIcon } from '../../components/practice/PracticeIcon';
import { useSessions } from '../../state/useSessions';
import { ConversationList } from '../study/ConversationStatus';
import type { AssessmentGrade, QuestionGrade } from '../../../shared/types';
import { CONFIDENCE_LABELS } from '../../../shared/insights';
import { ReadinessInsights } from '../insights/ReadinessInsights';
import { MonitorPrompt } from '../insights/MonitorDock';
import '../study/study.css';
import './feedback.css';

type ConceptOutcome = 'improved' | 'solid' | 'practice' | 'lower' | 'unchecked';

function outcome(before?: QuestionGrade, after?: QuestionGrade): ConceptOutcome {
  if (!after) return 'unchecked';
  if (before && after.score > before.score) return 'improved';
  if (before && after.score < before.score) return 'lower';
  if (after.score === after.maxScore) return 'solid';
  return 'practice';
}

function ScoreBar({ grade, label }: { grade?: AssessmentGrade; label: string }) {
  const max = grade?.maxScore ?? 6;
  return <span className="score-bar" role="img" aria-label={grade ? `${label}: ${grade.totalScore} of ${grade.maxScore}` : `${label}: no grade`}>
    {Array.from({ length: max }, (_, step) => <i key={step} className={grade && step < grade.totalScore ? 'is-on' : ''} style={{ animationDelay: `${step * 50}ms` }} />)}
  </span>;
}

export function ResultsPage() {
  const { sessionId = '' } = useParams(); const { sessions, busy, errors, loadSession, finishSession, setNervousness } = useSessions(); const navigate = useNavigate(); const session = sessions[sessionId]; const loadStarted = useRef(false);
  useEffect(() => { if (!session && !loadStarted.current) { loadStarted.current = true; void loadSession(sessionId).catch(() => { loadStarted.current = false; }); } }, [session, sessionId, loadSession]);
  if (!session) return <EmptyState loading={busy[sessionId]} title={busy[sessionId] ? 'Opening your reflection…' : 'Reflection unavailable'} description={busy[sessionId] ? 'Fetching your results.' : errors[sessionId] ?? 'We could not load this saved session.'} />;
  if (session.stage !== 'results') return <Navigate to={`/study/${sessionId}`} replace />;
  const baseline = session.attempts.find((attempt) => attempt.kind === 'baseline'); const finalAttempt = [...session.attempts].reverse().find((attempt) => attempt.kind === 'recheck' && attempt.grade); const mock = session.providerMode === 'mock'; const conversations = session.cycles.flatMap((cycle) => cycle.conversations);
  const before = baseline?.grade?.totalScore; const after = finalAttempt?.grade?.totalScore;
  const delta = before === undefined || after === undefined ? undefined : after - before;
  // A factual statement about these six questions only; never framed as mastery or improvement beyond the data.
  const comparison = delta === undefined ? undefined : delta > 0 ? `You scored ${delta} ${delta === 1 ? 'point' : 'points'} higher on the follow-up questions than on the first check.` : delta < 0 ? `You scored ${-delta} ${delta === -1 ? 'point' : 'points'} lower on the follow-up questions than on the first check.` : 'You scored the same on the follow-up questions as on the first check.';
  const concepts = session.concepts.map((concept) => {
    const first = baseline?.grade?.questionGrades.find((grade) => grade.conceptId === concept.id);
    const last = finalAttempt?.grade?.questionGrades.find((grade) => grade.conceptId === concept.id);
    return { concept, first, last, outcome: outcome(first, last) };
  });
  const stronger = concepts.filter((item) => item.outcome === 'improved' || item.outcome === 'solid');
  const weaker = concepts.filter((item) => item.last && item.last.score < item.last.maxScore);
  const weakTitles = weaker.map((item) => item.concept.title);
  const practiseAgain = () => void navigate('/', { state: { topic: session.title, description: `Practise ${weakTitles.join(', ')} from ${session.title}.` } });
  const pending = conversations.some((segment) => segment.transcriptStatus === 'pending');

  return <div className="results">
    <header className="results-head enter">
      <span className="eyebrow"><PracticeIcon name="leaf" size={14} />{session.title}</span>
      <h1 tabIndex={-1}>Here’s what changed.</h1>
    </header>

    {mock && <div className="notice notice--warning" role="status"><PracticeIcon name="info" size={16} /><p>DEV MOCK: these are deterministic test grades from the development fixture, not Gemini evaluation. {conversations.length ? 'Alex’s text replies were scripted test messages.' : 'Teaching was skipped with a test-only bypass; no conversation took place.'}</p></div>}

    <section className="compare card enter" aria-label="Assessment scores">
      <div className="compare-col"><span className="eyebrow">{mock ? 'DEV MOCK · ' : ''}First check</span><strong className="compare-score mono">{baseline?.grade ? <>{baseline.grade.totalScore}<span>/{baseline.grade.maxScore}</span></> : '—'}</strong><ScoreBar grade={baseline?.grade} label="First check" /><p>{baseline?.grade?.summary ?? 'No grade available'}</p></div>
      <div className="compare-mid" aria-hidden="true"><span className={`delta ${delta === undefined ? '' : delta > 0 ? 'delta--up' : delta < 0 ? 'delta--down' : ''}`}>{delta === undefined ? '—' : delta > 0 ? `+${delta}` : delta}</span><PracticeIcon name="arrow" size={18} /></div>
      <div className="compare-col compare-col--after"><span className="eyebrow">{mock ? 'DEV MOCK · ' : ''}Follow-up check</span><strong className="compare-score mono">{finalAttempt?.grade ? <>{finalAttempt.grade.totalScore}<span>/{finalAttempt.grade.maxScore}</span></> : '—'}</strong><ScoreBar grade={finalAttempt?.grade} label="Follow-up check" /><p>{finalAttempt?.grade?.summary ?? 'No grade available'}</p></div>
      {comparison && <p className="compare-note">{comparison} The follow-up used different questions on the same three concepts.</p>}
    </section>

    <ReadinessInsights session={session} />

    <div className="results-split">
      <section className="takeaway card" aria-labelledby="stronger-heading">
        <h3 id="stronger-heading"><span className="takeaway-icon"><PracticeIcon name="check" size={14} strokeWidth={2} /></span>Understood better or solid</h3>
        {stronger.length ? <ul>{stronger.map((item) => <li key={item.concept.id}>{item.concept.title}</li>)}</ul> : <p className="muted small">None of the follow-up answers scored higher yet. That’s useful to know.</p>}
      </section>
      <section className="takeaway takeaway--warm card" aria-labelledby="practice-heading">
        <h3 id="practice-heading"><span className="takeaway-icon"><PracticeIcon name="target" size={14} /></span>Still worth practising</h3>
        {weaker.length ? <ul>{weaker.map((item) => <li key={item.concept.id}>{item.concept.title}</li>)}</ul> : <p className="muted small">Every follow-up answer received full marks.</p>}
      </section>
    </div>

    <section className="next-step card" aria-labelledby="next-heading">
      <div><span className="eyebrow">What to do next</span>
        <h3 id="next-heading">{weaker.length ? `Explain ${weakTitles.length === 1 ? weakTitles[0] : 'these ideas'} again in a fresh session` : 'Try teaching Alex a new topic'}</h3>
        <p className="muted small">{weaker.length ? 'Read the feedback above, revisit your notes on the gaps, then teach it again with new questions.' : 'Explaining something new is the best way to keep the habit going.'}</p></div>
      {weaker.length ? <Button variant="secondary" onClick={practiseAgain}>Practice again<PracticeIcon name="arrow" size={16} /></Button> : <Link className="button button--secondary" to="/">New session<PracticeIcon name="arrow" size={16} /></Link>}
    </section>

    <div className="results-details">
      <details className="disclosure"><summary>{mock ? 'DEV MOCK test feedback · question by question' : 'Question-by-question feedback'}<span className="summary-meta">{session.attempts.reduce((total, attempt) => total + attempt.questions.length, 0)} questions</span><PracticeIcon name="chevron" size={14} /></summary>
        <div className="disclosure-body answer-review">{session.attempts.map((attempt, attemptIndex) => <section key={attempt.id}><h4 className="review-title">{attempt.kind === 'baseline' ? 'First check' : `Follow-up check${attemptIndex > 1 ? ` ${attemptIndex}` : ''}`}</h4>{attempt.questions.map((question) => {
          const answer = attempt.answers.find((item) => item.questionId === question.id); const grade = attempt.grade?.questionGrades.find((item) => item.questionId === question.id);
          return <article key={question.id}><div className="review-q"><strong>{question.prompt}</strong>{grade && <span className="pill mono">{grade.score}/{grade.maxScore}</span>}</div>
            <p>{answer?.skipped ? <em>Skipped</em> : answer?.text || <em>No answer saved</em>}{answer?.confidence ? <span className="muted"> · {CONFIDENCE_LABELS[answer.confidence]}</span> : answer?.uncertain ? <span className="muted"> · Marked unsure</span> : ''}</p>
            {answer?.working && <p className="muted small">Working: {answer.working}</p>}
            {grade && <p className="review-feedback">{grade.feedback}</p>}</article>;
        })}</section>)}</div></details>
      <details className="disclosure" open={pending}><summary>Conversations with Alex<span className="summary-meta">{conversations.length} {conversations.length === 1 ? 'conversation' : 'conversations'}</span><PracticeIcon name="chevron" size={14} /></summary>
        <div className="disclosure-body">{conversations.length ? <ConversationList session={session} /> : <p className="muted small">No conversation took place in this session.</p>}</div></details>
    </div>

    <section className="reflection card" aria-labelledby="reflection-heading">
      <div><span className="eyebrow">Optional self-report · not a diagnosis</span><h3 id="reflection-heading">How nervous do you feel now?</h3>
        <p className="muted small">Before: {session.nervousnessBefore === undefined ? 'not recorded' : `${session.nervousnessBefore}/5`}{session.nervousnessAfter !== undefined && <> · After: {session.nervousnessAfter}/5</>}</p></div>
      {session.nervousnessAfter === undefined && session.lifecycle === 'active' ? <div><div className="rating-scale">{([1, 2, 3, 4, 5] as const).map((value) => <button type="button" key={value} disabled={busy[sessionId]} aria-label={`Nervousness ${value} out of 5`} onClick={() => void setNervousness(sessionId, 'after', value).catch(() => undefined)}>{value}</button>)}</div><div className="rating-ends"><span>Not at all</span><span>Very</span></div></div>
        : session.nervousnessAfter === undefined && <p className="muted small">After: not recorded</p>}
    </section>

    <MonitorPrompt session={session} />

    {(errors[sessionId] || session.operationError) && <p className="notice notice--danger" role="alert"><PracticeIcon name="alert" size={16} />{errors[sessionId] || session.operationError}</p>}
    <div className="results-actions">
      <Link to="/" className="button button--quiet">Start a new session</Link>
      <Button disabled={busy[sessionId]} onClick={async () => { try { await finishSession(sessionId); await navigate('/'); } catch { /* state exposes operation error */ } }}>Finish session<PracticeIcon name="check" size={16} /></Button>
    </div>
  </div>;
}
