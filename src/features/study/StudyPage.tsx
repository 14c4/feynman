import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ConversationProvider, useConversation } from '@elevenlabs/react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import type { AssessmentAttempt, PracticeSession, TranscriptMessage } from '../../../shared/types';
import { PRACTICE_LIMITS } from '../../../shared/types';
import { useSessions } from '../../state/useSessions';
import { PracticeIcon, type PracticeIconName } from '../../components/practice/PracticeIcon';
import { PracticeApiError } from '../../services/practiceApi';
import { ConversationList } from './ConversationStatus';
import { AlexAvatar } from './AlexAvatar';
import { ALEX_LABELS, type AlexState } from './alexState';
import { QuestionCard, type SaveState } from './QuestionCard';
import { MonitorPrompt } from '../insights/MonitorDock';
import './study.css';

export function StudyPage() {
  const { sessionId = '' } = useParams();
  return <StudyContent key={sessionId} sessionId={sessionId} />;
}

/** Calm full-card status for generation, grading and recovery moments. */
function StatusCard({ title, children, busy = false, tone = 'neutral', icon = 'info', level = 2 }: { title: string; children?: ReactNode; busy?: boolean; tone?: 'neutral' | 'error'; icon?: PracticeIconName; level?: 1 | 2 }) {
  const Heading = level === 1 ? 'h1' : 'h2';
  return <section className={`status-card card enter ${tone === 'error' ? 'status-card--error' : ''}`} aria-live="polite" aria-busy={busy || undefined}>
    {busy ? <AlexAvatar state="thinking" size="sm" /> : <span className="status-card-icon"><PracticeIcon name={tone === 'error' ? 'alert' : icon} /></span>}
    <Heading tabIndex={level === 1 ? -1 : undefined}>{title}</Heading>
    {busy && <div className="status-card-lines" aria-hidden="true"><span className="skeleton" /><span className="skeleton" /><span className="skeleton" /></div>}
    {children}
  </section>;
}

function AssessmentPanel({ session, attempt }: { session: PracticeSession; attempt: AssessmentAttempt }) {
  const { updateDraft, submitAssessment, busy, setNervousness, draftStatus, saveDraft, storageError, startAttempt } = useSessions();
  const [ratingSkipped, setRatingSkipped] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const index = attempt.currentQuestionIndex;
  const question = attempt.questions[index];
  const answer = attempt.answers[index];
  const recheck = attempt.kind === 'recheck';
  // The first question is on screen: record when this assessment genuinely began.
  const attemptStarted = Boolean(attempt.startedAt);
  useEffect(() => { if (!attemptStarted && session.lifecycle === 'active') void startAttempt(session.id, attempt.id).catch(() => undefined); }, [attempt.id, attemptStarted, session.id, session.lifecycle, startAttempt]);
  function move(skip = false) {
    // answeredAt marks the moment the learner moved on; the server turns each new value into a timeline event.
    const response = { ...(skip ? { ...answer, skipped: true } : answer), answeredAt: new Date().toISOString() };
    updateDraft(session.id, attempt.id, response, Math.min(index + 1, attempt.questions.length - 1));
    if (index === attempt.questions.length - 1) {
      setSubmitting(true);
      void submitAssessment(session.id, attempt.id).catch(() => undefined).finally(() => setSubmitting(false));
    }
  }
  if (submitting) return <StatusCard title="Checking your answers…" busy><p className="muted">Your responses are saved. This usually takes a few seconds.</p></StatusCard>;
  const status = draftStatus[session.id];
  const saveState: SaveState = storageError ? 'unavailable' : status === 'local' ? 'local' : status === 'saving' ? 'saving' : status === 'saved' ? 'saved' : 'clean';
  const showRating = attempt.kind === 'baseline' && !ratingSkipped;
  return <div className={`assess ${showRating ? '' : 'assess--single'}`}>
    <div className="assess-main">
      {recheck && <div className="notice notice--accent enter"><PracticeIcon name="refresh" size={16} /><p><strong>Follow-up questions.</strong> These are new questions on the same concepts you just taught. Answer from your own understanding.</p></div>}
      <QuestionCard question={question} answer={answer} index={index} count={attempt.questions.length} saveState={saveState} disabled={busy[session.id]}
        conceptTitle={session.concepts.find((concept) => concept.id === question.conceptId)?.title}
        submitLabel={recheck ? 'Submit follow-up' : 'Check my answers'}
        onChange={(updated) => updateDraft(session.id, attempt.id, updated)} onBack={() => updateDraft(session.id, attempt.id, answer, index - 1)} onNext={move} />
      <div className="assess-foot">
        <p><PracticeIcon name="info" size={14} />No hints or corrections during the check. Feedback comes at the end.</p>
        <span className="assess-kbd">Ctrl + Enter to continue</span>
      </div>
      {status === 'local' && <Button variant="secondary" size="sm" onClick={() => void saveDraft(session.id).catch(() => undefined)}><PracticeIcon name="refresh" size={14} />Retry saving answers</Button>}
    </div>
    {showRating && <aside className="assess-aside">
      <section className="rating card" aria-labelledby="rating-heading">
        <h3 id="rating-heading">How nervous do you feel right now?</h3>
        <p className="muted small">Optional self-report. It’s just for your own reflection, not a diagnosis.</p>
        <div className="rating-scale" role="group" aria-labelledby="rating-heading">{([1, 2, 3, 4, 5] as const).map((value) => <button key={value} type="button" disabled={busy[session.id]} aria-label={`Before practice nervousness ${value} of 5`} aria-pressed={session.nervousnessBefore === value} onClick={() => void setNervousness(session.id, 'before', value).catch(() => undefined)}>{value}</button>)}</div>
        <div className="rating-ends"><span>Not at all</span><span>Very</span></div>
        <button type="button" className="text-button" disabled={busy[session.id]} onClick={() => { setRatingSkipped(true); if (session.nervousnessBefore !== undefined) void setNervousness(session.id, 'before', null).catch(() => undefined); }}>Skip this check-in</button>
      </section>
    </aside>}
  </div>;
}

