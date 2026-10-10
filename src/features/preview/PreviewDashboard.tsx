import { useState, type FormEvent } from 'react';
import { Button } from '../../components/Button';
import { PreviewIcon } from './PreviewIcon';
import { previewFixtures, type PreviewFixture } from './previewFixtures';
import { Link } from 'react-router';
import { StartPracticeForm } from '../../components/practice/StartPracticeForm';

export interface PreviewHistoryEntry {
  id: string;
  fixture: PreviewFixture;
  title: string;
  recency: string;
  status: 'Paused' | 'Completed' | 'In progress';
  destination: 'baseline' | 'conversation' | 'followup' | 'results';
}

export function SessionRows({ entries, onOpen }: { entries: PreviewHistoryEntry[]; onOpen: (entry: PreviewHistoryEntry) => void }) {
  return <ul className="pv-session-list">{entries.map((entry) => <li key={entry.id}><span className="pv-subject-icon"><PreviewIcon name={entry.fixture.id === 'heart' ? 'leaf' : 'book'} /></span><div className="pv-session-title"><strong>{entry.title}</strong><span>{entry.fixture.category} <span aria-hidden="true">·</span> {entry.recency}</span></div><span className={`pv-status ${entry.status === 'Completed' ? 'pv-status--complete' : ''}`}>{entry.status}</span><span className="pv-session-score">{entry.status === 'Completed' ? '3/6 → 5/6' : '—'}</span><Button variant="quiet" onClick={() => onOpen(entry)} aria-label={`${entry.destination === 'results' ? 'Review' : 'Resume'} ${entry.title}`}>{entry.destination === 'results' ? 'Review' : 'Resume'}<PreviewIcon name="arrow" size={16} /></Button></li>)}</ul>;
}

export function PreviewDashboard({ onStart, entries, onOpen, notice }: { onStart: (fixture: PreviewFixture, title: string, notes: string) => void; entries: PreviewHistoryEntry[]; onOpen: (entry: PreviewHistoryEntry) => void; notice: string }) {
  const [subject, setSubject] = useState('');
  const [notes, setNotes] = useState('');
  const [fixture, setFixture] = useState(previewFixtures[0]);
  const [empty, setEmpty] = useState(false);
  const [error, setError] = useState('');
  function start(event: FormEvent) {
    event.preventDefault();
    if (!subject.trim()) { setError('Tell us what you’ve studied, or choose a sample subject below.'); return; }
    onStart(fixture, subject.trim(), notes.trim());
  }
  return <>
    <header className="pv-page-heading"><h1 tabIndex={-1}>What are you studying?</h1></header>
    {notice && <div className="pv-notice" role="status"><PreviewIcon name="check" />{notice}</div>}
    <div className="pv-dashboard-grid">
      <StartPracticeForm subject={subject} notes={notes} error={error} preview suggestions={previewFixtures.map((sample) => ({ title: sample.title, label: sample.category, notes: sample.notes }))} onSubject={(value) => { setSubject(value); setError(''); }} onNotes={setNotes} onSuggestion={(suggestion) => { setFixture(previewFixtures.find((sample) => sample.title === suggestion.title)!); setSubject(suggestion.title); setNotes(suggestion.notes); setError(''); }} onSubmit={start}
        footer={<p className="pv-fixture-note">Preview uses the fixed <strong>{fixture.title}</strong> example. Editing the topic or notes does not generate questions.</p>} />
    </div>
    <section className="pv-recent"><div className="pv-section-heading"><div><h2>Pick up where you left off</h2><p>Example sessions, kept separate from your real practice.</p></div><Link to="/preview/history">View history <span aria-hidden="true">↗</span></Link></div><div className="pv-local-controls"><label><input type="checkbox" checked={empty} onChange={(event) => setEmpty(event.target.checked)} />Show new-user empty state</label></div>{empty ? <div className="pv-empty"><PreviewIcon name="book" size={28} /><h3>Your first idea starts here.</h3><p>Practice sessions will appear here when you start.</p><Button variant="secondary" onClick={() => document.getElementById('pv-subject')?.focus()}>Choose a subject</Button></div> : <SessionRows entries={entries.slice(0, 3)} onOpen={onOpen} />}</section>
  </>;
}

export function PreviewHistory({ entries, onOpen, notice }: { entries: PreviewHistoryEntry[]; onOpen: (entry: PreviewHistoryEntry) => void; notice: string }) {
  const [filter, setFilter] = useState('All sessions');
  const [search, setSearch] = useState('');
  const filtered = entries.filter((entry) => (filter === 'All sessions' || entry.status === filter) && entry.title.toLowerCase().includes(search.toLowerCase()));
  return <><header className="pv-page-heading"><span className="pv-eyebrow">YOUR THINKING, OVER TIME</span><h1 tabIndex={-1}>Practice history</h1><p>A place to return to ideas, and see how your explanations changed.</p></header>{notice && <div className="pv-notice" role="status">{notice}</div>}<div className="pv-notice pv-notice--neutral"><span className="pv-badge">PREVIEW</span>These are sample sessions. Live history uses browser references and requires the original API process.</div><div className="pv-history-tools"><div className="pv-tabs" aria-label="Filter sample sessions">{['All sessions', 'Paused', 'Completed'].map((value) => <button type="button" key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{value}</button>)}</div><label><span className="sr-only">Search sample sessions</span><input type="search" placeholder="Search subjects…" value={search} onChange={(event) => setSearch(event.target.value)} /></label></div><section className="pv-card pv-history-card" aria-label="Sample session history"><div className="pv-history-label"><span>Subject & recency</span><span>Sample comparison</span></div>{filtered.length ? <SessionRows entries={filtered} onOpen={onOpen} /> : <div className="pv-empty"><PreviewIcon name="history" size={28} /><h2>No sessions here yet.</h2><p>Try a different search or filter.</p><Button variant="secondary" onClick={() => { setFilter('All sessions'); setSearch(''); }}>Clear filters</Button></div>}</section><div className="pv-history-foot"><span>{filtered.length} sample {filtered.length === 1 ? 'session' : 'sessions'}</span><Link className="button button--primary" to="/preview/practice">Start new practice<PreviewIcon name="arrow" size={18} /></Link></div></>;
}
