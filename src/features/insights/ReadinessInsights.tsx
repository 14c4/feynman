import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { PracticeSession, QuestionGrade, TimelinePhase } from '../../../shared/types';
import {
  buildTimeline, calibrationSummary, CONFIDENCE_LABELS, conceptJourneys, PHASE_LABELS, phaseAt, phaseReadings, readingsNear,
  type AnswerMoment, type ConceptJourney, type SessionTimeline, type TimelineItem,
} from '../../../shared/insights';
import { PracticeIcon } from '../../components/practice/PracticeIcon';
import { PURPOSE_LABELS } from './monitoringContext';
import './insights.css';

/* ---------- formatting ---------- */

const elapsed = (ms: number) => {
  const total = Math.max(0, Math.round(ms / 1000)); const h = Math.floor(total / 3600); const m = Math.floor((total % 3600) / 60); const s = total % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
};
const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
const clip = (text: string, max = 220) => text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
const scoreTone = (grade?: QuestionGrade, skipped = false) => skipped ? 'skipped' : !grade ? 'none' : grade.score === grade.maxScore ? 'full' : grade.score > 0 ? 'partial' : 'zero';
const SCORE_WORDS = { full: 'Correct', partial: 'Partly correct', zero: 'Incorrect', skipped: 'Skipped', none: 'Not graded' } as const;

function Dots({ grade }: { grade?: QuestionGrade }) {
  if (!grade) return <span className="score-dots score-dots--empty" aria-label="Not graded">—</span>;
  return <span className="score-dots" aria-label={`${grade.score} of ${grade.maxScore}`}>{Array.from({ length: grade.maxScore }, (_, step) => <i key={step} className={step < grade.score ? 'is-on' : ''} />)}</span>;
}

function ConfidenceChip({ moment }: { moment?: AnswerMoment }) {
  if (!moment || moment.skipped) return null;
  if (!moment.confidence) return <span className="conf-chip conf-chip--none">No rating</span>;
  const level = ['low', 'medium', 'high'].indexOf(moment.confidence);
  return <span className={`conf-chip conf-chip--${moment.confidence}`}><span className="confidence-meter" aria-hidden="true">{[0, 1, 2].map((bar) => <i key={bar} className={bar <= level ? 'is-on' : ''} />)}</span>{CONFIDENCE_LABELS[moment.confidence]}</span>;
}

function CalibrationTag({ moment }: { moment?: AnswerMoment }) {
  if (!moment || !moment.grade || !moment.confidence || moment.skipped) return null;
  const kind = moment.calibration.kind;
  return <span className={`calib-tag calib-tag--${kind}`}>{kind === 'calibrated' ? <PracticeIcon name="check" size={12} strokeWidth={2} /> : <PracticeIcon name="alert" size={12} />}{moment.calibration.label}</span>;
}

/* ---------- time scale ---------- */

/**
 * Piecewise time scale: each learning phase gets a share of the width proportional to the square
 * root of its duration (minimum 8%), so a long pause never squeezes a 40-second assessment into a
 * sliver. Within a phase, time stays linear, and every mark is placed by its real timestamp.
 */
function makeScale(timeline: SessionTimeline, x0: number, x1: number) {
  const spans = timeline.phases.length ? timeline.phases : [{ phase: 'preparation' as TimelinePhase, start: timeline.start, end: timeline.end }];
  const durations = spans.map((span, index) => Math.max(1, (index === spans.length - 1 ? Math.max(span.end, timeline.end) : span.end) - span.start));
  const weights = durations.map((duration) => Math.sqrt(duration));
  const sum = weights.reduce((total, weight) => total + weight, 0);
  let shares = weights.map((weight) => Math.max(0.08, weight / sum));
  const norm = shares.reduce((total, share) => total + share, 0); shares = shares.map((share) => share / norm);
  const offsets = shares.map((_, index) => shares.slice(0, index).reduce((total, share) => total + share, 0));
  const width = x1 - x0;
  const x = (t: number) => {
    let index = spans.findIndex((span, i) => t < span.start + durations[i]!);
    if (index < 0) index = spans.length - 1;
    if (t < spans[0]!.start) return x0;
    const fraction = Math.min(1, Math.max(0, (t - spans[index]!.start) / durations[index]!));
    return x0 + (offsets[index]! + shares[index]! * fraction) * width;
  };
  return { x, bands: spans.map((span, index) => ({ phase: span.phase, start: span.start, x: x0 + offsets[index]! * width, w: shares[index]! * width })) };
}

