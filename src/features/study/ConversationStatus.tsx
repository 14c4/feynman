import { useEffect, useRef, useState } from 'react';
import type { ConversationSegment, PracticeSession } from '../../../shared/types';
import { useSessions } from '../../state/useSessions';
import { TranscriptPanel } from './TranscriptPanel';

// Bounded backoff for ElevenLabs transcript processing. After these attempts the
// learner gets a manual "Check again" action; nothing is labeled saved until the
// server reports the provider transcript as done.
const DELAYS = [3_000, 6_000, 12_000, 20_000, 30_000];

const segments = (session: PracticeSession) => session.cycles.flatMap((cycle) => cycle.conversations);
const isVoice = (segment: ConversationSegment) => segment.channel !== 'text';

function useTranscriptReconciler(session: PracticeSession | undefined, liveConversationId?: string) {
  const { finalizeConversation } = useSessions();
  const attempts = useRef<Record<string, number>>({});
  const [tick, setTick] = useState(0);
  const [exhausted, setExhausted] = useState<string[]>([]);
  const sessionId = session?.id;
  const pending = session ? segments(session).filter((segment) => isVoice(segment) && segment.transcriptStatus === 'pending' && segment.id !== liveConversationId).map((segment) => segment.id) : [];
  const key = pending.join(',');
  useEffect(() => {
    if (!sessionId || !key) return;
    const timers = key.split(',').flatMap((id) => {
      const count = attempts.current[id] ?? 0;
      if (count >= DELAYS.length) return [];
      return [setTimeout(() => {
        attempts.current[id] = count + 1;
        void finalizeConversation(sessionId, id).catch(() => undefined).finally(() => {
          if (attempts.current[id] >= DELAYS.length) setExhausted((current) => current.includes(id) ? current : [...current, id]);
          setTick((value) => value + 1);
        });
      }, DELAYS[count])];
    });
    return () => timers.forEach(clearTimeout);
  }, [finalizeConversation, key, sessionId, tick]);
  function checkNow(id: string) {
    if (!sessionId) return;
    attempts.current[id] = 0;
    setExhausted((current) => current.filter((item) => item !== id));
    void finalizeConversation(sessionId, id).catch(() => undefined).finally(() => setTick((value) => value + 1));
  }
  return { exhausted, checkNow };
}

function statusLabel(segment: ConversationSegment, retrying: boolean): string {
  if (segment.channel === 'text') {
    if (!segment.endedAt) return 'in progress · saved after each message';
    return segment.transcriptStatus === 'ready' ? 'saved' : 'ended without your explanations';
  }
  if (segment.transcriptStatus === 'ready') return 'transcript saved';
  if (segment.transcriptStatus === 'incomplete') return 'transcript unavailable from the voice service';
  return retrying ? 'transcript processing · checking automatically' : 'transcript not confirmed yet';
}

/** Every conversation in the session with its honest transcript status. */
export function ConversationList({ session, liveConversationId, showMessages = true }: { session: PracticeSession; liveConversationId?: string; showMessages?: boolean }) {
  const { busy } = useSessions();
  const { exhausted, checkNow } = useTranscriptReconciler(session, liveConversationId);
  const all = segments(session).filter((segment) => segment.id !== liveConversationId);
  if (!all.length) return null;
  return <div className="conversation-list">{all.map((segment, index) => {
    const retrying = !exhausted.includes(segment.id);
    const label = `${segment.channel === 'text' ? 'Text' : 'Voice'} conversation ${index + 1} · ${statusLabel(segment, retrying)}`;
    return <div key={segment.id}>
      {showMessages && segment.messages.length ? <TranscriptPanel messages={segment.messages} label={label} /> : <p className="conversation-status"><span className={`dot ${segment.transcriptStatus === 'ready' ? 'dot--accent' : segment.transcriptStatus === 'pending' ? 'dot--warning' : ''}`} aria-hidden="true" />{label}</p>}
      {isVoice(segment) && segment.transcriptStatus === 'pending' && !retrying && <button type="button" className="text-button" disabled={busy[session.id]} onClick={() => checkNow(segment.id)}>Check for the transcript again</button>}
    </div>;
  })}</div>;
}