function micError(error: unknown): string {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Microphone access is blocked. Allow the microphone for this site in your browser’s address-bar or site settings, then press Start talking again. You can also type to Alex instead.';
  if (name === 'NotFoundError') return 'No microphone was found. Connect one and press Start talking again, or type to Alex instead.';
  if (name === 'NotReadableError') return 'Your microphone is being used by another app. Close it and try again, or type to Alex instead.';
  return 'The microphone could not be started. Try again, or type to Alex instead.';
}

function AlexStage({ state, detail, getLevel }: { state: AlexState; detail?: string; getLevel?: () => number }) {
  return <div className="alex-stage">
    <AlexAvatar state={state} size="lg" getLevel={getLevel} />
    <p className="alex-state" role="status"><span className={`alex-state-dot alex-state-dot--${state}`} aria-hidden="true" />{ALEX_LABELS[state]}</p>
    {detail && <p className="alex-detail">{detail}</p>}
  </div>;
}

function MessageList({ messages, label, thinking = false, empty }: { messages: TranscriptMessage[]; label: string; thinking?: boolean; empty?: ReactNode }) {
  const log = useRef<HTMLOListElement>(null);
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight, behavior: 'smooth' }); }, [messages.length, thinking]);
  if (!messages.length && !thinking) return empty ? <div className="chat-empty">{empty}</div> : null;
  return <ol className="chat" ref={log} aria-live="polite" aria-label={label}>
    {messages.map((message) => <li key={message.id} className={`bubble bubble--${message.role}`}>
      <span className="bubble-author">{message.role === 'learner' ? 'You' : 'Alex'}</span><p>{message.text}</p>
    </li>)}
    {thinking && <li className="bubble bubble--student bubble--typing" role="status"><span className="bubble-author">Alex</span><p><span className="sr-only">Alex is thinking…</span><span className="typing" aria-hidden="true"><i /><i /><i /></span></p></li>}
  </ol>;
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
  const input = useRef<HTMLTextAreaElement>(null);
  const ready = Boolean(open) && !awaiting && !working;
  // Return the cursor to the composer once Alex has replied, unless the learner moved focus elsewhere.
  useEffect(() => { if (ready && document.activeElement === document.body) input.current?.focus({ preventScroll: true }); }, [ready, open?.messages.length]);
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
  if (unavailable) return <div className="teach-body"><AlexStage state="interrupted" detail="Typing to Alex needs the server’s Gemini key. Add it to the server configuration to use the text conversation." /></div>;
  const state: AlexState = open ? (awaiting && working ? 'thinking' : draft.trim() ? 'user-speaking' : 'listening') : texts.length ? 'ended' : 'idle';
  const detail = open ? (awaiting && !working ? 'Alex hasn’t replied to your last message yet.' : undefined)
    : texts.length ? 'Start a new conversation to keep teaching, or move on to the follow-up questions.' : 'Explain the focus concepts in your own words. Alex will ask questions when something isn’t clear.';
  return <div className="teach-body">
    {mock && <p className="notice notice--warning teach-mock" role="note"><PracticeIcon name="info" size={16} />DEV MOCK: Alex’s text replies are scripted test messages, not AI. No provider request is made.</p>}
    <AlexStage state={state} detail={detail} />
    {shown && <MessageList messages={shown.messages} label="Conversation with Alex" thinking={Boolean(open && awaiting && working)} />}
    {open ? <div className="composer-bar">
      {awaiting && !working && <div className="retry-row"><Button variant="secondary" size="sm" onClick={() => void sendTextMessage(session.id, open.id).catch(() => undefined)}><PracticeIcon name="refresh" size={14} />Retry Alex’s reply</Button></div>}
      <div className="composer-input">
        <label className="sr-only" htmlFor="typed-explanation">Your explanation</label>
        <textarea ref={input} id="typed-explanation" value={draft} rows={2} maxLength={PRACTICE_LIMITS.textMessage} disabled={working || awaiting}
          onChange={(event) => setDraft(event.target.value)} placeholder={awaiting ? 'Waiting for Alex…' : 'Explain it to Alex in your own words…'}
          onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} />
        <Button aria-label="Send to Alex" disabled={working || awaiting || !draft.trim() || learnerTurns >= PRACTICE_LIMITS.textTurns} onClick={() => void send()}><PracticeIcon name="send" size={16} /><span className="send-label">Send</span></Button>
      </div>
      <div className="composer-meta"><span>Enter to send · Shift+Enter for a new line · <span className="mono">{learnerTurns}/{PRACTICE_LIMITS.textTurns}</span></span>
        <button type="button" className="text-button" disabled={working} onClick={() => void finalizeConversation(session.id, open.id).catch(() => undefined)}>End text conversation</button></div>
    </div> : <div className="teach-start"><Button size="lg" disabled={working || session.lifecycle !== 'active'} onClick={() => void startTextConversation(session.id).catch(() => undefined)}><PracticeIcon name="keyboard" size={18} />{texts.length ? 'Start a new text conversation' : 'Start typing to Alex'}</Button></div>}
  </div>;
}

