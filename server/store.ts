import type { PracticeSession, QuestionGrade } from '../shared/types.js';
import type { PrivateBlueprint } from './domain.js';
import type { PrivateMaterial } from './materials.js';

export interface StoredRecord {
  session: PracticeSession;
  tokenHash: string;
  /** Supabase user who owns the session. Absent for guest sessions, which are never persisted. */
  userId?: string;
  blueprint: PrivateBlueprint | null;
  conversationOwners: Record<string, string>;
  /** Extracted upload text; never serialized to the client. */
  materials?: PrivateMaterial[];
  /** Learner-provided topic name, kept as the session title. */
  topic?: string;
  /** Validated grades for an assessment whose grading has not finished; reused on retry. Server-only. */
  gradeCache?: Record<string, QuestionGrade>;
  /** Fingerprint of the evidence the stored review sheet was generated from. Server-only. */
  reviewHash?: string;
}
export interface SessionStore {
  get(id: string): Promise<StoredRecord | undefined>;
  set(record: StoredRecord): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface MemoryStoreOptions {
  /** Oldest-touched sessions are evicted beyond this count, bounding memory use. */
  maxSessions?: number;
  /** Sessions untouched for this long are dropped. */
  idleTtlMs?: number;
  onEvict?: (id: string) => void;
}

// Single-process demo storage. Restarting or redeploying the API clears these sessions.
export class MemorySessionStore implements SessionStore {
  private records = new Map<string, { record: StoredRecord; touched: number }>();
  constructor(private readonly options: MemoryStoreOptions = {}, private readonly clock: () => number = Date.now) {}
  async get(id: string) {
    const entry = this.records.get(id); if (!entry) return undefined;
    if (this.expired(entry.touched)) { this.evict(id); return undefined; }
    return structuredClone(entry.record);
  }
  async set(record: StoredRecord) {
    const id = record.session.id;
    // Re-inserting keeps the Map in least-recently-written order, so eviction removes the oldest first.
    this.records.delete(id); this.records.set(id, { record: structuredClone(record), touched: this.clock() });
    for (const [key, entry] of this.records) { if (!this.expired(entry.touched)) break; this.evict(key); }
    const max = this.options.maxSessions;
    if (max) while (this.records.size > max) { const oldest = this.records.keys().next().value; if (oldest === undefined || oldest === id) break; this.evict(oldest); }
  }
  async delete(id: string) { this.records.delete(id); }
  private expired(touched: number) { return this.options.idleTtlMs !== undefined && this.clock() - touched > this.options.idleTtlMs; }
  private evict(id: string) { this.records.delete(id); this.options.onEvict?.(id); }
}
