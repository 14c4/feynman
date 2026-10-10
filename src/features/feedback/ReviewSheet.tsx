import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '../../components/Button';
import { PracticeIcon } from '../../components/practice/PracticeIcon';
import { useSessions } from '../../state/useSessions';
import { inlineRuns, parseMarkdown } from '../../../shared/markdown';
import { reviewPdf } from '../../../shared/reviewPdf';
import type { PracticeSession } from '../../../shared/types';

// The personal review sheet, a collapsed section at the end of the results. The server generates it with
// Gemini from this session's stored answers, grades and transcripts and saves it with the session; this view
// only renders that saved Markdown, and the PDF is built from the same Markdown in the browser.

function inline(text: string): ReactNode[] {
  return inlineRuns(text).map((run, index) => run.style === 'bold' ? <strong key={index}>{run.text}</strong> : run.style === 'italic' ? <em key={index}>{run.text}</em> : run.style === 'code' ? <code key={index}>{run.text}</code> : run.text);
}
const lines = (values: string[]) => values.flatMap((value, index) => index ? [<br key={`br${index}`} />, ...inline(value)] : inline(value));

function Markdown({ source }: { source: string }) {
  return <>{parseMarkdown(source).map((block, index) => {
    if (block.kind === 'heading') { const Tag = `h${Math.min(6, block.level + 1)}` as 'h2'; return <Tag key={index}>{inline(block.text)}</Tag>; }
    if (block.kind === 'quote') return <blockquote key={index}>{block.paragraphs.map((paragraph, part) => <p key={part}>{lines(paragraph)}</p>)}</blockquote>;
    if (block.kind === 'list') { const items = block.items.map((item, part) => <li key={part}>{lines(item.split('\n'))}</li>); return block.ordered ? <ol key={index} start={block.start}>{items}</ol> : <ul key={index}>{items}</ul>; }
    return <p key={index}>{lines(block.lines)}</p>;
  })}</>;
}

/** Saves a file without opening a preview, tab or print dialog. Names use a short session reference, never the topic or notes. */
function save(bytes: BlobPart, type: string, name: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const link = document.createElement('a'); link.href = url; link.download = name;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ReviewSheetPanel({ session }: { session: PracticeSession }) {
  const { generateReview } = useSessions();
  const review = session.review;
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<'loading' | 'error' | 'idle'>('loading');
  // A saved sheet is shown while the server confirms it is current; only an explicit new version shows progress over it.
  const [renewing, setRenewing] = useState(false);
  const [error, setError] = useState('');
  const requested = useRef('');
  // Saved transcripts are part of the evidence; a voice transcript that arrives after results makes the sheet out of date.
  const savedTranscripts = session.cycles.flatMap((cycle) => cycle.conversations).filter((segment) => segment.transcriptStatus === 'ready').length;
  const pendingTranscripts = session.cycles.flatMap((cycle) => cycle.conversations).some((segment) => segment.transcriptStatus === 'pending');
  const create = useCallback((regenerate = false) => { setStatus('loading'); setRenewing(regenerate); return generateReview(session.id, regenerate).then(() => { setError(''); setStatus('idle'); }, (reason: unknown) => { setError(reason instanceof Error ? reason.message : 'Please try again.'); setStatus('error'); }).finally(() => setRenewing(false)); }, [generateReview, session.id]);
  // The server returns its saved sheet without calling Gemini unless the evidence changed, so this is cheap to repeat.
  useEffect(() => {
    const key = `${session.id}:${savedTranscripts}`;
    if (pendingTranscripts || requested.current === key) return;
    requested.current = key; void create();
  }, [session.id, savedTranscripts, pendingTranscripts, create]);
  const reference = session.id.slice(0, 8);
  const busy = status === 'loading' && !pendingTranscripts;
  const ready = Boolean(review);

  return <section className="review-sheet card" aria-labelledby="review-sheet-heading">
    <div className="review-sheet-head">
      <div>
        <h3 id="review-sheet-heading"><span className="takeaway-icon"><PracticeIcon name="book" size={14} /></span>Your Personal Review Sheet</h3>
        <p className="muted small">Review the concepts you can improve on, with explanations built around your own answers.</p>
      </div>
      <div className="review-sheet-actions">
        <Button variant="secondary" size="sm" aria-expanded={open} aria-controls="review-sheet-body" onClick={() => setOpen((value) => !value)}>
          {open ? 'Hide review sheet' : 'View review sheet'}<span className={`review-sheet-chevron${open ? ' is-open' : ''}`}><PracticeIcon name="chevron" size={14} /></span>
        </Button>
        <Button variant="quiet" size="sm" disabled={!ready} title={ready ? undefined : 'Available once your review sheet is ready'} onClick={() => review && save(reviewPdf(review.markdown, `Your Personal Review Sheet – ${session.title}`) as Uint8Array<ArrayBuffer>, 'application/pdf', `feynman-review-${reference}.pdf`)}>
          <PracticeIcon name="file" size={14} />Download PDF
        </Button>
      </div>
    </div>
    {busy && (!review || renewing) && <p className="review-sheet-status muted small" role="status"><span className="spinner" aria-hidden="true" />{review ? 'Creating a new version…' : 'Preparing your review sheet from this session’s answers and conversation…'}</p>}
    {status === 'error' && <div className="notice notice--danger" role="alert"><PracticeIcon name="alert" size={16} /><p>{review ? `Your review sheet could not be updated, so it may not reflect your latest answers or conversation. ${error}` : error}</p><Button variant="secondary" size="sm" onClick={() => void create()}>Try again</Button></div>}
    {pendingTranscripts && !review && <p className="review-sheet-status muted small" role="status">Your review sheet will be prepared once your voice conversation transcript is saved.</p>}
    {open && <div id="review-sheet-body" className="review-sheet-content">
      {review ? <>
        {review.source === 'mock' && <p className="notice notice--warning"><PracticeIcon name="info" size={16} />DEV MOCK: test content from the development fixture, not Gemini output.</p>}
        <div className="markdown"><Markdown source={review.markdown} /></div>
        <div className="review-sheet-foot">
          <span className="muted small">Created {new Date(review.generatedAt).toLocaleString()}</span>
          <Button variant="quiet" size="sm" onClick={() => save(review.markdown, 'text/markdown;charset=utf-8', `feynman-review-${reference}.md`)}>Download Markdown</Button>
          <Button variant="quiet" size="sm" disabled={busy} onClick={() => void create(true)}><PracticeIcon name="refresh" size={14} />Create a new version</Button>
        </div>
      </> : !busy && status !== 'error' && !pendingTranscripts ? <p className="muted small">No review sheet is available for this session.</p> : null}
    </div>}
  </section>;
}
