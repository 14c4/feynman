import { useCallback, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { PreviewLayout } from './PreviewLayout';
import { PreviewDashboard, PreviewHistory, type PreviewHistoryEntry } from './PreviewDashboard';
import { PreviewAssessment, type PreviewDraft } from './PreviewAssessment';
import { PreviewConversation } from './PreviewConversation';
import { PreviewResults } from './PreviewResults';
import { blankAnswers, initialConversationState, previewFixtures, type PreviewFixture, type PreviewScreen } from './previewFixtures';
import './preview.css';

const screens: PreviewScreen[] = ['home', 'practice', 'baseline', 'conversation', 'followup', 'results', 'history'];
const initialEntries: PreviewHistoryEntry[] = [
  { id: 'sample-heart', fixture: previewFixtures[0], title: previewFixtures[0].title, recency: 'Today · example', status: 'Paused', destination: 'conversation' },
  { id: 'sample-recursion', fixture: previewFixtures[1], title: previewFixtures[1].title, recency: 'Yesterday · example', status: 'Completed', destination: 'results' },
  { id: 'sample-probability', fixture: previewFixtures[2], title: previewFixtures[2].title, recency: 'Earlier this week · example', status: 'Paused', destination: 'baseline' },
];
const makeDrafts = (fixture: PreviewFixture) => ({ baseline: { answers: blankAnswers(fixture, 'baseline'), index: 0 }, recheck: { answers: blankAnswers(fixture, 'recheck'), index: 0 } });

// Intentionally outside SessionProvider: only transient component state, no
// API/service imports, browser persistence, credentials or microphone access.
export function PreviewApp() {
  const { screen: param = 'home' } = useParams();
  const screen = screens.includes(param as PreviewScreen) ? param as PreviewScreen : 'home';
  const navigate = useNavigate();
  const [fixture, setFixture] = useState(previewFixtures[0]);
  const [title, setTitle] = useState(previewFixtures[0].title);
  const [notes, setNotes] = useState(previewFixtures[0].notes);
  const [drafts, setDrafts] = useState(makeDrafts(previewFixtures[0]));
  const [conversation, setConversation] = useState(initialConversationState);
  const [before, setBefore] = useState<number>();
  const [after, setAfter] = useState<number>();
  const [currentEntry, setCurrentEntry] = useState<PreviewHistoryEntry>();
  const [notice, setNotice] = useState('');
  const go = useCallback((destination: PreviewScreen) => {
    if (destination === 'baseline' || destination === 'conversation' || destination === 'followup' || destination === 'results') {
      setCurrentEntry((previous) => previous ? { ...previous, destination } : previous);
    }
    void navigate(destination === 'home' ? '/preview' : `/preview/${destination}`);
  }, [navigate]);
  const completeBaseline = useCallback(() => go('conversation'), [go]);
  const completeRecheck = useCallback(() => go('results'), [go]);
  function start(sample: PreviewFixture, customTitle: string, customNotes: string) {
    setConversation(initialConversationState);
    setFixture(sample); setTitle(customTitle); setNotes(customNotes); setDrafts(makeDrafts(sample)); setBefore(undefined); setAfter(undefined); setNotice('');
    setCurrentEntry({ id: 'local-preview', fixture: sample, title: customTitle, recency: 'This preview tab', status: 'In progress', destination: 'baseline' }); go('baseline');
  }
  function open(entry: PreviewHistoryEntry) {
    if (entry.fixture.id !== fixture.id || entry.id !== currentEntry?.id) { setDrafts(makeDrafts(entry.fixture)); setConversation(initialConversationState); setBefore(undefined); setAfter(undefined); setNotes(entry.fixture.notes); }
    setFixture(entry.fixture); setTitle(entry.title); setNotice(''); setCurrentEntry({ ...entry, status: entry.status === 'Completed' ? 'Completed' : 'In progress' }); go(entry.destination);
  }
  function pause() {
    setConversation((previous) => ({ ...previous, state: 'disconnected' }));
    const destination = screen === 'followup' ? 'followup' : screen === 'conversation' ? 'conversation' : 'baseline';
    setCurrentEntry({ id: currentEntry?.id ?? 'local-preview', fixture, title, recency: 'This preview tab', status: 'Paused', destination });
    setNotice('Preview paused. Resume from the row below. Local drafts last until this page is refreshed.'); go('history');
  }
  function finish() {
    setCurrentEntry({ id: currentEntry?.id ?? 'local-preview', fixture, title, recency: 'Finished in this preview tab', status: 'Completed', destination: 'results' });
    setNotice('Example session marked complete in this preview tab. No real session was created or saved.'); go('history');
  }
  const entries = currentEntry ? [currentEntry, ...initialEntries.filter((entry) => entry.id !== currentEntry.id)] : initialEntries;
  function updateDraft(kind: 'baseline' | 'recheck', draft: PreviewDraft) { setDrafts((previous) => ({ ...previous, [kind]: draft })); }
  return <PreviewLayout screen={screen}>{!screens.includes(param as PreviewScreen) ? <section className="pv-empty"><h1 tabIndex={-1}>That preview screen isn’t here.</h1><Link to="/preview">Return to the dashboard</Link></section> :
    screen === 'home' || screen === 'practice' ? <PreviewDashboard key={screen} onStart={start} entries={entries} onOpen={open} notice={notice} /> :
    screen === 'history' ? <PreviewHistory entries={entries} onOpen={open} notice={notice} /> :
    screen === 'baseline' || screen === 'followup' ? <PreviewAssessment key={`${fixture.id}-${screen}`} fixture={fixture} title={title} kind={screen === 'baseline' ? 'baseline' : 'recheck'} draft={screen === 'baseline' ? drafts.baseline : drafts.recheck} onDraft={(draft) => updateDraft(screen === 'baseline' ? 'baseline' : 'recheck', draft)} onComplete={screen === 'baseline' ? completeBaseline : completeRecheck} onPause={pause} before={before} onBefore={setBefore} /> :
    screen === 'conversation' ? <PreviewConversation fixture={fixture} title={title} notes={notes} conversation={conversation} onConversation={setConversation} onNext={() => go('followup')} onPause={pause} /> :
    <PreviewResults fixture={fixture} title={title} drafts={drafts} localMessages={conversation.localMessages} before={before} after={after} onAfter={setAfter} onFinish={finish} onNew={() => { setNotice(''); go('practice'); }} />}</PreviewLayout>;
}
