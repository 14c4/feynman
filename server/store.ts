import type { PracticeSession } from '../shared/types.js';
import type { PrivateBlueprint } from './domain.js';

export interface StoredRecord {
  session: PracticeSession;
  tokenHash: string;
  blueprint: PrivateBlueprint | null;
  conversationOwners: Record<string, string>;
}
export interface SessionStore {
  get(id: string): Promise<StoredRecord | undefined>;
  set(record: StoredRecord): Promise<void>;
}

// Single-process demo storage. Restarting the API clears these sessions.
export class MemorySessionStore implements SessionStore {
  private records = new Map<string, StoredRecord>();
  async get(id: string) { const record = this.records.get(id); return record ? structuredClone(record) : undefined; }
  async set(record: StoredRecord) { this.records.set(record.session.id, structuredClone(record)); }
}
