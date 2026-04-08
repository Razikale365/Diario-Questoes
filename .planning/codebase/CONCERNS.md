# CONCERNS.md — Technical Debt & Known Issues

## Summary

The codebase is functional and well-structured for its size, but carries several known tech debt items accumulated across rapid iterative development cycles. The highest-risk areas involve data integrity (localStorage as sole local store), type safety bypasses, and a missing test suite.

---

## 🔴 High Priority

### 1. No Test Coverage for Critical Logic
**Files:** `src/utils/parser.ts`, `src/hooks/useTasks.ts`, `src/storage/SyncEngine.ts`

The parser (`parseLSTask`) is the most fragile and important piece of code — it converts free-form user-pasted text into structured data using regex. Any regression silently drops questions or creates wrong blocks. There is no test harness guarding it.

Similarly, `useTasks.moveBlock()` performs complex array surgery (recursive section drags with multiple splices) that is extremely easy to break.

**Risk:** Silent data corruption or lost user input on any parser/block mutation regression.

**Action:** Add vitest. Start with `parser.ts` unit tests and `useTasks` logic tests.

---

### 2. Last-Write-Wins Sync — No Conflict Resolution
**File:** `src/storage/SyncEngine.ts` (`doPull`, line 147)

```ts
if (!localUpdatedAt || new Date(remoteUpdatedAt) > new Date(localUpdatedAt)) {
  // Last-write-wins: remote is newer, replace local
  this.adapter.writeTasks(remoteTasks);
}
```

If a user works on two devices simultaneously, the later save silently overwrites the earlier one. There is no merge, diff, or conflict UI. For a study diary this may be acceptable, but any multi-device workflow risks data loss.

**Risk:** Data loss when working on multiple devices within the same sync window.

**Action:** Document this limitation clearly for users, or implement per-task merge by ID.

---

### 3. `useTasks.ts` Duplicates localStorage Reads on Init
**File:** `src/hooks/useTasks.ts` (lines 6–22)

`useTasks` reads from `localStorage` directly in its `useState` initializer, bypassing `LocalStorageAdapter`. Meanwhile, `SyncEngine` also uses `LocalStorageAdapter` to read/write tasks. This means there are **two parallel storage access paths** that can diverge.

```ts
// useTasks.ts — reads directly, not via adapter
const saved = localStorage.getItem('ls_tasks_v2');

// SyncEngine — reads via adapter
const tasks = this.adapter.readTasks(); // same key: 'ls_tasks_v2'
```

When `SyncEngine` pulls remote data, it dispatches a `ls_sync_pull` custom event. `App.tsx` listens and calls `setTasks(detail)` — which then triggers the `useEffect` in `useTasks` to write back to localStorage. This indirect chain is fragile and hard to trace.

**Risk:** Timing issues; sync pull could be overwritten by a stale `useEffect` on slow renders.

**Action:** Consolidate state management to flow through `SyncEngine↔StorageAdapter` as a single source of truth, or document the event handshake clearly.

---

## 🟡 Medium Priority

### 4. `as any` Type Bypasses in Layout Merges
**File:** `src/hooks/useTasks.ts` (lines 175, 190, 213)

```ts
layout: { ...block.layout, ...layout } as any
```

The `ActivityBlock.layout` type has a union that TypeScript can't narrow after spread. The casts silence the errors without fixing the underlying type mismatch. If `layout` fields are added or renamed, these casts will hide breakage.

**Action:** Define a proper `Partial<LayoutConfig>` type and use it in function signatures.

---

### 5. `revisionTaskModal` Typed as `any`
**File:** `src/App.tsx` (line 143)

```ts
const [revisionTaskModal, setRevisionTaskModal] = useState<any>({...})
```

This state object holds a full `StudyTask` without an `id` initially. The `RevisionTaskModalState` interface exists in `src/types/index.ts` but isn't used here, introducing a divergence risk.

**Action:** Use `RevisionTaskModalState & { id?: string; date?: string }` or extend the interface to cover the modal state shape.

---

### 6. Section Grouping by String Equality
**File:** `src/hooks/useTasks.ts` (`updateSectionBlocksLayout`, `toggleSectionLock`, `toggleSectionStats`, `moveBlock`)

