import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import type { PracticeStage, SessionSummary } from '../../../shared/types';
import { listMySessions } from '../../services/practiceApi';
import { useAuth } from '../../state/useAuth';
import { useSessions } from '../../state/useSessions';

export const STAGE_LABEL: Record<PracticeStage, string> = {
  preparing: 'Getting ready', baseline: 'First check', baseline_evaluating: 'First check', teaching: 'Teaching Alex',
  recheck: 'Follow-up check', recheck_evaluating: 'Follow-up check', results: 'Results ready',
};

export const savedWhen = (iso: string) => {
  const date = new Date(iso); if (Number.isNaN(date.getTime())) return '';
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days < 1) return 'Today'; if (days === 1) return 'Yesterday';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(days > 300 ? { year: 'numeric' } : {}) });
};

/** The signed-in learner's saved sessions (newest first), and a way to reopen one. */
export function useSavedSessions() {
  const { user } = useAuth();
  const { resumeSession } = useSessions();
  const navigate = useNavigate();
  const [items, setItems] = useState<SessionSummary[]>();
  const [error, setError] = useState('');
  const [opening, setOpening] = useState<string>();
  const userId = user?.id;

  const load = useCallback(async () => {
    setError('');
    try { setItems(await listMySessions()); } catch (cause) { setItems(undefined); setError(cause instanceof Error ? cause.message : 'Could not load your sessions.'); }
  }, []);
  useEffect(() => { if (userId) void load(); else setItems(undefined); }, [userId, load]);

  const open = useCallback(async (item: SessionSummary) => {
    setOpening(item.id); setError('');
    try { await resumeSession(item.id); await navigate(item.stage === 'results' ? `/results/${item.id}` : `/study/${item.id}`, { viewTransition: true }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not open that session.'); }
    finally { setOpening(undefined); }
  }, [resumeSession, navigate]);

  return { items, error, opening, load, open };
}