/* ---------- selection & details ---------- */

type Selectable = Exclude<TimelineItem, { type: 'lifecycle' }>;

function itemLabel(item: Selectable): string {
  switch (item.type) {
    case 'answer': return item.answer.revised
      ? `${item.answer.kind === 'baseline' ? 'First check' : 'Follow-up'}: first try, changed later${item.answer.confidence ? ` (${CONFIDENCE_LABELS[item.answer.confidence].toLowerCase()})` : ''}`
      : `${item.answer.kind === 'baseline' ? 'First check' : 'Follow-up'} answer: ${item.answer.skipped ? 'skipped' : SCORE_WORDS[scoreTone(item.answer.grade)]}${item.answer.confidence ? `, ${CONFIDENCE_LABELS[item.answer.confidence].toLowerCase()}` : ''}`;
    case 'assessment': return `${item.kind === 'baseline' ? 'First check' : 'Follow-up check'} ${item.edge}${item.score !== undefined ? ` · ${item.score}/${item.maxScore}` : ''}`;
    case 'conversation': return `${item.channel === 'voice' ? 'Voice' : 'Text'} conversation ${item.edge}`;
    case 'message': return item.role === 'student' ? (item.question ? 'Alex asked a question' : 'Alex replied') : 'You explained';
    case 'nervousness': return `Nervousness self-report ${item.when}: ${item.value}/5`;
    case 'monitoring': return `${item.window.purpose === 'in_session' ? 'Camera insights' : 'Camera check-in'} ${item.edge}${item.window.source === 'simulated' ? ' (simulated)' : ''}`;
    case 'quality': return `Camera quality: ${item.note.code === 'OK' ? 'signal OK' : item.note.hint || item.note.code.toLowerCase().replaceAll('_', ' ')}`;
  }
}

function Details({ item, session, timeline, onSelect }: { item: Selectable; session: PracticeSession; timeline: SessionTimeline; onSelect: (id: string) => void }) {
  const near = readingsNear(timeline, item.at);
  const phase = phaseAt(timeline.phases, item.at);
  const concept = (id: string) => session.concepts.find((entry) => entry.id === id)?.title ?? 'Concept';
  const grade = item.type === 'answer' ? item.answer.grade : undefined;
  const counterpart = item.type === 'answer' ? [...timeline.items].reverse().find((other): other is Extract<TimelineItem, { type: 'answer' }> => other.type === 'answer' && other.answer.conceptId === item.answer.conceptId && other.answer.kind !== item.answer.kind && !other.answer.revised) : undefined;
  return <div className="tl-detail enter" key={item.id} aria-live="polite">
    <div className="tl-detail-meta"><span className="mono">{elapsed(item.at - timeline.start)}</span><span>{clock(item.at)}</span>{phase && <span className={`phase-pill phase-pill--${phase}`}>{PHASE_LABELS[phase]}</span>}</div>
    {item.type === 'answer' ? <>
      <div className="tl-detail-head"><span className="chip chip--concept"><PracticeIcon name="target" size={12} />{concept(item.answer.conceptId)}</span><ConfidenceChip moment={item.answer} />{grade && <Dots grade={grade} />}<CalibrationTag moment={item.answer} /></div>
      <h4>{item.answer.prompt}</h4>
      {item.answer.revised ? <p className="muted small">You visited this question here and changed your answer later; the graded answer is the later one.</p>
        : <p className="tl-answer">{item.answer.skipped ? <em>Skipped</em> : item.answer.text ? clip(item.answer.text, 400) : <em>No typed answer</em>}</p>}
      {grade?.feedback && <p className="review-feedback">{grade.feedback}</p>}
      {counterpart && <button type="button" className="tl-link" onClick={() => onSelect(counterpart.id)}><PracticeIcon name={counterpart.answer.kind === 'recheck' ? 'arrow' : 'back'} size={14} />
        {counterpart.answer.kind === 'recheck' ? 'Matched follow-up' : 'Matched first-check'} answer: {SCORE_WORDS[scoreTone(counterpart.answer.grade, counterpart.answer.skipped)].toLowerCase()}{counterpart.answer.confidence ? `, ${CONFIDENCE_LABELS[counterpart.answer.confidence].toLowerCase()}` : ''}</button>}
    </> : item.type === 'message' ? <>
      <div className="tl-detail-head"><strong>{item.role === 'student' ? 'Alex' : 'You'}</strong>{item.conceptIds.map((id) => <span key={id} className="chip chip--concept"><PracticeIcon name="target" size={12} />{concept(id)}</span>)}</div>
      <p className="tl-answer">“{clip(item.text, 360)}”</p>
      {item.conceptIds.length > 0 && <p className="muted small">Tagged because the message names the concept, not a judgement of the explanation.</p>}
    </> : item.type === 'conversation' ? <p>{item.channel === 'voice' ? 'Voice' : 'Text'} conversation with Alex {item.edge}. {item.edge === 'ended' && item.transcriptStatus !== 'ready' ? 'The transcript was not available, so its turns are not on the timeline.' : ''}</p>
      : item.type === 'nervousness' ? <p>You rated how nervous you felt {item.when === 'before' ? 'before the first check' : 'after the follow-up'}: <strong className="mono">{item.value}/5</strong>. A self-report for your own reflection.</p>
      : item.type === 'monitoring' ? <p>{PURPOSE_LABELS[item.window.purpose]} · camera {item.edge}. {item.edge === 'ended' && item.window.endReason ? item.window.endReason : ''} {item.edge === 'ended' ? `${item.window.samples.filter((sample) => sample.valid).length} reliable of ${item.window.samples.length} readings.` : ''}{item.edge === 'ended' && item.window.pipeline?.captureFps ? ` Camera measured at ${Math.round(item.window.pipeline.captureFps)} fps${item.window.pipeline.processedFps ? `; Presage processed ${Math.round(item.window.pipeline.processedFps)} fps` : ''}.` : ''}</p>
      : item.type === 'quality' ? <p>{item.note.code === 'OK' ? 'The camera signal became usable again.' : <>Signal quality changed: <strong>{item.note.hint || item.note.code}</strong>. Readings during poor signal are not plotted.</>}</p>
      : <p>{itemLabel(item)}.</p>}
    {(near.pulse || near.breathing) ? <p className="tl-near small"><PracticeIcon name="heart" size={12} />Within 20 s of this moment{timeline.simulated ? ' (simulated)' : ''}: {near.pulse && <>pulse <span className="mono">{near.pulse.min === near.pulse.max ? near.pulse.mean : `${near.pulse.min}–${near.pulse.max}`} bpm</span></>}{near.pulse && near.breathing && ' · '}{near.breathing && <>breathing <span className="mono">{near.breathing.min === near.breathing.max ? near.breathing.mean : `${near.breathing.min}–${near.breathing.max}`} /min</span></>}</p>
      : timeline.windows.length > 0 && <p className="tl-near tl-near--none small">No reliable camera reading near this moment.</p>}
  </div>;
}

