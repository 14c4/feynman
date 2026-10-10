import type { FormEvent, ReactNode } from 'react';
import { MATERIAL_LIMITS, PRACTICE_LIMITS } from '../../../shared/types';
import { Button } from '../Button';
import { PracticeIcon } from './PracticeIcon';

interface SubjectSuggestion { title: string; label: string; notes: string }
interface StartPracticeFormProps {
  subject: string;
  notes: string;
  error?: string;
  busy?: boolean;
  preview?: boolean;
  footer?: ReactNode;
  suggestions: SubjectSuggestion[];
  onSubject: (subject: string) => void;
  onNotes: (notes: string) => void;
  onSuggestion: (suggestion: SubjectSuggestion) => void;
  onSubmit: (event: FormEvent) => void;
  /** Live app only: a short topic name and study files. Omitted in /preview. */
  topic?: string;
  onTopic?: (topic: string) => void;
  files?: File[];
  onFiles?: (files: File[]) => void;
  onRemoveFile?: (index: number) => void;
}

const size = (bytes: number) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export function StartPracticeForm({ subject, notes, error, busy, preview, footer, suggestions, onSubject, onNotes, onSuggestion, onSubmit, topic, onTopic, files, onFiles, onRemoveFile }: StartPracticeFormProps) {
  return <form className="pv-card pv-start-card" onSubmit={onSubmit} noValidate>
    <div className="pv-card-heading"><span className="pv-subject-icon"><PracticeIcon name="practice" /></span><h2>Start a practice session</h2></div>
    {onTopic && <><label htmlFor="pv-topic">Topic</label><input id="pv-topic" className="pv-text-input" maxLength={PRACTICE_LIMITS.topic} value={topic ?? ''} disabled={busy} onChange={(event) => onTopic(event.target.value)} placeholder="e.g. Photosynthesis" /></>}
    <label htmlFor="pv-subject">{onTopic ? 'What do you want to learn?' : 'Your subject or topic'}</label><textarea id="pv-subject" rows={3} maxLength={PRACTICE_LIMITS.description} value={subject} disabled={busy} onChange={(event) => onSubject(event.target.value)} placeholder="e.g. How the heart moves blood" aria-describedby="pv-subject-help" aria-invalid={Boolean(error)} />
    <p id="pv-subject-help" className="pv-field-help">Choose something you’ve already studied. A specific idea works best.</p>
    <details className="pv-notes"><summary>Add your notes <span>optional</span></summary><label htmlFor="pv-notes">{preview ? 'Notes for this local preview' : 'Notes to help shape your questions'}</label><textarea id="pv-notes" rows={4} maxLength={PRACTICE_LIMITS.notes} value={notes} disabled={busy} onChange={(event) => onNotes(event.target.value)} placeholder="A few key points from class…" /></details>
    {onFiles && <div className="pv-materials"><label htmlFor="pv-files">Study material <span>optional · PDF, TXT or Markdown · up to {MATERIAL_LIMITS.files} files, {MATERIAL_LIMITS.fileBytes / 1024 / 1024} MB each</span></label>
      <input id="pv-files" type="file" multiple disabled={busy || (files?.length ?? 0) >= MATERIAL_LIMITS.files} accept={[...MATERIAL_LIMITS.extensions, 'application/pdf', 'text/plain', 'text/markdown'].join(',')}
        onChange={(event) => { onFiles(Array.from(event.target.files ?? [])); event.target.value = ''; }} />
      {files && files.length > 0 && <ul className="pv-file-list">{files.map((file, index) => <li key={`${file.name}-${index}`}><span>{file.name}</span><span className="pv-field-help">{size(file.size)}</span>
        <button type="button" className="pv-text-button" disabled={busy} onClick={() => onRemoveFile?.(index)} aria-label={`Remove ${file.name}`}>Remove</button></li>)}</ul>}
      <p className="pv-field-help">Text is extracted on the server and used only for this session. Scanned or image-only PDFs aren’t supported yet.</p></div>}
    <div className="pv-suggestions"><span>{preview ? 'Try a sample' : 'Try a subject'}</span>{suggestions.map((suggestion) => <button type="button" key={suggestion.title} disabled={busy} onClick={() => onSuggestion(suggestion)}>{suggestion.label}<PracticeIcon name="arrow" size={14} /></button>)}</div>
    {error && <p className="pv-error" role="alert">{error}</p>}
    <div className="pv-start-bottom"><Button type="submit" disabled={busy}>{busy ? 'Starting…' : 'Start practicing'}<PracticeIcon name="arrow" size={18} /></Button><span>3 questions to begin</span></div>
    {footer}
  </form>;
}
