import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { useSessions } from '../../state/useSessions';
import { getTopic } from '../topics/topics';
import { TranscriptPanel } from '../study/TranscriptPanel';
import { AttemptSummary } from './AttemptSummary';
import { ConceptFeedbackList } from './ConceptFeedbackList';
import { sampleFeedback, sampleTranscript } from './sampleFeedback';
import '../study/study.css';
import './feedback.css';

export function ResultsPage() {
  const { sessionId = '' } = useParams();
  const { sessions, createSession } = useSessions();
  const navigate = useNavigate();
  const session = sessions[sessionId];
  const topic = session ? getTopic(session.topicId) : undefined;

  if (!session || !topic) return <EmptyState title="No reflection here yet." description="Complete a study session to see your saved explanation. Refreshing clears this visit’s sessions." />;
  if (session.status === 'abandoned') return <EmptyState title="This session wasn’t completed." description="Choose a topic and save an explanation to complete a new attempt." />;
  if (session.status !== 'completed') return <Navigate to={`/study/${sessionId}`} replace />;

  const previous = Object.values(sessions).filter((item) => item.topicId === topic.id && item.status === 'completed' && item.attemptNumber < session.attemptNumber);
  const exampleTopic = getTopic('recursion')!;
  const learnerMessages = session.transcript.filter((message) => message.role === 'learner');

  return (
    <div className="results-page page-narrow">
      <header className="results-heading"><span className="eyebrow">Pause. Reflect. Explain again.</span><h1 tabIndex={-1}>A little clearer, each time.</h1><p className="muted">{topic.title} <span aria-hidden="true">·</span> Attempt {session.attemptNumber} <span aria-hidden="true">·</span> Session complete</p></header>

      <section className="session-recap" aria-labelledby="recap-heading">
        <div className="section-heading"><h2 id="recap-heading">Your explanation</h2><span className="pill">{learnerMessages.length} saved {learnerMessages.length === 1 ? 'entry' : 'entries'}</span></div>
        <p className="recap-explanation">{learnerMessages.at(-1)?.text}</p>
        <TranscriptPanel messages={session.transcript} label="Your session transcript" />
        <div className="integration-note"><span className="status-dot" aria-hidden="true" /><p><strong>Your session is complete.</strong> AI evaluation is awaiting integration. Your explanation has not been scored or assessed.</p></div>
      </section>

      <div className="results-actions"><Button onClick={() => {
        const id = createSession(topic.id, session.id);
        void navigate(`/study/${id}`);
      }}>Retry {topic.title} <span aria-hidden="true">↻</span></Button><Link to="/" className="text-link">Choose another topic <span aria-hidden="true">→</span></Link></div>

      <section className="feedback-example" aria-labelledby="example-heading">
        <div className="example-banner"><span className="pill pill--warm">Illustrative example</span><p>Not an evaluation of your explanation.</p></div>
        <header><span className="eyebrow">What future feedback could look like</span><h2 id="example-heading">Sample reflection: Recursion</h2><p className="muted">{sampleFeedback.summary}</p></header>
        <div className="feedback-section"><h3><span className="feedback-marker feedback-marker--covered" aria-hidden="true">✓</span> Explained clearly</h3><ConceptFeedbackList coverage={sampleFeedback.conceptCoverage.filter((item) => item.status === 'covered')} topic={exampleTopic} transcript={sampleTranscript} /></div>
        <div className="feedback-section"><h3><span className="feedback-marker" aria-hidden="true">↗</span> Room to clarify</h3><ConceptFeedbackList coverage={sampleFeedback.conceptCoverage.filter((item) => item.status !== 'covered')} topic={exampleTopic} transcript={sampleTranscript} /></div>
        <section className="retry-suggestion"><span className="eyebrow">A more useful next attempt</span><h3>Make the stopping point explicit.</h3><ul>{sampleFeedback.recommendations.map((item) => <li key={item}>{item}</li>)}</ul><p>{sampleFeedback.suggestedRetry}</p></section>
        <TranscriptPanel messages={sampleTranscript} label="Example transcript · separate sample data" />
      </section>

      <AttemptSummary current={session} previous={previous} />
    </div>
  );
}