/* ---------- chart ---------- */

const LANE = { phases: 0, knowledge: 34, teach: 132, pulse: 182, breathing: 262, axis: 330 } as const;
const CONF_Y: Record<string, number> = { high: LANE.knowledge + 14, medium: LANE.knowledge + 40, low: LANE.knowledge + 66, none: LANE.knowledge + 84 };
const PAD_L = 92; const PAD_R = 16;

/** Fits a phase name into its band: full name, first word, or nothing (the tooltip keeps it). */
function bandLabel(label: string, width: number) {
  const fits = (text: string) => text.length * 6.8 + 14 <= width;
  if (fits(label)) return label;
  const first = label.split(' ')[0]!;
  return fits(first) ? first : '';
}

function linePath(points: { x: number; y: number; t: number }[], gapMs = 6000) {
  let d = ''; let previous: { t: number } | undefined;
  for (const point of points) { d += `${!previous || point.t - previous.t > gapMs ? 'M' : 'L'}${point.x.toFixed(1)},${point.y.toFixed(1)}`; previous = point; }
  return d;
}

function TimelineChart({ timeline, selected, onSelect, width }: { timeline: SessionTimeline; selected?: string; onSelect: (id: string) => void; width: number }) {
  const { x, bands } = makeScale(timeline, PAD_L, width - PAD_R);
  const selectedItem = timeline.items.find((item) => item.id === selected);
  const hasCamera = timeline.windows.length > 0;
  const plot = (metric: 'pulse' | 'breathing', top: number, height: number) => {
    const valid = timeline.samples[metric].filter((sample) => sample.valid);
    const invalid = timeline.samples[metric].filter((sample) => !sample.valid);
    if (!valid.length) return { valid, invalid, path: '', ticks: [] as { y: number; label: string }[], y: () => top + height / 2 };
    const values = valid.map((sample) => sample.value);
    let low = Math.floor(Math.min(...values)); let high = Math.ceil(Math.max(...values));
    const span = metric === 'pulse' ? 10 : 4; if (high - low < span) { const mid = (high + low) / 2; low = Math.floor(mid - span / 2); high = Math.ceil(mid + span / 2); }
    const y = (value: number) => top + height - ((value - low) / (high - low)) * height;
    return { valid, invalid, path: linePath(valid.map((sample) => ({ x: x(sample.t), y: y(sample.value), t: sample.t }))), ticks: [{ y: y(high), label: String(high) }, { y: y(low), label: String(low) }], y };
  };
  const pulse = plot('pulse', LANE.pulse + 8, 52); const breathing = plot('breathing', LANE.breathing + 8, 44);
  const key = (event: KeyboardEvent, id: string) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(id); } };
  const conversations = timeline.items.filter((item): item is Extract<TimelineItem, { type: 'conversation' }> => item.type === 'conversation' && item.edge === 'started');
  const axisTicks = bands.map((band) => ({ x: band.x, label: elapsed(band.start - timeline.start) }));

  return <svg className="tl-chart" width={width} height={LANE.axis + 22} role="group" aria-label="Session timeline chart">
    {/* phase bands */}
    {bands.map((band) => <g key={band.phase} className={`tl-band tl-band--${band.phase}`}>
      <rect x={band.x} y={LANE.knowledge - 6} width={band.w} height={LANE.axis - LANE.knowledge + 6} />
      <line x1={band.x} x2={band.x} y1={LANE.phases + 4} y2={LANE.axis} />
      <text x={band.x + 8} y={LANE.phases + 18} className="tl-band-label">{bandLabel(PHASE_LABELS[band.phase], band.w)}<title>{PHASE_LABELS[band.phase]}</title></text>
    </g>)}

    {/* lane labels */}
    <g className="tl-lane-labels">
      <text x={8} y={CONF_Y.high! + 4}>Confident</text><text x={8} y={CONF_Y.medium! + 4}>Somewhat</text><text x={8} y={CONF_Y.low! + 4}>Guessing</text><text x={8} y={CONF_Y.none! + 4} className="is-faint">No rating</text>
      <text x={8} y={LANE.teach + 18}>With Alex</text>
      <text x={8} y={LANE.pulse + 22}>Pulse</text><text x={8} y={LANE.pulse + 36} className="is-faint">bpm</text>
      <text x={8} y={LANE.breathing + 22}>Breathing</text><text x={8} y={LANE.breathing + 36} className="is-faint">per min</text>
    </g>
    {[CONF_Y.high, CONF_Y.medium, CONF_Y.low].map((y) => <line key={y} className="tl-grid" x1={PAD_L} x2={width - PAD_R} y1={y} y2={y} />)}

    {/* camera windows */}
    {timeline.windows.map((window) => { const start = Date.parse(window.startedAt); const end = window.endedAt ? Date.parse(window.endedAt) : timeline.end; return <rect key={window.id} className={`tl-window ${window.source === 'simulated' ? 'tl-window--sim' : ''}`} x={x(start)} y={LANE.pulse} width={Math.max(2, x(end) - x(start))} height={LANE.axis - LANE.pulse - 8} />; })}
    {!hasCamera && <text className="tl-empty" x={PAD_L + 8} y={LANE.pulse + 48}>Camera insights were off for this session. Your learning timeline is complete without them.</text>}
    {hasCamera && !pulse.valid.length && <text className="tl-empty" x={PAD_L + 8} y={LANE.pulse + 36}>No pulse readings were reliable enough to plot.</text>}
    {hasCamera && !breathing.valid.length && <text className="tl-empty" x={PAD_L + 8} y={LANE.breathing + 32}>No breathing readings were reliable enough to plot.</text>}
    {[pulse, breathing].map((series, index) => <g key={index} className={`tl-series tl-series--${index ? 'breathing' : 'pulse'}`}>
      {series.ticks.map((tick) => <text key={tick.label + tick.y} className="tl-tick" x={PAD_L - 6} y={tick.y + 3} textAnchor="end">{tick.label}</text>)}
      {series.invalid.map((sample) => <circle key={`i${sample.t}`} className="tl-invalid" cx={x(sample.t)} cy={(index ? LANE.breathing : LANE.pulse) + (index ? 60 : 66)} r={1.6} />)}
      {series.path && <path d={series.path} />}
    </g>)}

    {/* teaching conversations and Alex's questions */}
    {conversations.map((item) => { const end = timeline.items.find((other) => other.type === 'conversation' && other.conversationId === item.conversationId && other.edge === 'ended')?.at ?? timeline.end; return <g key={item.id} className="tl-convo" role="button" tabIndex={0} aria-label={itemLabel(item)} onClick={() => onSelect(item.id)} onKeyDown={(event) => key(event, item.id)}>
      <rect x={x(item.at)} y={LANE.teach + 6} width={Math.max(6, x(end) - x(item.at))} height={18} rx={9} className={selected === item.id ? 'is-selected' : ''} />
    </g>; })}
    {timeline.items.filter((item): item is Extract<TimelineItem, { type: 'message' }> => item.type === 'message').map((item) => item.role === 'student' && item.question
      ? <g key={item.id} className={`tl-ask ${selected === item.id ? 'is-selected' : ''}`} role="button" tabIndex={0} aria-label={`${itemLabel(item)}: ${clip(item.text, 80)}`} onClick={() => onSelect(item.id)} onKeyDown={(event) => key(event, item.id)} onMouseEnter={() => onSelect(item.id)}>
        <rect x={x(item.at) - 5} y={LANE.teach + 10} width={10} height={10} transform={`rotate(45 ${x(item.at)} ${LANE.teach + 15})`} />
      </g>
      : item.role === 'learner' ? <line key={item.id} className="tl-turn" x1={x(item.at)} x2={x(item.at)} y1={LANE.teach + 9} y2={LANE.teach + 21} /> : null)}

    {/* assessment edges and self-reports */}
    {timeline.items.filter((item) => item.type === 'assessment' && item.edge !== 'graded').map((item) => <line key={item.id} className="tl-edge" x1={x(item.at)} x2={x(item.at)} y1={LANE.knowledge} y2={LANE.knowledge + 92} />)}
    {timeline.items.filter((item): item is Extract<TimelineItem, { type: 'nervousness' }> => item.type === 'nervousness').map((item) => <g key={item.id} className={`tl-self ${selected === item.id ? 'is-selected' : ''}`} role="button" tabIndex={0} aria-label={itemLabel(item)} onClick={() => onSelect(item.id)} onKeyDown={(event) => key(event, item.id)} onMouseEnter={() => onSelect(item.id)}>
      <circle cx={x(item.at)} cy={LANE.teach + 15} r={8} /><text x={x(item.at)} y={LANE.teach + 19} textAnchor="middle">{item.value}</text>
    </g>)}
    {timeline.items.filter((item): item is Extract<TimelineItem, { type: 'quality' }> => item.type === 'quality' && item.note.code !== 'OK').map((item) => <g key={item.id} className={`tl-quality ${selected === item.id ? 'is-selected' : ''}`} role="button" tabIndex={0} aria-label={itemLabel(item)} onClick={() => onSelect(item.id)} onKeyDown={(event) => key(event, item.id)} onMouseEnter={() => onSelect(item.id)}>
      <path d={`M${x(item.at)},${LANE.axis - 14} l5,9 h-10 z`} />
    </g>)}

    {/* answers: height = stated confidence, colour = graded result, halo = mismatch */}
    {timeline.answers.map((moment) => {
      const item = timeline.items.find((entry): entry is Extract<TimelineItem, { type: 'answer' }> => entry.type === 'answer' && entry.answer === moment)!;
      const cx = x(item.at); const cy = CONF_Y[moment.confidence ?? 'none']!; const tone = scoreTone(moment.grade, moment.skipped);
      return <g key={item.id} className={`tl-answer-mark tl-answer-mark--${tone} ${moment.kind === 'recheck' ? 'is-recheck' : ''} ${moment.revised ? 'is-revised' : ''} ${selected === item.id ? 'is-selected' : ''}`}
        role="button" tabIndex={0} aria-label={itemLabel(item)} onClick={() => onSelect(item.id)} onKeyDown={(event) => key(event, item.id)} onMouseEnter={() => onSelect(item.id)}>
        {moment.calibration.mismatch && !moment.revised && <circle className="tl-halo" cx={cx} cy={cy} r={14} />}
        {moment.kind === 'recheck' ? <rect x={cx - 8} y={cy - 8} width={16} height={16} rx={4} /> : <circle cx={cx} cy={cy} r={8} />}
      </g>;
    })}

    {/* selection guide */}
    {selectedItem && <line className="tl-guide" x1={x(selectedItem.at)} x2={x(selectedItem.at)} y1={LANE.knowledge - 6} y2={LANE.axis} />}

    {/* axis */}
    <line className="tl-axis" x1={PAD_L} x2={width - PAD_R} y1={LANE.axis} y2={LANE.axis} />
    {axisTicks.map((tick) => <text key={tick.x} className="tl-tick" x={tick.x + 2} y={LANE.axis + 15}>{tick.label}</text>)}
  </svg>;
}

