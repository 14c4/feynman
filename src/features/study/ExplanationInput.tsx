import { useState, type FormEvent } from 'react';
import { Button } from '../../components/Button';

export function ExplanationInput({ draft, onChange, onSave }: { draft: string; onChange: (text: string) => void; onSave: () => void }) {
  const [notice, setNotice] = useState('');
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim()) return;
    onSave();
    setNotice('Explanation saved to your transcript.');
  }
  return (
    <form className="explanation-form" onSubmit={submit}>
      <div className="input-heading"><label htmlFor="explanation">Your explanation</label></div>
      <textarea id="explanation" value={draft} onChange={(event) => { onChange(event.target.value); setNotice(''); }} rows={3} maxLength={10000}
        placeholder="Imagine you’re explaining this to someone for the first time…" aria-describedby="explanation-help" />
      <div className="input-footer">
        <p id="explanation-help" className="small muted">Development fallback · no AI response yet.</p>
        <Button type="submit" variant="secondary" disabled={!draft.trim()}>Save explanation <span aria-hidden="true">↑</span></Button>
      </div>
      <span className="sr-only" role="status">{notice}</span>
    </form>
  );
}
