import { useEffect, useRef, useState } from 'react';
import { ConversationProvider, useConversation } from '@elevenlabs/react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import type { AssessmentAttempt, PracticeSession, TranscriptMessage } from '../../../shared/types';
import { PRACTICE_LIMITS } from '../../../shared/types';
import { useSessions } from '../../state/useSessions';
import { StudentAvatar } from './StudentAvatar';
import { TranscriptPanel } from './TranscriptPanel';
import { AssessmentView } from '../../components/practice/AssessmentView';
import { PracticeIcon } from '../../components/practice/PracticeIcon';
import { PracticeApiError } from '../../services/practiceApi';
import { ConversationList } from './ConversationStatus';
import './study.css';

export function StudyPage() {
  const { sessionId = '' } = useParams();
  return <StudyContent key={sessionId} sessionId={sessionId} />;
}

function AssessmentPanel({ session, attempt }: { session: PracticeSession; attempt: AssessmentAttempt }) {
  const { updateDraft, submitAssessment, busy, setNervousness, draftStatus, saveDraft, storageError } = useSessions();
  const [ratingSkipped, setRatingSkipped] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const index = attempt.currentQuestionIndex;
  const question = attempt.questions[index];
  const answer = attempt.answers[index];
  function move(skip = false) {
    const response = skip ? { ...answer, skipped: true } : answer;
    updateDraft(session.id, attempt.id, response, Math.min(index + 1, attempt.questions.length - 1));
    if (index === attempt.questions.length - 1) {
      setSubmitting(true);
      void submitAssessment(session.id, attempt.id).catch(() => undefined).finally(() => setSubmitting(false));
    }
  }
  if (submitting) return <section className="pv-card pv-evaluation" aria-live="polite"><h2>Checking your answers…</h2><p>Your responses are kept.</p></section>;
  return <>
    <div className="pv-assessment-layout"><div><AssessmentView question={question} answer={answer} index={index} count={attempt.questions.length}
      disabled={busy[session.id]} draftLabel={storageError ? 'Browser saving unavailable' : draftStatus[session.id] === 'local' ? 'Browser draft · sync pending' : draftStatus[session.id] === 'saving' ? 'Saving to server…' : draftStatus[session.id] === 'saved' ? 'Saved to server' : 'No unsaved changes'}
      onChange={(updated) => updateDraft(session.id, attempt.id, updated)} onBack={() => updateDraft(session.id, attempt.id, answer, index - 1)} onNext={move} />
      <p className="pv-assessment-foot"><PracticeIcon name="book" size={16} />No answers or corrections during the check.</p>
      {draftStatus[session.id] === 'local' && <Button variant="quiet" onClick={() => void saveDraft(session.id).catch(() => undefined)}>Retry saving answers</Button>}
    </div><aside className="pv-assessment-aside">
      {attempt.kind === 'baseline' && !ratingSkipped && <section className="pv-card pv-rating"><h3>How nervous do you feel?</h3><p>Optional self-report · not a diagnosis</p><div className="pv-rating-buttons">{([1, 2, 3, 4, 5] as const).map((value) => <button key={value} type="button" disabled={busy[session.id]} aria-label={`Before practice nervousness ${value} of 5`} aria-pressed={session.nervousnessBefore === value} onClick={() => void setNervousness(session.id, 'before', value).catch(() => undefined)}>{value}</button>)}</div><div className="pv-rating-labels"><span>Not at all</span><span>Very</span></div><button type="button" className="pv-text-button" disabled={busy[session.id]} onClick={() => { setRatingSkipped(true); if (session.nervousnessBefore !== undefined) void setNervousness(session.id, 'before', null).catch(() => undefined); }}>Skip this check-in</button></section>}
    </aside></div>
  </>;
}

function micError(error: unknown): string {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Microphone access is blocked. Allow the microphone for this site in your browser’s address-bar or site settings, then press Start talking again. You can also type to Alex instead.';
  if (name === 'NotFoundError') return 'No microphone was found. Connect one and press Start talking again, or type to Alex instead.';
  if (name === 'NotReadableError') return 'Your microphone is being used by another app. Close it and try again, or type to Alex instead.';
  return 'The microphone could not be started. Try again, or type to Alex instead.';
}