/* ---------- list alternative (mobile and screen readers) ---------- */

function TimelineList({ timeline, selected, onSelect, session }: { timeline: SessionTimeline; selected?: string; onSelect: (id: string) => void; session: PracticeSession }) {
  const shown = timeline.items.filter((item): item is Selectable => item.type !== 'lifecycle' && !(item.type === 'message' && !(item.role === 'student' && item.question)) && !(item.type === 'assessment' && item.edge === 'submitted') && !(item.type === 'quality' && item.note.code === 'OK'));
  const groups = timeline.phases.map((span) => ({ span, items: shown.filter((item) => phaseAt(timeline.phases, item.at) === span.phase) })).filter((group) => group.items.length);
  return <div className="tl-list">{groups.map(({ span, items }) => <section key={span.phase} className={`tl-list-phase tl-list-phase--${span.phase}`}>
    <h4><span className={`phase-pill phase-pill--${span.phase}`}>{PHASE_LABELS[span.phase]}</span><span className="mono muted">{elapsed(span.start - timeline.start)}</span></h4>
    <ol>{items.map((item) => <li key={item.id}>
      <button type="button" className={`tl-list-item ${selected === item.id ? 'is-selected' : ''} ${item.type === 'answer' && item.answer.calibration.mismatch && !item.answer.revised ? 'is-mismatch' : ''}`} aria-expanded={selected === item.id} onClick={() => onSelect(item.id)}>
        <span className={`tl-list-icon tl-list-icon--${item.type === 'answer' ? scoreTone(item.answer.grade, item.answer.skipped) : item.type}`} aria-hidden="true" />
        <span className="tl-list-text">{itemLabel(item)}{item.type === 'answer' && <small>{session.concepts.find((concept) => concept.id === item.answer.conceptId)?.title}</small>}</span>
        <span className="mono muted small">{elapsed(item.at - timeline.start)}</span>
      </button>
      {selected === item.id && <Details item={item} session={session} timeline={timeline} onSelect={onSelect} />}
    </li>)}</ol>
  </section>)}</div>;
}