function useUserSpeaking(active: boolean, getInputVolume: () => number) {
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setSpeaking(getInputVolume() > 0.06), 180);
    return () => clearInterval(timer);
  }, [active, getInputVolume]);
  return active && speaking;
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
  const { endSession, setMuted, getInputVolume, getOutputVolume } = voice;
  useEffect(() => () => { endSession(); }, [endSession]);
  const connected = voice.status === 'connected';
  const connecting = starting || voice.status === 'connecting';
  const userSpeaking = useUserSpeaking(connected && !voice.isMuted && !voice.isSpeaking, getInputVolume);
  const speakingRef = useRef(false);
  useEffect(() => { speakingRef.current = voice.isSpeaking; }, [voice.isSpeaking]);
  const getLevel = useCallback(() => speakingRef.current ? getOutputVolume() : getInputVolume(), [getInputVolume, getOutputVolume]);

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
  const baselineGrade = session.attempts.find((item) => item.kind === 'baseline')?.grade;
  const hasConversation = cycle.conversations.some((segment) => segment.messages.some((message) => message.role === 'learner') || segment.channel !== 'text');
  const voiceEnded = cycle.conversations.some((segment) => segment.channel !== 'text' && segment.endedAt);
  const lastLive = messages.at(-1);
  const voiceState: AlexState = voiceError ? 'interrupted' : connecting ? 'connecting' : connected
    ? voice.isSpeaking ? 'speaking' : userSpeaking ? 'user-speaking' : lastLive?.role === 'learner' && !voice.isMuted ? 'thinking' : 'listening'
    : voiceEnded ? 'ended' : 'idle';
  const voiceDetail = connected ? voice.isMuted ? 'Your microphone is muted. Alex can’t hear you.' : 'Speak naturally. Alex may interrupt with a question.'
    : voiceEnded ? 'The saved transcript appears below once the voice service has processed it.' : 'Explain the focus concepts out loud. Alex will ask questions when something isn’t clear.';
  const savedConversations = cycle.conversations.some((segment) => segment.id !== liveId);

  return <>
    <div className="teach">
      <section className="teach-stage card" aria-labelledby="teach-heading">
        <header className="teach-head">
          <div><span className="eyebrow">You’re the teacher</span><h2 id="teach-heading">Teach it to Alex</h2></div>
          <div className="segmented" role="tablist" aria-label="How to talk with Alex">
            <button type="button" role="tab" id="tab-voice" aria-controls="teach-panel" aria-selected={mode === 'voice'} disabled={connected} onClick={() => setMode('voice')}><PracticeIcon name="mic" size={15} />Voice</button>
            <button type="button" role="tab" id="tab-text" aria-controls="teach-panel" aria-selected={mode === 'text'} disabled={connected} onClick={() => setMode('text')}><PracticeIcon name="keyboard" size={15} />Text</button>
          </div>
        </header>
        <div id="teach-panel" role="tabpanel" aria-labelledby={mode === 'voice' ? 'tab-voice' : 'tab-text'} className="teach-panel">
          {mode === 'voice' ? <div className="teach-body">
            {!voiceAvailable ? <>
              <AlexStage state="idle" detail={mock ? 'DEV MOCK: voice is disabled. No ElevenLabs request is made.' : integration ? 'Voice isn’t configured on this server yet.' : 'Checking voice availability…'} />
              {(mock || integration) && <div className="teach-start"><Button size="lg" onClick={() => setMode('text')}><PracticeIcon name="keyboard" size={18} />Type to Alex instead</Button></div>}
            </> : <>
              <AlexStage state={voiceState} detail={voiceDetail} getLevel={connected ? getLevel : undefined} />
              {connected && <MessageList messages={messages} label="Live captions" empty={<p>Live captions appear here as you talk.</p>} />}
              {voiceError && <div className="notice notice--danger" role="alert"><PracticeIcon name="alert" size={16} /><p>{voiceError}</p></div>}
              <div className="voice-controls">
                {connected ? <>
                  <button type="button" className={`voice-button ${voice.isMuted ? 'is-muted' : ''}`} aria-pressed={voice.isMuted} onClick={() => voice.setMuted(!voice.isMuted)}>
                    <span className="voice-button-circle"><PracticeIcon name={voice.isMuted ? 'mute' : 'mic'} size={22} /></span><span>{voice.isMuted ? 'Unmute microphone' : 'Mute microphone'}</span></button>
                  <button type="button" className="voice-button voice-button--end" onClick={() => endSession()}>
                    <span className="voice-button-circle"><PracticeIcon name="stop" size={18} /></span><span>End voice conversation</span></button>
                </> : <button type="button" className="voice-button voice-button--start" onClick={() => void connect()} disabled={connecting || busy[session.id]}>
                  <span className="voice-button-circle">{connecting ? <span className="spinner" aria-hidden="true" /> : <PracticeIcon name="mic" size={24} />}</span>
                  <span>{connecting ? 'Connecting…' : voiceError ? 'Reconnect' : voiceEnded ? 'Start talking again' : 'Start talking'}</span></button>}
              </div>
              {voiceError && <div className="teach-start"><button type="button" className="text-button" onClick={() => { setVoiceError(''); setMode('text'); }}>Type to Alex instead</button></div>}
            </>}
          </div> : <TextConversation session={session} />}
        </div>
        {connected && <p className="teach-caption-note">Live captions · the saved transcript comes from the voice service after you end.</p>}
      </section>

      <aside className="teach-side">
        <section className="side-card card">
          <span className="eyebrow">Topic</span>
          <h3>{session.title}</h3>
          <span className="eyebrow side-label">Focus concepts</span>
          <ul className="focus-list">{focus.map((concept) => {
            const grade = baselineGrade?.questionGrades.find((item) => item.conceptId === concept.id);
            return <li key={concept.id}><div><strong>{concept.title}</strong>{concept.description && <p>{concept.description}</p>}</div>
              {grade && <span className="score-dots" aria-label={`First check: ${grade.score} of ${grade.maxScore}`}>{Array.from({ length: grade.maxScore }, (_, step) => <i key={step} className={step < grade.score ? 'is-on' : ''} />)}</span>}</li>;
          })}</ul>
          {baselineGrade && <p className="side-note">{mock ? 'DEV MOCK test grade' : 'First check'}: <span className="mono">{baselineGrade.totalScore}/{baselineGrade.maxScore}</span>. {baselineGrade.summary}</p>}
        </section>
        <section className="side-card side-card--tips card">
          <span className="eyebrow">Teaching tips</span>
          <ul className="tips"><li>Start with the big idea, then the steps.</li><li>Use an example Alex could picture.</li><li>When Alex asks “why?”, go one level deeper.</li></ul>
        </section>
        <MonitorPrompt session={session} compact />
        {session.notes && <details className="disclosure"><summary>Your notes<PracticeIcon name="chevron" size={14} /></summary><div className="disclosure-body"><p className="notes-text">{session.notes}</p></div></details>}
      </aside>
    </div>

    {savedConversations && <section className="saved-conversations" aria-labelledby="saved-heading"><h3 id="saved-heading">Saved conversations</h3><ConversationList session={session} liveConversationId={liveId} /></section>}
    {errors[session.id] && <p role="alert" className="notice notice--danger"><PracticeIcon name="alert" size={16} />{errors[session.id]}</p>}

    <div className="teach-foot">
      <Button variant="quiet" onClick={() => void exit()} disabled={busy[session.id]}>Save &amp; exit</Button>
      <div className="teach-foot-end">
        <span className="teach-foot-hint">{hasConversation ? 'Done explaining? Three new questions are next.' : 'Teach Alex first, then answer three new questions.'}</span>
        <Button onClick={() => void next()} disabled={busy[session.id] || session.lifecycle !== 'active'}>{mock && !hasConversation ? 'DEV MOCK: skip teaching (test only)' : 'I’m ready for the follow-up questions'}<PracticeIcon name="arrow" size={16} /></Button>
      </div>
    </div>
  </>;
}