function TextConversation({ session }: { session: PracticeSession }) {
  const { startTextConversation, sendTextMessage, finalizeConversation, busy, integration } = useSessions();
  const [draft, setDraft] = useState('');
  const cycle = session.cycles.find((item) => item.id === session.currentCycleId) ?? session.cycles[0];
  const texts = cycle.conversations.filter((segment) => segment.channel === 'text');
  const open = texts.find((segment) => !segment.endedAt);
  const shown = open ?? texts.at(-1);
  const awaiting = open?.messages.at(-1)?.role === 'learner';
  const working = busy[session.id];
  const mock = session.providerMode === 'mock';
  const unavailable = !mock && integration && !integration.geminiConfigured;
  const learnerTurns = open?.messages.filter((message) => message.role === 'learner').length ?? 0;
  const log = useRef<HTMLOListElement>(null);
  const count = shown?.messages.length ?? 0;
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight }); }, [count, working]);
  async function send() {
    const text = draft.trim();
    if (!open || !text) return;
    try { await sendTextMessage(session.id, open.id, text); setDraft(''); }
    catch (error) {
      // A failed reply still saves the learner's message; only keep the draft if it was not stored.
      const saved = error instanceof PracticeApiError && error.session?.cycles.some((item) => item.conversations.some((segment) => segment.id === open.id && segment.messages.at(-1)?.role === 'learner' && segment.messages.at(-1)?.text === text));
      if (saved) setDraft('');
    }
  }
  if (unavailable) return <p className="muted">Typing to Alex needs the server’s Gemini key. Add it to the server configuration to use the text conversation.</p>;
  return <div className="text-conversation">
    {mock && <p className="pv-notice pv-notice--neutral" role="note">DEV MOCK: Alex’s text replies are scripted test messages, not AI. No provider request is made.</p>}
    {shown && <ol className="chat-log" ref={log} aria-live="polite" aria-label="Conversation with Alex">
      {shown.messages.map((message) => <li key={message.id} className={`chat-message chat-message--${message.role}`}><strong>{message.role === 'learner' ? 'You' : 'Alex'}</strong><p>{message.text}</p></li>)}
      {open && awaiting && working && <li className="chat-message chat-message--student" role="status"><strong>Alex</strong><p className="muted">Thinking…</p></li>}
    </ol>}
    {open ? <>
      {awaiting && !working && <div className="pv-action-row"><p className="muted">Alex hasn’t replied to your last message.</p><Button variant="secondary" onClick={() => void sendTextMessage(session.id, open.id).catch(() => undefined)}>Retry Alex’s reply</Button></div>}
      <label htmlFor="typed-explanation">Your explanation</label>
      <textarea id="typed-explanation" value={draft} rows={3} maxLength={PRACTICE_LIMITS.textMessage} disabled={working || awaiting}
        onChange={(event) => setDraft(event.target.value)} placeholder="Explain it in your own words…"
        onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} />
      <div className="pv-action-row">
        <Button disabled={working || awaiting || !draft.trim() || learnerTurns >= PRACTICE_LIMITS.textTurns} onClick={() => void send()}>Send to Alex</Button>
        <Button variant="quiet" disabled={working} onClick={() => void finalizeConversation(session.id, open.id).catch(() => undefined)}>End text conversation</Button>
      </div>
      <p className="pv-field-help">Enter sends · Shift+Enter adds a line · {learnerTurns}/{PRACTICE_LIMITS.textTurns} messages</p>
    </> : <div className="pv-action-row"><Button disabled={working || session.lifecycle !== 'active'} onClick={() => void startTextConversation(session.id).catch(() => undefined)}>{texts.length ? 'Start a new text conversation' : 'Start typing to Alex'}</Button></div>}
  </div>;
}

