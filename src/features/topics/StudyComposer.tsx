import { useRef, useState, type FormEvent } from 'react';
import { MATERIAL_LIMITS, PRACTICE_LIMITS } from '../../../shared/types';
import { Button } from '../../components/Button';
import { PracticeIcon } from '../../components/practice/PracticeIcon';

export interface SubjectSuggestion { title: string; label: string; notes: string }

interface StudyComposerProps {
  topic: string;
  description: string;
  notes: string;
  files: File[];
  error?: string;
  busy: boolean;
  suggestions: SubjectSuggestion[];
  onTopic: (value: string) => void;
  onDescription: (value: string) => void;
  onNotes: (value: string) => void;
  onFiles: (files: File[]) => void;
  onRemoveFile: (index: number) => void;
  onSuggestion: (suggestion: SubjectSuggestion) => void;
  onSubmit: (event: FormEvent) => void;
}

const size = (bytes: number) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const kind = (name: string) => name.toLowerCase().endsWith('.pdf') ? 'PDF' : name.toLowerCase().endsWith('.txt') ? 'TXT' : 'MD';

export function StudyComposer({ topic, description, notes, files, error, busy, suggestions, onTopic, onDescription, onNotes, onFiles, onRemoveFile, onSuggestion, onSubmit }: StudyComposerProps) {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const full = files.length >= MATERIAL_LIMITS.files;
  const dropDisabled = busy || full;

  return <form className="composer card" onSubmit={onSubmit} noValidate aria-labelledby="composer-heading">
    <h2 id="composer-heading" className="sr-only">Start a study session</h2>
    <div className="composer-body">
      <div className="field">
        <label className="field-label" htmlFor="topic">Topic <span className="optional">optional</span></label>
        <input id="topic" className="input composer-topic" maxLength={PRACTICE_LIMITS.topic} value={topic} disabled={busy} onChange={(event) => onTopic(event.target.value)} placeholder="e.g. Photosynthesis" autoComplete="off" />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="description">What do you want to explain?</label>
        <textarea id="description" className="textarea" rows={3} maxLength={PRACTICE_LIMITS.description} value={description} disabled={busy} onChange={(event) => onDescription(event.target.value)}
          placeholder="e.g. How light energy becomes chemical energy in a leaf" aria-describedby="description-hint" aria-invalid={Boolean(error) && !description.trim()} />
        <p id="description-hint" className="field-hint">Pick something you’ve already studied. A specific idea works best.</p>
      </div>

      <div className="field">
        <span className="field-label" id="materials-label">Study material <span className="optional">optional · PDF, TXT or Markdown · up to {MATERIAL_LIMITS.files} files, {MATERIAL_LIMITS.fileBytes / 1024 / 1024} MB each</span></span>
        <label htmlFor="files" className={`dropzone ${dragging ? 'is-dragging' : ''} ${dropDisabled ? 'is-disabled' : ''}`}
          onDragEnter={(event) => { event.preventDefault(); if (dropDisabled) return; depth.current += 1; setDragging(true); }}
          onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = dropDisabled ? 'none' : 'copy'; }}
          onDragLeave={() => { depth.current = Math.max(0, depth.current - 1); if (!depth.current) setDragging(false); }}
          onDrop={(event) => { event.preventDefault(); depth.current = 0; setDragging(false); if (!dropDisabled) onFiles(Array.from(event.dataTransfer.files)); }}>
          <span className="dropzone-icon"><PracticeIcon name="upload" size={18} /></span>
          <span className="dropzone-copy"><strong>{full ? 'File limit reached' : dragging ? 'Drop to add' : 'Drop files here or browse'}</strong><span>Text is extracted on the server and used only for this session.</span></span>
          <input id="files" className="sr-only" type="file" multiple disabled={dropDisabled} aria-labelledby="materials-label" aria-describedby="files-hint"
            accept={[...MATERIAL_LIMITS.extensions, 'application/pdf', 'text/plain', 'text/markdown'].join(',')}
            onChange={(event) => { onFiles(Array.from(event.target.files ?? [])); event.target.value = ''; }} />
        </label>
        <p id="files-hint" className="sr-only">Scanned or image-only PDFs aren’t supported yet.</p>
        {files.length > 0 && <ul className="file-list" aria-label="Selected files">{files.map((file, index) => <li key={`${file.name}-${index}`} className="enter">
          <span className="file-kind">{kind(file.name)}</span><span className="file-name">{file.name}</span><span className="file-size">{size(file.size)}</span>
          <button type="button" className="icon-button" disabled={busy} onClick={() => onRemoveFile(index)} aria-label={`Remove ${file.name}`}><PracticeIcon name="close" size={16} /></button>
        </li>)}</ul>}
      </div>

      <details className="composer-notes" open={notes ? true : undefined}>
        <summary><PracticeIcon name="chevron" size={14} />Add notes <span className="optional">optional</span></summary>
        <div className="field"><label className="sr-only" htmlFor="notes">Notes to help shape your questions</label>
          <textarea id="notes" className="textarea" rows={4} maxLength={PRACTICE_LIMITS.notes} value={notes} disabled={busy} onChange={(event) => onNotes(event.target.value)} placeholder="A few key points from class…" /></div>
      </details>
    </div>

    {error && <p className="form-error composer-error" role="alert"><PracticeIcon name="alert" size={16} />{error}</p>}

    <div className="composer-foot">
      <div className="composer-suggestions"><span>Try</span>{suggestions.map((suggestion) => <button type="button" className="chip" key={suggestion.title} disabled={busy} onClick={() => onSuggestion(suggestion)}>{suggestion.title}</button>)}</div>
      <Button type="submit" size="lg" disabled={busy}>{busy ? <><span className="spinner" aria-hidden="true" />{files.length ? 'Uploading…' : 'Starting…'}</> : <>Start session<PracticeIcon name="arrow" size={18} /></>}</Button>
    </div>
  </form>;
}