/* ---------- concept journeys ---------- */

const OUTCOME = (journey: ConceptJourney) => {
  const before = journey.baselineGrade; const after = journey.recheckGrade;
  if (!after) return { key: 'unchecked', label: 'Not rechecked' };
  if (before && after.score > before.score) return { key: 'improved', label: 'Improved' };
  if (before && after.score < before.score) return { key: 'lower', label: 'Lower this time' };
  if (after.score === after.maxScore) return { key: 'solid', label: 'Solid both times' };
  return { key: 'practice', label: 'Needs more practice' };
};

function JourneyCard({ journey, timeline, onSelect, hadConversation }: { journey: ConceptJourney; timeline: SessionTimeline; onSelect: (id: string) => void; hadConversation: boolean }) {
  const outcome = OUTCOME(journey);
  const idOf = (moment?: AnswerMoment) => moment && timeline.items.find((item) => item.type === 'answer' && item.answer === moment)?.id;
  const firstMention = journey.mentions.firstAt !== undefined ? timeline.items.find((item) => item.type === 'message' && item.at === journey.mentions.firstAt && item.conceptIds.includes(journey.concept.id))?.id : undefined;
  const step = (label: string, moment?: AnswerMoment, grade?: QuestionGrade) => {
    const id = idOf(moment);
    const body = <><small>{label}</small><span className="journey-score"><Dots grade={grade} /><span className="small">{SCORE_WORDS[scoreTone(grade, moment?.skipped)]}</span></span><ConfidenceChip moment={moment} /><CalibrationTag moment={moment} /></>;
    return id ? <button type="button" className="journey-step" onClick={() => onSelect(id)}>{body}</button> : <div className="journey-step">{body}</div>;
  };
  const talk = journey.mentions.learner + journey.mentions.alexQuestions;
  return <li className={`journey card concept-result--${outcome.key}`}>
    <div className="concept-result-head"><strong>{journey.concept.title}</strong><span className={`outcome outcome--${outcome.key}`}>{outcome.key === 'improved' && <PracticeIcon name="trend" size={13} strokeWidth={2} />}{outcome.label}</span></div>
    <div className="journey-steps">
      {step('First check', journey.baseline, journey.baselineGrade)}
      <span className="journey-link" aria-hidden="true" />
      {firstMention ? <button type="button" className="journey-step journey-step--alex" onClick={() => onSelect(firstMention)}><small>With Alex</small><span className="small">{journey.mentions.learner ? `You named it ${journey.mentions.learner}×` : 'You didn’t name it'}{journey.mentions.alexQuestions ? ` · Alex asked ${journey.mentions.alexQuestions} question${journey.mentions.alexQuestions === 1 ? '' : 's'}` : ''}</span>{journey.focus && <span className="focus-tag">Focus concept</span>}</button>
        : <div className="journey-step journey-step--alex"><small>With Alex</small><span className="small muted">{!hadConversation ? 'No conversation was recorded' : talk ? '' : 'Not named in the saved transcript'}</span>{journey.focus && <span className="focus-tag">Focus concept</span>}</div>}
      <span className="journey-link" aria-hidden="true" />
      {step('Follow-up', journey.recheck, journey.recheckGrade)}
    </div>
    {journey.recheckGrade?.feedback && <p className="journey-feedback">{journey.recheckGrade.feedback}</p>}
  </li>;
}

