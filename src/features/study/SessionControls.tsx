import { Button } from '../../components/Button';

export function SessionControls({ canFinish, onFinish, onBack }: { canFinish: boolean; onFinish: () => void; onBack: () => void }) {
  return (
    <section className="session-controls" aria-label="Session controls">
      <div className="finish-controls">
        <Button variant="quiet" onClick={onBack}>Leave session</Button>
        <Button disabled={!canFinish} onClick={onFinish} aria-describedby={!canFinish ? 'finish-help' : undefined}>Finish session <span aria-hidden="true">→</span></Button>
      </div>
      {!canFinish && <p id="finish-help" className="small muted finish-help">Use the text fallback below to save an explanation and finish.</p>}
    </section>
  );
}
