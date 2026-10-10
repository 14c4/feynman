export type PracticeIconName = 'home' | 'practice' | 'history' | 'arrow' | 'check' | 'mic' | 'mute' | 'book' | 'close' | 'leaf' | 'message';

const paths: Record<PracticeIconName, string> = {
  home: 'm3 10 9-7 9 7v10H3V10Zm6 10v-7h6v7',
  practice: 'M8 4H5v17h14V4h-3M8 3h8v4H8V3Zm0 9h8m-8 4h5',
  history: 'M3 11a9 9 0 1 1 2 7M3 4v7h7m2-4v6l4 2',
  arrow: 'M4 12h16m-6-6 6 6-6 6',
  check: 'm5 12 4 4L19 6',
  mic: 'M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0V5Zm-3 6v1a6 6 0 0 0 12 0v-1m-6 7v4m-4 0h8',
  mute: 'm3 3 18 18M9 9v3a3 3 0 0 0 5 2m1-5V5a3 3 0 0 0-5-2M6 11v1a6 6 0 0 0 10 4m2-4v-1m-6 7v4m-4 0h8',
  book: 'M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1m0-15c3-2 6-2 9-1v15c-3-1-6-1-9 1V5Z',
  close: 'm6 6 12 12M6 18 18 6',
  leaf: 'M5 19C-1 9 10 3 20 3c0 10-6 21-15 16Zm0 0L15 9',
  message: 'M21 3H3v14h5v4l5-4h8V3ZM7 8h10M7 12h7',
};

export function PracticeIcon({ name, size = 20 }: { name: PracticeIconName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
