import { useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { Button } from '../../components/Button';
import { StartPracticeForm } from '../../components/practice/StartPracticeForm';
import { PracticeIcon } from '../../components/practice/PracticeIcon';
import { useSessions } from '../../state/useSessions';
import { topics } from './topics';
import { MATERIAL_LIMITS, type MaterialUpload } from '../../../shared/types';

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error(`“${file.name}” could not be read by the browser. Choose it again.`));
    reader.readAsDataURL(file);
  });
}

export function HomePage() {
  const navigate = useNavigate();
  const { sessions, createSession, storageError, errors, removeSessions } = useSessions();
  const [description, setDescription] = useState('');
  const [notes, setNotes] = useState('');
  const [topic, setTopic] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const starting = useRef(false);
  const recent = Object.values(sessions).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  async function start(event: FormEvent) {
    event.preventDefault();
    if (starting.current) return;
    if (!description.trim()) { setError('Describe what you want to learn to get started.'); return; }
    starting.current = true; setSaving(true); setError('');
    try {
      const materials: MaterialUpload[] = await Promise.all(files.map(async (file) => ({ name: file.name, data: await readBase64(file) })));
      const id = await createSession({ topic: topic.trim() || undefined, description: description.trim(), notes: notes.trim(), materials: materials.length ? materials : undefined });
      await navigate(`/study/${id}`);
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not start this practice session.'); }
    finally { starting.current = false; setSaving(false); }
  }

  async function remove(ids: string[]) {
    if (!ids.length) return;
    const label = ids.length === recent.length ? 'all practice history' : `${ids.length} ${ids.length === 1 ? 'session' : 'sessions'}`;
    if (!window.confirm(`Delete ${label}? Answers, uploaded material and conversations are removed from this browser and the server. This can’t be undone.`)) return;
    setDeleting(true);
    try { await removeSessions(ids); setSelected([]); setSelecting(false); }
    finally { setDeleting(false); }
  }

  function addFiles(chosen: File[]) {
    const next = [...files];
    for (const file of chosen) {
      const extension = file.name.toLowerCase().match(/\.[a-z]+$/)?.[0] ?? '';
      if (!(MATERIAL_LIMITS.extensions as readonly string[]).includes(extension)) { setError(`“${file.name}” is not supported. Upload a PDF, TXT, or Markdown (.md) file.`); return; }
      if (!file.size) { setError(`“${file.name}” is empty.`); return; }
      if (file.size > MATERIAL_LIMITS.fileBytes) { setError(`“${file.name}” is larger than ${MATERIAL_LIMITS.fileBytes / 1024 / 1024} MB.`); return; }
      if (!next.some((item) => item.name === file.name && item.size === file.size)) next.push(file);
    }
    if (next.length > MATERIAL_LIMITS.files) { setError(`Upload at most ${MATERIAL_LIMITS.files} files.`); return; }
    if (next.reduce((total, file) => total + file.size, 0) > MATERIAL_LIMITS.totalBytes) { setError(`Files together must be under ${MATERIAL_LIMITS.totalBytes / 1024 / 1024} MB.`); return; }
    setFiles(next); setError('');
  }

  return <>
    <header className="pv-page-heading"><h1 tabIndex={-1}>What are you studying?</h1></header>
    <div className="pv-dashboard-grid"><StartPracticeForm subject={description} notes={notes} error={error || storageError} busy={saving}
      topic={topic} onTopic={(value) => { setTopic(value); setError(''); }} files={files} onFiles={addFiles} onRemoveFile={(index) => setFiles((current) => current.filter((_, position) => position !== index))}
      suggestions={topics.map((topic) => ({ title: topic.title, label: topic.category, notes: topic.essentialConcepts.map((concept) => concept.description).join('\n') }))}
      onSubject={(value) => { setDescription(value); setError(''); }} onNotes={setNotes}
      onSuggestion={(suggestion) => { setTopic(suggestion.title); setDescription(`Review the key ideas of ${suggestion.title.toLowerCase()}.`); setNotes(suggestion.notes); setError(''); }} onSubmit={(event) => void start(event)} /></div>
    <section id="sessions" className="pv-recent" aria-labelledby="recent-heading"><div className="pv-section-heading"><div><h2 id="recent-heading" tabIndex={-1}>Pick up where you left off</h2><p>Saved in this browser; requires the original API process.</p></div>
      {recent.length > 0 && <div className="pv-history-actions">{selecting ? <>
        <Button variant="quiet" disabled={deleting} onClick={() => setSelected(selected.length === recent.length ? [] : recent.map((session) => session.id))}>{selected.length === recent.length ? 'Select none' : 'Select all'}</Button>
        <Button variant="secondary" disabled={deleting || !selected.length} onClick={() => void remove(selected)}>Delete selected ({selected.length})</Button>
        <Button variant="quiet" disabled={deleting} onClick={() => { setSelecting(false); setSelected([]); }}>Cancel</Button>
      </> : <>
        <Button variant="quiet" onClick={() => setSelecting(true)}>Select</Button>
        <Button variant="quiet" disabled={deleting} onClick={() => void remove(recent.map((session) => session.id))}>Clear history</Button>
      </>}</div>}</div>
      {recent.length ? <ul className="pv-session-list">{recent.map((session) => {
        const baseline = session.attempts.find((attempt) => attempt.kind === 'baseline')?.grade;
        const recheck = session.attempts.find((attempt) => attempt.kind === 'recheck')?.grade;
        return <li key={session.id}>{selecting && <input type="checkbox" className="pv-history-check" aria-label={`Select ${session.title}`} checked={selected.includes(session.id)} disabled={deleting}
            onChange={(event) => setSelected((current) => event.target.checked ? [...current, session.id] : current.filter((id) => id !== session.id))} />}<span className="pv-subject-icon"><PracticeIcon name="book" /></span><div className="pv-session-title"><strong>{session.title}</strong><span>{session.providerMode === 'mock' ? 'DEV MOCK · ' : ''}{new Date(session.updatedAt).toLocaleString()}</span>{errors[session.id] && <p className="pv-error" role="alert">{errors[session.id]}</p>}</div>
          <span className={`pv-status ${session.lifecycle === 'completed' ? 'pv-status--complete' : ''}`}>{session.lifecycle === 'completed' ? 'Completed' : session.lifecycle === 'paused' ? 'Paused' : 'In progress'}</span>
          <span className="pv-session-score">{baseline ? `${baseline.totalScore}/${baseline.maxScore}${recheck ? ` → ${recheck.totalScore}/${recheck.maxScore}` : ''}` : '—'}</span>
          <Link className="button button--quiet" to={session.stage === 'results' ? `/results/${session.id}` : `/study/${session.id}`} aria-label={`${session.stage === 'results' ? 'Review' : 'Resume'} ${session.title}`}>{session.stage === 'results' ? 'Review' : 'Resume'}<PracticeIcon name="arrow" size={16} /></Link></li>;
      })}</ul> : <div className="pv-empty"><PracticeIcon name="book" size={28} /><h3>Your first idea starts here.</h3><p>Practice sessions will appear here when you start.</p><Button variant="secondary" onClick={() => document.getElementById('pv-subject')?.focus()}>Choose a subject</Button></div>}
    </section>
  </>;
}