Sections and their child blocks are linked via `block.lesson === section.title` (case-insensitive string match). This means:
- Renaming a section title breaks all block associations
- Identical lesson names across different tasks could theoretically collide (they don't because operations are task-scoped, but the patten is fragile)
- The `autoSnapBlocks()` function uses `lesson.includes(sectionTitle)` which allows partial matches — inconsistent with other functions using exact equality

**Action:** Consider assigning a `sectionId` to blocks at import time instead of relying on title equality.

---

### 7. `prompt()` for Section Creation
**File:** `src/App.tsx` (line 493)

```ts
const title = prompt('Título da Seção (ex: Aula 01):');
```

Native `window.prompt()` is used to create new sections. This is inconsistent with the rest of the UI (which uses styled modals), breaks on mobile WebViews, and cannot be styled or animated. This is a known placeholder.

**Action:** Replace with a styled inline input or a small modal (reuse `ConfirmModal` pattern).

---

### 8. `tmp_output.txt` / `tmp_output_utf8.txt` at Project Root
**Files:** `tmp_output.txt`, `tmp_output_utf8.txt`

These large text files (23 KB and 11 KB) appear to be captured stdout from past debugging sessions. They are not part of the application and should not be in version control.

**Action:** Add to `.gitignore`, delete files.

---

### 9. UAT Script Hardcodes Linux Path
**File:** `uat-test-phase15.cjs` (line 180)

```js
fs.writeFileSync('/tmp/uat-results.json', JSON.stringify(results, null, 2));
```

This path is hardcoded to `/tmp/` — broken on Windows where the project is developed. Results silently fail to save.

**Action:** Use `path.join(os.tmpdir(), 'uat-results.json')` or save relative to project root.

---

### 10. `@playwright/test` in `dependencies` (not `devDependencies`)
**File:** `package.json` (line 18)

Playwright is a 100+ MB dev-only test tool that ended up in `dependencies`. This pollutes production bundles and increases install size unnecessarily.

**Action:** Move to `devDependencies`.

---

## 🟢 Low Priority / Observations

### 11. `App.tsx` Growing Large (~625 lines)
`App.tsx` handles routing logic, all modal state, DnD context, sync initialization, export/import handlers, toast management, and section/task edit flows. While it's not yet unmanageable, it grows with each new feature.

**Observation:** Consider extracting modal state management into a `useModals` hook and import/export handlers into their own utility.

---

### 12. No Error Boundary
The app has no React Error Boundary. A runtime exception in any component unmounts the whole tree silently.

**Action:** Wrap `<App>` in an `<ErrorBoundary>` with a fallback UI.

---

### 13. Tailwind v4 `@tailwindcss/vite` Plugin (Still Experimental at Time of Adoption)
**File:** `vite.config.ts`, `package.json`

Tailwind CSS v4 was adopted via `@tailwindcss/vite` — the new Vite-native integration (replacing PostCSS). While this is now the recommended v4 approach, v4 was still in beta/RC during initial phases. Watch for breaking config changes.

---

### 14. Supabase Client May Be `null`
**File:** `src/lib/supabase.ts` (not read — inferred from `SyncEngine.ts`)

The Supabase client is nullable — `if (!supabase) return` guards are scattered throughout `SyncEngine.ts`. This is intentional (offline-first), but means sync silently does nothing if `.env` is missing or malformed. No user feedback is shown when Supabase is unavailable at startup.

**Action:** Add a `syncState.status === 'unauthenticated'` UI hint in the sidebar to make offline mode visible.

---

## Fragile Areas (Quick Reference)

| Area | Why Fragile |
|---|---|
| `parseLSTask()` | Complex regex on free-form text; no tests |
| `useTasks.moveBlock()` CASE 1 | Multi-splice index recalculation; no tests |
| `SyncEngine.doPull()` — last-write-wins | Silent data overwrite risk |
| Section title equality linking | Rename breaks associations |
| `prompt()` for section creation | Native browser dialog, not styled |
| `/tmp/` path in UAT script | Broken on Windows |
