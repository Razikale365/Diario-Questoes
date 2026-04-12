# STRUCTURE.md — Directory Structure

## Root Layout
```
Diario-Questoes/
├── src/                    # All application code
│   ├── App.tsx             # Root component — orchestrates all state & layout (625 lines)
│   ├── main.tsx            # React entry point
│   ├── index.css           # Minimal global styles (Tailwind import only)
│   ├── vite-env.d.ts       # Vite env type declarations
│   ├── components/         # UI components (14 files)
│   ├── hooks/              # Custom React hooks (2 files)
│   ├── lib/                # External service clients (1 file)
│   ├── storage/            # Data persistence layer (2 files)
│   ├── types/              # TypeScript interfaces (2 files)
│   └── utils/              # Pure utilities (2 files)
├── .planning/              # GSD project management
│   ├── PROJECT.md
│   ├── ROADMAP.md
│   ├── STATE.md
│   ├── codebase/           # This directory (7 docs)
│   ├── milestones/         # Per-milestone planning artifacts
│   ├── phases/             # Phase plans
│   └── ui-reviews/         # UI review artifacts
├── index.html              # SPA shell
├── package.json
├── tsconfig.json
├── vite.config.ts
├── .env                    # Supabase credentials (gitignored)
├── .env.example            # Template with documented variables
├── SUPABASE_SETUP.md       # Supabase integration guide
└── uat-test-phase15.cjs    # UAT test script
```

## `src/components/` — UI Components

| File | Purpose | Size |
|------|---------|------|
| `ActivityBlockCard.tsx` | Main question block card — renders both section headers and activity blocks; handles question answering, layout, DnD, resize | 473 lines |
| `TaskHeader.tsx` | Task info display + edit form + global layout controls + "Revisar com IA" prompt generator | 416 lines |
| `HistoryList.tsx` | Paginated history of completed tasks with search and filter | 14.3 KB |
| `ImportArea.tsx` | Form to paste LS platform task text + metadata fields; triggers parseLSTask() | 165 lines |
| `RevisionArea.tsx` | Generates revision list from completed tasks; lesson-level checkbox selector | 177 lines |
| `Sidebar.tsx` | Left navigation + backup actions (export/import/merge/paste) + sync badge | 161 lines |
| `SyncStatusBadge.tsx` | Compact sync status indicator with login/disconnect actions | 96 lines |
| `BlockEditModal.tsx` | Modal to create/edit activity blocks (title, lesson, bank, question numbers, layout) | 8.8 KB |
| `SectionEditModal.tsx` | Modal to bulk-update all blocks in a section (width, rowSpan) | 6 KB |
| `GabaritoModal.tsx` | Modal to paste/parse correct answer key (gabarito) for a block | 3.8 KB |
| `AuthModal.tsx` | Email/password login & signup modal for Supabase | 128 lines |
| `CreateTaskModal.tsx` | Confirmation modal for creating revision tasks | 5.4 KB |
| `PasteBackupModal.tsx` | Textarea modal to paste JSON backup (import or merge) | 2.9 KB |
| `ConfirmModal.tsx` | Generic destructive action confirmation dialog | 2.3 KB |

## `src/hooks/`

| File | Purpose |
|------|---------|
| `useTasks.ts` | Core state hook — all task/block/question CRUD, DnD, layout, sections, lock, stats, gabarito (523 lines) |
| `useSnapResizer.ts` | Mouse-drag resize hook — snaps block width/height to grid columns/rows |

## `src/storage/`

| File | Purpose |
|------|---------|
| `StorageAdapter.ts` | `StorageAdapter` interface + `LocalStorageAdapter` class — reads/writes to `ls_tasks_v2` |
| `SyncEngine.ts` | Class-based sync orchestrator — debounced push, periodic pull, online/offline detection (235 lines) |

## `src/types/`

| File | Purpose |
|------|---------|
| `index.ts` | Core domain types: `Question`, `ActivityBlock`, `StudyTask`, `RevisionTaskModalState` |
| `sync.ts` | Sync types: `SyncStatus`, `SyncRecord`, `SyncState` |

## `src/utils/`

| File | Purpose |
|------|---------|
| `constants.ts` | Static data: `PLANEJAMENTOS`, `DISCIPLINAS`, `BANKS` lists |
| `parser.ts` | `parseLSTask()` — parses LS platform task text into blocks; `formatQuestionList()`, `parseQuestionsText()` |

## `src/lib/`

| File | Purpose |
|------|---------|
| `supabase.ts` | Creates and exports nullable Supabase client |

## Key File Size Reference
- Largest: `App.tsx` (625 lines) — root orchestrator, likely candidate for refactoring
- `ActivityBlockCard.tsx` (473 lines) — complex component with dual mode (section header / activity block)
- `useTasks.ts` (523 lines) — the heart of all business logic

## Naming Conventions
- Components: PascalCase, `.tsx` extension
- Hooks: camelCase with `use` prefix, `.ts` extension
- Utils/lib: camelCase, `.ts` extension
- Types: PascalCase interfaces exported from `index.ts`