/* ---------- at a glance ---------- */

function Glance({ session, timeline, journeys }: { session: PracticeSession; timeline: SessionTimeline; journeys: ConceptJourney[] }) {
  const before = calibrationSummary(journeys.map((journey) => journey.baseline));
  const after = calibrationSummary(journeys.map((journey) => journey.recheck));
  const phases = phaseReadings(timeline);
  const pulseOf = (phase: TimelinePhase) => phases.find((entry) => entry.phase === phase)?.pulse.mean;
  const firstPulse = pulseOf('preparation') ?? pulseOf('baseline'); const lastPulse = pulseOf('results') ?? pulseOf('recheck');
  const rate = (summary: typeof before) => summary.rated ? `${summary.calibrated}/${summary.rated}` : '—';
  return <div className="glance">
    <div className="glance-item"><small>Confidence matched result</small><strong className="mono">{rate(before)} <PracticeIcon name="arrow" size={13} /> {rate(after)}</strong><span className="small muted">{before.rated || after.rated ? 'rated answers, first check → follow-up' : 'No confidence ratings were given'}</span></div>
    <div className="glance-item"><small>Confident but incorrect</small><strong className="mono">{before.confidentIncorrect} <PracticeIcon name="arrow" size={13} /> {after.confidentIncorrect}</strong><span className="small muted">Correct but unsure: {before.correctUnsure} → {after.correctUnsure}</span></div>
    <div className="glance-item"><small>Nervousness self-report</small><strong className="mono">{session.nervousnessBefore ?? '—'} <PracticeIcon name="arrow" size={13} /> {session.nervousnessAfter ?? '—'}</strong><span className="small muted">out of 5 · optional reflection</span></div>
    <div className="glance-item"><small>Average pulse{timeline.simulated ? ' · simulated' : ''}</small><strong className="mono">{firstPulse ?? '—'} <PracticeIcon name="arrow" size={13} /> {lastPulse ?? '—'}</strong><span className="small muted">{timeline.windows.length ? 'reliable readings, start → end' : 'Camera insights not used'}</span></div>
  </div>;
}

