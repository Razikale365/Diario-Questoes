# CONCERNS.md — Technical Debt, Risks & Issues

## 🔴 Critical Issues

### 1. Code Modularization (Partially Resolved)
- ✓ Extracted custom hooks (`useTasks`), components, and utils.
- `src/App.tsx` reduced from 1200 to ~580 lines.
- **Next:** Continue extracting sub-components from `App.tsx` (modals, tabs).

---

### 2. localStorage Safety (Resolved)
- ✓ Added try/catch blocks around all storage reads and writes in `useTasks.ts`.
- ✓ Corrupted data now falls back to empty state instead of crashing.

---

### 3. Brittle Text Parser (`parseLSTask`)
- Entire data import depends on regex patterns matching LS platform text format exactly
- The LS (LFG) platform can change its text export format at any time
- Any whitespace or punctuation change in the source text breaks parsing silently (returns empty array)
- Regex patterns are complex and not documented:
  ```ts
  /resolv(?:a|er) as questões|refaça as questões/i
  /questões\s+(?:de\s+)?(\d+)\s+a\s+(\d+)/i
  /questões\s+([\d\s,e]+)(?:das\s+páginas|\(total|da\s+pág)/i
  ```
- **Risk:** Import fails completely with no actionable error message for user
- **Fix:** Add parser test suite with real LS text samples; expose parse errors with specific messages

---

## 🟡 Moderate Issues

### 4. TypeScript Strict Mode (Resolved)
- ✓ Enabled `"strict": true` in `tsconfig.json`.
- ✓ Fixed type errors across the codebase.

### 5. No Input Validation / Data Integrity
- `handleImport` only validates that `importDiscipline` is non-empty and text produces blocks
- No validation on question numbers (could be 0, negative, or extremely large)
- Gabarito import uses `regex.exec` in a loop without iteration limit — potential ReDoS on crafted input
- `window.confirm()` is used for delete — blocks main thread, unreliable in some environments

### 6. Unused Installed Packages
These packages are installed but not used — bloating bundle:
| Package | Status |
|---|---|
| `@google/genai` | Not imported anywhere |
| `express` | No server file exists |
| `dotenv` | Not imported directly (Vite handles it) |
| `motion` | Not imported anywhere |
- **Risk:** Bundle size includes these in `build`, longer installs for CI/local
- **Fix:** Remove unused packages or activate them

### 7. `@google/genai` Key Wired but Unused
```ts
// vite.config.ts — key is compiled into the bundle
'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
```
- The key is inlined into the client JS bundle at build time
- If real API calls are added, any user can extract the API key from the bundle
- **Fix:** Proxy API calls through a server-side endpoint; never expose API keys in client bundles

### 8. Data Export / Backup (Resolved)
- ✓ Implemented JSON export and import.
- ✓ Added "Merge" capability for backups to avoid data loss.
- ✓ Added Paste Backup modal for easy clipboard transfers.

---


### 10. No Memoization on Handlers
- All event handlers are re-created on every render (no `useCallback`)
- With 20+ state variables, any state change re-renders the entire App and re-creates all handlers
- **Impact:** Low currently (one component, no child props), but will become an issue after decomposition

### 11. `confirm()` Usage
```ts
const deleteTask = (id: string) => {
  if (confirm('Tem certeza que deseja excluir esta tarefa?')) {
```
- `window.confirm()` is deprecated in many contexts (blocked in cross-origin iframes, disruptive UX)
- Should be replaced with a custom confirmation modal

### 12. No 404 / SPA Fallback Config
- Vite dev server handles this automatically, but production deployments (e.g., Nginx, S3) need SPA fallback configured
- No `_redirects` or similar config file present

### 13. `diário-de-revisão-ls.zip` in Repo Root
- Binary archive file committed to the repo root
- Should not be in version control

---

## 🔵 Scalability / Future Concerns

### 14. localStorage Size Limit (~5-10MB)
- Each completed task stores full question arrays with answer data
- Heavy users with many tasks will eventually hit the browser storage quota
- No size monitoring or cleanup mechanism

### 15. No Data Migration Strategy
- Storage key `ls_tasks_v2` suggests a previous version existed (`ls_tasks_v1`?)
- No migration code to handle schema changes between versions
- Any interface change to `StudyTask`/`ActivityBlock`/`Question` will silently break stored data deserialization

### 16. Monolithic State = Expensive Re-renders
- Every keystroke in any input (answers, gabarito, import form) triggers a full `tasks` array state update → full component re-render
- With large task histories, this could cause visible lag
- No React.memo, useMemo on sub-components, or state segmentation by concern

---

## Summary Table

| Issue | Severity | Effort | Impact |
|---|---|---|---|
| Monolithic App.tsx | 🔴 Critical | High | Maintainability |
| No localStorage error handling | 🔴 Critical | Low | Data loss risk |
| Brittle text parser | 🔴 Critical | Medium | Core feature reliability |
| No TypeScript strict mode | 🟡 Moderate | Medium | Type safety |
| No input validation | 🟡 Moderate | Medium | Data integrity |
| Unused packages | 🟡 Moderate | Low | Bundle size |
| API key in client bundle | 🟡 Moderate | Medium | Security |
| No data backup/export | 🟡 Moderate | High | User trust |
| HTML title wrong | 🟢 Minor | Trivial | Polish |
| confirm() usage | 🟢 Minor | Low | UX |
| No storage size limit | 🔵 Future | Medium | Scalability |
| No data migration | 🔵 Future | Medium | Reliability |
