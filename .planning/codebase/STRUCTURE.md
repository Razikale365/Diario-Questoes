# STRUCTURE.md — Directory Layout & Organization

## Project Root
```
Diario-Questoes/
├── src/                    # All application source code
│   ├── App.tsx             # THE entire application (1195 lines)
│   ├── main.tsx            # React entry point (11 lines)
│   └── index.css           # Global styles + Tailwind + Google Fonts (13 lines)
├── .planning/              # GSD planning directory
│   └── codebase/           # This codebase map
├── index.html              # HTML shell (14 lines)
├── package.json            # Dependencies & scripts
├── package-lock.json       # Lockfile
├── tsconfig.json           # TypeScript config
├── vite.config.ts          # Vite build config
├── metadata.json           # AI Studio app metadata
├── .env                    # Local environment variables (gitignored)
├── .env.example            # Template for env vars
├── .gitignore              # Git exclusions
├── README.md               # Setup instructions
├── node_modules/           # Dependencies (gitignored)
└── diário-de-revisão-ls.zip  # Archive file (binary, not used)
```

---

## Source Files Detail

### `src/App.tsx` (1195 lines)
The **only** application file with logic. Contains:
- Lines 1–2: Imports (React hooks + lucide-react icons)
- Lines 4–33: TypeScript interfaces (`Question`, `ActivityBlock`, `StudyTask`)
- Lines 35–72: Data constants (`BANKS`, `PLANEJAMENTOS`, `DISCIPLINAS`)
- Lines 74–171: `parseLSTask()` — core text parser function
- Lines 173–180: `formatQuestionList()` — formatter utility
- Lines 182–539: `App` function component (state declarations + handlers)
- Lines 541–1192: JSX return (sidebar + 3 tabs + 2 modals)
- Lines 1194–1195: `export default App`

### `src/main.tsx` (11 lines)
Standard React 19 entry point using `createRoot`. No customization.

### `src/index.css` (13 lines)
```css
@import url('https://fonts.googleapis.com/...Open+Sans...');
@import "tailwindcss";
@theme { --font-sans: "Open Sans", ...; }
body { background-color: #2d2d2d; color: #f5f5f5; }
```

### `index.html` (14 lines)
Minimal HTML shell. Title: "Diário de Questões - LS Ensino - JPCCN" (default — not updated).

---

## Key Locations by Feature

| Feature | Location |
|---|---|
| Task import form | `src/App.tsx` lines ~619–709 |
| Active task header | `src/App.tsx` lines ~784–813 |
| Question grid (per block) | `src/App.tsx` lines ~845–891 |
| Gabarito import modal | `src/App.tsx` lines ~1063–1099 |
| Block edit modal | `src/App.tsx` lines ~1101–1188 |
| Revision generator tab | `src/App.tsx` lines ~909–986 |
| Task history tab | `src/App.tsx` lines ~988–1057 |
| Text parser logic | `src/App.tsx` lines 74–171 |
| Revision computation | `src/App.tsx` lines 495–534 |

---

## Naming Conventions

### Files
- Single `App.tsx` — no naming convention enforced (only one component file)
- CSS file: `index.css` (standard Vite convention)

### TypeScript
- **Interfaces:** PascalCase — `StudyTask`, `ActivityBlock`, `Question`
- **Constants:** SCREAMING_SNAKE_CASE — `BANKS`, `PLANEJAMENTOS`, `DISCIPLINAS`
- **State variables:** camelCase — `activeTaskId`, `importDiscipline`, `blockEditModal`
- **Event handlers:** `handle*` prefix — `handleImport`, `handleDeleteBlock`, `handleImportGabarito`, `handleCopy`
- **Action functions:** verb + noun — `finishTask`, `deleteTask`, `toggleLock`, `openEditBlock`, `saveBlockEdit`, `undoDeleteBlock`
- **Computed/derived values:** noun — `activeTask`, `generatedRevision`, `uniqueDisciplines`, `availableLessons`

### CSS / Tailwind
- All styling is utility-first via Tailwind classes in JSX
- No custom CSS classes defined (only base `body` styles in `index.css`)
- Color palette: dark grays (`#2d2d2d`, `#333333`, `#404040`, `#525252`, `#262626`), purple sidebar (`#5c2092`), accent lime-green (`#84cc16`)

---

## Build Output
- `dist/` — Vite build output (gitignored)
- Entry: `index.html` → `src/main.tsx` → `src/App.tsx`

---

## Missing Common Directories
These directories are **not present** (codebase is minimal):
- No `src/components/` — no component decomposition
- No `src/hooks/` — no custom hooks
- No `src/utils/` — utility functions inline in App.tsx
- No `src/types/` — types defined inline
- No `src/constants/` — constants defined inline
- No `src/services/` — no API layer
- No `tests/` or `__tests__/` — no test files
- No `public/` — no static assets
- No `api/` — no server routes
