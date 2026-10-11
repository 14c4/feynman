import { Link } from 'react-router';
import { Button } from '../../components/Button';
import { PracticeIcon } from '../../components/practice/PracticeIcon';
import { useAuth } from '../../state/useAuth';
import { STAGE_LABEL, savedWhen, useSavedSessions } from './useSavedSessions';

/** Under the composer: an invitation to sign in for guests, and the saved-session list for learners who have. */
export function SavedSessions() {
  const { user, available, loading } = useAuth();
  const { items, error, opening, load, open } = useSavedSessions();

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
      <div><strong>{item.title}</strong><span className="muted small">{STAGE_LABEL[item.stage]} · {savedWhen(item.updatedAt)}</span></div>
      <Button variant="secondary" size="sm" disabled={Boolean(opening)} onClick={() => void open(item)}>
        {opening === item.id ? <><span className="spinner" aria-hidden="true" />Opening…</> : item.stage === 'results' ? 'View results' : 'Continue'}
      </Button>
    </li>)}</ul>}
  </section>;
}
