# INTEGRATIONS.md — External Services & APIs

## Supabase (Cloud Sync)
- **SDK**: `@supabase/supabase-js 2.101.1`
- **Client**: `src/lib/supabase.ts` — exports nullable `supabase` client
- **Auth**: Email + Password (Supabase Auth)
  - Sign up: `supabase.auth.signUp({ email, password })`
  - Sign in: `supabase.auth.signInWithPassword({ email, password })`
  - Sign out: `supabase.auth.signOut()`
  - Session check: `supabase.auth.getSession()`
- **Database**: Single table `diario_ls_sync`
  - Schema: `{ id: user_id, user_id, payload: StudyTask[], updated_at }`
  - Strategy: One row per user (upsert on `id`)
  - Conflict resolution: last-write-wins based on `updated_at` timestamp
- **Graceful degradation**: If env vars are missing, `supabase` is `null` and all sync features silently disable

### Sync Flow
1. On init: `pullOnStart()` → if no remote record, push local data
2. On data change: React state → `localStorage` → `SyncEngine.markLocalWrite()` → debounced push (2s)
3. On pull: compares remote `updated_at` vs local `ls_tasks_meta_v2.updatedAt` → newer wins
4. Periodic pull: every 30 seconds while authenticated
5. Online/offline: browser `online`/`offline` events trigger sync or mark as offline

### Sync States
`idle` | `syncing` | `synced` | `error` | `offline` | `unauthenticated`

**Note**: `SyncEngine.markLocalWrite()` is defined but **never called** from `useTasks.ts` or `App.tsx`. Sync is triggered manually via `syncNow()` or on pull timer — local writes do NOT auto-push.

## Browser APIs Used
- `localStorage` — primary data persistence (keys: `ls_tasks_v2`, `ls_active_task_v2`, `ls_tasks_meta_v2`)
- `navigator.clipboard.writeText()` — used for copy AI prompt and copy revision text
- `crypto.randomUUID()` — UUID generation for task/block IDs
- `document.createElement('a')` — file download for JSON backup export
- `FileReader` — reading imported JSON backup files
- `CustomEvent('ls_sync_pull')` — cross-boundary notification from `SyncEngine` to React state
- `window.addEventListener('online'|'offline')` — network status tracking

## No External Analytics / Telemetry
- No tracking libraries (no GA, Sentry, Mixpanel, etc.)
- No CDN dependencies (all bundled locally)

## No External Font / Icon CDNs
- Lucide React icons bundled via npm
- No Google Fonts or external typography requests
