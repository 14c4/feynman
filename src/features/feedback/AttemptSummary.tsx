import type { StudySession } from '../../../shared/types';

export function AttemptSummary({ current, previous }: { current: StudySession; previous: StudySession[] }) {
  return (
    <section className="attempt-summary" aria-labelledby="attempts-heading">
      <div><span className="eyebrow">Keep building understanding</span><h2 id="attempts-heading">One explanation at a time.</h2></div>
      {previous.length ? <>
        <p className="muted">{previous.length} earlier {previous.length === 1 ? 'attempt' : 'attempts'} for this topic in this visit. Feedback comparisons will appear after Gemini integration.</p>
        <ul>{[...previous, current].sort((a, b) => a.attemptNumber - b.attemptNumber).map((session) => <li key={session.id}>
          <span>Attempt {session.attemptNumber}{session.id === current.id ? ' · this session' : ''}</span>
          <span className="muted">{session.transcript.filter((message) => message.role === 'learner').length} saved explanations</span>
        </li>)}</ul>
      </> : <p className="muted">Your first completed attempt for this topic. Retry to practice a clearer explanation; future AI feedback will help you compare attempts.</p>}
    </section>
  );
}
