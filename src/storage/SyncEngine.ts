import { StudyTask } from '../types';
import { SyncState, SyncStatus } from '../types/sync';
import { supabase } from '../lib/supabase';
import { StorageAdapter } from '../storage/StorageAdapter';

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

      await this.doPull({ isStartup: true });
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

  private async doPull(opts: { isStartup?: boolean } = {}): Promise<void> {
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

      // A "fresh device" is one that has never synced before (no cloudUpdatedAt stored).
      // In that case we always defer to the cloud to avoid overwriting valid history.
      const knownCloudUpdatedAt = this.getCloudUpdatedAt();
      const isFreshDevice = opts.isStartup && !knownCloudUpdatedAt;
      const remoteIsNewer =
        !knownCloudUpdatedAt ||
        new Date(remoteUpdatedAt) > new Date(knownCloudUpdatedAt);

      if (isFreshDevice || remoteIsNewer) {
        // Merge: remote tasks are authoritative on id collision,
        // but local-only tasks (not in remote) are preserved to avoid any data loss.
        const merged = this.mergeTasks(remoteTasks, localTasks);
        this.adapter.writeTasks(merged);
        this.setCloudUpdatedAt(remoteUpdatedAt);

        // Notify React state
        window.dispatchEvent(new CustomEvent('ls_sync_pull', { detail: merged }));

        // If we added local-only tasks to the merge, push the combined set back
        const hadLocalOnly = merged.length > remoteTasks.length;
        if (hadLocalOnly) {
          setTimeout(() => this.doPush(), 200);
        }
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

  /**
   * Merges remote and local task arrays.
   * - Remote tasks take precedence on id collision (cloud is source of truth for conflicts).
   * - Local-only tasks (ids not in remote) are appended so no local work is ever silently lost.
   */
  private mergeTasks(remote: StudyTask[], local: StudyTask[]): StudyTask[] {
    const remoteIds = new Set(remote.map(t => t.id));
    const localOnly = local.filter(t => !remoteIds.has(t.id));
    return [...remote, ...localOnly];
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

  /** Last known cloud updated_at timestamp (to detect if remote has newer data) */
  private getCloudUpdatedAt(): string | null {
    return this.readMeta().cloudUpdatedAt || null;
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