function Overview({ session, onBegin }: { session: PracticeSession; onBegin: () => void }) {
  const mock = session.providerMode === 'mock';
  return <section className="overview enter" aria-labelledby="overview-heading">
    <div className="overview-intro card">
      <span className="eyebrow">{mock ? <><span className="badge badge--warning badge--mono">DEV MOCK</span>Fixture overview</> : 'Your material, distilled'}</span>
      <h2 id="overview-heading">{session.title}</h2>
      {session.scope && <p className="overview-scope">{session.scope}</p>}
      {session.materials?.length ? <ul className="material-list" aria-label="Uploaded files">{session.materials.map((material) => <li key={material.id}><PracticeIcon name="file" size={14} /><span>{material.name}</span>
        <span className="muted">{material.pages ? `${material.pages} ${material.pages === 1 ? 'page' : 'pages'}` : `${Math.round(material.characters / 1000)}k chars`}{material.truncated ? ' · beginning used' : ''}</span></li>)}</ul> : null}
    </div>
    <div>
      <h3 className="overview-label">Three concepts to practise</h3>
      <ol className="concept-grid">{session.concepts.map((concept, index) => <li key={concept.id} className="concept-card card"><span className="concept-num mono">0{index + 1}</span><strong>{concept.title}</strong>{concept.description && <p>{concept.description}</p>}</li>)}</ol>
    </div>
    <div className="overview-flow card">
      <ol className="flow">
        <li className="is-next"><span className="flow-dot" /><div><strong>Quick check</strong><span>3 questions · no feedback until the end</span></div></li>
        <li><span className="flow-dot" /><div><strong>Teach Alex</strong><span>Explain the ideas by voice or text</span></div></li>
        <li><span className="flow-dot" /><div><strong>Follow-up</strong><span>3 new questions on the same concepts</span></div></li>
        <li><span className="flow-dot" /><div><strong>Reflect</strong><span>See what changed</span></div></li>
      </ol>
      <Button size="lg" onClick={onBegin}>Start the 3-question check<PracticeIcon name="arrow" size={18} /></Button>
    </div>
    <MonitorPrompt session={session} />
  </section>;
}

