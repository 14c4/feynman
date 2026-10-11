import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useSessions } from '../../state/useSessions';
import { StudyComposer } from './StudyComposer';
import { SavedSessions } from './SavedSessions';
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

/** Optional prefill passed from Results (“practice this again”). */
interface HomeState { topic?: string; description?: string }

export function HomePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const prefill = (location.state ?? {}) as HomeState;
  const { createSession } = useSessions();
  const [description, setDescription] = useState(prefill.description ?? '');
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const starting = useRef(false);

  useEffect(() => {
    if (prefill.description) document.getElementById('description')?.focus({ preventScroll: true });
  }, [prefill.description]);

  async function start(event: FormEvent) {
    event.preventDefault();
    if (starting.current) return;
    if (!description.trim() && !files.length) { setError('Upload what you’re studying, or describe what you want to explain.'); document.getElementById('files')?.focus(); return; }
    starting.current = true; setSaving(true); setError('');
    try {
      const materials: MaterialUpload[] = await Promise.all(files.map(async (file) => ({ name: file.name, data: await readBase64(file) })));
      const id = await createSession({ description: description.trim() || undefined, materials: materials.length ? materials : undefined });
      await navigate(`/study/${id}`);
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not start this practice session.'); }
    finally { starting.current = false; setSaving(false); }
  }

  function addFiles(chosen: File[]) {
    const next = [...files];
    for (const file of chosen) {
      const extension = file.name.toLowerCase().match(/\.[a-z]+$/)?.[0] ?? '';
      if (!(MATERIAL_LIMITS.extensions as readonly string[]).includes(extension)) { setError(`“${file.name}” is not supported. Upload a photo (PNG, JPEG, WebP), PDF, TXT, or Markdown (.md) file.`); return; }
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
      <h1 tabIndex={-1}>Think you know it? <em>Prove it.</em></h1>
      <ol className="how" aria-label="How a session works">
        <li><span className="how-num">01</span><div><strong>Check</strong><span>Three short questions</span></div></li>
        <li><span className="how-num">02</span><div><strong>Teach</strong><span>Explain by voice or text</span></div></li>
        <li><span className="how-num">03</span><div><strong>Recheck</strong><span>New questions, same ideas</span></div></li>
      </ol>
    </header>

    <StudyComposer description={description} files={files} error={error} busy={saving}
      onDescription={(value) => { setDescription(value); setError(''); }}
      onFiles={addFiles} onRemoveFile={(index) => setFiles((current) => current.filter((_, position) => position !== index))}
      onSubmit={(event) => void start(event)} />

    <SavedSessions />
  </div>;
}
