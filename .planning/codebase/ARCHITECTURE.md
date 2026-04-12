# ARCHITECTURE.md — System Architecture

## Pattern
**Single-Page Application (SPA)** — React 19, no routing library, no SSR. All state lives in-memory and persists to localStorage.

## Layers

```
┌─────────────────────────────────────────────────────┐
│              UI Components  (src/components/)        │
│  App.tsx (root) → Sidebar, TaskHeader, ActivityBlockCard │
│  ImportArea, RevisionArea, HistoryList, Modals       │
└──────────────────────┬──────────────────────────────┘
                       │ props + callbacks (no context API)
┌──────────────────────▼──────────────────────────────┐
│          State & Logic  (src/hooks/)                 │
│  useTasks.ts  — all task/block/question mutations    │
│  useSnapResizer.ts  — drag-resize hook               │
└──────────────────────┬──────────────────────────────┘
                       │ reads/writes
┌──────────────────────▼──────────────────────────────┐
│          Storage Layer  (src/storage/)               │
│  StorageAdapter (interface) + LocalStorageAdapter    │
│  SyncEngine — Supabase cloud sync (optional)         │
└──────────────────────┬──────────────────────────────┘
                       │ conditional
┌──────────────────────▼──────────────────────────────┐
│          External  (src/lib/)                        │
│  supabase.ts — nullable Supabase client              │
└─────────────────────────────────────────────────────┘
```

## Data Flow

1. **Import**: User pastes LS platform text → `ImportArea` → `parseLSTask()` → `StudyTask` object → `useTasks.addTask()` → React state → localStorage
2. **Answering questions**: `ActivityBlockCard` → button click → `onUpdateQuestion()` → `useTasks.updateQuestion()` → immutable state update → localStorage persists via `useEffect`
3. **Sync**: localStorage state → `SyncEngine.syncNow()` → Supabase upsert / pull
4. **DND reorder**: `DndContext.onDragEnd` → `useTasks.moveBlock()` → updates block order in state
5. **Revision generation**: `RevisionArea` → filters completed tasks by discipline + lesson → generates text list of wrong/doubt questions

## State Management
- **No Redux, Zustand, or Context API** — state is hoisted at `App.tsx` level
- `useTasks` hook owns all task state via `useState<StudyTask[]>`
- Sync state (`SyncState`) managed separately in `App.tsx` via `useState<SyncState>`
- All child components receive data and callbacks via props (prop drilling is the intentional pattern)

## Key Abstractions

### StudyTask
Top-level entity. Has `id`, `date`, `discipline`, `bank`, `status`, and `blocks: ActivityBlock[]`.

### ActivityBlock
Can be either:
1. **Activity block** — has `questions[]`, `layout`, `bank`, `lesson`, `pages`
2. **Section Header** — `isSection: true`, empty `questions[]`, used visually as a divider/grouping label

### Section System
- Sections are not a separate data type — they're `ActivityBlock` objects with `isSection: true`
- Blocks are linked to sections by matching `block.lesson === section.title` (case-insensitive)
- Section stats aggregated in `App.tsx` before being passed down as `sectionStats` prop

### Question
Primitive unit: `{ number, answer, isCorrect, hasDoubt, correctAnswer?, isMultipleChoice?, eliminated? }`

## Entry Points
- `index.html` → `src/main.tsx` → `<App />` mounted to `#root`
- `src/main.tsx` — minimal, just `createRoot().render()`

## Grid Layout System
- Outer grid: CSS `grid-cols-12` on the blocks container
- Each `ActivityBlock` has `layout.width` (3 | 6 | 9 | 12 = col-span) and `layout.rowSpan`
- Inner questions grid: configurable `layout.columns × layout.rows`, type `'grid' | 'columns'`
- Resize handled by `useSnapResizer` hook — snaps to 3, 6, 9, 12 horizontal columns

## Concurrency Model
- Supports multiple in-progress tasks simultaneously (`status: 'in_progress'`)
- Only one task "active" at a time (tracked by `activeTaskId`)
- Pause/resume: set `activeTaskId = null` to pause, set to task ID to resume
