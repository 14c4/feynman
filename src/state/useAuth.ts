import { createContext, useContext } from 'react';
import type { User } from '@supabase/supabase-js';

export interface AuthContextValue {
  /** The signed-in learner, or undefined for guests. */
  user?: User;
  /** True until the first check of any saved browser sign-in has finished. */
  loading: boolean;
  /** Sign-in is only offered when both the browser and the server are set up for it. */
  available: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  /** Resolves `'confirm'` when the email must be confirmed before the first sign-in. */
  signUp: (email: string, password: string) => Promise<'signed-in' | 'confirm'>;
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
