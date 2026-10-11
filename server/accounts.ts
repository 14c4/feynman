import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { SessionSummary } from '../shared/types.js';
import { MemorySessionStore, type SessionStore, type StoredRecord } from './store.js';

/**
 * Optional accounts. Signed-in learners' sessions are saved to Supabase so they can come back later;
 * guests keep the in-memory behavior. The server uses a secret key, so the answer keys, rubrics and
 * uploaded text in a stored record are never reachable from the browser (the table has no RLS policies).
 */
export interface Accounts {
  /** Verifies a Supabase access token and returns the user id, or undefined when it is missing or invalid. */
  verify(accessToken: string | undefined): Promise<string | undefined>;
  list(userId: string): Promise<SessionSummary[]>;
  store: SessionStore;
}

const TABLE = 'practice_sessions';
const MAX_LISTED = 50;

export function createAccounts(env: NodeJS.ProcessEnv, cache: MemorySessionStore): Accounts | undefined {
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const key = env.SUPABASE_SECRET_KEY;
  if (!url || !key) return undefined;
  const db: SupabaseClient = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const fail = (action: string, error: { message: string }) => new Error(`Could not ${action} your saved session (${error.message}).`);

  const store: SessionStore = {
    async get(id) {
      const cached = await cache.get(id);
      if (cached) return cached;
      const { data, error } = await db.from(TABLE).select('record').eq('id', id).maybeSingle();
      if (error) throw fail('load', error);
      if (!data) return undefined;
      const record = data.record as StoredRecord;
      await cache.set(record);
      return record;
    },
    async set(record) {
      await cache.set(record);
      if (!record.userId) return;
      const { session } = record;
      const { error } = await db.from(TABLE).upsert({ id: session.id, user_id: record.userId, record, title: session.title, stage: session.stage, lifecycle: session.lifecycle, created_at: session.createdAt, updated_at: session.updatedAt });
      if (error) throw fail('save', error);
    },
    async delete(id) {
      await cache.delete(id);
      const { error } = await db.from(TABLE).delete().eq('id', id);
      if (error) throw fail('delete', error);
    },
  };

  return {
    store,
    async verify(accessToken) {
      if (!accessToken || accessToken.length > 4096) return undefined;
      const { data, error } = await db.auth.getUser(accessToken);
      return error ? undefined : data.user?.id;
    },
    async list(userId) {
      const { data, error } = await db.from(TABLE).select('id, title, stage, lifecycle, created_at, updated_at').eq('user_id', userId).order('updated_at', { ascending: false }).limit(MAX_LISTED);
      if (error) throw fail('list', error);
      return (data ?? []).map((row) => ({ id: row.id as string, title: row.title as string, stage: row.stage as SessionSummary['stage'], lifecycle: row.lifecycle as SessionSummary['lifecycle'], createdAt: row.created_at as string, updatedAt: row.updated_at as string }));
    },
  };
}
