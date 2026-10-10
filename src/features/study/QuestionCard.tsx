import { useEffect, useRef } from 'react';
import type { AssessmentAnswer, PracticeQuestion } from '../../../shared/types';
import { PRACTICE_LIMITS } from '../../../shared/types';
import { Button } from '../../components/Button';
import { PracticeIcon } from '../../components/practice/PracticeIcon';

export type SaveState = 'unavailable' | 'local' | 'saving' | 'saved' | 'clean';

const SAVE_LABELS: Record<SaveState, string> = {
  unavailable: 'Browser saving unavailable',
  local: 'Saved in browser · syncing',
  saving: 'Saving…',
  saved: 'Saved',
  clean: 'All changes saved',
};

interface QuestionCardProps {
  question: PracticeQuestion;
  answer: AssessmentAnswer;
  conceptTitle?: string;
  index: number;
  count: number;
  saveState: SaveState;
  disabled?: boolean;
  submitLabel: string;
  onChange: (answer: AssessmentAnswer) => void;
  onBack: () => void;
  onNext: (skip: boolean) => void;
}

/** One question at a time, driven entirely by the session's assessment attempt. */
export function QuestionCard({ question, answer, conceptTitle, index, count, saveState, disabled = false, submitLabel, onChange, onBack, onNext }: QuestionCardProps) {
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { field.current?.focus({ preventScroll: true }); }, [question.id]);
  const last = index === count - 1;
  const canContinue = answer.skipped || Boolean(answer.text.trim() || answer.working.trim());

  return <section className="qcard card" aria-labelledby="question-prompt"
    onKeyDown={(event) => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && canContinue && !disabled) { event.preventDefault(); onNext(false); } }}>
    <div className="qcard-top">
      <div className="qcard-progress" role="progressbar" aria-label="Question progress" aria-valuemin={1} aria-valuemax={count} aria-valuenow={index + 1} aria-valuetext={`Question ${index + 1} of ${count}`}>
        {Array.from({ length: count }, (_, step) => <span key={step} className={step < index ? 'is-done' : step === index ? 'is-current' : ''} />)}
      </div>
      <span className={`save-status save-status--${saveState}`} role="status">{saveState === 'saving' ? <span className="spinner" aria-hidden="true" /> : saveState === 'local' || saveState === 'unavailable' ? <span className="dot dot--warning" aria-hidden="true" /> : <PracticeIcon name="check" size={13} strokeWidth={2} />}{SAVE_LABELS[saveState]}</span>
    </div>

    <div className="qcard-body enter" key={question.id}>
      <div className="qcard-meta"><span className="qcard-count mono">Question {index + 1} of {count}</span>{conceptTitle && <span className="chip chip--concept"><PracticeIcon name="target" size={13} />{conceptTitle}</span>}</div>
      <h2 id="question-prompt" className="qcard-prompt">{question.prompt}</h2>
      <p className="qcard-hint">Use your own words. It’s fine if you don’t remember everything.</p>

      <div className="field">
        <label className="field-label" htmlFor="answer">Your answer</label>
        <textarea ref={field} id="answer" className="textarea qcard-answer" rows={6} maxLength={PRACTICE_LIMITS.answer} value={answer.text} disabled={disabled}
          onChange={(event) => onChange({ ...answer, text: event.target.value, skipped: false })} placeholder="Here’s how I understand it…" />
      </div>

      {question.supportsWorking && <details className="qcard-working" key={`working-${question.id}`} open={answer.working ? true : undefined}>
        <summary><PracticeIcon name="chevron" size={14} />Show your working <span className="optional">optional</span></summary>
        <div className="field"><label className="sr-only" htmlFor="working">Reasoning, calculations, or rough notes</label>
          <textarea id="working" className="textarea qcard-working-field" rows={4} maxLength={PRACTICE_LIMITS.working} value={answer.working} disabled={disabled}
            onChange={(event) => onChange({ ...answer, working: event.target.value, skipped: false })} placeholder="Reasoning, calculations, rough notes…" /></div>
      </details>}

      <label className={`unsure-toggle ${answer.uncertain ? 'is-on' : ''}`}>
        <input type="checkbox" checked={answer.uncertain} disabled={disabled} onChange={(event) => onChange({ ...answer, uncertain: event.target.checked })} />
        <span className="unsure-switch" aria-hidden="true" /><span><strong>I’m not sure yet</strong><span>No penalty for being honest.</span></span>
      </label>

      {answer.skipped && <p className="notice" role="status"><PracticeIcon name="info" size={16} />This question is marked skipped. Typing an answer clears the skip.</p>}
    </div>

    <footer className="qcard-actions">
      <Button variant="quiet" onClick={onBack} disabled={disabled || index === 0}><PracticeIcon name="back" size={16} />Back</Button>
      <div className="qcard-actions-end">
        <Button variant="quiet" onClick={() => onNext(true)} disabled={disabled}>Skip</Button>
        <Button onClick={() => onNext(false)} disabled={disabled || !canContinue}>{last ? submitLabel : 'Next question'}<PracticeIcon name={last ? 'check' : 'arrow'} size={16} /></Button>
      </div>
    </footer>
  </section>;
}
