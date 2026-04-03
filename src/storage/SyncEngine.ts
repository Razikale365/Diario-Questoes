import { StudyTask } from '../types';
import { SyncState, SyncStatus } from '../types/sync';
import { supabase } from '../lib/supabase';
import { StorageAdapter } from '../storage/StorageAdapter';

const SYNC_DEBOUNCE_MS = 2000;
const SYNC_INTERVAL_MS = 30000;
const SYNC_DATA_KEY = 'diario_ls_sync';

export class SyncEngine {
  private adapter: StorageAdapter;
  private state: SyncState = {
    status: supabase ? 'idle' : 'unauthenticated',
    lastSyncAt: null,
    lastError: null,
    pendingChanges: 0,
  };
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private intervalTimer: ReturnType<typeof setInterval> | null = null;
  private onStateChange: (state: SyncState) => void;
  private isInitialized = false;

  constructor(adapter: StorageAdapter, onStateChange: (state: SyncState) => void) {
    this.adapter = adapter;
    this.onStateChange = onStateChange;
  }

  init(): void {
    if (!supabase) {
      this.updateState({ status: 'unauthenticated' });
      return;
    }
    if (this.isInitialized) return;
    this.isInitialized = true;

    this.startInterval();
    this.setupOnlineOffline();
    this.pullOnStart();
  }

  destroy(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (this.intervalTimer) clearInterval(this.intervalTimer);
    this.isInitialized = false;
  }

  push(): void {
    if (!supabase) return;

    if (this.debounceTimer) clearTimeout(this.debounceTimer);

    this.updateState({ status: 'syncing' });

    this.debounceTimer = setTimeout(async () => {
      await this.doPush();
    }, SYNC_DEBOUNCE_MS);
  }

  private async doPush(): Promise<void> {
    if (!supabase) return;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        this.updateState({ status: 'unauthenticated' });
        return;
      }

      const tasks = this.adapter.readTasks();
      const now = new Date().toISOString();

      const { error } = await supabase
        .from(SYNC_DATA_KEY)
        .upsert(
          {
            id: session.user.id,
            user_id: session.user.id,
            payload: tasks,
            updated_at: now,
          },
          { onConflict: 'id' }
        );

      if (error) throw error;

      this.updateState({
        status: 'synced',
        lastSyncAt: now,
        pendingChanges: 0,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Push failed';
      this.updateState({ status: 'error', lastError: message });
    }
  }

  private async pullOnStart(): Promise<void> {
    if (!supabase) return;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        this.updateState({ status: 'unauthenticated' });
        return;
      }

      await this.doPull();
    } catch {
      // On startup, don't fail hard — just start in idle
      this.updateState({ status: 'idle' });
    }
  }

  private async doPull(): Promise<void> {
    if (!supabase) return;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        this.updateState({ status: 'unauthenticated' });
        return;
      }

      const { data, error } = await supabase
        .from(SYNC_DATA_KEY)
        .select('*')
        .eq('user_id', session.user.id)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          // No remote data yet — push local
          await this.doPush();
          return;
        }
        throw error;
      }

      if (!data) return;

      const remoteTasks: StudyTask[] = data.payload;
      const remoteUpdatedAt: string = data.updated_at;
      const localTasks = this.adapter.readTasks();

      // Check if remote is newer
      const localUpdatedAt = this.getLastWriteTime();
      if (!localUpdatedAt || new Date(remoteUpdatedAt) > new Date(localUpdatedAt)) {
        // Last-write-wins: remote is newer, replace local
        this.adapter.writeTasks(remoteTasks);
        // Notify React state by dispatching a custom event
        window.dispatchEvent(new CustomEvent('ls_sync_pull', { detail: remoteTasks }));
      }

      this.updateState({
        status: 'synced',
        lastSyncAt: new Date().toISOString(),
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Pull failed';
      this.updateState({ status: 'error', lastError: message });
    }
  }

  private getLastWriteTime(): string | null {
    try {
      const meta = localStorage.getItem('ls_tasks_meta_v2');
      if (meta) {
        const parsed = JSON.parse(meta);
        return parsed.updatedAt || null;
      }
    } catch {
      // ignore
    }
    return null;
  }

  private updateLocalWriteTime(): void {
    try {
      const meta = { updatedAt: new Date().toISOString() };
      localStorage.setItem('ls_tasks_meta_v2', JSON.stringify(meta));
    } catch {
      // ignore
    }
  }

  private startInterval(): void {
    this.intervalTimer = setInterval(() => {
      if (this.state.status === 'unauthenticated' || this.state.status === 'offline') return;
      this.doPull();
    }, SYNC_INTERVAL_MS);
  }

  private setupOnlineOffline(): void {
    window.addEventListener('online', () => {
      this.updateState({ status: 'syncing' });
      this.doPull();
    });
    window.addEventListener('offline', () => {
      this.updateState({ status: 'offline' });
    });
  }

  markLocalWrite(): void {
    this.updateLocalWriteTime();
    this.updateState((prev) => ({
      pendingChanges: prev.pendingChanges + 1,
    }));
    this.push();
  }

  async syncNow(): Promise<void> {
    if (!supabase) return;
    this.updateState({ status: 'syncing' });
    await this.doPush();
    await this.doPull();
  }

  async disconnect(): Promise<void> {
    if (!supabase) return;
    await supabase.auth.signOut();
    this.destroy();
    this.updateState({ status: 'idle' });
  }

  getState(): SyncState {
    return this.state;
  }

  private updateState(updates: Partial<SyncState> | ((prev: SyncState) => Partial<SyncState>)): void {
    const newUpdates = typeof updates === 'function' ? updates(this.state) : updates;
    this.state = { ...this.state, ...newUpdates };
    this.onStateChange(this.state);
  }
}
