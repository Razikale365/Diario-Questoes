# ARCHITECTURE.md — System Design & Patterns

## Pattern
**SPA Monolith — Single-component architecture.**

The entire application is a single React function component (`App`) in one file (`src/App.tsx`, ~1195 lines). There is no component decomposition, no routing, no external state management. All business logic, UI rendering, and state live in one place.

---

## Application Layers

```
Browser
  └── React SPA (Vite)
        └── App.tsx (single component, all logic + UI)
              ├── State (useState + useMemo)
              ├── Business Logic (pure TS functions)
              ├── Event Handlers (mutate state)
              └── JSX (renders 3 tabs + 2 modals)
                    └── localStorage (persistence)
```

---

## Data Flow

### Write Path
```
User Action → Event Handler → setTasks() → useEffect → localStorage.setItem()
```

### Read Path
```
localStorage.getItem() → useState initializer → useMemo derivations → JSX render
```

### Task Lifecycle
```
Import Form (paste LS text)
  → parseLSTask() [parse & extract blocks]
  → handleImport() [create StudyTask]
  → tasks state [active task]
  → User fills answers per block
  → [Optional] Import Gabarito → auto-validate correctness
  → finishTask() [status → 'completed', activeTaskId → null]
  → Histórico tab (read-only history)
  → Revisão tab [filter wrong/doubt questions → generate revision text]
```

---

## Core Data Structures

### `StudyTask`
Top-level record. One per study session.
```ts
interface StudyTask {
  id: string;             // crypto.randomUUID()
  date: string;           // ISO date string
  planejamento?: string;  // e.g., 'Planejamento Iniciante Fiscal [103971]'
  meta?: string;          // numeric string
  tarefa?: string;        // numeric string
  assunto?: string;       // subject matter (auto-extracted from LS text)
  discipline: string;     // from DISCIPLINAS list
  bank: string;           // from BANKS list (CEBRASPE, FCC, etc.)
  blocks: ActivityBlock[];
  status: 'in_progress' | 'completed';
}
```

### `ActivityBlock`
A group of questions within a task (maps to one "Atividade" in LS platform text).
```ts
interface ActivityBlock {
  id: string;
  title: string;
  lesson: string;        // e.g., 'Aula 05'
  pages: string;         // e.g., '77 a 83'
  bank?: string;         // override bank for this specific block
  isLocked?: boolean;    // locks all question inputs
  questions: Question[];
}
```

### `Question`
Atomic unit — one exam question.
```ts
interface Question {
  number: number;
  answer: string;          // user-typed answer (A-E, C, E)
  isCorrect: boolean | null;   // null = not yet evaluated
  hasDoubt: boolean;
  correctAnswer?: string;  // set after gabarito import
}
```

---

## Key Abstractions

### `parseLSTask(text: string): ActivityBlock[]`
- **Location:** `src/App.tsx` (lines 74–171)
- **Purpose:** Parses raw text pasted from the LS (LFG) platform into structured `ActivityBlock[]`
- **Algorithm:**
  1. Splits text on `Atividade N` boundaries
  2. For each part, finds question-range lines (`Resolva as questões X a Y`)
  3. Extracts: question numbers (range or list), pages, bank name, lesson name
- **Weakness:** Regex-heavy, brittle to LS text format changes

### `formatQuestionList(numbers: number[]): string`
- Converts `[1, 2, 3, 4]` → `"1 2 3 e 4"` (Brazilian list format for revision text)

### `parseQuestionsText(text: string): number[]`
- Used in block edit modal — parses `"1-20, 25, 30"` → `[1,2,...20,25,30]`

### `generatedRevision` (useMemo)
- **Derived state** — computed from completed tasks filtered by discipline + selected lessons
- Groups wrong/doubt questions by `lesson|bank` key
- Produces formatted revision text for clipboard copy

---

## Navigation Model
- **3 tabs** (rendered conditionally, not via URL routing):
  - `caderno` — active task + question grid (default)
  - `revisao` — revision generator
  - `historico` — read-only list of all tasks
- **2 modals** (fixed position overlays):
  - Gabarito import modal
  - Block edit/create modal

---

## State Management
All state is `useState` within `App`:
| State | Type | Purpose |
|---|---|---|
| `tasks` | `StudyTask[]` | All tasks, synced to localStorage |
| `activeTaskId` | `string \| null` | Currently active task pointer |
| `activeTab` | `'caderno' \| 'revisao' \| 'historico'` | Navigation |
| `toastMessage` | `string \| null` | Notification text |
| `importText` | `string` | Import form textarea |
| `importPlanejamento` | `string` | Import form field |
| `importMeta` | `string` | Import form field |
| `importTarefa` | `string` | Import form field |
| `importAssunto` | `string` | Import form field |
| `importDiscipline` | `string` | Import form field |
| `importBank` | `string` | Import form field |
| `isEditingTask` | `boolean` | Task meta edit mode |
| `editForm` | object | Fields for task edit |
| `revDiscipline` | `string` | Revision filter |
| `selectedLessons` | `Set<string>` | Revision filter |
| `deletedBlockInfo` | object \| null | Undo delete buffer |
| `blockEditModal` | object \| null | Block modal state |
| `gabaritoModal` | `string \| null` | Gabarito modal (block ID) |
| `gabaritoText` | `string` | Gabarito textarea content |

---

## Rendering Strategy
- No virtualization — all questions rendered at once
- CSS multi-column layout for question grid (`columns-1 sm:columns-2 md:columns-3 lg:columns-4 xl:columns-5`)
- Animations: `animate-in fade-in slide-in-from-*` (Tailwind CSS animations) for toasts
