import { useEffect, useRef, useState, type FormEvent } from 'react';
import { MATERIAL_LIMITS, PRACTICE_LIMITS } from '../../../shared/types';
import { Button } from '../../components/Button';
import { PracticeIcon } from '../../components/practice/PracticeIcon';

interface StudyComposerProps {
  description: string;
  files: File[];
  error?: string;
  busy: boolean;
  onDescription: (value: string) => void;
  onFiles: (files: File[]) => void;
  onRemoveFile: (index: number) => void;
  onSubmit: (event: FormEvent) => void;
}

const size = (bytes: number) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const extensionOf = (file: File) => file.name.toLowerCase().match(/\.[a-z]+$/)?.[0] ?? '';
const isImage = (file: File) => (MATERIAL_LIMITS.imageExtensions as readonly string[]).includes(extensionOf(file));
const kind = (file: File) => extensionOf(file) === '.pdf' ? 'PDF' : extensionOf(file) === '.txt' ? 'TXT' : 'MD';

/** Small preview of a chosen image; the object URL is released when the file goes away. */
function Thumb({ file }: { file: File }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url ? <img className="file-thumb" src={url} alt="" /> : <span className="file-kind">IMG</span>;
}

export function StudyComposer({ description, files, error, busy, onDescription, onFiles, onRemoveFile, onSubmit }: StudyComposerProps) {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const full = files.length >= MATERIAL_LIMITS.files;
  const dropDisabled = busy || full;

  return <form className="composer card" onSubmit={onSubmit} noValidate aria-labelledby="composer-heading">
    <h2 id="composer-heading" className="sr-only">Start a study session</h2>
    <div className="composer-body">
      <div className="field">
        <span className="field-label field-label--lg" id="materials-label">Upload what you’re studying</span>
        <label htmlFor="files" className={`dropzone dropzone--hero ${dragging ? 'is-dragging' : ''} ${dropDisabled ? 'is-disabled' : ''} ${files.length ? 'has-files' : ''}`}
          onDragEnter={(event) => { event.preventDefault(); if (dropDisabled) return; depth.current += 1; setDragging(true); }}
          onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = dropDisabled ? 'none' : 'copy'; }}
          onDragLeave={() => { depth.current = Math.max(0, depth.current - 1); if (!depth.current) setDragging(false); }}
          onDrop={(event) => { event.preventDefault(); depth.current = 0; setDragging(false); if (!dropDisabled) onFiles(Array.from(event.dataTransfer.files)); }}>
          <span className="dropzone-icon"><PracticeIcon name="upload" size={26} /></span>
          <span className="dropzone-copy"><strong>{full ? 'File limit reached' : dragging ? 'Drop to add' : files.length ? 'Add another file' : 'Drop photos, notes or PDFs here, or browse'}</strong>
            <span>Photos of notes or textbook pages, screenshots, PDFs, TXT or Markdown. Up to {MATERIAL_LIMITS.files} files, {MATERIAL_LIMITS.fileBytes / 1024 / 1024} MB each.</span></span>
          <input id="files" className="sr-only" type="file" multiple disabled={dropDisabled} aria-labelledby="materials-label"
            accept={[...MATERIAL_LIMITS.extensions, 'application/pdf', 'text/plain', 'text/markdown', 'image/png', 'image/jpeg', 'image/webp'].join(',')}
            onChange={(event) => { onFiles(Array.from(event.target.files ?? [])); event.target.value = ''; }} />
        </label>
        {files.length > 0 && <ul className="file-list" aria-label="Selected files">{files.map((file, index) => <li key={`${file.name}-${index}`} className="enter">
          {isImage(file) ? <Thumb file={file} /> : <span className="file-kind">{kind(file)}</span>}<span className="file-name">{file.name}</span><span className="file-size">{size(file.size)}</span>
          <button type="button" className="icon-button" disabled={busy} onClick={() => onRemoveFile(index)} aria-label={`Remove ${file.name}`}><PracticeIcon name="close" size={16} /></button>
        </li>)}</ul>}
      </div>

      <div className="field">
        <label className="field-label field-label--lg" htmlFor="description">Anything to add?</label>
        <textarea id="description" className="textarea composer-detail" rows={3} maxLength={PRACTICE_LIMITS.description} value={description} disabled={busy} onChange={(event) => onDescription(event.target.value)}
          placeholder={files.length ? 'e.g. Focus on chapter 3, or what I found confusing' : 'Or just describe it: how light energy becomes chemical energy in a leaf'} aria-describedby="description-hint" />
        <p id="description-hint" className="field-hint">{files.length ? 'Your upload is enough on its own. Add a line only if you want to steer the questions.' : 'Without a file, a specific idea you’ve already studied works best.'}</p>
      </div>
    </div>

    {error && <p className="form-error composer-error" role="alert"><PracticeIcon name="alert" size={16} />{error}</p>}

    <div className="composer-foot">
      <Button type="submit" size="lg" disabled={busy}>{busy ? <><span className="spinner" aria-hidden="true" />{files.some(isImage) ? 'Reading your upload…' : files.length ? 'Uploading…' : 'Starting…'}</> : <>Start session<span className="button-arrow" aria-hidden="true"><PracticeIcon name="arrow" size={16} /></span></>}</Button>
    </div>
  </form>;
}
