import { useEffect, useRef, useState } from 'react';
import { ConversationProvider, useConversation } from '@elevenlabs/react';
import { Navigate, useNavigate, useParams } from 'react-router';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import type { AssessmentAttempt, PracticeSession, TranscriptMessage } from '../../../shared/types';
import { PRACTICE_LIMITS } from '../../../shared/types';
import { useSessions } from '../../state/useSessions';
import { StudentAvatar } from './StudentAvatar';
import { TranscriptPanel } from './TranscriptPanel';
import './study.css';

export function StudyPage() {
  const { sessionId = '' } = useParams();
  return <StudyContent key={sessionId} sessionId={sessionId} />;
}

function AssessmentPanel({ session, attempt }: { session: PracticeSession; attempt: AssessmentAttempt }) {
  const { updateDraft, submitAssessment, busy, setNervousness } = useSessions();
  const [ratingSkipped, setRatingSkipped] = useState(false);
  const index = attempt.currentQuestionIndex;
  const question = attempt.questions[index];
  const answer = attempt.answers[index];
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { field.current?.focus(); }, [question.id]);
  function move(skip = false) {
    const response = skip ? { ...answer, text: '', working: '', skipped: true } : answer;
    updateDraft(session.id, attempt.id, response, Math.min(index + 1, 2));
    if (index === 2) void submitAssessment(session.id, attempt.id).catch(() => undefined);
  }
  return <>
    {attempt.kind === 'baseline' && index === 0 && !ratingSkipped && session.nervousnessBefore === undefined &&
      <div className="nervousness-prompt"><span>Optional: how nervous do you feel? <small>1 = not at all · 5 = very</small></span>
        <div>{([1, 2, 3, 4, 5] as const).map((value) => <button key={value} type="button" aria-label={`Nervousness ${value} of 5`} onClick={() => void setNervousness(session.id, 'before', value).catch(() => undefined)}>{value}</button>)}
          <button type="button" className="skip-rating" onClick={() => setRatingSkipped(true)}>Skip</button></div></div>}
    <section className="assessment-card" aria-labelledby="assessment-question">
      <div className="assessment-progress"><span className="eyebrow">{attempt.kind === 'baseline' ? 'See what you remember' : 'Ready to try again?'}</span><span>{index + 1} of 3</span></div>
      <h2 id="assessment-question">{question.prompt}</h2>
      <label htmlFor="assessment-answer">Your answer</label>
      <textarea ref={field} id="assessment-answer" rows={4} maxLength={PRACTICE_LIMITS.answer} value={answer.text} placeholder="Write what you remember…"
        onChange={(event) => updateDraft(session.id, attempt.id, { ...answer, text: event.target.value, skipped: false })} />
      {question.supportsWorking && <><label htmlFor="assessment-working">Working <span className="muted">(optional)</span></label>
        <textarea id="assessment-working" rows={2} maxLength={PRACTICE_LIMITS.working} value={answer.working}
          onChange={(event) => updateDraft(session.id, attempt.id, { ...answer, working: event.target.value, skipped: false })} /></>}
      <label className="uncertainty-check"><input type="checkbox" checked={answer.uncertain} onChange={(event) => updateDraft(session.id, attempt.id, { ...answer, uncertain: event.target.checked })} />I’m not sure yet</label>
      <div className="assessment-actions"><button type="button" className="text-link" onClick={() => move(true)} disabled={busy[session.id]}>Skip</button>
        <Button onClick={() => move()} disabled={busy[session.id] || (!answer.skipped && !answer.text.trim() && !answer.working.trim())}>{index === 2 ? 'Check my answers' : 'Next'}</Button></div>
    </section>
  </>;
}

