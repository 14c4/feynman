import { useEffect, useRef } from 'react';
import '../insights/insights.css';
import type { AssessmentAnswer, ConfidenceLevel, PracticeQuestion } from '../../../shared/types';
import { CONFIDENCE_LABELS } from '../../../shared/insights';
import { PRACTICE_LIMITS } from '../../../shared/types';
import { Button } from '../../components/Button';
import { DictationButton } from '../../components/DictationButton';
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
        <div className="dictate-wrap">
          <textarea ref={field} id="answer" className="textarea qcard-answer" rows={6} maxLength={PRACTICE_LIMITS.answer} value={answer.text} disabled={disabled}
            onChange={(event) => onChange({ ...answer, text: event.target.value, skipped: false })} placeholder="Here’s how I understand it…" />
          <DictationButton value={answer.text} maxLength={PRACTICE_LIMITS.answer} disabled={disabled} label="answer" onChange={(text) => onChange({ ...answer, text, skipped: false })} />
        </div>
      </div>

      {question.supportsWorking && <details className="qcard-working" key={`working-${question.id}`} open={answer.working ? true : undefined}>
        <summary><PracticeIcon name="chevron" size={14} />Show your working <span className="optional">optional</span></summary>
        <div className="field"><label className="sr-only" htmlFor="working">Reasoning, calculations, or rough notes</label>
          <div className="dictate-wrap">
            <textarea id="working" className="textarea qcard-working-field" rows={4} maxLength={PRACTICE_LIMITS.working} value={answer.working} disabled={disabled}
              onChange={(event) => onChange({ ...answer, working: event.target.value, skipped: false })} placeholder="Reasoning, calculations, rough notes…" />
            <DictationButton value={answer.working ?? ''} maxLength={PRACTICE_LIMITS.working} disabled={disabled} label="working" onChange={(working) => onChange({ ...answer, working, skipped: false })} />
          </div></div>
      </details>}

      <fieldset className="confidence" disabled={disabled}>
        <legend>How sure are you?</legend>
        <div className="confidence-options">{(['low', 'medium', 'high'] as ConfidenceLevel[]).map((level) => <button key={level} type="button"
          className={`confidence-option confidence-option--${level}`} aria-pressed={answer.confidence === level}
          onClick={() => onChange(answer.confidence === level
            ? { ...answer, confidence: undefined, confidenceAt: undefined, uncertain: false }
            : { ...answer, confidence: level, confidenceAt: new Date().toISOString(), uncertain: level === 'low' })}>
          <span className="confidence-meter" aria-hidden="true">{[0, 1, 2].map((bar) => <i key={bar} className={bar <= ['low', 'medium', 'high'].indexOf(level) ? 'is-on' : ''} />)}</span>{CONFIDENCE_LABELS[level]}</button>)}</div>
      </fieldset>

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