function TeachingPanel({ session }: { session: PracticeSession }) {
  const { requestVoice, registerConversation, finalizeConversation, startRecheck, saveAndExit, busy, errors, integration } = useSessions();
  const navigate = useNavigate();
  const mock = session.providerMode === 'mock';
  const voiceAvailable = !mock && integration?.voiceConfigured === true;
  const [mode, setMode] = useState<'voice' | 'text'>(() => voiceAvailable ? 'voice' : 'text');
  const [voiceError, setVoiceError] = useState('');
  const [starting, setStarting] = useState(false);
  const [liveId, setLiveId] = useState<string>();
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const registration = useRef<Promise<void>>(Promise.resolve());
  const voiceId = useRef('');
  const voice = useConversation({
    onConnect: ({ conversationId }) => {
      voiceId.current = conversationId; setLiveId(conversationId); setStarting(false); setVoiceError(''); setMessages([]);
      registration.current = registerConversation(session.id, conversationId).catch(() => undefined);
    },
    onDisconnect: () => {
      setStarting(false); setLiveId(undefined);
      const id = voiceId.current; voiceId.current = '';
      // The first check runs now; ConversationList keeps retrying while ElevenLabs processes the transcript.
      if (id) void registration.current.then(() => finalizeConversation(session.id, id)).catch(() => undefined);
    },
    onError: (message) => { setVoiceError(message || 'The voice connection failed. Try again, or type to Alex instead.'); setStarting(false); },
    onMessage: (message) => {
      if (!message.message.trim()) return;
      const id = `${message.role}:${message.response_id ?? message.event_id}`;
      const turn: TranscriptMessage = { id, sessionId: session.id, role: message.role === 'user' ? 'learner' : 'student', text: message.message, createdAt: new Date().toISOString(), source: 'voice' };
      setMessages((previous) => previous.some((item) => item.id === id) ? previous.map((item) => item.id === id ? turn : item) : [...previous, turn]);
    },
  });
  const { endSession, setMuted } = voice;
  useEffect(() => () => { endSession(); }, [endSession]);
  const connected = voice.status === 'connected';
  async function connect() {
    setVoiceError(''); setStarting(true);
    try {
      // Ask for the microphone before requesting a signed URL so a denial costs nothing and is recoverable.
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser can’t use a microphone on this page. Type to Alex instead.');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true }).catch((error: unknown) => { throw new Error(micError(error)); });
      stream.getTracks().forEach((track) => track.stop());
      const credentials = await requestVoice(session.id);
      voice.startSession({ signedUrl: credentials.signedUrl, connectionType: 'websocket', dynamicVariables: credentials.dynamicVariables });
    } catch (error) { setStarting(false); setVoiceError(error instanceof Error ? error.message : 'Voice could not connect. Please try again.'); }
  }
  function hangUp() { if (connected || voice.status === 'connecting') { setMuted(true); endSession(); } }
  async function next() {
    try { hangUp(); await startRecheck(session.id); }
    catch { /* The session store displays the error and preserves progress. */ }
  }
  async function exit() {
    try { hangUp(); await saveAndExit(session.id); void navigate('/'); }
    catch { /* The session store displays the error. */ }
  }
  const cycle = session.cycles.find((item) => item.id === session.currentCycleId) ?? session.cycles[0];
  const focus = cycle.focusConceptIds.length ? session.concepts.filter((concept) => cycle.focusConceptIds.includes(concept.id)) : session.concepts;
  const latest = messages.slice(-2);
  const hasConversation = cycle.conversations.some((segment) => segment.messages.some((message) => message.role === 'learner') || segment.channel !== 'text');
  return <>
    <section className="conversation-layout">
      <div className="conversation-person"><StudentAvatar /><h2>Teach it to Alex.</h2><p>Alex is a curious classmate. You do the explaining; Alex asks questions.</p>
        <div className="mode-switch" role="tablist" aria-label="How to talk with Alex">
          <button type="button" role="tab" aria-selected={mode === 'voice'} disabled={connected} onClick={() => setMode('voice')}>Talk with voice</button>
          <button type="button" role="tab" aria-selected={mode === 'text'} disabled={connected} onClick={() => setMode('text')}>Type instead</button>
        </div>
        {mode === 'voice' ? <>
          {!voiceAvailable ? <p className="muted" role="note">{mock ? 'DEV MOCK: voice is disabled. No ElevenLabs request is made. Use “Type instead”.' : integration ? 'Voice isn’t configured on this server yet. Type to Alex instead.' : 'Checking voice availability…'}</p> : <>
            <span className="connection-pill" role="status">{connected ? voice.isMuted ? 'Microphone muted' : voice.isSpeaking ? 'Alex is speaking' : 'Listening' : starting || voice.status === 'connecting' ? 'Connecting…' : 'Not connected'}</span>
            <div className="pv-action-row">
              {connected ? <><Button className="microphone-button" onClick={() => voice.setMuted(!voice.isMuted)}>{voice.isMuted ? 'Unmute microphone' : 'Mute microphone'}</Button><Button variant="secondary" onClick={() => endSession()}>End voice conversation</Button></>
                : <Button className="microphone-button" onClick={() => void connect()} disabled={starting || voice.status === 'connecting' || busy[session.id]}>Start talking</Button>}
            </div>
          </>}
          {voiceError && <p className="form-error" role="alert">{voiceError}</p>}
        </> : <TextConversation session={session} />}
      </div>
      <div className="conversation-context"><span className="eyebrow">Focus for this practice</span><div>{focus.map((concept) => <span className="focus-chip" key={concept.id} title={concept.description}>{concept.title}</span>)}</div>
        {mode === 'voice' && <div className="latest-exchange" aria-live="polite">{latest.length ? latest.map((message) => <p key={message.id}><strong>{message.role === 'learner' ? 'You' : 'Alex'}:</strong> {message.text}</p>) : <p>Start talking when you’re ready. Explain the ideas in your own words.</p>}</div>}
        {session.notes && <details className="notes-preview"><summary>Your notes</summary><p>{session.notes}</p></details>}
      </div>
    </section>
    {connected && <TranscriptPanel messages={messages} label="Live captions · the saved transcript comes from the voice service after you end" />}
    <ConversationList session={session} liveConversationId={liveId} />
    {errors[session.id] && <p role="alert" className="form-error">{errors[session.id]}</p>}
    <div className="session-controls"><Button variant="quiet" onClick={() => void exit()} disabled={busy[session.id]}>Save &amp; exit</Button>
      <Button onClick={() => void next()} disabled={busy[session.id] || session.lifecycle !== 'active'}>{mock && !hasConversation ? 'DEV MOCK: skip teaching (test only)' : 'I’m ready for the follow-up questions'}</Button></div>
  </>;
}

