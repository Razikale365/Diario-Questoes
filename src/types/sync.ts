import { StudyTask } from '../types';

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error' | 'offline' | 'unauthenticated';

export interface SyncRecord {
  id: string;
  user_id: string;
  payload: StudyTask[];
  updated_at: string;
}

export interface SyncHistoryEntry {
  id: string;
  user_id: string;
  task_count: number;
  snapshot_at: string;
  source: 'auto' | 'manual';
  snapshot_name?: string | null;
}

export interface SyncState {
  status: SyncStatus;
  lastSyncAt: string | null;
  lastError: string | null;
  pendingChanges: number;
  lastConflictAt?: string | null;
  lastConflictMessage?: string | null;
}
