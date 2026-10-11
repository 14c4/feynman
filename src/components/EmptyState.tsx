import { Link } from 'react-router';
import { PracticeIcon } from './practice/PracticeIcon';

export function EmptyState({ title, description, loading = false }: { title: string; description: string; loading?: boolean }) {
  return (
    <section className="empty-state enter" aria-busy={loading || undefined}>
      <span className="empty-icon">{loading ? <span className="spinner" aria-hidden="true" /> : <PracticeIcon name="leaf" />}</span>
      <h1 tabIndex={-1}>{title}</h1>
      <p className="muted">{description}</p>
      {!loading && <Link className="button button--primary" to="/app">Back to home <PracticeIcon name="arrow" size={16} /></Link>}
    </section>
  );
}
