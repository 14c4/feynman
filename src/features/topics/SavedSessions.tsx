import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { PracticeStage, SessionSummary } from '../../../shared/types';
import { Button } from '../../components/Button';
import { PracticeIcon } from '../../components/practice/PracticeIcon';
import { listMySessions } from '../../services/practiceApi';
import { useAuth } from '../../state/useAuth';
import { useSessions } from '../../state/useSessions';

const STAGE: Record<PracticeStage, string> = {
  preparing: 'Getting ready', baseline: 'First check', baseline_evaluating: 'First check', teaching: 'Teaching Alex',
  recheck: 'Follow-up check', recheck_evaluating: 'Follow-up check', results: 'Results ready',
};
const when = (iso: string) => {
  const date = new Date(iso); if (Number.isNaN(date.getTime())) return '';
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days < 1) return 'Today'; if (days === 1) return 'Yesterday';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(days > 300 ? { year: 'numeric' } : {}) });
};

/** Under the composer: an invitation to sign in for guests, and the saved-session list for learners who have. */
export function SavedSessions() {
  const { user, available, loading } = useAuth();
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

  async function open(item: SessionSummary) {
    setOpening(item.id); setError('');
    try { await resumeSession(item.id); await navigate(item.stage === 'results' ? `/results/${item.id}` : `/study/${item.id}`); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not open that session.'); }
    finally { setOpening(undefined); }
  }

  if (!available || loading) return null;
  if (!user) return <aside className="saved saved--invite card" aria-label="Save your progress">
    <span className="saved-icon"><PracticeIcon name="history" size={18} /></span>
    <div><strong>Want to come back to this later?</strong><p>Create a free account and your sessions are saved, so you can pick up where you left off.</p></div>
    <Link className="button button--secondary" to="/account">Sign in or create account</Link>
  </aside>;

  return <section className="saved card" aria-labelledby="saved-heading">
    <header className="saved-head"><h2 id="saved-heading">Your sessions</h2>{items && <span className="muted small">{items.length} saved</span>}</header>
    {error && <p className="form-error" role="alert"><PracticeIcon name="alert" size={16} />{error} <button type="button" className="text-button" onClick={() => void load()}>Try again</button></p>}
    {!items && !error && <div className="saved-loading" aria-busy="true"><span className="skeleton" /><span className="skeleton" /></div>}
    {items && !items.length && <p className="muted">Nothing saved yet. Start a session above and it will appear here.</p>}
    {items && items.length > 0 && <ul className="saved-list">{items.map((item) => <li key={item.id}>
      <div><strong>{item.title}</strong><span className="muted small">{STAGE[item.stage]} · {when(item.updatedAt)}</span></div>
      <Button variant="secondary" size="sm" disabled={Boolean(opening)} onClick={() => void open(item)}>
        {opening === item.id ? <><span className="spinner" aria-hidden="true" />Opening…</> : item.stage === 'results' ? 'View results' : 'Continue'}
      </Button>
    </li>)}</ul>}
  </section>;
}
