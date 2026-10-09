import type { StudyTopic } from '../../../shared/types';
import { Button } from '../../components/Button';
import { StudentAvatar } from './StudentAvatar';

export function PreparationPanel({ topic, onStart, onBack }: { topic: StudyTopic; onStart: () => void; onBack: () => void }) {
  return (
    <section className="preparation-panel">
      <StudentAvatar small />
      <span className="eyebrow">A moment to prepare</span>
      <h2>Teach it like it’s new.</h2>
      <p className="preparation-prompt">{topic.openingPrompt}</p>
      <ol className="preparation-steps">
        <li><span>1</span> Use your own words.</li>
        <li><span>2</span> Make it concrete with an example.</li>
        <li><span>3</span> Finish, reflect, and try again.</li>
      </ol>
      <p className="small muted">For now, type your explanation. Voice and AI replies are awaiting integration.</p>
      <div className="button-row"><Button onClick={onStart}>Start session <span aria-hidden="true">→</span></Button><Button variant="quiet" onClick={onBack}>Back to topics</Button></div>
    </section>
  );
}
