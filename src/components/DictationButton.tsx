import { useCallback, useEffect, useRef, useState } from 'react';
import { PracticeIcon } from './practice/PracticeIcon';

interface RecognitionResult { readonly isFinal: boolean; readonly 0: { readonly transcript: string } }
interface RecognitionEvent { readonly resultIndex: number; readonly results: { readonly length: number; readonly [index: number]: RecognitionResult } }
interface Recognition {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
}
type RecognitionConstructor = new () => Recognition;

function recognitionConstructor(): RecognitionConstructor | undefined {
  const scope = window as unknown as { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
}

const ERRORS: Record<string, string> = {
  'not-allowed': 'Microphone access was blocked. Allow it in your browser to dictate.',
  'service-not-allowed': 'Dictation is not allowed in this browser.',
  'audio-capture': 'No microphone was found.',
  network: 'Dictation needs a network connection in this browser.',
};

function join(base: string, spoken: string) {
  const text = spoken.trim();
  if (!text) return base;
  return base && !/\s$/.test(base) ? `${base} ${text}` : `${base}${text}`;
}

/** Browser speech-to-text for a text field. Renders nothing where the Web Speech API is unavailable. */
export function DictationButton({ value, onChange, maxLength, disabled, className = '', label = 'answer' }: {
  value: string; onChange: (text: string) => void; maxLength?: number; disabled?: boolean; className?: string; label?: string;
}) {
  const Recognition = recognitionConstructor();
  const [listening, setListening] = useState(false);
  const [message, setMessage] = useState('');
  const recognition = useRef<Recognition | null>(null);
  const latest = useRef({ onChange, maxLength });
  latest.current = { onChange, maxLength };
  const valueRef = useRef(value);
  valueRef.current = value;

  const stop = useCallback(() => { recognition.current?.stop(); }, []);
  useEffect(() => () => { recognition.current?.abort(); }, []);
  useEffect(() => { if (disabled) recognition.current?.stop(); }, [disabled]);

  if (!Recognition) return null;

  function start() {
    if (!Recognition) return;
    const engine = new Recognition();
    engine.lang = document.documentElement.lang || navigator.language || 'en-US';
    engine.continuous = true;
    engine.interimResults = true;
    const base = valueRef.current;
    let finalText = '';
    engine.onresult = (event) => {
      let interim = '';
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result.isFinal) finalText += `${result[0].transcript} `; else interim += result[0].transcript;
      }
      const next = join(base, finalText + interim);
      latest.current.onChange(latest.current.maxLength ? next.slice(0, latest.current.maxLength) : next);
    };
    engine.onerror = (event) => { if (event.error !== 'no-speech' && event.error !== 'aborted') setMessage(ERRORS[event.error] ?? 'Dictation stopped unexpectedly.'); };
    engine.onend = () => { setListening(false); if (recognition.current === engine) recognition.current = null; };
    recognition.current = engine;
    setMessage('');
    try { engine.start(); setListening(true); } catch { recognition.current = null; setMessage('Dictation could not start.'); }
  }

  return <>
    <button type="button" className={`icon-button dictate-button ${listening ? 'is-listening' : ''} ${className}`} disabled={disabled}
      aria-pressed={listening} aria-label={listening ? `Stop dictating ${label}` : `Dictate ${label}`} title={listening ? 'Stop dictation' : 'Dictate with your voice'}
      onClick={() => (listening ? stop() : start())}>
      <PracticeIcon name="mic" size={16} />
    </button>
    <span className="sr-only" role="status">{listening ? 'Listening. Speak to add text.' : message}</span>
    {message && <span className="dictate-error" role="alert">{message}</span>}
  </>;
}
