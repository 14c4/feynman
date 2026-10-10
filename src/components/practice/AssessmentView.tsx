import { useEffect, useRef } from 'react';
import type { AssessmentAnswer, PracticeQuestion } from '../../../shared/types';
import { Button } from '../Button';
import { PracticeIcon as PreviewIcon } from './PracticeIcon';

interface AssessmentViewProps {
  question: PracticeQuestion;
  answer: AssessmentAnswer;
  index: number;
  count: number;
  draftLabel: string;
  disabled?: boolean;
  submitLabel?: string;
  onChange: (answer: AssessmentAnswer) => void;
  onBack: () => void;
  onNext: (skip: boolean) => void;
}

// Controlled presentation; no fixtures, providers or persistence here.
export function AssessmentView({ question, answer, index, count, draftLabel, disabled = false, submitLabel = 'Check my answers', onChange, onBack, onNext }: AssessmentViewProps) {
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { field.current?.focus(); }, [question.id]);
  return <section className="pv-card pv-question-card" aria-labelledby="pv-question">
    <div className="pv-question-meta"><span className="pv-eyebrow">QUESTION {index + 1} OF {count}</span><span className="pv-draft-status" role="status"><PreviewIcon name="check" size={14} />{draftLabel}</span></div>
    <div className="pv-question-progress" role="progressbar" aria-label="Question progress" aria-valuemin={0} aria-valuemax={count} aria-valuenow={index + 1}>{Array.from({ length: count }, (_, step) => <span key={step} className={step <= index ? 'is-filled' : ''} />)}</div>
    <h2 id="pv-question">{question.prompt}</h2><p className="pv-question-hint">Use your own words. It’s okay if you don’t remember everything.</p>
    <label htmlFor="pv-answer">Your answer</label><textarea ref={field} id="pv-answer" rows={5} maxLength={6000} value={answer.text} disabled={disabled} onChange={(event) => onChange({ ...answer, text: event.target.value, skipped: false })} placeholder="Here’s how I understand it…" />
    {question.supportsWorking && <details className="pv-working" key={question.id} open={answer.working ? true : undefined}><summary>Add your working <span>optional</span></summary><label htmlFor="pv-working">Reasoning, calculations, or rough notes</label><textarea id="pv-working" rows={3} maxLength={6000} value={answer.working} disabled={disabled} onChange={(event) => onChange({ ...answer, working: event.target.value, skipped: false })} /></details>}
    <label className="pv-checkbox"><input type="checkbox" checked={answer.uncertain} disabled={disabled} onChange={(event) => onChange({ ...answer, uncertain: event.target.checked })} />I’m not sure yet<span>No penalty for being honest.</span></label>
    {answer.skipped && <p className="pv-field-help" role="status">This question is marked skipped. Adding an answer will clear the skip.</p>}
    <div className="pv-question-actions"><Button variant="quiet" onClick={onBack} disabled={disabled || index === 0}>Back</Button><div><Button variant="quiet" onClick={() => onNext(true)} disabled={disabled}>Skip question</Button><Button onClick={() => onNext(false)} disabled={disabled || (!answer.skipped && !answer.text.trim() && !answer.working.trim())}>{index === count - 1 ? submitLabel : 'Next question'}<PreviewIcon name="arrow" size={18} /></Button></div></div>
  </section>;
}
