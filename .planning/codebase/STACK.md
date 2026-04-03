# STACK.md — Technology Stack

## Project Identity
- **App name:** Diário de Revisão LS
- **Description:** Web app for tracking question attempts and auto-generating revision lists for Brazilian public exam (concurso) study plans.
- **Originated from:** Google AI Studio app scaffold (`react-example`)

---

## Language & Runtime
| Item | Value |
|---|---|
| Language | TypeScript 5.8 |
| Target | ES2022 |
| JSX | react-jsx (React 19 transform) |
| Module system | ESNext modules (`"type": "module"`) |
| Runtime | Browser (SPA) |
| Node.js | Used only for build tooling |

---

## Framework
- **React 19** (`react@^19.0.0`, `react-dom@^19.0.0`)
  - Uses React Hooks exclusively (`useState`, `useEffect`, `useMemo`)
  - No routing library — single page with tab-based navigation
  - No state management library — all state local to `App` function component

---

## Build Tool
- **Vite 6.2** (`vite@^6.2.0`)
  - Config: `vite.config.ts`
  - Plugins: `@vitejs/plugin-react`, `@tailwindcss/vite`
  - Dev server: port 3000, host 0.0.0.0
  - HMR: conditionally disabled via `DISABLE_HMR` env var (AI Studio compatibility)
  - Path alias: `@` → project root

---

## Styling
- **Tailwind CSS v4** (`tailwindcss@^4.1.14`)
  - Integrated via `@tailwindcss/vite` plugin (new v4 approach — no `tailwind.config.js`)
  - Custom theme in `src/index.css` via `@theme { --font-sans: ... }`
  - All styling done inline via Tailwind utility classes in JSX
- **Google Fonts** — Open Sans (400, 600, 700) imported in `src/index.css`

---

## UI Libraries
- **lucide-react `^0.546.0`** — icon library (BookOpen, List, History, Save, Copy, etc.)
- **motion `^12.23.24`** — animation library (imported in package.json, not yet actively used in code)

---

## Key Dev Dependencies
| Package | Version | Purpose |
|---|---|---|
| `typescript` | ~5.8.2 | Type checking |
| `tsx` | ^4.21.0 | TypeScript execution for scripts |
| `@types/node` | ^22.14.0 | Node type definitions |
| `autoprefixer` | ^10.4.21 | CSS vendor prefixes |

---

## Scripts
```json
"dev":     "vite --port=3000 --host=0.0.0.0"
"build":   "vite build"
"preview": "vite preview"
"clean":   "rm -rf dist"
"lint":    "tsc --noEmit"
```

---

## Browser APIs Used
- `localStorage` — persistent storage for tasks (`ls_tasks_v2`, `ls_active_task_v2`)
- `crypto.randomUUID()` — ID generation for tasks and blocks
- `navigator.clipboard.writeText()` — copy revision text to clipboard
- `window.confirm()` — delete confirmation dialogs

---

## TypeScript Config (tsconfig.json)
```json
{
  "target": "ES2022",
  "module": "ESNext",
  "moduleResolution": "bundler",
  "jsx": "react-jsx",
  "allowJs": true,
  "isolatedModules": true,
  "noEmit": true,
  "paths": { "@/*": ["./*"] }
}
```

---

## Unused / Available but Inactive
- `express@^4.21.2` + `@types/express` — present in `package.json` but no server file exists; likely from AI Studio scaffold
- `@google/genai@^1.29.0` — Gemini SDK present but **not imported anywhere** in current code
- `motion` — installed but not used in any component
- `dotenv@^17.2.3` — env management, used by Vite internally via `loadEnv`
