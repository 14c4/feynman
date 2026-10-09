import type { TranscriptMessage } from '../../../shared/types';

export function TranscriptPanel({ messages, label = 'Full transcript' }: { messages: TranscriptMessage[]; label?: string }) {
  return (
    <details className="transcript-panel">
      <summary>{label}<span className="transcript-count">{messages.length} {messages.length === 1 ? 'message' : 'messages'}</span></summary>
      {messages.length === 0 ? <p className="muted transcript-empty">Your saved explanations will appear here.</p> :
        <ol className="transcript-list">
          {messages.map((message) => <li key={message.id}>
            <div className="transcript-meta"><strong>{message.role === 'learner' ? 'You' : 'Student'}</strong><span>{message.source === 'sample' ? 'Sample' : message.source === 'text' ? 'Text entry' : 'Voice'}</span></div>
            <p>{message.text}</p>
          </li>)}
        </ol>}
    </details>
  );
}
