import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useBeforeUnload, useBlocker, useNavigate, useParams } from 'react-router';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { useSessions } from '../../state/useSessions';
import { getTopic } from '../topics/topics';
import { ExplanationInput } from './ExplanationInput';
import { MicrophoneControl } from './MicrophoneControl';
import { PreparationPanel } from './PreparationPanel';
import { SessionControls } from './SessionControls';
import { StudentAvatar } from './StudentAvatar';
import { TranscriptPanel } from './TranscriptPanel';
import './study.css';

export function StudyPage() {
  const { sessionId = '' } = useParams();
  // Keyed content prevents drafts carrying into a different session URL.
  return <StudyContent key={sessionId} sessionId={sessionId} />;
}

function StudyContent({ sessionId }: { sessionId: string }) {
  const { sessions, startSession, saveExplanation, finishSession } = useSessions();
  const session = sessions[sessionId];
  const topic = session ? getTopic(session.topicId) : undefined;
  const [draft, setDraft] = useState('');
  const [finishPrompt, setFinishPrompt] = useState(false);
  const allowNavigation = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const navigate = useNavigate();
  const dirty = session?.status === 'active' && !!draft.trim();
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && !allowNavigation.current && currentLocation.pathname !== nextLocation.pathname);
  const showDialog = blocker.state === 'blocked' || finishPrompt;

  useBeforeUnload(useCallback((event) => {
    if (dirty) { event.preventDefault(); event.returnValue = ''; }
  }, [dirty]));

  useEffect(() => {
    if (showDialog && !dialog.current?.open) dialog.current?.showModal();
    if (!showDialog && dialog.current?.open) dialog.current?.close();
  }, [showDialog]);

  if (!session || !topic) return <EmptyState title="Let’s choose a topic first." description="This session is unavailable. Sessions live in memory, so refreshing starts fresh." />;
  if (session.status === 'completed') return <Navigate to={`/results/${session.id}`} replace />;
  if (session.status === 'abandoned') return <EmptyState title="This session has ended." description="Choose a topic to begin a new attempt. Your earlier saved text stays in memory until refresh." />;

  const latestLearner = session.transcript.filter((message) => message.role === 'learner').at(-1);
  const latestStudent = session.transcript.filter((message) => message.role === 'student').at(-1);

  function saveDraft() {
    if (draft.trim()) saveExplanation(sessionId, draft);
    setDraft('');
  }

  function finish() {
    finishSession(sessionId);
    void navigate(`/results/${sessionId}`);
  }

  function resolveDraft(save: boolean) {
    if (save) saveDraft();
    else setDraft('');
    // Suppress the blocker for the intentional finish navigation in this render.
    allowNavigation.current = true;
    setFinishPrompt(false);
    if (blocker.state === 'blocked') blocker.proceed();
    else finish();
  }

  function stay() {
    setFinishPrompt(false);
    if (blocker.state === 'blocked') blocker.reset();
  }

  return (
    <div className="study-page page-narrow">
      <div className="study-heading"><div><span className="eyebrow">{session.status === 'preparing' ? 'Before you begin' : 'Your teaching space'}</span><h1 tabIndex={-1}>{topic.title}</h1></div><span className="pill">Attempt {session.attemptNumber}</span></div>
      {session.status === 'preparing' ? <PreparationPanel topic={topic} onStart={() => startSession(sessionId)} onBack={() => void navigate('/')} /> : <>
        <section className="student-stage" aria-label="Virtual student">
          <StudentAvatar />
          <h2>Meet Alex, your curious student.</h2>
          <MicrophoneControl />
          <div className="latest-exchange" aria-live="polite">
            <span className="eyebrow">{latestLearner ? 'Your latest explanation' : 'A question to get you started'}</span>
            <p>{latestLearner?.text ?? topic.openingPrompt}</p>
            {latestStudent ? <div className="student-placeholder"><strong>Alex</strong><p>{latestStudent.text}</p></div> : <p className="student-placeholder">AI replies will appear here after integration.</p>}
          </div>
        </section>
        <TranscriptPanel messages={session.transcript} />
        <SessionControls canFinish={!!latestLearner} onBack={() => void navigate('/')} onFinish={() => { if (draft.trim()) setFinishPrompt(true); else finish(); }} />
        <details className="text-fallback">
          <summary>Use text instead <span className="text-fallback-hint">{draft.trim() ? 'Unsaved text' : 'Development fallback'}</span></summary>
          <ExplanationInput draft={draft} onChange={setDraft} onSave={saveDraft} />
        </details>
      </>}
      <dialog ref={dialog} className="draft-dialog" aria-labelledby="draft-title" aria-describedby="draft-description" onCancel={(event) => { event.preventDefault(); stay(); }}>
        <span className="eyebrow">Before you go</span><h2 id="draft-title">Keep your explanation?</h2>
        <p id="draft-description" className="muted">You have text that hasn’t been saved to the transcript.</p>
        <div className="dialog-actions"><Button onClick={() => resolveDraft(true)}>Save and continue</Button><Button variant="secondary" onClick={() => resolveDraft(false)}>Discard and continue</Button><Button variant="quiet" onClick={stay}>Keep editing</Button></div>
      </dialog>
    </div>
  );
}
