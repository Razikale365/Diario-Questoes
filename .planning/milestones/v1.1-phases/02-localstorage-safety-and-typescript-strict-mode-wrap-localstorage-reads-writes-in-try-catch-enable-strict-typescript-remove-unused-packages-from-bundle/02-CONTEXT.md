# Phase 2: localStorage Safety and TypeScript Strict Mode - Context

**Gathered:** 2026-03-30
**Status:** Ready for planning
**Mode:** Auto-generated (autonomous — infrastructure phase with clear CONCERNS.md spec)

<domain>
## Phase Boundary

Protect the app from data-loss bugs and silent type errors:
1. Wrap all localStorage reads (`getItem` + `JSON.parse`) in try/catch — return safe defaults on error
2. Wrap all localStorage writes (`setItem`) in try/catch — show toast on `QuotaExceededError`
3. Enable TypeScript strict mode (`"strict": true` in tsconfig.json) and fix all resulting errors
4. Remove unused npm packages: `@google/genai`, `express`, `dotenv`, `motion`
5. Also remove the `GEMINI_API_KEY` inline from `vite.config.ts` since `@google/genai` is being removed

</domain>

<decisions>
## Implementation Decisions

### localStorage Error Strategy
- On parse failure: return `[]` (for tasks) or `null` (for activeTaskId) — silent recovery, log to console
- On `QuotaExceededError` in `setItem`: show toast "⚠ Armazenamento cheio — dados não foram salvos"
- Both `ls_tasks_v2` and `ls_active_task_v2` reads get try/catch treatment

### TypeScript Strict Mode
- Enable `"strict": true` immediately — fix all resulting errors in the same commit
- Replace all inferred-`any` patterns with explicit types
- Add null checks where strict mode enforces them (use optional chaining `?.` and non-null assertions `!` where appropriate)

### Package Cleanup
- Remove: `@google/genai`, `express`, `dotenv`, `motion` from package.json
- Reason: none are imported anywhere in the codebase
- Remove the `GEMINI_API_KEY` define from `vite.config.ts` (was for the removed AI package)
- Keep: all other deps (React, lucide-react, etc.)

### the Agent's Discretion
- The try/catch for `setItem` can be in a shared `safeSetItem()` utility or inlined in each useEffect — inline is fine given single-file architecture
- Only fix TypeScript errors that strict mode actually reports — do not over-engineer

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `showToast(message: string)` — existing helper at App.tsx:248, will be used for quota error toast
- All localStorage interactions in two `useState` initializers (lines 187-193) and two `useEffect` hooks (lines 236-246)

### Established Patterns
- State initializers use lazy `() => { ... }` form — wrap the body in try/catch
- `useEffect` hooks write to localStorage on state change — wrap `setItem` calls
- `showToast` is called from event handlers — same pattern for error toast

### Integration Points
- `useState<StudyTask[]>(() => { ... })` at line 187 — tasks initializer wraps JSON.parse
- `useState<string | null>(() => { ... })` at line 191 — active task ID initializer wraps getItem
- `useEffect` at line 236 — ls_tasks_v2 setItem
- `useEffect` at line 240 — ls_active_task_v2 setItem/removeItem
- `tsconfig.json` — add `"strict": true`
- `package.json` — remove 4 unused packages
- `vite.config.ts` — remove GEMINI_API_KEY define

</code_context>

<specifics>
## Specific Ideas

- The try/catch in useState initializers cannot call `showToast` (it's defined inside the component, after state); use `console.error` for parse failures there
- For `setItem` failures in useEffect, we CAN show toast since the component is mounted
- The QuotaExceededError check: `catch (e) { if (e instanceof DOMException) showToast('...') }`

</specifics>

<deferred>
## Deferred Ideas

- Centralized localStorage service class — deferred to Backlog (CONCERN-15 data migration)
- Adding an IndexedDB fallback — out of scope for this phase
- localStorage size monitoring — Backlog item

</deferred>