/* ---------- section ---------- */

export function ReadinessInsights({ session }: { session: PracticeSession }) {
  const timeline = useMemo(() => buildTimeline(session), [session]);
  const journeys = useMemo(() => conceptJourneys(session, timeline), [session, timeline]);
  const notable = timeline.answers.filter((moment) => !moment.revised && (moment.calibration.kind === 'confident_incorrect' || moment.calibration.kind === 'correct_unsure'));
  const firstNotable = notable[0] && timeline.items.find((item) => item.type === 'answer' && item.answer === notable[0])?.id;
  const [selected, setSelected] = useState<string | undefined>(firstNotable);
  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [view, setView] = useState<'chart' | 'list'>(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 720px)').matches ? 'list' : 'chart');
  useEffect(() => {
    const element = frame.current; if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry!.contentRect.width)));
    observer.observe(element); return () => observer.disconnect();
  }, [view]);
  const selectedItem = timeline.items.find((item): item is Selectable => item.id === selected && item.type !== 'lifecycle');
  const hadConversation = session.cycles.some((cycle) => cycle.conversations.length > 0);
  const answersTimed = timeline.answers.length > 0;
  const simulated = timeline.simulated; const mock = session.providerMode === 'mock';

  return <section className="insights" aria-labelledby="insights-heading">
    <header className="insights-head">
      <div><span className="eyebrow"><PracticeIcon name="gauge" size={14} />Readiness insights</span><h2 id="insights-heading">Your session, moment by moment</h2>
        <p className="muted small">What you thought you knew, what you showed, how Alex pushed you, and what changed, on one timeline.</p></div>
      <div className="segmented" role="tablist" aria-label="Timeline view">
        <button type="button" role="tab" aria-selected={view === 'chart'} onClick={() => setView('chart')}><PracticeIcon name="trend" size={14} />Timeline</button>
        <button type="button" role="tab" aria-selected={view === 'list'} onClick={() => setView('list')}><PracticeIcon name="menu" size={14} />List</button>
      </div>
    </header>

    {(mock || simulated) && <p className="notice notice--warning small" role="note"><PracticeIcon name="info" size={14} />{[mock && 'DEV MOCK grades and scripted Alex messages', simulated && 'DEV SIMULATED physiology values (not measurements)'].filter(Boolean).join(' · ')} are shown on this timeline.</p>}

    <Glance session={session} timeline={timeline} journeys={journeys} />

    {notable.length > 0 && <div className="moments" role="group" aria-label="Moments where confidence and result differed">
      <span className="small muted">Worth a look:</span>
      {notable.map((moment) => { const id = timeline.items.find((item) => item.type === 'answer' && item.answer === moment)!.id; return <button type="button" key={id} className={`moment-chip calib-tag--${moment.calibration.kind} ${selected === id ? 'is-selected' : ''}`} onClick={() => setSelected(id)}>
        <PracticeIcon name="alert" size={12} />{moment.calibration.label} · {session.concepts.find((concept) => concept.id === moment.conceptId)?.title}{moment.kind === 'recheck' ? ' (follow-up)' : ''}</button>; })}
    </div>}

    <div className="tl card">
      {!answersTimed && <p className="muted small tl-legacy"><PracticeIcon name="info" size={14} />This session was recorded before answer timing was added, so only the stored timestamps (grading, conversations, readings) are shown.</p>}
      {view === 'chart' ? <>
        <div className="tl-frame" ref={frame}>{width > 0 && <TimelineChart timeline={timeline} selected={selected} onSelect={setSelected} width={Math.max(width, 640)} />}</div>
        <ul className="tl-legend small" aria-label="Legend">
          <li><i className="lg-dot lg-dot--full" />Correct</li><li><i className="lg-dot lg-dot--partial" />Partly correct</li><li><i className="lg-dot lg-dot--zero" />Incorrect</li><li><i className="lg-dot lg-dot--skipped" />Skipped</li>
          <li><i className="lg-shape lg-shape--circle" />First check</li><li><i className="lg-shape lg-shape--square" />Follow-up</li><li><i className="lg-halo" />Confidence and result differed</li><li><i className="lg-ask" />Alex asked</li>
          {timeline.windows.length > 0 && <li><i className="lg-window" />Camera on{simulated ? ' (simulated)' : ''}</li>}{timeline.windows.length > 0 && <li><i className="lg-quality" />Signal issue</li>}{timeline.windows.length > 0 && <li><i className="lg-invalid" />Unreliable reading (not plotted)</li>}
        </ul>
        {selectedItem ? <Details item={selectedItem} session={session} timeline={timeline} onSelect={setSelected} /> : <p className="tl-detail tl-detail--empty muted small">Hover or select any mark to see what happened at that moment.</p>}
      </> : <TimelineList timeline={timeline} selected={selected} onSelect={(id) => setSelected((current) => current === id ? undefined : id)} session={session} />}
      <p className="tl-footnote small muted">Answer height shows how sure you said you were; colour shows the grade. Camera readings are plotted only when Presage reported them reliable, and are shown alongside learning events for reflection. They don’t measure anxiety or confidence, and a change during a phase doesn’t mean that activity caused it.</p>
    </div>

    <section aria-labelledby="journeys-heading" className="results-section">
      <h3 id="journeys-heading">Concept by concept</h3>
      <ul className="journeys">{journeys.map((journey) => <JourneyCard key={journey.concept.id} journey={journey} timeline={timeline} hadConversation={hadConversation} onSelect={(id) => { setSelected(id); if (view === 'chart') frame.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }} />)}</ul>
    </section>
  </section>;
}
