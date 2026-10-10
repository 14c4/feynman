export type PracticeIconName =
  | 'home' | 'practice' | 'history' | 'arrow' | 'check' | 'mic' | 'mute' | 'book' | 'close' | 'leaf' | 'message'
  | 'plus' | 'upload' | 'file' | 'chevron' | 'back' | 'send' | 'stop' | 'alert' | 'info' | 'sparkle' | 'refresh'
  | 'trash' | 'keyboard' | 'wave' | 'target' | 'trend' | 'menu' | 'clock' | 'pause' | 'camera' | 'heart' | 'gauge';

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
  plus: 'M12 5v14M5 12h14',
  upload: 'M12 15V4m-5 5 5-5 5 5M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4',
  file: 'M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8l-5-5Zm0 0v5h5M9 13h6m-6 4h4',
  chevron: 'm9 6 6 6-6 6',
  back: 'M20 12H4m6-6-6 6 6 6',
  send: 'M5 12h13M12 5l7 7-7 7',
  stop: 'M7 7h10v10H7z',
  alert: 'M12 9v4m0 3.5v.5M10.3 3.9 2.6 17a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-10v6m0-9.5V8',
  sparkle: 'M12 3v4m0 10v4M3 12h4m10 0h4M6 6l2.5 2.5m7 7L18 18M6 18l2.5-2.5m7-7L18 6',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  trash: 'M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3',
  keyboard: 'M3 6h18v12H3zM7 10h.01M11 10h.01M15 10h.01M7 14h10',
  wave: 'M4 10v4m4-8v12m4-15v18m4-12v6m4-3v0',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-4a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0-4a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z',
  trend: 'm3 17 6-6 4 4 8-8m0 0h-6m6 0v6',
  menu: 'M4 7h16M4 12h16M4 17h16',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13v4l3 2',
  pause: 'M9 5v14m6-14v14',
  camera: 'M3 8a1 1 0 0 1 1-1h3l2-3h6l2 3h3a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8Zm9 9a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
  heart: 'M12 20s-7-4.4-9-9a4.6 4.6 0 0 1 9-3 4.6 4.6 0 0 1 9 3c-2 4.6-9 9-9 9Z',
  gauge: 'M4 18a8 8 0 1 1 16 0M12 18l4-6',
};

export function PracticeIcon({ name, size = 20, strokeWidth = 1.6 }: { name: PracticeIconName; size?: number; strokeWidth?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
