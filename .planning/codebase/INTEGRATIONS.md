# INTEGRATIONS.md — External Services & APIs

## External APIs

### Google Gemini AI (`@google/genai`)
- **Package:** `@google/genai@^1.29.0`
- **Status:** ⚠️ INSTALLED BUT NOT INTEGRATED — the SDK is in `package.json` but **not imported or called anywhere** in `src/App.tsx` or any other source file.
- **Configuration:** `GEMINI_API_KEY` is passed to the browser via Vite's `define` in `vite.config.ts`:
  ```ts
  'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
  ```
- **Env var source:** `.env` / `.env.local` file (example in `.env.example`)
- **Future use:** Likely intended for AI-powered features (e.g., auto-explain wrong answers, AI revision suggestions)

---

## Google Fonts
- **URL:** `https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;600;700&display=swap`
- **Loaded via:** CSS `@import` in `src/index.css`
- **Purpose:** Typography — Open Sans as the app's default font family

---

## Hosting / Deployment Platform

### Google AI Studio
- **App URL:** `https://ai.studio/apps/948bbcb4-f76e-45aa-967e-d08ff90e23ab` (from README)
- `APP_URL` env var is configured by AI Studio automatically for Cloud Run deployments
- `GEMINI_API_KEY` is injected by AI Studio from user secrets at runtime
- HMR is disabled via `DISABLE_HMR=true` env var in the AI Studio environment

---

## Browser Storage
- **localStorage** — the only persistence layer currently in use
  - `ls_tasks_v2` — array of `StudyTask` objects (full app state)
  - `ls_active_task_v2` — string ID of the currently active task
  - No expiration logic; data persists indefinitely until cleared

---

## Express Server
- **Package:** `express@^4.21.2` + `@types/express@^4.17.21`
- **Status:** ⚠️ INSTALLED BUT NOT USED — no server file exists in the codebase (`server.ts`, `api/`, etc.)
- **Likely origin:** AI Studio scaffold boilerplate for optional server-side features

---

## No Active External Integrations
The app currently has **zero live API calls** or server-side integrations. It is a fully client-side, offline-capable SPA that stores all data in `localStorage`.

### What is NOT integrated (but installed):
| Package | Reason Not Used |
|---|---|
| `@google/genai` | Key wired but no API calls made |
| `express` | No server route files found |
| `dotenv` | Used indirectly by Vite's `loadEnv` |

---

## Summary
| Service | Status | Notes |
|---|---|---|
| Gemini AI | Not active | SDK present, key configured, no usage |
| Google Fonts | Active | Open Sans font loading |
| AI Studio Hosting | Active (prod) | Cloud Run deployment |
| localStorage | Active | Sole persistence mechanism |
| Express API | Not active | Package present, no routes |
