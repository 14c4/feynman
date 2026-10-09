import { useNavigate } from 'react-router';
import { useSessions } from '../../state/useSessions';
import { TopicCard } from './TopicCard';
import { topics } from './topics';
import './topics.css';

export function HomePage() {
  const navigate = useNavigate();
  const { createSession } = useSessions();
  return (
    <div className="home-page">
      <section className="home-intro">
        <h1 tabIndex={-1}>What would you like to teach?</h1>
      </section>

      <section className="topic-section" aria-labelledby="topics-heading">
        <div className="section-heading">
          <h2 id="topics-heading">Suggested topics</h2>
        </div>
        <div className="topic-grid">
          {topics.map((topic) => <TopicCard key={topic.id} topic={topic} onSelect={() => {
            const id = createSession(topic.id);
            void navigate(`/study/${id}`);
          }} />)}
        </div>
      </section>

      <aside className="integration-note">
        <span className="status-dot" aria-hidden="true" />
        <p>Voice and AI feedback are awaiting integration. Use text to try a session.</p>
      </aside>
    </div>
  );
}