function Overview({ session, onBegin }: { session: PracticeSession; onBegin: () => void }) {
  return <section className="pv-card pv-overview" aria-labelledby="overview-heading">
    <span className="pv-eyebrow">{session.providerMode === 'mock' ? 'DEV MOCK fixture overview' : 'Overview'}</span>
    <h2 id="overview-heading">{session.title}</h2>
    {session.scope && <p>{session.scope}</p>}
    {session.materials?.length ? <p className="pv-field-help">From your files: {session.materials.map((material) => `${material.name}${material.pages ? ` (${material.pages} ${material.pages === 1 ? 'page' : 'pages'})` : ''}${material.truncated ? ' · long file, beginning used' : ''}`).join(' · ')}</p> : null}
    <h3>Three key concepts</h3>
    <ol className="pv-concept-list">{session.concepts.map((concept) => <li key={concept.id}><strong>{concept.title}</strong>{concept.description && <span> — {concept.description}</span>}</li>)}</ol>
    <p className="muted">First, a short check: three questions, no feedback until the end. Then you’ll teach the ideas to Alex, and answer three different questions on the same concepts.</p>
    <div className="pv-action-row"><Button onClick={onBegin}>Start the 3-question check</Button></div>
  </section>;
}

function StudyContent({ sessionId }: { sessionId: string }) {
  const { sessions, busy, errors, errorStatuses, storageError, loadSession, prepareSession, submitAssessment, saveAndExit, resumeSession } = useSessions();
  const session = sessions[sessionId]; const navigate = useNavigate(); const started = useRef(false);
  const [clarification, setClarification] = useState('');
  const [overviewDone, setOverviewDone] = useState(false);
  useEffect(() => {
    if (!session && !started.current) { started.current = true; void loadSession(sessionId).catch(() => undefined); }
  }, [loadSession, session, sessionId]);
  if (!session) return <div className="page-narrow"><EmptyState title={busy[sessionId] ? 'Opening your session…' : 'Session unavailable'} description={errors[sessionId] ?? 'Open a session from Home, or start a new practice.'} /></div>;
  if (errorStatuses[sessionId] === 404 || errorStatuses[sessionId] === 401) return <section className="pv-card pv-evaluation"><h1 tabIndex={-1}>Session unavailable on the server.</h1><p>{errors[sessionId]}</p><p>Your browser drafts are kept below. Restarting the in-memory API clears server sessions; start a new practice if this session cannot be reopened.</p><div className="pv-action-row"><Button disabled={busy[sessionId]} onClick={() => void loadSession(sessionId).catch(() => undefined)}>Retry loading session</Button><Link className="button button--secondary" to="/">Start a new practice</Link></div><details className="pv-review"><summary>Review browser drafts</summary><div className="pv-review-content">{session.attempts.map((attempt) => <section key={attempt.id}>{attempt.questions.map((question, index) => <article key={question.id}><h3>{question.prompt}</h3><p>{attempt.answers[index]?.text || 'No typed answer'}</p><p>{attempt.answers[index]?.working}</p><p>{attempt.answers[index]?.skipped ? 'Skipped' : ''}{attempt.answers[index]?.uncertain ? ' · Marked unsure' : ''}</p></article>)}</section>)}</div></details></section>;
  if (session.stage === 'results') return <Navigate to={`/results/${session.id}`} replace />;
  const exit = async () => { try { await saveAndExit(sessionId); void navigate('/'); } catch { /* Error shown below. */ } };
  const error = errors[sessionId] || session.operationError || (session.stage === 'preparing' ? session.preparation.message : undefined);
  const attempt = session.attempts.find((item) => item.kind === (session.stage.startsWith('baseline') ? 'baseline' : 'recheck'));
  const baselineGrade = session.attempts.find((item) => item.kind === 'baseline')?.grade;
  const preparing = session.stage === 'preparing';
  const fresh = session.stage === 'baseline' && attempt && attempt.currentQuestionIndex === 0 && attempt.answers.every((answer) => !answer.text && !answer.working && !answer.skipped);
  return <div className="study-page">
    <header className="pv-study-heading"><div><span className="pv-eyebrow">{preparing ? 'PREPARATION' : session.stage.startsWith('baseline') ? 'BASELINE ASSESSMENT' : session.stage === 'teaching' ? 'EXPLAIN IT' : 'MATCHED FOLLOW-UP'}</span><h1 tabIndex={-1}>{preparing ? 'Preparing your practice.' : session.stage === 'baseline' ? 'Let’s see what you remember.' : session.title}</h1><p>{session.stage === 'baseline' ? session.title : session.description}</p></div>{session.stage !== 'teaching' && <Button variant="secondary" onClick={() => void exit()} disabled={busy[sessionId]}>Save &amp; exit</Button>}</header>
    {session.lifecycle === 'paused' ? <section className="pv-card pv-evaluation"><h2>Your practice is paused.</h2><Button disabled={busy[sessionId]} onClick={() => void resumeSession(sessionId).catch(() => undefined)}>Continue practicing</Button></section> :
      preparing ? <section className="pv-card pv-evaluation">
        {busy[sessionId] ? <p role="status">{session.materials?.length ? `Reading ${session.materials.length === 1 ? 'your file' : 'your files'} and preparing three questions…` : 'Preparing your three questions…'}</p> : <>
          {session.preparation.clarificationQuestion && <><h2>{session.preparation.clarificationQuestion}</h2><label htmlFor="clarification">Your focus</label><textarea id="clarification" value={clarification} maxLength={PRACTICE_LIMITS.description} onChange={(event) => setClarification(event.target.value)} rows={3} /></>}
          <div className="pv-action-row"><Button disabled={session.preparation.status === 'clarification' && !clarification.trim()} onClick={() => void prepareSession(sessionId, clarification || undefined).catch(() => undefined)}>{session.preparation.status === 'clarification' ? 'Continue' : 'Try preparing again'}</Button>
            <Button variant="secondary" onClick={() => void loadSession(sessionId).catch(() => undefined)}>Refresh session status</Button></div>
        </>}
      </section> : fresh && !overviewDone ? <Overview session={session} onBegin={() => setOverviewDone(true)} /> :
      session.stage === 'baseline' || session.stage === 'recheck' ? attempt && <AssessmentPanel session={session} attempt={attempt} /> :
      session.stage === 'baseline_evaluating' || session.stage === 'recheck_evaluating' ? <section className="pv-card pv-evaluation" aria-live="polite"><h2>{busy[sessionId] ? 'Checking your answers…' : error ? 'We couldn’t check your answers yet.' : 'Grading request interrupted or still processing.'}</h2><p>Your responses are kept.</p>
        <div className="pv-action-row">{!busy[sessionId] && attempt && <><Button onClick={() => void submitAssessment(sessionId, attempt.id).catch(() => undefined)}>Retry grading</Button><Button variant="secondary" onClick={() => void loadSession(sessionId).catch(() => undefined)}>Refresh session status</Button></>}</div></section> :
      <>{baselineGrade && <div className="pv-notice" role="status">{session.providerMode === 'mock' ? 'DEV MOCK test grade' : 'Baseline grade'}: {baselineGrade.totalScore}/{baselineGrade.maxScore}. {baselineGrade.summary}</div>}
        <ConversationProvider><TeachingPanel session={session} /></ConversationProvider></>}
    {error && session.stage !== 'teaching' && <p className="pv-error" role="alert">{error}</p>}
    {session.stage === 'recheck' && <ConversationList session={session} showMessages={false} />}
    {storageError && <p className="pv-error" role="alert">{storageError}</p>}
  </div>;
}