const HEADINGS: Record<PracticeSession['stage'], { eyebrow: string; title: (session: PracticeSession) => string }> = {
  preparing: { eyebrow: 'Preparation', title: () => 'Preparing your session' },
  baseline: { eyebrow: 'First check', title: () => 'Let’s see what you remember' },
  baseline_evaluating: { eyebrow: 'First check', title: () => 'Checking your answers' },
  teaching: { eyebrow: 'Teach Alex', title: (session) => session.title },
  recheck: { eyebrow: 'Follow-up check', title: () => 'Show what you’ve explained' },
  recheck_evaluating: { eyebrow: 'Follow-up check', title: () => 'Checking your answers' },
  results: { eyebrow: 'Results', title: (session) => session.title },
};

function StudyContent({ sessionId }: { sessionId: string }) {
  const { sessions, busy, errors, errorStatuses, storageError, loadSession, prepareSession, submitAssessment, saveAndExit, resumeSession } = useSessions();
  const session = sessions[sessionId]; const navigate = useNavigate(); const started = useRef(false);
  const [clarification, setClarification] = useState('');
  const [overviewDone, setOverviewDone] = useState(false);
  useEffect(() => {
    if (!session && !started.current) { started.current = true; void loadSession(sessionId).catch(() => undefined); }
  }, [loadSession, session, sessionId]);
  if (!session) return <EmptyState loading={busy[sessionId]} title={busy[sessionId] ? 'Opening your session…' : 'Session unavailable'} description={busy[sessionId] ? 'Fetching your saved progress.' : errors[sessionId] ?? 'Open a session from Home, or start a new one.'} />;
  if (errorStatuses[sessionId] === 404 || errorStatuses[sessionId] === 401) return <div className="study">
    <StatusCard level={1} title="Session unavailable on the server" tone="error"><p>{errors[sessionId]}</p><p className="muted">Your browser drafts are kept below. Restarting the in-memory API clears server sessions; start a new practice if this session cannot be reopened.</p>
      <div className="button-row"><Button disabled={busy[sessionId]} onClick={() => void loadSession(sessionId).catch(() => undefined)}><PracticeIcon name="refresh" size={16} />Retry loading session</Button><Link className="button button--secondary" to="/">Start a new session</Link></div></StatusCard>
    <details className="disclosure"><summary>Review browser drafts<PracticeIcon name="chevron" size={14} /></summary><div className="disclosure-body answer-review">{session.attempts.map((attempt) => <section key={attempt.id}>{attempt.questions.map((question, index) => <article key={question.id}><h4>{question.prompt}</h4><p>{attempt.answers[index]?.text || 'No typed answer'}</p>{attempt.answers[index]?.working && <p className="muted">{attempt.answers[index]?.working}</p>}<p className="muted small">{attempt.answers[index]?.skipped ? 'Skipped' : ''}{attempt.answers[index]?.uncertain ? ' · Marked unsure' : ''}</p></article>)}</section>)}</div></details>
  </div>;
  if (session.stage === 'results') return <Navigate to={`/results/${session.id}`} replace />;
  const exit = async () => { try { await saveAndExit(sessionId); void navigate('/'); } catch { /* Error shown below. */ } };
  const error = errors[sessionId] || session.operationError || (session.stage === 'preparing' ? session.preparation.message : undefined);
  const attempt = session.attempts.find((item) => item.kind === (session.stage.startsWith('baseline') ? 'baseline' : 'recheck'));
  const preparing = session.stage === 'preparing';
  const fresh = session.stage === 'baseline' && attempt && attempt.currentQuestionIndex === 0 && attempt.answers.every((answer) => !answer.text && !answer.working && !answer.skipped);
  const heading = HEADINGS[session.stage];
  const showOverview = fresh && !overviewDone && session.lifecycle !== 'paused';
  return <div className={`study study--${session.stage}`}>
    <header className="study-head">
      <div><span className="eyebrow">{heading.eyebrow}</span><h1 tabIndex={-1}>{showOverview ? 'Here’s what we’ll practise' : heading.title(session)}</h1>{session.stage !== 'teaching' && !showOverview && <p className="muted">{session.stage === 'preparing' ? session.description : session.title}</p>}</div>
      {session.stage !== 'teaching' && <Button variant="secondary" size="sm" onClick={() => void exit()} disabled={busy[sessionId]}>Save &amp; exit</Button>}
    </header>
    {session.lifecycle === 'paused' ? <StatusCard title="Your session is paused" icon="pause"><p className="muted">Everything you’ve written is saved. Pick up right where you left off.</p><Button disabled={busy[sessionId]} onClick={() => void resumeSession(sessionId).catch(() => undefined)}>Continue session<PracticeIcon name="arrow" size={16} /></Button></StatusCard> :
      preparing ? (busy[sessionId] ? <StatusCard busy title={session.materials?.length ? `Reading ${session.materials.length === 1 ? 'your file' : 'your files'}…` : 'Preparing your questions…'}><p className="muted">Finding three core concepts and writing a short check for each.</p></StatusCard>
        : <section className="status-card card enter" aria-live="polite">
          {session.preparation.clarificationQuestion ? <>
            <span className="status-card-icon"><PracticeIcon name="message" /></span>
            <h2>{session.preparation.clarificationQuestion}</h2>
            <div className="field status-card-field"><label className="field-label" htmlFor="clarification">Your focus</label><textarea id="clarification" className="textarea" value={clarification} maxLength={PRACTICE_LIMITS.description} onChange={(event) => setClarification(event.target.value)} rows={3} /></div>
          </> : <><span className="status-card-icon"><PracticeIcon name={error ? 'alert' : 'sparkle'} /></span><h2>{error ? 'Preparation didn’t finish' : 'Ready to prepare'}</h2></>}
          <div className="button-row"><Button disabled={session.preparation.status === 'clarification' && !clarification.trim()} onClick={() => void prepareSession(sessionId, clarification || undefined).catch(() => undefined)}>{session.preparation.status === 'clarification' ? 'Continue' : 'Try preparing again'}</Button>
            <Button variant="secondary" onClick={() => void loadSession(sessionId).catch(() => undefined)}><PracticeIcon name="refresh" size={16} />Refresh status</Button></div>
        </section>) :
      showOverview ? <Overview session={session} onBegin={() => setOverviewDone(true)} /> :
      session.stage === 'baseline' || session.stage === 'recheck' ? attempt && <AssessmentPanel session={session} attempt={attempt} /> :
      session.stage === 'baseline_evaluating' || session.stage === 'recheck_evaluating' ? (busy[sessionId] ? <StatusCard busy title="Checking your answers…"><p className="muted">Your responses are saved.</p></StatusCard>
        : <StatusCard tone={error ? 'error' : 'neutral'} icon="clock" title={error ? 'We couldn’t check your answers yet' : 'Grading was interrupted or is still processing'}><p className="muted">Your responses are kept.</p>
          {attempt && <div className="button-row"><Button onClick={() => void submitAssessment(sessionId, attempt.id).catch(() => undefined)}><PracticeIcon name="refresh" size={16} />Retry grading</Button><Button variant="secondary" onClick={() => void loadSession(sessionId).catch(() => undefined)}>Refresh status</Button></div>}</StatusCard>) :
      <ConversationProvider><TeachingPanel session={session} /></ConversationProvider>}
    {error && session.stage !== 'teaching' && <p className="notice notice--danger" role="alert"><PracticeIcon name="alert" size={16} />{error}</p>}
    {session.stage === 'recheck' && <ConversationList session={session} showMessages={false} />}
    {storageError && <p className="notice notice--warning" role="alert"><PracticeIcon name="alert" size={16} />{storageError}</p>}
  </div>;
}
