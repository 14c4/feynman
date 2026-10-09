import { Button } from '../../components/Button';

export function MicrophoneControl() {
  return (
    <div className="microphone-control">
      <Button className="microphone-button" disabled aria-label="Microphone" aria-describedby="microphone-help">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="9" y="2" width="6" height="12" rx="3" />
          <path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" />
        </svg>
      </Button>
      <span className="microphone-label">Explain with your voice</span>
      <p id="microphone-help" className="microphone-status">Microphone unavailable · integration pending.<br />No audio is recorded.</p>
    </div>
  );
}
