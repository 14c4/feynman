import { createClient } from '@supabase/supabase-js';

// Publishable (browser-safe) key only. Never put a secret/service-role key behind a VITE_ variable.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

/** Null when Supabase is not configured, so the app still works for guests. */
export const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

/** The signed-in learner's access token, if any. Sent to our API so it can attach or reopen saved sessions. */
export async function accessToken(): Promise<string | undefined> {
  if (!supabase) return undefined;
  try { return (await supabase.auth.getSession()).data.session?.access_token; } catch { return undefined; }
}
