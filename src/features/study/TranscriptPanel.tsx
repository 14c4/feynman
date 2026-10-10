import type { TranscriptMessage } from '../../../shared/types';
import { PracticeIcon } from '../../components/practice/PracticeIcon';

export function TranscriptPanel({ messages, label = 'Full transcript' }: { messages: TranscriptMessage[]; label?: string }) {
  return (
    <details className="disclosure transcript-panel">
      <summary><span className="transcript-label">{label}</span><span className="summary-meta">{messages.length} {messages.length === 1 ? 'message' : 'messages'}</span><PracticeIcon name="chevron" size={14} /></summary>
      <div className="disclosure-body">
        {messages.length === 0 ? <p className="muted small">Your saved explanations will appear here.</p> :
          <ol className="transcript-list">
            {messages.map((message) => <li key={message.id} className={`bubble bubble--${message.role}`}>
              <span className="bubble-author">{message.role === 'learner' ? 'You' : 'Alex'}<span className="bubble-source">{message.source === 'sample' ? 'Sample' : message.source === 'text' ? 'Typed' : 'Voice'}</span></span>
              <p>{message.text}</p>
            </li>)}
          </ol>}
      </div>
    </details>
  );
}
