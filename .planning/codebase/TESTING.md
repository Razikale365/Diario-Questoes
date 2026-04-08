# TESTING.md — Test Structure & Practices

## Overview

This project has **no automated unit or integration test suite**. Testing is done exclusively through ad-hoc UAT (User Acceptance Testing) scripts using Playwright. There is no `vitest`, `jest`, or any test framework configured in `package.json`. The `@playwright/test` package is present in `dependencies` (not `devDependencies`), suggesting it was added as needed for UAT rather than as a formal test layer.

## Test Framework

| Aspect | Detail |
|---|---|
| Framework | Playwright (`@playwright/test ^1.59.1`) |
| Runner | Node.js CJS (`*.cjs` files executed directly with `node`) |
| Configuration | None — no `playwright.config.ts` exists |
| Test discovery | Manual — no `npm test` script defined |
| Target URL | `http://localhost:3000` (dev server must be running) |

## Only Test File

### `uat-test-phase15.cjs` (184 lines)

A standalone Playwright script that performs browser-based black-box tests against the live app. It is **not integrated into any CI pipeline** and must be run manually.

**Pattern:**
```js
// Minimal test harness — no test framework, raw async functions
const browser = await chromium.launch();
const page = await context.newPage();
await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });

async function test(name, fn) {
  try {
    const result = await fn(page);
    results.push({ name, status: result.passed ? 'pass' : 'issue', detail: result.detail || '' });
  } catch (err) {
    results.push({ name, status: 'issue', detail: err.message });
  }
}
```

**Tests covered (12 total):**
1. Correct/Wrong distribution at block level (checks for ✔/✖ indicators)
2. Correct/Wrong at section level (section headers with stats)
3. Correct/Wrong at task level (multiple indicators)
4. Lock section button presence
5. Unlock section toggle presence
6. Stats propagation toggle
7. Inline section title editing (double-click — DOM attribute check)
8. Drag and Drop handles present in DOM
9. AI Revision button presence (`revisar`/`ia` keywords)
10. AI Revision strategic prompt content (`auditor` keyword)
11. CEBRASPE/CESPE C/E layout (C/E pattern in text)
12. Performance badge elements (`[class*="badge"]` selector)

**Test output:** Results saved to `/tmp/uat-results.json` (hardcoded Linux path — **broken on Windows**).

**Run command (manual):**
```bash
node uat-test-phase15.cjs
# Requires: dev server running at localhost:3000
```

## Testing Approach & Philosophy

- Tests are **smoke tests** — they check DOM presence/text, not behavior flows
- No assertions on state changes or network calls
- No mocking of localStorage or Supabase
- No setup/teardown (browser launched fresh, no stored state)
- Results are `pass` / `issue` (not `pass`/`fail`) — intentionally lenient
- Tests do **not** simulate actual user interactions (clicks, typing) — only DOM inspection

## What Is NOT Tested

- `useTasks.ts` — no unit tests for any state mutation logic
- `parser.ts` (`parseLSTask`, `parseQuestionsText`) — no unit tests for parsing logic
- `SyncEngine.ts` — no tests for sync/push/pull behavior or offline handling
- `StorageAdapter.ts` — no tests
- React component rendering — no component tests
- Error states (localStorage full, bad JSON, network failure)
- The gabarito import flow
- Section deletion / non-cascade behavior
- Section recursive drag behavior
- The backup import/export/merge flow
- Auth modal and Supabase login

## Coverage Gaps (Critical)

| Area | Risk | Recommended Test Type |
|---|---|---|
| `parseLSTask()` regex engine | **High** — parses user-pasted text with complex regex | Unit (vitest) |
| `useTasks.updateQuestion()` grading logic | **High** — auto-grades C/E answers with ANULADA edge case | Unit (vitest) |
| `useTasks.moveBlock()` section recursion | **High** — complex index manipulation, easy to break | Unit (vitest) |
| `SyncEngine` push/pull/debounce | **Medium** — async with timers, last-write-wins logic | Unit (vitest + fake timers) |
| `importBackup` / `mergeBackup` | **Medium** — data destructive if wrong | Integration (Playwright) |
| Answer mode (CEBRASPE vs A-E) | **Medium** — bank detection drives UX | Unit (vitest) |

## Tmp/Debug Output Files

At root level, there are output files that indicate past debugging/UAT sessions:
- `tmp_output.txt` (23 KB) — likely captured stdout from a previous run
- `tmp_output_utf8.txt` (11 KB) — UTF-8 conversion of above

These are **not test artifacts** — they should be added to `.gitignore`.

## Recommended Next Steps

If a test suite is introduced:

1. **Add vitest** — natural fit for Vite projects (zero config, ESM-native)
   ```bash
   npm install -D vitest @vitest/ui
   ```

2. **Unit test `parser.ts`** — the highest value target:
   ```ts
   // src/utils/parser.test.ts
   import { parseLSTask } from './parser';
   test('parses CEBRASPE range block', () => {
     const result = parseLSTask('Atividade 1\nResolva as questões CEBRASPE: 1 a 5\n');
     expect(result[0].bank).toBe('CEBRASPE');
     expect(result[0].questions).toHaveLength(5);
   });
   ```

3. **Unit test `useTasks` mutations** — use `renderHook` from `@testing-library/react`

4. **Update Playwright config** — create `playwright.config.ts` with `baseURL`, reporter, and CI support