function TeachingPanel({ session }: { session: PracticeSession }) {
  const { requestVoice, registerConversation, finalizeConversation, startRecheck, saveAndExit, busy, errors } = useSessions();
  const navigate = useNavigate();
  const [voiceError, setVoiceError] = useState('');
  const [starting, setStarting] = useState(false);
  const [typed, setTyped] = useState('');
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const registration = useRef<Promise<void>>(Promise.resolve());
  const voiceId = useRef('');
  const voice = useConversation({
    onConnect: ({ conversationId }) => {
      voiceId.current = conversationId; setStarting(false); setVoiceError('');
      registration.current = registerConversation(session.id, conversationId).catch(() => undefined);
    },
    onDisconnect: () => {
      setStarting(false);
      const id = voiceId.current;
      if (id) void registration.current.then(() => finalizeConversation(session.id, id)).catch(() => undefined);
    },
    onError: (message) => { setVoiceError(message); setStarting(false); },
    onMessage: (message) => {
      if (!message.message.trim()) return;
      const id = `${message.role}:${message.response_id ?? message.event_id}`;
      const turn: TranscriptMessage = { id, sessionId: session.id, role: message.role === 'user' ? 'learner' : 'student', text: message.message, createdAt: new Date().toISOString(), source: 'voice' };
      setMessages((previous) => previous.some((item) => item.id === id) ? previous.map((item) => item.id === id ? turn : item) : [...previous, turn]);
    },
  });
  const { endSession, setMuted } = voice;
  useEffect(() => () => { endSession(); }, [endSession]);
  async function connect() {
    setVoiceError(''); setStarting(true);
    try {
      const credentials = await requestVoice(session.id);
      voice.startSession({ signedUrl: credentials.signedUrl, connectionType: 'websocket', dynamicVariables: credentials.dynamicVariables });
    } catch (error) { setStarting(false); setVoiceError(error instanceof Error ? error.message : 'Voice could not connect. Please try again.'); }
  }
  async function next() {
    try { setMuted(true); endSession(); await startRecheck(session.id); }
    catch { /* The session store displays the error and preserves progress. */ }
  }
  async function exit() {
    try { setMuted(true); endSession(); await saveAndExit(session.id); void navigate('/'); }
    catch { /* The session store displays the error. */ }
  }
  const cycle = session.cycles[0];
  const focus = cycle.focusConceptIds.length ? session.concepts.filter((concept) => cycle.focusConceptIds.includes(concept.id)) : session.concepts;
  const latest = messages.slice(-2);
  const connected = voice.status === 'connected';
  return <>
    <section className="conversation-layout">
      <div className="conversation-person"><StudentAvatar /><h2>Let’s talk it through.</h2><p>Explain your thinking to a curious classmate.</p>
        <span className="connection-pill" role="status">{connected ? voice.isMuted ? 'Microphone muted' : voice.isSpeaking ? 'Alex is speaking' : 'Listening' : starting || voice.status === 'connecting' ? 'Connecting…' : 'Disconnected'}</span>
        <div><Button className="microphone-button" onClick={() => connected ? voice.setMuted(!voice.isMuted) : void connect()} disabled={starting || voice.status === 'connecting'}>
          {connected ? voice.isMuted ? 'Unmute microphone' : 'Mute microphone' : 'Start talking'}</Button></div>
        {voiceError && <p className="form-error" role="alert">{voiceError}</p>}
        <details className="text-fallback"><summary>Use text instead</summary><div className="typed-response">
          <label htmlFor="typed-explanation">Your explanation</label><textarea id="typed-explanation" value={typed} onChange={(event) => setTyped(event.target.value)} rows={3} maxLength={PRACTICE_LIMITS.answer} />
          <Button variant="secondary" disabled={!connected || !typed.trim()} onClick={() => { voice.sendUserMessage(typed.trim()); setTyped(''); }}>Send to Alex</Button>
          {!connected && <p className="muted">Connect the conversation first to send a response.</p>}
        </div></details>
      </div>
      <div className="conversation-context"><span className="eyebrow">Focus for this practice</span><div>{focus.map((concept) => <span className="focus-chip" key={concept.id}>{concept.title}</span>)}</div>
        <div className="latest-exchange" aria-live="polite">{latest.length ? latest.map((message) => <p key={message.id}><strong>{message.role === 'learner' ? 'You' : 'Alex'}:</strong> {message.text}</p>) : <p>Start talking when you’re ready. Explain the ideas in your own words.</p>}</div>
        {session.notes && <details className="notes-preview"><summary>Your notes</summary><p>{session.notes}</p></details>}
      </div>
    </section>
    <TranscriptPanel messages={messages.length ? messages : cycle.conversations.flatMap((segment) => segment.messages)} />
    {errors[session.id] && <p role="alert" className="form-error">{errors[session.id]}</p>}
    <div className="session-controls"><Button variant="quiet" onClick={() => void exit()} disabled={busy[session.id]}>Save &amp; exit</Button>
      <Button onClick={() => void next()} disabled={busy[session.id]}>I’m ready to try again</Button></div>
  </>;
}

