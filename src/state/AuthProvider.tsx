import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../services/supabase';
import { AuthContext } from './useAuth';
import { useSessions } from './useSessions';

/** Friendlier wording for the errors learners are most likely to see. */
function friendly(message: string) {
  if (/invalid login credentials/i.test(message)) return 'That email and password don’t match. Check them and try again.';
  if (/already registered|already been registered/i.test(message)) return 'That email already has an account. Try signing in instead.';
  if (/email not confirmed/i.test(message)) return 'Confirm your email first. We sent you a link when you created the account.';
  if (/rate limit|too many/i.test(message)) return 'Too many attempts. Please wait a minute and try again.';
  return message;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const { integration } = useSessions();
  const [user, setUser] = useState<User>();
  const [loading, setLoading] = useState(Boolean(supabase));

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    void supabase.auth.getSession().then(({ data }) => { if (active) { setUser(data.session?.user); setLoading(false); } }).catch(() => { if (active) setLoading(false); });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => { if (active) setUser(session?.user); });
    return () => { active = false; data.subscription.unsubscribe(); };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    if (!supabase) throw new Error('Accounts are not set up here.');
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw new Error(friendly(error.message));
  }, []);
  const signUp = useCallback(async (email: string, password: string) => {
    if (!supabase) throw new Error('Accounts are not set up here.');
    const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
    if (error) throw new Error(friendly(error.message));
    // A user with no identities means the email is already registered (Supabase hides that on purpose).
    if (data.user && data.user.identities?.length === 0) throw new Error(friendly('already registered'));
    return data.session ? 'signed-in' as const : 'confirm' as const;
  }, []);
  const signOut = useCallback(async () => { if (supabase) await supabase.auth.signOut(); }, []);

  const available = Boolean(supabase && integration?.accountsEnabled);
  return <AuthContext.Provider value={{ user, loading, available, signIn, signUp, signOut }}>{children}</AuthContext.Provider>;
}
