# STACK.md — Technology Stack

## Runtime & Language
- **Language**: TypeScript ~5.8.2 (strict mode enabled)
- **Target**: ES2022 / ESNext modules
- **JSX**: react-jsx (React 19)
- **Module resolution**: bundler
- **Runtime**: Browser only (no SSR)

## Framework
- **React 19.0.0** — latest stable, uses `memo`, `forwardRef`, concurrent hooks
- **Vite 6.2.0** — build tool and dev server

## UI / Styling
- **Tailwind CSS v4.1.14** — via `@tailwindcss/vite` plugin (no config file needed)
- **Inline Tailwind classes only** — no separate CSS modules or styled-components
- `src/index.css` — minimal (just Tailwind directives)
- Primary color palette: `#84cc16` (lime green), `#5c2092` (purple sidebar), `#1a1a1a` / `#2d2d2d` / `#333333` / `#404040` (dark grays)

## Animation
- **Framer Motion 12.38.0** — used in `ActivityBlockCard.tsx` for `motion.div` fade-in/slide-in
- Native Tailwind `animate-in`, `fade-in`, `zoom-in-*`, `slide-in-from-*` utilities for modals and transitions

## Drag & Drop
- **@dnd-kit/core 6.3.1** — core sensors (Pointer, Touch, Keyboard), `DndContext`, `closestCenter`
- **@dnd-kit/sortable 10.0.0** — `SortableContext`, `useSortable`, `rectSortingStrategy`, `arrayMove`
- **@dnd-kit/modifiers 9.0.0** — `restrictToWindowEdges`
- **@dnd-kit/utilities 3.2.2** — `CSS.Translate`

## Icons
- **Lucide React 0.546.0** — tree-shakeable SVG icons, used extensively throughout UI

## Backend / Cloud
- **@supabase/supabase-js 2.101.1** — optional cloud sync (email/password auth + single-row storage)
- Supabase client initialized conditionally: if `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are missing, cloud features are disabled gracefully

## Testing
- **@playwright/test 1.59.1** — end-to-end testing (installed but minimal test coverage)
- `uat-test-phase15.cjs` — standalone UAT script at project root

## Dev Dependencies
- `typescript ~5.8.2`, `tsx 4.21.0` (for running .ts scripts directly)
- `autoprefixer 10.4.21`
- `@types/react 19.2.14`, `@types/react-dom 19.2.3`, `@types/node 22.14.0`

## Build & Scripts
```json
"dev":     "vite --port=3000 --host=0.0.0.0"
"build":   "vite build"
"preview": "vite preview"
"clean":   "rm -rf dist"
"lint":    "tsc --noEmit"
```

## Environment Variables
```
VITE_SUPABASE_URL      — Supabase project URL
VITE_SUPABASE_ANON_KEY — Supabase anonymous key
DISABLE_HMR            — Set to "true" to disable HMR (used by AI Studio to prevent flicker)
```

## Key Configuration
- `tsconfig.json`: strict, `allowJs: true`, `allowImportingTsExtensions: true`, `noEmit: true`
- `vite.config.ts`: path alias `@` → project root (`./`), HMR toggle via env var
- localStorage keys: `ls_tasks_v2`, `ls_active_task_v2`, `ls_tasks_meta_v2`
- Supabase table: `diario_ls_sync` (single-row upsert per user_id)
