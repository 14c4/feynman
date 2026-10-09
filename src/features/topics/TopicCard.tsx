import type { StudyTopic } from '../../../shared/types';
import { Button } from '../../components/Button';

const symbols: Record<string, string> = { recursion: '↻', derivatives: 'ƒ′', photosynthesis: '☼' };

export function TopicCard({ topic, onSelect }: { topic: StudyTopic; onSelect: () => void }) {
  return (
    <article className={`topic-card topic-card--${topic.id}`}>
      <span className="topic-symbol" aria-hidden="true">{symbols[topic.id]}</span>
      <span className="eyebrow">{topic.category}</span>
      <h3>{topic.title}</h3>
      <p>{topic.description}</p>
      <Button variant="secondary" onClick={onSelect} aria-label={`Prepare to study ${topic.title}`}>
        Prepare to study <span aria-hidden="true">↗</span>
      </Button>
    </article>
  );
}
