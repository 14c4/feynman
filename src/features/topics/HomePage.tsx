import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { Button } from '../../components/Button';
import { PRACTICE_LIMITS } from '../../../shared/types';
import { useSessions } from '../../state/useSessions';
import './topics.css';

export function HomePage() {
  const navigate = useNavigate();
  const { sessions, createSession, storageError } = useSessions();
  const [description, setDescription] = useState('');
  const [notes, setNotes] = useState('');
  const [showNotes, setShowNotes] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const recent = Object.values(sessions).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  async function start(event: FormEvent) {
    event.preventDefault();
    if (!description.trim()) { setError('Add a subject or skill to get started.'); return; }
    setSaving(true); setError('');
    try { const id = await createSession({ description: description.trim(), notes: notes.trim() }); await navigate(`/study/${id}`); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not start this practice session.'); }
    finally { setSaving(false); }
  }

  return <div className="home-page">
    <section className="home-intro"><span className="eyebrow">A calmer way to check what you know</span><h1 tabIndex={-1}>What are you studying?</h1><p>Practice what you know before your next test.</p></section>
    <form className="lesson-form" onSubmit={(event) => void start(event)}>
      <label htmlFor="lesson-description">What have you been reviewing?</label>
      <textarea id="lesson-description" value={description} maxLength={PRACTICE_LIMITS.description} onChange={(event) => setDescription(event.target.value)} placeholder="For example, how the heart moves blood" required />
      <div className="lesson-form-meta"><span>Be specific about what you want to remember.</span><span>{description.length}/{PRACTICE_LIMITS.description}</span></div>
      <button type="button" className="notes-toggle" aria-expanded={showNotes} onClick={() => setShowNotes(!showNotes)}>{showNotes ? '−' : '+'} Add notes (optional)</button>
      {showNotes && <div className="notes-field"><label htmlFor="lesson-notes">Paste notes to help shape your questions</label><textarea id="lesson-notes" value={notes} maxLength={PRACTICE_LIMITS.notes} onChange={(event) => setNotes(event.target.value)} rows={5} placeholder="Paste a few key points, definitions, or class notes…" /><span className="field-count">{notes.length}/{PRACTICE_LIMITS.notes}</span></div>}
      {(error || storageError) && <p className="form-error" role="alert">{error || storageError}</p>}
      <Button type="submit" disabled={saving}>{saving ? 'Starting…' : 'Start practicing'} <span aria-hidden="true">→</span></Button>
    </form>
    {recent.length > 0 && <section className="recent-section" aria-labelledby="recent-heading"><div className="section-heading"><h2 id="recent-heading">Your sessions</h2><span className="muted">Saved on this device</span></div><ul className="recent-list">{recent.map((session) => <li key={session.id}><div><strong>{session.title}</strong><span>{session.lifecycle === 'completed' ? 'Complete · review your results' : session.lifecycle === 'paused' ? 'Paused · ready to continue' : 'In progress'}</span></div><Link className="text-link" to={session.stage === 'results' ? `/results/${session.id}` : `/study/${session.id}`}>{session.stage === 'results' ? 'Review' : session.lifecycle === 'paused' ? 'Resume' : 'Continue'} <span aria-hidden="true">→</span></Link></li>)}</ul></section>}
  </div>;
}