function StudyContent({ sessionId }: { sessionId: string }) {
  const { sessions, busy, errors, loadSession, prepareSession, submitAssessment, saveAndExit, resumeSession } = useSessions();
  const session = sessions[sessionId]; const navigate = useNavigate(); const started = useRef(false);
  const [clarification, setClarification] = useState('');
  useEffect(() => {
    if (!session && !started.current) { started.current = true; void loadSession(sessionId).catch(() => undefined); }
  }, [loadSession, session, sessionId]);
  if (!session) return <div className="page-narrow"><EmptyState title={busy[sessionId] ? 'Opening your session…' : 'Session unavailable'} description={errors[sessionId] ?? 'Open a session from Home, or start a new practice.'} /></div>;
  if (session.stage === 'results') return <Navigate to={`/results/${session.id}`} replace />;
  const exit = async () => { try { await saveAndExit(sessionId); void navigate('/'); } catch { /* Error shown below. */ } };
  const error = errors[sessionId] || session.operationError || (session.stage === 'preparing' ? session.preparation.message : undefined);
  const attempt = session.attempts.find((item) => item.kind === (session.stage.startsWith('baseline') ? 'baseline' : 'recheck'));
  return <div className="study-page page-narrow">
    <header className="study-heading"><h1 tabIndex={-1}>{session.title}</h1>{session.stage !== 'teaching' && <Button variant="quiet" onClick={() => void exit()} disabled={busy[sessionId]}>Save &amp; exit</Button>}</header>
    {session.lifecycle === 'paused' ? <section className="preparation-panel"><h2>Your practice is paused.</h2><Button onClick={() => void resumeSession(sessionId).catch(() => undefined)}>Continue practicing</Button></section> :
      session.stage === 'preparing' ? <section className="preparation-panel">
        {busy[sessionId] ? <p role="status">Preparing your three questions…</p> : <>
          {session.preparation.clarificationQuestion && <><h2>{session.preparation.clarificationQuestion}</h2><label htmlFor="clarification">Your focus</label><textarea id="clarification" value={clarification} maxLength={PRACTICE_LIMITS.description} onChange={(event) => setClarification(event.target.value)} rows={3} /></>}
          <Button onClick={() => void prepareSession(sessionId, clarification || undefined).catch(() => undefined)}>{session.preparation.status === 'clarification' ? 'Continue' : 'Try preparing again'}</Button>
        </>}
      </section> : session.stage === 'baseline' || session.stage === 'recheck' ? attempt && <AssessmentPanel session={session} attempt={attempt} /> :
      session.stage === 'baseline_evaluating' || session.stage === 'recheck_evaluating' ? <section className="loading-card"><h2>{error ? 'We couldn’t check your answers yet.' : 'Checking your answers…'}</h2><p>Your responses are kept.</p>
        {error && attempt && <Button disabled={busy[sessionId]} onClick={() => void submitAssessment(sessionId, attempt.id).catch(() => undefined)}>Retry grading</Button>}</section> :
      <ConversationProvider><TeachingPanel session={session} /></ConversationProvider>}
    {error && session.stage !== 'teaching' && <p className="form-error" role="alert">{error}</p>}
  </div>;
}
