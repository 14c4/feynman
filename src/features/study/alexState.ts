/** Conversation states Alex can visibly communicate. Each one is driven by real app or voice-SDK state. */
export type AlexState = 'idle' | 'connecting' | 'listening' | 'user-speaking' | 'thinking' | 'speaking' | 'interrupted' | 'ended';

export const ALEX_LABELS: Record<AlexState, string> = {
  idle: 'Alex is ready to learn',
  connecting: 'Connecting to Alex…',
  listening: 'Alex is listening',
  'user-speaking': 'You’re explaining',
  thinking: 'Alex is thinking',
  speaking: 'Alex is responding',
  interrupted: 'Connection interrupted',
  ended: 'Conversation ended',
};
