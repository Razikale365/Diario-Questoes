import type { StudyTask } from '../types';
import type { SyncState } from '../types/sync';
import { supabase } from '../lib/supabase';
import { StorageAdapter } from '../storage/StorageAdapter';
import {
  areStudyTaskCollectionsEqual,
  mergeStudyTaskCollections,
} from '../utils/taskSyncMerge';

const SYNC_DEBOUNCE_MS = 2000;
const SYNC_INTERVAL_MS = 30000;
const SYNC_DATA_KEY = 'diario_ls_sync';
const META_KEY = 'ls_tasks_meta_v2';

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
  /** True while the startup pull is in-flight — blocks pushes to prevent overwrite */
  private isPullInProgress = false;
  /** Whether a push was requested while pull was in progress */
  private pushPending = false;

  constructor(adapter: StorageAdapter, onStateChange: (state: SyncState) => void) {
    this.adapter = adapter;
    this.onStateChange = onStateChange;
  }

  init(): void {
    if (!supabase) {
      this.updateState({ status: 'unauthenticated' });
      return;
    }
    if (this.isInitialized) return void this.pullOnStart();
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

    // Block push while startup pull is in-flight to prevent overwriting cloud data
    // with potentially stale/empty local state from a new device
    if (this.isPullInProgress) {
      this.pushPending = true;
      return;
    }

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

      const localTasks = this.adapter.readTasks();
      const { data: remoteData, error: remoteError } = await supabase
        .from(SYNC_DATA_KEY)
        .select('payload')
        .eq('user_id', session.user.id)
        .maybeSingle();
      if (remoteError) throw remoteError;

      const remoteTasks: StudyTask[] = Array.isArray(remoteData?.payload)
        ? remoteData.payload
        : [];
      const { tasks } = mergeStudyTaskCollections(remoteTasks, localTasks);
      const localChanged = !areStudyTaskCollectionsEqual(tasks, localTasks);
      if (localChanged) {
        this.adapter.writeTasks(tasks);
        window.dispatchEvent(new CustomEvent('ls_sync_pull', { detail: tasks }));
      }
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

      // Track the cloud timestamp so future pulls can compare correctly
      this.setCloudUpdatedAt(now);

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

    this.isPullInProgress = true;
    this.updateState({ status: 'syncing' });

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
    } finally {
      this.isPullInProgress = false;

      // Flush any push that was queued while pull was running
      if (this.pushPending) {
        this.pushPending = false;
        this.push();
      }
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
          // No remote data yet — push local (safe: nothing to lose on the cloud)
          await this.doPush();
          return;
        }
        throw error;
      }

      if (!data) return;

      const remoteTasks: StudyTask[] = Array.isArray(data.payload) ? data.payload : [];
      const remoteUpdatedAt: string = data.updated_at;
      const localTasks = this.adapter.readTasks();

      const { tasks: merged, differsFromRemote } = mergeStudyTaskCollections(
        remoteTasks,
        localTasks,
      );
      this.setCloudUpdatedAt(remoteUpdatedAt);

      const dataChanged = !areStudyTaskCollectionsEqual(merged, localTasks);
      if (dataChanged) {
        this.adapter.writeTasks(merged);
        window.dispatchEvent(new CustomEvent('ls_sync_pull', { detail: merged }));
      }

      if (differsFromRemote) {
        setTimeout(() => this.doPush(), 200);
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

  // ── Meta helpers ────────────────────────────────────────────────────────────

  private readMeta(): Record<string, string> {
    try {
      const raw = localStorage.getItem(META_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  private writeMeta(updates: Record<string, string>): void {
    try {
      const meta = this.readMeta();
      localStorage.setItem(META_KEY, JSON.stringify({ ...meta, ...updates }));
    } catch {
      // ignore
    }
  }

  private setCloudUpdatedAt(ts: string): void {
    this.writeMeta({ cloudUpdatedAt: ts });
  }

  private updateLocalWriteTime(): void {
    this.writeMeta({ localUpdatedAt: new Date().toISOString() });
  }

  // ── Interval / online-offline ────────────────────────────────────────────────

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

  // ── Public API ───────────────────────────────────────────────────────────────

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
    await this.doPull();
    await this.doPush();
  }

  /** Returns the last 10 snapshots for the current user, newest first */
  async listHistory(): Promise<import('../types/sync').SyncHistoryEntry[]> {
    if (!supabase) return [];
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return [];
    const { data, error } = await supabase
      .from('diario_ls_sync_history')
      .select('id, user_id, task_count, snapshot_at, source')
      .eq('user_id', session.user.id)
      .order('snapshot_at', { ascending: false })
      .limit(10);
    if (error) return [];
    return (data ?? []) as import('../types/sync').SyncHistoryEntry[];
  }

  /** Saves an explicit named snapshot (manual backup point) */
  async saveManualSnapshot(): Promise<void> {
    if (!supabase) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const tasks = this.adapter.readTasks();
    await supabase.from('diario_ls_sync_history').insert({
      user_id: session.user.id,
      payload: tasks,
      source: 'manual',
    });
  }

  /** Restores a specific snapshot by its history id */
  async restoreFromHistory(snapshotId: string): Promise<StudyTask[] | null> {
    if (!supabase) return null;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;
    const { data, error } = await supabase
      .from('diario_ls_sync_history')
      .select('payload')
      .eq('id', snapshotId)
      .eq('user_id', session.user.id)
      .single();
    if (error || !data) return null;
    const tasks = data.payload as StudyTask[];
    // Write locally
    this.adapter.writeTasks(tasks);
    // Push restored data to main sync table
    await this.doPush();
    // Notify React
    window.dispatchEvent(new CustomEvent('ls_sync_pull', { detail: tasks }));
    return tasks;
  }

  async disconnect(): Promise<void> {
    if (!supabase) return;
    await supabase.auth.signOut();
    this.destroy();
    this.updateState({ status: 'unauthenticated' });
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
