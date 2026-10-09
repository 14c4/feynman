import { Link } from 'react-router';

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <section className="empty-state page-narrow">
      <span className="eyebrow">A fresh start</span>
      <h1 tabIndex={-1}>{title}</h1>
      <p className="muted">{description}</p>
      <Link className="button button--primary" to="/">Choose a topic <span aria-hidden="true">→</span></Link>
    </section>
  );
}
