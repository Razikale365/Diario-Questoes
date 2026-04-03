# TESTING.md — Test Structure & Practices

## Current State: No Tests
There are **zero test files** in this codebase.

```
src/
├── App.tsx    ← no corresponding App.test.tsx
├── main.tsx   ← no test
└── index.css  ← no test
```

No test directories exist:
- No `tests/`
- No `__tests__/`
- No `*.test.ts` / `*.spec.ts` files

---

## No Test Dependencies Configured
`package.json` contains **no test framework** dependencies:
- No Vitest
- No Jest
- No React Testing Library
- No Playwright / Cypress

The only "test-like" script in `package.json`:
```json
"lint": "tsc --noEmit"
```
This is just TypeScript type-checking, **not a test framework**.

---

## No CI/CD Configuration
- No `.github/workflows/` directory
- No CI pipeline files (`.circleci`, `.gitlab-ci.yml`, etc.)
- Testing is entirely manual

---

## Manual Testing Approach (inferred)
Based on the codebase structure, testing is currently **entirely manual** via:
1. Running `npm run dev` → `http://localhost:3000`
2. Pasting LS platform task text into the import form
3. Manually verifying block parsing results
4. Testing question answer input & gabarito import
5. Checking revision generation output

---

## High-Value Test Targets (for future test coverage)

### Unit Tests — Pure Functions
These functions have no side effects and are ideal for unit testing:

| Function | What to Test |
|---|---|
| `parseLSTask(text)` | Various LS text formats → correct block/question extraction |
| `formatQuestionList(numbers)` | `[1,2,3,4]` → `"1 2 3 e 4"` |
| `parseQuestionsText(text)` | `"1-20, 25, 30"` → `[1..20, 25, 30]` |
| `handleImportGabarito` regex | `"1 B\n2 CERTO"` → `Map {1→'B', 2→'C'}` |

### Integration Tests — State Flows
| Flow | What to Test |
|---|---|
| Import task flow | Paste text → click import → task appears in caderno |
| Answer a question | Click ✓/✗/flag → question state updates correctly |
| Gabarito import | Paste gabarito → questions auto-validate |
| Lock/unlock block | Toggle lock → inputs disabled |
| Delete + undo block | Delete → undo within 10s → block restored at original position |
| Finish task | Click "Finalizar" → task moves to historico |
| Revision generation | Complete task with wrong answers → revisão tab shows correct questions |

### Edge Cases Worth Testing
| Scenario | Expected Behavior |
|---|---|
| `parseLSTask` with unexpected format | Returns `[]`, shows toast "Não foi possível..." |
| Empty import text | "Iniciar Tarefa" button disabled |
| Gabarito with non-standard format | Regex skips unrecognized lines gracefully |
| localStorage full | Unhandled — throws exception (see CONCERNS.md) |
| Question number 0 or negative | Parsed, accepted — no validation |

---

## Recommended Test Setup (if adding tests)

### Recommended Stack
```bash
npm install -D vitest @testing-library/react @testing-library/user-event jsdom
```

### Vitest Config Addition for `vite.config.ts`
```ts
import { defineConfig } from 'vite';

export default defineConfig({
  // ... existing config ...
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
  },
});
```

### Script to Add
```json
"test": "vitest",
"test:ui": "vitest --ui"
```

### Example Test for `parseLSTask`
```ts
// src/__tests__/parseLSTask.test.ts
import { describe, it, expect } from 'vitest';
import { parseLSTask } from '../App'; // would require export

describe('parseLSTask', () => {
  it('parses a range-based LS task', () => {
    const text = `Atividade 1
Aula 05 - Versão Original
Resolva as questões 01 a 20 das páginas 77 a 83. CEBRASPE`;
    const blocks = parseLSTask(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].questions).toHaveLength(20);
    expect(blocks[0].bank).toBe('CEBRASPE');
  });
});
```

> **Note:** `parseLSTask` is currently a module-level function but not exported. It would need to be exported or moved to a utils file for unit testing.
