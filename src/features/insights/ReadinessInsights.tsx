import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { PracticeSession, QuestionGrade, TimelinePhase } from '../../../shared/types';
import {
  buildTimeline, calibrationSummary, CONFIDENCE_LABELS, conceptJourneys, PHASE_LABELS, phaseAt, phaseReadings, readingsNear,
  type AnswerMoment, type ConceptJourney, type PhaseSpan, type SessionTimeline, type TimelineItem,
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
 * Piecewise time scale over the given phases. Every phase gets a readable share of the width (longer
 * phases get somewhat more, at most ~1.7× a short one), so a long phase never squeezes the others into
 * slivers. Within a phase, time is linear and every mark is placed by its real timestamp; anything
 * outside the shown phases is pinned to the nearest edge.
 */
function makeScale(spans: PhaseSpan[], x0: number, x1: number) {
  const durations = spans.map((span) => Math.max(1, span.end - span.start));
  const roots = durations.map((duration) => Math.sqrt(duration)); const maxRoot = Math.max(...roots);
  const weights = roots.map((root) => 0.6 + 0.4 * (root / maxRoot));
  const sum = weights.reduce((total, weight) => total + weight, 0);
  const shares = weights.map((weight) => weight / sum);
  const offsets = shares.map((_, index) => shares.slice(0, index).reduce((total, share) => total + share, 0));
  const width = x1 - x0;
  const x = (t: number) => {
    if (t < spans[0]!.start) return x0;
    let index = spans.findIndex((span, i) => t < span.start + durations[i]!);
    if (index < 0) index = spans.length - 1;
    const fraction = Math.min(1, Math.max(0, (t - spans[index]!.start) / durations[index]!));
    return x0 + (offsets[index]! + shares[index]! * fraction) * width;
  };
  return { x, bands: spans.map((span, index) => ({ phase: span.phase, start: span.start, duration: durations[index]!, x: x0 + offsets[index]! * width, w: shares[index]! * width })) };
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

/*
 * One row per concept, so each concept reads left to right: first check, what you said while teaching
 * Alex, then the follow-up. Below, a lane is drawn only when it has something to show: the conversation,
 * and reliable pulse and breathing readings. What's missing is said in words under the chart instead.
 */
const HEAD = 56;
const ROW = 70;
const LABEL_W = 176;
const PAD_L = LABEL_W + 44;
const PAD_R = 40;
const CONV_LANE = 52;
const BAR_H = 14;
const PULSE_LANE = 84;
const BREATH_LANE = 72;
const PLOT_PAD = 16;

/** Short phase names for the band headers; the full name stays in the tooltip. */
const BAND_NAMES: Record<TimelinePhase, string> = { preparation: 'Getting ready', baseline: 'First check', teaching: 'Teaching', recheck: 'Follow-up', results: 'Done' };

type AnswerItem = Extract<TimelineItem, { type: 'answer' }>;

const lasted = (ms: number) => { const s = Math.round(ms / 1000); if (s < 60) return `${s} s`; const m = Math.floor(s / 60); return s % 60 ? `${m} min ${s % 60} s` : `${m} min`; };

/** Fits a label into a band: full text, first word, or nothing (the tooltip keeps it). */
function bandLabel(label: string, width: number, charW = 7.2) {
  const fits = (text: string) => text.length * charW + 16 <= width;
  if (fits(label)) return label;
  const first = label.split(' ')[0]!;
  return fits(first) ? first : '';
}

function linePath(points: { x: number; y: number; t: number }[], gapMs = 6000) {
  let d = ''; let previous: { t: number } | undefined;
  for (const point of points) { d += `${!previous || point.t - previous.t > gapMs ? 'M' : 'L'}${point.x.toFixed(1)},${point.y.toFixed(1)}`; previous = point; }
  return d;
}

/** Wraps a concept title onto at most two lines that fit the label column. */
function wrapTitle(title: string, max = 22): string[] {
  const lines: string[] = []; let line = '';
  for (const word of title.split(/\s+/)) {
    if (!line) line = word;
    else if (`${line} ${word}`.length <= max) line = `${line} ${word}`;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  if (lines.length <= 2) return lines.map((text) => text.length > max ? `${text.slice(0, max - 1)}…` : text);
  return [lines[0]!, `${lines.slice(1).join(' ').slice(0, max - 1).trimEnd()}…`];
}

/** Which phases the chart spans: setup only when readings were taken then, and never the results screen. */
function chartSpans(timeline: SessionTimeline): PhaseSpan[] {
  const firstCheck = timeline.phases.find((span) => span.phase === 'baseline')?.start;
  const readings = [...timeline.samples.pulse, ...timeline.samples.breathing].filter((sample) => sample.valid);
  const setupReadings = firstCheck !== undefined && readings.some((sample) => sample.t < firstCheck);
  const spans = timeline.phases.filter((span) => span.phase !== 'results' && (span.phase !== 'preparation' || setupReadings));
  if (spans.length) return spans;
  return timeline.phases.length ? timeline.phases : [{ phase: 'preparation', start: timeline.start, end: timeline.end }];
}

function TimelineChart({ timeline, journeys, selected, onSelect, width }: { timeline: SessionTimeline; journeys: ConceptJourney[]; selected?: string; onSelect: (id: string) => void; width: number }) {
  const { x, bands } = makeScale(chartSpans(timeline), PAD_L, width - PAD_R);
  const answerItem = new Map<AnswerMoment, AnswerItem>();
  for (const item of timeline.items) if (item.type === 'answer') answerItem.set(item.answer, item);
  const messages = timeline.items.filter((item): item is Extract<TimelineItem, { type: 'message' }> => item.type === 'message');
  const conversations = timeline.items.filter((item): item is Extract<TimelineItem, { type: 'conversation' }> => item.type === 'conversation' && item.edge === 'started');
  const selectedItem = timeline.items.find((item) => item.id === selected);
  const pulseValid = timeline.samples.pulse.filter((sample) => sample.valid);
  const breathValid = timeline.samples.breathing.filter((sample) => sample.valid);

  // Vertical layout: concept rows, then only the lanes that have data.
  const rowY = (index: number) => HEAD + index * ROW + ROW / 2;
  let cursor = HEAD + journeys.length * ROW;
  const convTop = conversations.length ? cursor : undefined; if (convTop !== undefined) cursor += CONV_LANE;
  const signalTop = cursor;
  const pulseTop = pulseValid.length ? cursor : undefined; if (pulseTop !== undefined) cursor += PULSE_LANE;
  const breathTop = breathValid.length ? cursor : undefined; if (breathTop !== undefined) cursor += BREATH_LANE;
  const bottom = cursor;
  const height = bottom + 6;
  const plotX1 = width - PAD_R;

  const key = (event: KeyboardEvent, id: string) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(id); } };
  const interactive = (id: string) => ({ role: 'button' as const, tabIndex: 0, onClick: () => onSelect(id), onKeyDown: (event: KeyboardEvent) => key(event, id), onMouseEnter: () => onSelect(id) });

  /** One answer, placed on its concept row: colour = grade, the label above = stated confidence, below = score. */
  const mark = (item: AnswerItem, cy: number) => {
    const moment = item.answer; const cx = x(item.at); const tone = scoreTone(moment.grade, moment.skipped);
    return <g key={item.id} className={`tl-answer-mark tl-answer-mark--${tone} ${moment.kind === 'recheck' ? 'is-recheck' : ''} ${selected === item.id ? 'is-selected' : ''}`}
      aria-label={itemLabel(item)} {...interactive(item.id)}>
      {moment.calibration.mismatch && <circle className="tl-halo" cx={cx} cy={cy} r={15} />}
      {moment.kind === 'recheck' ? <rect x={cx - 9} y={cy - 9} width={18} height={18} rx={4} /> : <circle cx={cx} cy={cy} r={9} />}
      {moment.confidence && !moment.skipped && <text className="tl-mark-conf" x={cx} y={cy - 16} textAnchor="middle">{CONFIDENCE_LABELS[moment.confidence]}</text>}
      <text className="tl-mark-score" x={cx} y={cy + 26} textAnchor="middle">{moment.skipped ? 'skipped' : moment.grade ? `${moment.grade.score}/${moment.grade.maxScore}` : ''}</text>
    </g>;
  };

  /** Lane label in the left column, vertically centred on the lane. */
  const laneLabel = (top: number, laneH: number, label: string, sub?: string) => <>
    <text className="tl-lane-label" x={0} y={top + laneH / 2 + (sub ? -3 : 4)}>{label}</text>
    {sub && <text className="tl-lane-sub" x={0} y={top + laneH / 2 + 13}>{sub}</text>}
  </>;

  /** A reliable-readings line fitted inside its lane, with its top and bottom values as gridlines. */
  const signal = (metric: 'pulse' | 'breathing', valid: typeof pulseValid, laneTop: number, laneH: number) => {
    const top = laneTop + PLOT_PAD; const bandH = laneH - PLOT_PAD * 2;
    const values = valid.map((sample) => sample.value);
    let low = Math.floor(Math.min(...values)); let high = Math.ceil(Math.max(...values));
    const span = metric === 'pulse' ? 10 : 4; if (high - low < span) { const mid = (high + low) / 2; low = Math.floor(mid - span / 2); high = Math.ceil(mid + span / 2); }
    const y = (value: number) => top + bandH - ((value - low) / (high - low)) * bandH;
    return <g className="tl-signal">
      <line className="tl-rowline" x1={0} x2={width} y1={laneTop} y2={laneTop} />
      {laneLabel(laneTop, laneH, metric === 'pulse' ? 'Pulse' : 'Breathing', metric === 'pulse' ? 'beats per min' : 'breaths per min')}
      {[high, low].map((value) => <g key={`${metric}${value}`}>
        <line className="tl-grid" x1={PAD_L} x2={plotX1} y1={y(value)} y2={y(value)} />
        <text className="tl-tick" x={PAD_L - 8} y={y(value) + 4} textAnchor="end">{value}</text>
      </g>)}
      <path className={metric === 'pulse' ? 'tl-pulse' : 'tl-breath'} d={linePath(valid.map((sample) => ({ x: x(sample.t), y: y(sample.value), t: sample.t })))} />
    </g>;
  };

  return <svg className="tl-chart" width={width} height={height} role="group" aria-label="Session timeline chart">
    {/* phase bands run through every lane; each header shows how long the phase lasted */}
    {bands.map((band) => <g key={band.phase} className={`tl-band tl-band--${band.phase}`}>
      <rect x={band.x} y={0} width={band.w} height={bottom} />
      <line x1={band.x} x2={band.x} y1={0} y2={bottom} />
      <text x={band.x + 10} y={24} className="tl-band-label">{bandLabel(BAND_NAMES[band.phase], band.w)}<title>{PHASE_LABELS[band.phase]}</title></text>
      <text x={band.x + 10} y={41} className="tl-band-sub">{bandLabel(lasted(band.duration), band.w, 6.2)}</text>
    </g>)}

    {/* soft bands where the camera was on, behind the reading lanes */}
    {bottom > signalTop && timeline.windows.map((window) => { const start = Date.parse(window.startedAt); const end = window.endedAt ? Date.parse(window.endedAt) : timeline.end; return <rect key={window.id} className={`tl-window ${window.source === 'simulated' ? 'tl-window--sim' : ''}`} x={x(start)} y={signalTop} width={Math.max(3, x(end) - x(start))} height={bottom - signalTop} />; })}

    {/* selection guide, behind the marks so it never covers their labels */}
    {selectedItem && <line className="tl-guide" x1={x(selectedItem.at)} x2={x(selectedItem.at)} y1={HEAD - 6} y2={bottom} />}

    {/* one row per concept */}
    {journeys.map((journey, index) => {
      const cy = rowY(index); const top = HEAD + index * ROW;
      const outcome = OUTCOME(journey);
      const base = journey.baseline ? answerItem.get(journey.baseline) : undefined;
      const after = journey.recheck ? answerItem.get(journey.recheck) : undefined;
      const lines = wrapTitle(journey.concept.title);
      const titleY = cy - (lines.length > 1 ? 13 : 4);
      return <g key={journey.concept.id}>
        <line className="tl-rowline" x1={0} x2={width} y1={top} y2={top} />
        <text x={0} y={titleY} className="tl-row-label">{lines.map((line, lineIndex) => <tspan key={lineIndex} x={0} dy={lineIndex ? 16 : 0}>{line}</tspan>)}<title>{journey.concept.title}</title></text>
        <text x={0} y={titleY + (lines.length > 1 ? 33 : 17)} className="tl-row-sub">{outcome.label}{journey.focus ? ' · focus' : ''}</text>
        {base && after && <line className={`tl-link-line is-${outcome.key}`} x1={x(base.at)} x2={x(after.at)} y1={cy} y2={cy} />}
        {messages.filter((item) => item.role === 'learner' && item.conceptIds.includes(journey.concept.id)).map((item) =>
          <line key={`${journey.concept.id}-${item.id}`} className="tl-turn" x1={x(item.at)} x2={x(item.at)} y1={cy - 9} y2={cy + 9} />)}
        {base && mark(base, cy)}
        {after && mark(after, cy)}
      </g>;
    })}

    {/* conversation with Alex, and Alex's questions */}
    {convTop !== undefined && <>
      <line className="tl-rowline" x1={0} x2={width} y1={convTop} y2={convTop} />
      {laneLabel(convTop, CONV_LANE, 'With Alex')}
      {conversations.map((item) => {
        const end = timeline.items.find((other) => other.type === 'conversation' && other.conversationId === item.conversationId && other.edge === 'ended')?.at ?? timeline.end;
        const x0 = x(item.at); const w = Math.max(BAR_H, x(end) - x0); const cy = convTop + CONV_LANE / 2;
        const count = messages.filter((message) => message.conversationId === item.conversationId).length;
        const label = `${item.channel === 'voice' ? 'Voice' : 'Text'}${count ? ` · ${count} message${count === 1 ? '' : 's'}` : ''}`;
        const fitsAfter = x0 + w + 8 + label.length * 6.5 <= plotX1;
        return <g key={item.id} className="tl-convo" aria-label={itemLabel(item)} {...interactive(item.id)}>
          <text className="tl-convo-text" x={fitsAfter ? x0 + w + 8 : x0 - 8} y={cy + 4} textAnchor={fitsAfter ? 'start' : 'end'}>{label}</text>
          <rect x={x0} y={cy - BAR_H / 2} width={w} height={BAR_H} rx={BAR_H / 2} className={selected === item.id ? 'is-selected' : ''} />
        </g>;
      })}
      {messages.filter((item) => item.role === 'student' && item.question).map((item) => {
        const cx = x(item.at); const cy = convTop + CONV_LANE / 2;
        return <g key={item.id} className={`tl-ask ${selected === item.id ? 'is-selected' : ''}`} aria-label={`${itemLabel(item)}: ${clip(item.text, 80)}`} {...interactive(item.id)}>
          <rect x={cx - 5} y={cy - 5} width={10} height={10} transform={`rotate(45 ${cx} ${cy})`} />
        </g>;
      })}
    </>}

    {/* reliable camera readings only */}
    {pulseTop !== undefined && signal('pulse', pulseValid, pulseTop, PULSE_LANE)}
    {breathTop !== undefined && signal('breathing', breathValid, breathTop, BREATH_LANE)}

    <line className="tl-axis" x1={0} x2={width} y1={bottom} y2={bottom} />
  </svg>;
}

/** Plain-language notes for what the chart couldn't draw. */
function chartNotes(timeline: SessionTimeline): string[] {
  const notes: string[] = [];
  if (!timeline.items.some((item) => item.type === 'conversation')) notes.push('No conversation with Alex was recorded.');
  if (timeline.windows.length) {
    const pulse = timeline.samples.pulse.some((sample) => sample.valid); const breathing = timeline.samples.breathing.some((sample) => sample.valid);
    if (!pulse && !breathing) notes.push('The camera was on, but no pulse or breathing reading was reliable enough to plot.');
    else if (!pulse) notes.push('No pulse reading was reliable enough to plot.');
    else if (!breathing) notes.push('No breathing reading was reliable enough to plot.');
  }
  return notes;
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
  return <li className={`journey concept-result--${outcome.key}`}>
    <strong className="journey-title">{journey.concept.title}</strong>
      {step('First check', journey.baseline, journey.baselineGrade)}
      {firstMention ? <button type="button" className="journey-step journey-step--alex" onClick={() => onSelect(firstMention)}><small>With Alex</small><span className="small">{journey.mentions.learner ? `You named it ${journey.mentions.learner}×` : 'You didn’t name it'}{journey.mentions.alexQuestions ? ` · Alex asked ${journey.mentions.alexQuestions} question${journey.mentions.alexQuestions === 1 ? '' : 's'}` : ''}</span>{journey.focus && <span className="focus-tag">Focus concept</span>}</button>
        : <div className="journey-step journey-step--alex"><small>With Alex</small><span className="small muted">{!hadConversation ? 'No conversation was recorded' : talk ? '' : 'Not named in the saved transcript'}</span>{journey.focus && <span className="focus-tag">Focus concept</span>}</div>}
      {step('Follow-up', journey.recheck, journey.recheckGrade)}
    <span className={`outcome outcome--${outcome.key}`}>{outcome.key === 'improved' && <PracticeIcon name="trend" size={13} strokeWidth={2} />}{outcome.label}</span>
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

/** `beforeConcepts` is rendered just above the concept table. */
export function ReadinessInsights({ session, beforeConcepts }: { session: PracticeSession; beforeConcepts?: ReactNode }) {
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
  const talked = timeline.items.some((item) => item.type === 'conversation');
  const readings = [...timeline.samples.pulse, ...timeline.samples.breathing].some((sample) => sample.valid);
  const notes = chartNotes(timeline);

  return <section className="insights" aria-label="Readiness insights">
    <header className="insights-head">
      <div><span className="eyebrow"><PracticeIcon name="gauge" size={14} />Readiness insights</span></div>
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
        <div className="tl-frame" ref={frame}>{width > 0 && <TimelineChart timeline={timeline} journeys={journeys} selected={selected} onSelect={setSelected} width={Math.max(width, 640)} />}</div>
        {notes.length > 0 && <p className="tl-notes small muted">{notes.join(' ')}</p>}
        <ul className="tl-legend small" aria-label="Legend">
          <li><i className="lg-dot lg-dot--full" />Correct</li><li><i className="lg-dot lg-dot--partial" />Partly correct</li><li><i className="lg-dot lg-dot--zero" />Incorrect</li><li><i className="lg-dot lg-dot--skipped" />Skipped</li>
          <li><i className="lg-shape lg-shape--circle" />First check</li><li><i className="lg-shape lg-shape--square" />Follow-up</li><li><i className="lg-line lg-line--improved" />Improved</li><li><i className="lg-line lg-line--lower" />Lower this time</li>
          <li><i className="lg-halo" />Confidence and result differed</li>{talked && <><li><i className="lg-turn" />You named the concept</li><li><i className="lg-ask" />Alex asked</li></>}
          {readings && <li><i className="lg-window" />Camera on{simulated ? ' (simulated)' : ''}</li>}
        </ul>
        {selectedItem ? <Details item={selectedItem} session={session} timeline={timeline} onSelect={setSelected} /> : <p className="tl-detail tl-detail--empty muted small">Hover or select any mark to see what happened at that moment.</p>}
      </> : <TimelineList timeline={timeline} selected={selected} onSelect={(id) => setSelected((current) => current === id ? undefined : id)} session={session} />}
      <p className="tl-footnote small muted">Each row is one concept. Its first-check and follow-up answers show how sure you said you were and your score; the line between them shows the change. Camera readings are plotted only when Presage reported them reliable, and are shown alongside learning events for reflection. They don’t measure anxiety or confidence, and a change during a phase doesn’t mean that activity caused it.</p>
    </div>

    {beforeConcepts}

    <section aria-label="Concept by concept" className="results-section">
      <div className="journeys-wrap card">
        <div className="journeys-head" aria-hidden="true"><span>Concept</span><span>First check</span><span>With Alex</span><span>Follow-up</span><span /></div>
      <ul className="journeys">{journeys.map((journey) => <JourneyCard key={journey.concept.id} journey={journey} timeline={timeline} hadConversation={hadConversation} onSelect={(id) => { setSelected(id); if (view === 'chart') frame.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }} />)}</ul>
      </div>
    </section>
  </section>;
}
