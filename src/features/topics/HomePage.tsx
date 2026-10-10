import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { Button } from '../../components/Button';
import { PracticeIcon } from '../../components/practice/PracticeIcon';
import { useSessions } from '../../state/useSessions';
import { sessionHref, statusLabel } from '../study/stages';
import { StudyComposer } from './StudyComposer';
import { topics } from './topics';
import { MATERIAL_LIMITS, type MaterialUpload } from '../../../shared/types';
import './home.css';

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error(`“${file.name}” could not be read by the browser. Choose it again.`));
    reader.readAsDataURL(file);
  });
}

/** Optional prefill passed from Results (“practise this again”). */
interface HomeState { topic?: string; description?: string }

const dateFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function HomePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const prefill = (location.state ?? {}) as HomeState;
  const { sessions, createSession, storageError, errors, removeSessions } = useSessions();
  const [description, setDescription] = useState(prefill.description ?? '');
  const [notes, setNotes] = useState('');
  const [topic, setTopic] = useState(prefill.topic ?? '');
  const [files, setFiles] = useState<File[]>([]);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const starting = useRef(false);
  const recent = Object.values(sessions).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  useEffect(() => {
    if (prefill.description) document.getElementById('description')?.focus({ preventScroll: true });
  }, [prefill.description]);

  async function start(event: FormEvent) {
    event.preventDefault();
    if (starting.current) return;
    if (!description.trim()) { setError('Describe what you want to explain to get started.'); document.getElementById('description')?.focus(); return; }
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

  return <div className="home">
    <header className="hero enter">
      <span className="hero-kicker"><PracticeIcon name="leaf" size={14} />The Feynman Technique, with a classmate</span>
      <h1 tabIndex={-1}>Learn it by explaining it.</h1>
      <p className="hero-lede">You’re the teacher. Alex is a curious AI student who asks questions until your explanation holds together. A quick check before and after shows what actually changed.</p>
      <ol className="how" aria-label="How a session works">
        <li><span className="how-num">1</span><div><strong>Check</strong><span>Three short questions</span></div></li>
        <li><span className="how-num">2</span><div><strong>Teach Alex</strong><span>Explain by voice or text</span></div></li>
        <li><span className="how-num">3</span><div><strong>Recheck</strong><span>New questions, same ideas</span></div></li>
      </ol>
    </header>

    <StudyComposer topic={topic} description={description} notes={notes} files={files} error={error || storageError} busy={saving}
      suggestions={topics.map((item) => ({ title: item.title, label: item.category, notes: item.essentialConcepts.map((concept) => concept.description).join('\n') }))}
      onTopic={(value) => { setTopic(value); setError(''); }} onDescription={(value) => { setDescription(value); setError(''); }} onNotes={setNotes}
      onFiles={addFiles} onRemoveFile={(index) => setFiles((current) => current.filter((_, position) => position !== index))}
      onSuggestion={(suggestion) => { setTopic(suggestion.title); setDescription(`Review the key ideas of ${suggestion.title.toLowerCase()}.`); setNotes(suggestion.notes); setError(''); }}
      onSubmit={(event) => void start(event)} />

    <section id="sessions" className="sessions" aria-labelledby="recent-heading">
      <div className="section-head">
        <div><h2 id="recent-heading" tabIndex={-1}>Your sessions</h2><p className="muted small">Saved in this browser. Resuming needs the same API process that created them.</p></div>
        {recent.length > 0 && <div className="section-actions">{selecting ? <>
          <Button variant="quiet" size="sm" disabled={deleting} onClick={() => setSelected(selected.length === recent.length ? [] : recent.map((session) => session.id))}>{selected.length === recent.length ? 'Select none' : 'Select all'}</Button>
          <Button variant="danger" size="sm" disabled={deleting || !selected.length} onClick={() => void remove(selected)}><PracticeIcon name="trash" size={14} />Delete ({selected.length})</Button>
          <Button variant="quiet" size="sm" disabled={deleting} onClick={() => { setSelecting(false); setSelected([]); }}>Cancel</Button>
        </> : <>
          <Button variant="quiet" size="sm" onClick={() => setSelecting(true)}>Select</Button>
          <Button variant="quiet" size="sm" disabled={deleting} onClick={() => void remove(recent.map((session) => session.id))}>Clear history</Button>
        </>}</div>}
      </div>
      {recent.length ? <ul className="session-list">{recent.map((session) => {
        const baseline = session.attempts.find((attempt) => attempt.kind === 'baseline')?.grade;
        const recheck = session.attempts.find((attempt) => attempt.kind === 'recheck')?.grade;
        const review = session.stage === 'results';
        const checked = selected.includes(session.id);
        return <li key={session.id} className={`session-row ${checked ? 'is-selected' : ''}`}>
          {selecting && <input type="checkbox" className="session-check" aria-label={`Select ${session.title}`} checked={checked} disabled={deleting}
            onChange={(event) => setSelected((current) => event.target.checked ? [...current, session.id] : current.filter((id) => id !== session.id))} />}
          <span className="session-icon" aria-hidden="true"><PracticeIcon name={session.lifecycle === 'completed' ? 'check' : 'book'} size={16} /></span>
          <div className="session-main"><strong>{session.title}</strong>
            <span className="session-meta">{session.providerMode === 'mock' && <span className="badge badge--warning badge--mono">DEV MOCK</span>}{dateFormat.format(new Date(session.updatedAt))}</span>
            {errors[session.id] && <p className="form-error" role="alert">{errors[session.id]}</p>}</div>
          <span className={`session-status ${session.lifecycle === 'completed' ? 'is-complete' : ''}`}>{statusLabel(session)}</span>
          <span className="session-score mono" aria-label={baseline ? `Score ${baseline.totalScore} of ${baseline.maxScore}${recheck ? `, then ${recheck.totalScore} of ${recheck.maxScore}` : ''}` : 'Not scored yet'}>{baseline ? <>{baseline.totalScore}/{baseline.maxScore}{recheck && <><span aria-hidden="true"> → </span>{recheck.totalScore}/{recheck.maxScore}</>}</> : '—'}</span>
          <Link className="button button--secondary button--sm session-open" to={sessionHref(session)} aria-label={`${review ? 'Review' : 'Resume'} ${session.title}`}>{review ? 'Review' : 'Resume'}<PracticeIcon name="arrow" size={14} /></Link>
        </li>;
      })}</ul> : <div className="sessions-empty"><PracticeIcon name="book" size={20} /><div><strong>No sessions yet.</strong><p className="muted small">Your first explanation starts above. Finished and paused sessions will appear here.</p></div></div>}
    </section>
  </div>;
}
