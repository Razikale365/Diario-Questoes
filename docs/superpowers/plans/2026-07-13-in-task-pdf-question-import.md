# In-Task PDF and Text Question Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an existing Diario task import complete objective questions from a PDF or pasted text into a new section, a new block, or an existing block without losing study progress.

**Architecture:** Keep PDF extraction in the current parser, build and deduplicate canonical question-bank items before touching the task, and pass those items through a pure import planner that returns an immutable task plus a structured summary. A separate storage helper commits the task array and question bank together with rollback, while one shared modal owns parsing, destination selection, preview, and confirmation for every UI entry point.

**Tech Stack:** React 19, TypeScript 5.8, Vite 6, pdfjs-dist 6, Node test runner through `tsx`, localStorage, lucide-react.

## Global Constraints

- No OCR for image-only PDFs in this milestone.
- Never extract or store proprietary TEC question bodies; TEC remains an external metadata-only flow.
- Do not offer `tec` as a source kind in the in-task PDF modal.
- Never replace complete conflicting question content automatically.
- Preserve `answer`, `isCorrect`, `hasDoubt`, `favorite`, `observations`, `eliminated`, `doubtedAlts`, and `attempts` while enriching a task question.
- Keep the current standalone PDF importer working for creating a new task.
- Parsing and preview must not mutate the task, question bank, React state, or localStorage.
- A locked target block or section cannot receive an import until unlocked.
- Re-importing the same batch into the same destination must not duplicate task questions or question-bank items.
- Imported gabaritos start hidden in execution views.
- A task/question-bank persistence failure must restore both previous localStorage values before any React state or update event changes.
- PDF and pasted text must normalize to the same preview input and therefore have identical deduplication, conflict, destination, and rollback behavior.

---

## File Map

- Create `src/utils/taskQuestionImport.ts`: pure destination validation, matching, enrichment, append, conflict, idempotence, and new block/section construction.
- Create `src/utils/taskQuestionImport.test.ts`: complete domain behavior and preservation tests.
- Create `src/utils/taskQuestionImportStorage.ts`: shared task storage key and rollback-capable two-key commit.
- Create `src/utils/taskQuestionImportStorage.test.ts`: success and failure/rollback tests with an in-memory storage double.
- Create `src/hooks/useTasks.contract.test.ts`: source contract proving persistence precedes React state and bank events.
- Create `src/utils/taskQuestionImportPreview.ts`: compose parsed PDF questions, canonical bank merge, and the pure task plan without persistence.
- Create `src/utils/taskQuestionImportPreview.test.ts`: preview counts, canonical IDs, duplicates, and invalid destination behavior.
- Create `src/components/TaskQuestionPdfImportModal.tsx`: shared modal for file metadata, destination, preview, and confirmation.
- Create `src/components/TaskQuestionPdfImportModal.contract.test.ts`: source-level UI contract following the repository's existing command-layer test pattern.
- Modify `src/hooks/useTasks.ts`: expose one `commitTaskQuestionImport` operation that persists before updating React state.
- Modify `src/storage/StorageAdapter.ts`: use the shared task storage key.
- Modify `src/App.tsx`: own modal request state, coordinate current/history tasks, add the footer command, and switch to Questions after success.
- Modify `src/components/ActivityBlockCard.tsx`: emit section/block import requests through one callback.
- Modify `src/components/BlockEditModal.tsx`: add the secondary PDF-import command and export its state type.
- Modify `src/components/SectionEditModal.tsx`: support create/edit modes plus `Criar e importar PDF`.

---

### Task 1: Pure Task Import Planner

**Files:**
- Create: `src/utils/taskQuestionImport.ts`
- Create: `src/utils/taskQuestionImport.test.ts`

**Interfaces:**
- Consumes: `StudyTask`, `Question`, `QuestionBankItem`, `ImportedObjectiveQuestion`, `DEFAULT_ACTIVITY_LAYOUT`, and `DEFAULT_SECTION_LAYOUT`.
- Produces: `TaskQuestionImportDestination`, `TaskQuestionImportBlockDefaults`, `TaskQuestionImportSummary`, `TaskQuestionImportResult`, and `planTaskQuestionImport(input)`.

- [ ] **Step 1: Write failing tests for enrichment, conflicts, append, idempotence, destinations, and locks**

Create fixtures that keep the preservation assertions explicit:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { Question, QuestionBankItem, StudyTask } from '../types';
import { ImportedObjectiveQuestion } from './objectiveQuestionParser';
import { planTaskQuestionImport } from './taskQuestionImport';

const parsed = (number: number, answerKey = 'B'): ImportedObjectiveQuestion => ({
  localId: `parsed-${number}`,
  number,
  statement: `Enunciado completo ${number}`,
  alternatives: [
    { label: 'A', text: `Alternativa A${number}` },
    { label: 'B', text: `Alternativa B${number}` },
  ],
  answerKey,
  bank: 'FCC',
  year: 2026,
});

const canonical = (number: number, answerKey = 'B'): QuestionBankItem => ({
  id: `qb-${number}`,
  fingerprint: `fp-${number}`,
  sourceQuestionNumber: number,
  statement: `Enunciado completo ${number}`,
  alternatives: [
    { label: 'A', text: `Alternativa A${number}` },
    { label: 'B', text: `Alternativa B${number}` },
  ],
  correctAnswer: answerKey,
  isMultipleChoice: false,
  sourceKind: 'professor',
  sourceName: 'Aula 02 - ITCD',
  sourceFileName: 'ITCD_CE.pdf',
  targetSlug: 'sefaz_ce',
  discipline: 'Legislação Tributária Estadual',
  lesson: 'Aula 02 - ITCD',
  taskTitle: 'Questões inéditas - ITCD',
  bank: 'FCC',
  year: 2026,
  tags: ['ITCD'],
  favorite: false,
  hasDoubt: false,
  attempts: [],
  importedAt: '2026-07-13T12:00:00.000Z',
  updatedAt: '2026-07-13T12:00:00.000Z',
});

const taskWith = (questions: Question[], locked = false): StudyTask => ({
  id: 'task-1',
  date: '2026-07-13T10:00:00.000Z',
  targetSlug: 'sefaz_ce',
  discipline: 'Legislação Tributária Estadual',
  bank: 'FCC',
  status: 'in_progress',
  blocks: [{
    id: 'block-1',
    title: 'Questões por índice',
    lesson: 'Aula 02 - ITCD',
    pages: '1-27',
    bank: 'FCC',
    isLocked: locked,
    questions,
  }],
});

const taskWithSection = (children: StudyTask['blocks'] = [], locked = false): StudyTask => ({
  ...taskWith([]),
  blocks: [{
    id: 'section-1',
    title: 'Aula 02 - ITCD',
    lesson: 'Aula 02 - ITCD',
    pages: '',
    questions: [],
    isSection: true,
    isLocked: locked,
  }, ...children],
});

const defaults = {
  title: 'Questões inéditas - ITCD',
  lesson: 'Aula 02 - ITCD',
  pages: '27 páginas',
  bank: 'FCC',
};
```

Add tests with these exact outcomes:

```ts
test('enriches an index-only question and preserves all execution progress', () => {
  const existing: Question = {
    number: 2,
    answer: 'A',
    correctAnswer: 'B',
    isCorrect: false,
    hasDoubt: true,
    favorite: true,
    observations: 'Fiquei entre A e B.',
    eliminated: ['C'],
    doubtedAlts: ['A', 'B'],
    attempts: [{ answer: 'A', isCorrect: false, attemptedAt: '2026-07-12T18:00:00.000Z' }],
  };
  const result = planTaskQuestionImport({
    task: taskWith([existing]),
    sourceQuestions: [parsed(2)],
    canonicalItems: [canonical(2)],
    destination: { kind: 'existing_block', blockId: 'block-1' },
    blockDefaults: defaults,
    now: () => '2026-07-13T13:00:00.000Z',
    idFactory: () => 'unused-id',
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.summary.enriched, 1);
  assert.equal(result.summary.answerKeyConflicts, 0);
  assert.deepEqual(result.task.blocks[0].questions[0], {
    ...existing,
    localId: 'qb-2',
    sourceQuestionNumber: 2,
    statement: 'Enunciado completo 2',
    alternatives: canonical(2).alternatives,
    isMultipleChoice: false,
    sourceKind: 'professor',
    sourceName: 'Aula 02 - ITCD',
    year: 2026,
    exam: undefined,
    institution: undefined,
  });
});

test('preserves a conflicting manual key and imports non-conflicting questions', () => {
  const result = planTaskQuestionImport({
    task: taskWith([
      { number: 1, answer: '', correctAnswer: 'A', isCorrect: null, hasDoubt: false },
      { number: 2, answer: '', isCorrect: null, hasDoubt: false },
    ]),
    sourceQuestions: [parsed(1, 'B'), parsed(2, 'B')],
    canonicalItems: [canonical(1, 'B'), canonical(2, 'B')],
    destination: { kind: 'existing_block', blockId: 'block-1' },
    blockDefaults: defaults,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.task.blocks[0].questions[0].correctAnswer, 'A');
  assert.equal(result.task.blocks[0].questions[1].correctAnswer, 'B');
  assert.equal(result.summary.answerKeyConflicts, 1);
  assert.deepEqual(result.summary.conflicts.map((conflict) => conflict.sourceQuestionNumber), [1]);
});

test('appends unmatched questions with unique internal numbers and source numbers', () => {
  const result = planTaskQuestionImport({
    task: taskWith([{ number: 25, answer: '', isCorrect: null, hasDoubt: false }]),
    sourceQuestions: [parsed(2), parsed(3)],
    canonicalItems: [canonical(2), canonical(3)],
    destination: { kind: 'existing_block', blockId: 'block-1' },
    blockDefaults: defaults,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.task.blocks[0].questions.map((question) => question.number), [25, 26, 27]);
  assert.deepEqual(result.task.blocks[0].questions.slice(1).map((question) => question.sourceQuestionNumber), [2, 3]);
  assert.equal(result.summary.appended, 2);
});

test('is idempotent when the same canonical batch is imported twice', () => {
  const first = planTaskQuestionImport({
    task: taskWith([]),
    sourceQuestions: [parsed(1)],
    canonicalItems: [canonical(1)],
    destination: { kind: 'existing_block', blockId: 'block-1' },
    blockDefaults: defaults,
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;

  const second = planTaskQuestionImport({
    task: first.task,
    sourceQuestions: [parsed(1)],
    canonicalItems: [canonical(1)],
    destination: { kind: 'existing_block', blockId: 'block-1' },
    blockDefaults: defaults,
  });
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.changed, false);
  assert.equal(second.summary.duplicates, 1);
  assert.equal(second.task.blocks[0].questions.length, 1);
});
```

Add the destination, lock, and content-conflict tests in full:

```ts
test('rejects locked block and locked section destinations', () => {
  const lockedBlock = planTaskQuestionImport({
    task: taskWith([], true),
    sourceQuestions: [parsed(1)],
    canonicalItems: [canonical(1)],
    destination: { kind: 'existing_block', blockId: 'block-1' },
    blockDefaults: defaults,
  });
  const lockedSection = planTaskQuestionImport({
    task: taskWithSection([], true),
    sourceQuestions: [parsed(1)],
    canonicalItems: [canonical(1)],
    destination: { kind: 'new_block', sectionTitle: 'Aula 02 - ITCD' },
    blockDefaults: defaults,
  });

  assert.equal(lockedBlock.ok, false);
  assert.equal(lockedBlock.code, 'locked_destination');
  assert.equal(lockedSection.ok, false);
  assert.equal(lockedSection.code, 'locked_destination');
});

test('keeps complete conflicting content while importing another question', () => {
  const manual: Question = {
    number: 1,
    sourceQuestionNumber: 1,
    statement: 'Conteúdo manual preservado',
    alternatives: [
      { label: 'A', text: 'Manual A' },
      { label: 'B', text: 'Manual B' },
    ],
    answer: '',
    isCorrect: null,
    hasDoubt: false,
  };
  const result = planTaskQuestionImport({
    task: taskWith([manual]),
    sourceQuestions: [parsed(1), parsed(2)],
    canonicalItems: [canonical(1), canonical(2)],
    destination: { kind: 'existing_block', blockId: 'block-1' },
    blockDefaults: defaults,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.summary.contentConflicts, 1);
  assert.equal(result.summary.appended, 1);
  assert.equal(result.task.blocks[0].questions[0].statement, 'Conteúdo manual preservado');
  assert.equal(result.task.blocks[0].questions[1].localId, 'qb-2');
});

test('creates a responsive section block and treats its repeated batch as idempotent', () => {
  let nextId = 0;
  const first = planTaskQuestionImport({
    task: taskWith([]),
    sourceQuestions: [parsed(1), parsed(2)],
    canonicalItems: [canonical(1), canonical(2)],
    destination: { kind: 'new_section', sectionTitle: 'Aula 02 - ITCD' },
    blockDefaults: defaults,
    idFactory: () => `new-${++nextId}`,
  });

  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.deepEqual(first.task.blocks.map((block) => block.isSection), [undefined, true, undefined]);
  assert.equal(first.task.blocks.at(-1)?.layout?.width, 12);
  assert.equal(first.task.blocks.at(-1)?.layout?.columns, 1);
  assert.equal(first.task.blocks.at(-1)?.showGabarito, false);

  const repeated = planTaskQuestionImport({
    task: first.task,
    sourceQuestions: [parsed(1), parsed(2)],
    canonicalItems: [canonical(1), canonical(2)],
    destination: { kind: 'new_section', sectionTitle: 'Aula 02 - ITCD' },
    blockDefaults: defaults,
  });
  assert.equal(repeated.ok, true);
  if (!repeated.ok) return;
  assert.equal(repeated.changed, false);
  assert.equal(repeated.summary.duplicates, 2);

  const differentBatch = planTaskQuestionImport({
    task: first.task,
    sourceQuestions: [parsed(3)],
    canonicalItems: [canonical(3)],
    destination: { kind: 'new_section', sectionTitle: 'Aula 02 - ITCD' },
    blockDefaults: defaults,
  });
  assert.equal(differentBatch.ok, false);
  assert.equal(differentBatch.code, 'duplicate_section');
});

test('creates one block in an existing section and does not duplicate the batch', () => {
  const first = planTaskQuestionImport({
    task: taskWithSection(),
    sourceQuestions: [parsed(1), parsed(2)],
    canonicalItems: [canonical(1), canonical(2)],
    destination: { kind: 'new_block', sectionTitle: 'Aula 02 - ITCD' },
    blockDefaults: defaults,
    idFactory: () => 'new-block',
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.task.blocks.at(-1)?.lesson, 'Aula 02 - ITCD');

  const repeated = planTaskQuestionImport({
    task: first.task,
    sourceQuestions: [parsed(1), parsed(2)],
    canonicalItems: [canonical(1), canonical(2)],
    destination: { kind: 'new_block', sectionTitle: 'Aula 02 - ITCD' },
    blockDefaults: defaults,
  });
  assert.equal(repeated.ok, true);
  if (!repeated.ok) return;
  assert.equal(repeated.changed, false);
  assert.equal(repeated.summary.duplicates, 2);
  assert.equal(repeated.task.blocks.length, first.task.blocks.length);
});
```

- [ ] **Step 2: Run the focused test and verify the module is missing**

Run: `npx tsx --test src/utils/taskQuestionImport.test.ts`

Expected: FAIL because `./taskQuestionImport` does not exist.

- [ ] **Step 3: Implement the immutable import planner**

Define the public contract exactly:

```ts
export type TaskQuestionImportDestination =
  | { kind: 'new_section'; sectionTitle: string }
  | { kind: 'new_block'; sectionTitle: string }
  | { kind: 'existing_block'; blockId: string };

export interface TaskQuestionImportBlockDefaults {
  title: string;
  lesson: string;
  pages: string;
  bank: string;
}

export interface TaskQuestionImportConflict {
  kind: 'content' | 'answer_key';
  sourceQuestionNumber?: number;
  existingQuestionNumber: number;
}

export interface TaskQuestionImportSummary {
  detected: number;
  enriched: number;
  appended: number;
  duplicates: number;
  contentConflicts: number;
  answerKeyConflicts: number;
  conflicts: TaskQuestionImportConflict[];
}

export type TaskQuestionImportFailureCode =
  | 'empty_batch'
  | 'batch_mismatch'
  | 'missing_block'
  | 'missing_section'
  | 'locked_destination'
  | 'duplicate_section';

export type TaskQuestionImportResult =
  | { ok: true; task: StudyTask; summary: TaskQuestionImportSummary; changed: boolean }
  | { ok: false; code: TaskQuestionImportFailureCode; message: string; summary: TaskQuestionImportSummary };

export interface PlanTaskQuestionImportInput {
  task: StudyTask;
  sourceQuestions: ImportedObjectiveQuestion[];
  canonicalItems: QuestionBankItem[];
  destination: TaskQuestionImportDestination;
  blockDefaults: TaskQuestionImportBlockDefaults;
  idFactory?: () => string;
  now?: () => string;
}
```

Implement matching in this order and stop after the first match:

```ts
const findMatch = (questions: Question[], item: QuestionBankItem) =>
  questions.find((question) => question.localId && question.localId === item.id)
  || questions.find((question) =>
    question.sourceQuestionNumber !== undefined
    && question.sourceQuestionNumber === item.sourceQuestionNumber)
  || questions.find((question) =>
    !hasCompleteContent(question)
    && item.sourceQuestionNumber !== undefined
    && question.number === item.sourceQuestionNumber);
```

Use these exact completeness and comparison rules:

```ts
const normalizeContent = (value: string | undefined) =>
  (value || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/\s+/g, ' ').trim().toLowerCase();

const hasCompleteContent = (question: Question) =>
  Boolean(
    question.statement?.trim()
    && question.alternatives
    && question.alternatives.length >= 2
    && question.alternatives.every((alternative) => alternative.label.trim() && alternative.text.trim()),
  );

const hasSameContent = (question: Question, item: QuestionBankItem) =>
  normalizeContent(question.statement) === normalizeContent(item.statement)
  && JSON.stringify(
    (question.alternatives || []).map((alternative) => [
      normalizeContent(alternative.label),
      normalizeContent(alternative.text),
    ]),
  ) === JSON.stringify(
    item.alternatives.map((alternative) => [
      normalizeContent(alternative.label),
      normalizeContent(alternative.text),
    ]),
  );
```

Materialize imported content with `questionBankItemToQuestion`, but always restore the existing execution fields from the task question:

```ts
const enrichQuestion = (existing: Question, item: QuestionBankItem): Question => {
  const imported = questionBankItemToQuestion(item, 0);
  return {
    ...imported,
    number: existing.number,
    answer: existing.answer,
    isCorrect: existing.isCorrect,
    hasDoubt: existing.hasDoubt,
    favorite: existing.favorite !== undefined ? existing.favorite : imported.favorite,
    observations: existing.observations !== undefined ? existing.observations : imported.observations,
    eliminated: existing.eliminated !== undefined ? existing.eliminated : imported.eliminated,
    doubtedAlts: existing.doubtedAlts !== undefined ? existing.doubtedAlts : imported.doubtedAlts,
    attempts: existing.attempts !== undefined ? existing.attempts : imported.attempts,
    correctAnswer: existing.correctAnswer || imported.correctAnswer,
  };
};
```

For a placeholder, fill content and keep a non-empty manual `correctAnswer`; report an `answer_key` conflict only when both keys are non-empty and differ. For a complete content mismatch, keep the existing question unchanged and report `content`.

Append unmatched items in source order using `Math.max(0, ...questions.map(({ number }) => number)) + 1`. Before creating a new block, compare its canonical `localId` set against blocks already in the selected section. If one block already contains the full incoming set, return an unchanged successful result with every incoming item counted as a duplicate. For `new_section`, apply the same equivalent-batch check when a case-insensitive section title already exists; return idempotent success for the same batch and `duplicate_section` for different content. Otherwise append a section header using `DEFAULT_SECTION_LAYOUT`, then append a question block. For `new_block`, require a matching unlocked section header. Build new question blocks with:

```ts
const buildImportedBlock = (
  id: string,
  defaults: TaskQuestionImportBlockDefaults,
  items: QuestionBankItem[],
): ActivityBlock => ({
  id,
  title: defaults.title,
  lesson: defaults.lesson,
  pages: defaults.pages,
  bank: defaults.bank,
  questions: items.map(questionBankItemToQuestion),
  showStats: true,
  showGabarito: false,
  layout: {
    ...DEFAULT_ACTIVITY_LAYOUT,
    columns: 1,
    rows: Math.min(Math.max(items.length, 1), 8),
    type: 'grid',
    width: 12,
    rowSpan: 4,
  },
});
```

Set `updatedAt` only when `changed` is true. Never mutate any input array, block, question, alternative, or attempt.

Return these exact failure messages so the modal can display the reason without translating codes:

```ts
const failureMessages: Record<TaskQuestionImportFailureCode, string> = {
  empty_batch: 'Nenhuma questão objetiva foi detectada.',
  batch_mismatch: 'O lote processado não corresponde aos itens canônicos do banco.',
  missing_block: 'Selecione um bloco existente para receber as questões.',
  missing_section: 'Selecione uma seção existente para criar a atividade.',
  locked_destination: 'Desbloqueie o bloco ou a seção antes de importar.',
  duplicate_section: 'Já existe uma seção com este título; escolha Nova atividade para acrescentar outro lote.',
};
```

- [ ] **Step 4: Run the domain tests and TypeScript**

Run: `npx tsx --test src/utils/taskQuestionImport.test.ts`

Expected: PASS with all import planner tests green.

Run: `npm run lint`

Expected: PASS with no TypeScript errors.

- [ ] **Step 5: Commit the pure domain slice**

```bash
git add src/utils/taskQuestionImport.ts src/utils/taskQuestionImport.test.ts
git commit -m "feat: plan in-task PDF question imports"
```

---

### Task 2: Atomic Task and Question-Bank Persistence

**Files:**
- Create: `src/utils/taskQuestionImportStorage.ts`
- Create: `src/utils/taskQuestionImportStorage.test.ts`
- Create: `src/hooks/useTasks.contract.test.ts`
- Modify: `src/hooks/useTasks.ts:1-40,54-67,return object`
- Modify: `src/storage/StorageAdapter.ts:1-25`

**Interfaces:**
- Consumes: `QUESTION_BANK_STORAGE_KEY`, the current task array, one updated task, and the merged bank.
- Produces: `STUDY_TASKS_STORAGE_KEY`, `TaskQuestionImportStorage`, `persistTaskQuestionImportSnapshot(input)`, and `useTasks().commitTaskQuestionImport(nextTask, nextQuestionBank)`.

- [ ] **Step 1: Write failing rollback tests**

Use a storage double that can fail once on a selected key:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { QuestionBankItem, StudyTask } from '../types';
import { QUESTION_BANK_STORAGE_KEY } from './questionBank';
import {
  persistTaskQuestionImportSnapshot,
  STUDY_TASKS_STORAGE_KEY,
  TaskQuestionImportStorage,
} from './taskQuestionImportStorage';

class MemoryStorage implements TaskQuestionImportStorage {
  readonly values = new Map<string, string>();
  failOnceOn: string | null = null;

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    if (this.failOnceOn === key) {
      this.failOnceOn = null;
      throw new Error(`write failed: ${key}`);
    }
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}
```

Use these complete test cases after the `MemoryStorage` class:

```ts
const tasks: StudyTask[] = [{
  id: 'task-next',
  date: '2026-07-13T10:00:00.000Z',
  discipline: 'Direito Tributário',
  bank: 'FCC',
  blocks: [],
  status: 'in_progress' as const,
}];

const questionBank: QuestionBankItem[] = [{
  id: 'qb-1',
  fingerprint: 'fp-1',
  sourceQuestionNumber: 1,
  statement: 'Enunciado',
  alternatives: [{ label: 'C', text: 'Certo' }, { label: 'E', text: 'Errado' }],
  sourceKind: 'professor' as const,
  sourceName: 'Aula 01',
  discipline: 'Direito Tributário',
  bank: 'FCC',
  tags: [],
  favorite: false,
  hasDoubt: false,
  attempts: [],
  importedAt: '2026-07-13T10:00:00.000Z',
  updatedAt: '2026-07-13T10:00:00.000Z',
}];

test('persists the task array and question bank together', () => {
  const storage = new MemoryStorage();
  const result = persistTaskQuestionImportSnapshot({ storage, tasks, questionBank });

  assert.deepEqual(result, { ok: true });
  assert.equal(storage.getItem(STUDY_TASKS_STORAGE_KEY), JSON.stringify(tasks));
  assert.equal(storage.getItem(QUESTION_BANK_STORAGE_KEY), JSON.stringify(questionBank));
});

test('restores both previous values when the bank write fails', () => {
  const storage = new MemoryStorage();
  storage.values.set(STUDY_TASKS_STORAGE_KEY, '["old-task"]');
  storage.values.set(QUESTION_BANK_STORAGE_KEY, '["old-question"]');
  storage.failOnceOn = QUESTION_BANK_STORAGE_KEY;

  const result = persistTaskQuestionImportSnapshot({ storage, tasks, questionBank });

  assert.equal(result.ok, false);
  assert.equal(storage.getItem(STUDY_TASKS_STORAGE_KEY), '["old-task"]');
  assert.equal(storage.getItem(QUESTION_BANK_STORAGE_KEY), '["old-question"]');
});

test('removes a newly-created key while rolling back an absent previous bank', () => {
  const storage = new MemoryStorage();
  storage.values.set(STUDY_TASKS_STORAGE_KEY, '["old-task"]');
  storage.failOnceOn = QUESTION_BANK_STORAGE_KEY;

  const result = persistTaskQuestionImportSnapshot({ storage, tasks, questionBank });

  assert.equal(result.ok, false);
  assert.equal(storage.getItem(STUDY_TASKS_STORAGE_KEY), '["old-task"]');
  assert.equal(storage.getItem(QUESTION_BANK_STORAGE_KEY), null);
});
```

Create `src/hooks/useTasks.contract.test.ts` with this order assertion:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./useTasks.ts', import.meta.url), 'utf8');

test('task PDF import persists before updating React state or dispatching bank events', () => {
  const start = source.indexOf('const commitTaskQuestionImport');
  assert.notEqual(start, -1);
  const body = source.slice(start, source.indexOf('\n  };', start) + 5);
  const persistAt = body.indexOf('persistTaskQuestionImportSnapshot');
  const stateAt = body.indexOf('setTasks(nextTasks)');
  const eventAt = body.indexOf('QUESTION_BANK_UPDATED_EVENT');

  assert.ok(persistAt >= 0);
  assert.ok(stateAt > persistAt);
  assert.ok(eventAt > stateAt);
});
```

- [ ] **Step 2: Run the storage test and verify it fails**

Run: `npx tsx --test src/utils/taskQuestionImportStorage.test.ts src/hooks/useTasks.contract.test.ts`

Expected: FAIL because the storage module and hook commit operation do not exist.

- [ ] **Step 3: Implement the rollback-capable storage helper**

Use this public contract:

```ts
export const STUDY_TASKS_STORAGE_KEY = 'ls_tasks_v2';

export interface TaskQuestionImportStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface PersistTaskQuestionImportInput {
  storage: TaskQuestionImportStorage;
  tasks: StudyTask[];
  questionBank: QuestionBankItem[];
}

export type PersistTaskQuestionImportResult =
  | { ok: true }
  | { ok: false; error: Error; rollbackErrors: Error[] };
```

Normalize thrown values and keep preparation inside the no-write phase:

```ts
const toError = (value: unknown) => value instanceof Error ? value : new Error(String(value));
```

Serialize both next values inside a `try` before reading or writing storage. If serialization fails, return `{ ok: false, error: toError(error), rollbackErrors: [] }` because no storage value changed. Read both old values inside a second `try`; if either read fails, return the same failure shape without writing. Then write tasks first and bank second, and on any write failure restore both keys independently so one rollback failure does not prevent the other rollback attempt. Implement the complete function as:

```ts
const restore = (storage: TaskQuestionImportStorage, key: string, value: string | null) => {
  if (value === null) storage.removeItem(key);
  else storage.setItem(key, value);
};

export const persistTaskQuestionImportSnapshot = (
  input: PersistTaskQuestionImportInput,
): PersistTaskQuestionImportResult => {
  let serializedTasks: string;
  let serializedQuestionBank: string;
  try {
    serializedTasks = JSON.stringify(input.tasks);
    serializedQuestionBank = JSON.stringify(input.questionBank);
  } catch (error) {
    return { ok: false, error: toError(error), rollbackErrors: [] };
  }

  let previousTasks: string | null;
  let previousQuestionBank: string | null;
  try {
    previousTasks = input.storage.getItem(STUDY_TASKS_STORAGE_KEY);
    previousQuestionBank = input.storage.getItem(QUESTION_BANK_STORAGE_KEY);
  } catch (error) {
    return { ok: false, error: toError(error), rollbackErrors: [] };
  }

  try {
    input.storage.setItem(STUDY_TASKS_STORAGE_KEY, serializedTasks);
    input.storage.setItem(QUESTION_BANK_STORAGE_KEY, serializedQuestionBank);
    return { ok: true };
  } catch (error) {
    const rollbackErrors: Error[] = [];
    for (const [key, value] of [
      [STUDY_TASKS_STORAGE_KEY, previousTasks],
      [QUESTION_BANK_STORAGE_KEY, previousQuestionBank],
    ] as const) {
      try {
        restore(input.storage, key, value);
      } catch (rollbackError) {
        rollbackErrors.push(toError(rollbackError));
      }
    }
    return { ok: false, error: toError(error), rollbackErrors };
  }
};
```

- [ ] **Step 4: Add the hook-level commit operation and shared storage key**

In `useTasks`, replace both hard-coded `ls_tasks_v2` occurrences with `STUDY_TASKS_STORAGE_KEY`. Add:

```ts
const commitTaskQuestionImport = (
  nextTask: StudyTask,
  nextQuestionBank: QuestionBankItem[],
): { ok: true } | { ok: false; message: string } => {
  if (!tasks.some((task) => task.id === nextTask.id)) {
    return { ok: false, message: 'Tarefa não encontrada.' };
  }

  const nextTasks = tasks.map((task) => task.id === nextTask.id ? nextTask : task);
  const persisted = persistTaskQuestionImportSnapshot({
    storage: localStorage,
    tasks: nextTasks,
    questionBank: nextQuestionBank,
  });
  if (!persisted.ok) {
    console.error('[Diário LS] Failed to commit PDF question import', persisted.error);
    return { ok: false, message: 'Não foi possível salvar a importação. Os dados anteriores foram restaurados.' };
  }

  setTasks(nextTasks);
  window.dispatchEvent(new CustomEvent(QUESTION_BANK_UPDATED_EVENT));
  return { ok: true };
};
```

Import `QuestionBankItem`, `QUESTION_BANK_UPDATED_EVENT`, `persistTaskQuestionImportSnapshot`, and `STUDY_TASKS_STORAGE_KEY`, then return `commitTaskQuestionImport` from the hook. Update `LocalStorageAdapter` to use the same exported key for read/write.

- [ ] **Step 5: Run focused tests and regressions**

Run: `npx tsx --test src/utils/taskQuestionImportStorage.test.ts src/hooks/useTasks.contract.test.ts src/utils/questionBank.test.ts src/utils/taskBackup.test.ts`

Expected: PASS.

Run: `npm run lint`

Expected: PASS.

- [ ] **Step 6: Commit the persistence slice**

```bash
git add src/utils/taskQuestionImportStorage.ts src/utils/taskQuestionImportStorage.test.ts src/hooks/useTasks.ts src/hooks/useTasks.contract.test.ts src/storage/StorageAdapter.ts
git commit -m "feat: commit task PDF imports atomically"
```

---

### Task 3: Pure Preview Composition

**Files:**
- Create: `src/utils/taskQuestionImportPreview.ts`
- Create: `src/utils/taskQuestionImportPreview.test.ts`

**Interfaces:**
- Consumes: parsed objective questions, `QuestionBankImportContext`, current bank, task, destination, and block defaults.
- Produces: `buildTaskQuestionImportPreview(input)` with canonical IDs, next bank, task plan, parser rejection count, bank-added count, and bank-duplicate count.

- [ ] **Step 1: Write the failing preview tests**

Build a parsed batch containing one placeholder match and one append, then assert:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { QuestionBankImportContext } from './questionBank';
import { buildTaskQuestionImportPreview } from './taskQuestionImportPreview';

const parsedQuestion = (number: number) => ({
  localId: `parsed-${number}`,
  number,
  statement: `Enunciado ${number}`,
  alternatives: [{ label: 'C', text: 'Certo' }, { label: 'E', text: 'Errado' }],
  answerKey: 'C',
  bank: 'CEBRASPE',
});

const parsedBatch = {
  questions: [parsedQuestion(1), parsedQuestion(2)],
  rejectedBlocks: 1,
  fileName: 'ITCD_CE.pdf',
  pageCount: 27,
};

const task = {
  id: 'task-preview',
  date: '2026-07-13T10:00:00.000Z',
  targetSlug: 'sefaz_ce',
  discipline: 'Legislação Tributária Estadual',
  bank: 'CEBRASPE',
  status: 'in_progress' as const,
  blocks: [{
    id: 'block-1',
    title: 'Índice',
    lesson: 'Aula 02 - ITCD',
    pages: '1-27',
    questions: [{ number: 1, answer: '', isCorrect: null, hasDoubt: false }],
  }],
};

const context: QuestionBankImportContext = {
  sourceKind: 'professor',
  sourceName: 'Aula 02 - ITCD',
  sourceFileName: 'ITCD_CE.pdf',
  targetSlug: 'sefaz_ce',
  discipline: task.discipline,
  lesson: 'Aula 02 - ITCD',
  taskTitle: 'Questões inéditas - ITCD',
  bank: 'CEBRASPE',
  tags: ['ITCD'],
};

const blockDefaults = {
  title: 'Questões inéditas - ITCD',
  lesson: 'Aula 02 - ITCD',
  pages: '27 páginas',
  bank: 'CEBRASPE',
};

const buildFirstPreview = () => buildTaskQuestionImportPreview({
  task,
  currentQuestionBank: [],
  parsed: parsedBatch,
  context,
  destination: { kind: 'existing_block', blockId: 'block-1' },
  blockDefaults,
});

test('builds canonical task and bank preview counts without persistence', () => {
  const preview = buildFirstPreview();
  assert.equal(preview.plan.ok, true);
  assert.equal(preview.rejectedBlocks, 1);
  assert.equal(preview.bankAdded, 2);
  assert.equal(preview.bankDuplicates, 0);
  assert.deepEqual(
    preview.plan.ok ? preview.plan.task.blocks[0].questions.map((question) => question.localId) : [],
    preview.canonicalItems.map((item) => item.id),
  );
});
```

Complete the idempotence and lock assertions in the same test file:

```ts
test('reports canonical and task duplicates on a repeated preview', () => {
  const preview = buildFirstPreview();
  if (!preview.plan.ok) throw new Error('Expected valid first preview');
  const repeated = buildTaskQuestionImportPreview({
    task: preview.plan.task,
    currentQuestionBank: preview.nextQuestionBank,
    parsed: parsedBatch,
    context,
    destination: { kind: 'existing_block', blockId: 'block-1' },
    blockDefaults,
  });

  assert.equal(repeated.bankAdded, 0);
  assert.equal(repeated.bankDuplicates, 2);
  assert.equal(repeated.plan.ok, true);
  if (!repeated.plan.ok) return;
  assert.equal(repeated.plan.changed, false);
  assert.equal(repeated.plan.task.blocks[0].questions.length, 2);
});

test('reports a locked destination without mutating the bank input', () => {
  const preview = buildFirstPreview();
  const originalBank = [...preview.nextQuestionBank];
  const locked = buildTaskQuestionImportPreview({
    task: { ...task, blocks: task.blocks.map((block) => ({ ...block, isLocked: true })) },
    currentQuestionBank: originalBank,
    parsed: parsedBatch,
    context,
    destination: { kind: 'existing_block', blockId: 'block-1' },
    blockDefaults,
  });

  assert.equal(locked.plan.ok, false);
  if (locked.plan.ok) return;
  assert.equal(locked.plan.code, 'locked_destination');
  assert.deepEqual(originalBank, preview.nextQuestionBank);
});
```

- [ ] **Step 2: Run the preview test and verify it fails**

Run: `npx tsx --test src/utils/taskQuestionImportPreview.test.ts`

Expected: FAIL because the preview module does not exist.

- [ ] **Step 3: Implement preview composition without importing pdfjs**

Define a structural parsed-batch type so Node tests never import the Vite `?url` PDF worker:

```ts
export interface TaskQuestionImportParsedBatch {
  questions: ImportedObjectiveQuestion[];
  rejectedBlocks: number;
  fileName: string;
  pageCount: number;
}

export interface BuildTaskQuestionImportPreviewInput {
  task: StudyTask;
  currentQuestionBank: QuestionBankItem[];
  parsed: TaskQuestionImportParsedBatch;
  context: QuestionBankImportContext;
  destination: TaskQuestionImportDestination;
  blockDefaults: TaskQuestionImportBlockDefaults;
  idFactory?: () => string;
  now?: () => string;
}

export interface TaskQuestionImportPreview {
  plan: TaskQuestionImportResult;
  canonicalItems: QuestionBankItem[];
  nextQuestionBank: QuestionBankItem[];
  bankAdded: number;
  bankDuplicates: number;
  rejectedBlocks: number;
}
```

Compose only existing pure functions:

```ts
const incomingItems = buildQuestionBankItems(input.parsed.questions, input.context);
const merged = mergeQuestionBankItems(input.currentQuestionBank, incomingItems);
const canonicalItems = resolveMergedQuestionBankItems(incomingItems, merged.items);
const plan = planTaskQuestionImport({
  task: input.task,
  sourceQuestions: input.parsed.questions,
  canonicalItems,
  destination: input.destination,
  blockDefaults: input.blockDefaults,
  idFactory: input.idFactory,
  now: input.now,
});

return {
  plan,
  canonicalItems,
  nextQuestionBank: merged.items,
  bankAdded: merged.added,
  bankDuplicates: merged.duplicates,
  rejectedBlocks: input.parsed.rejectedBlocks,
};
```

- [ ] **Step 4: Run all three feature utility suites**

Run: `npx tsx --test src/utils/taskQuestionImport.test.ts src/utils/taskQuestionImportStorage.test.ts src/utils/taskQuestionImportPreview.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the preview slice**

```bash
git add src/utils/taskQuestionImportPreview.ts src/utils/taskQuestionImportPreview.test.ts
git commit -m "feat: preview task PDF question imports"
```

---

### Task 4: Shared Import Modal

**Files:**
- Create: `src/components/TaskQuestionPdfImportModal.tsx`
- Create: `src/components/TaskQuestionPdfImportModal.contract.test.ts`

**Interfaces:**
- Consumes: `importObjectiveQuestionsFromPdf`, `buildTaskQuestionImportPreview`, `loadStoredQuestionBank`, target APIs, and a preselected destination.
- Produces: one modal that calls `onCommit(nextTask, nextQuestionBank)` only after a valid preview.

```ts
export interface TaskQuestionPdfImportModalProps {
  isOpen: boolean;
  task: StudyTask | null;
  initialDestination: TaskQuestionImportDestination | null;
  onClose: () => void;
  onCommit: (
    nextTask: StudyTask,
    nextQuestionBank: QuestionBankItem[],
  ) => { ok: true } | { ok: false; message: string };
  onImported: (summary: TaskQuestionImportSummary) => void;
}
```

- [ ] **Step 1: Write a failing source-contract test for the modal**

Follow `PlannerArea.commandLayer.test.ts` and read the component source. Use this complete contract:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const componentPath = new URL('./TaskQuestionPdfImportModal.tsx', import.meta.url);
const source = readFileSync(componentPath, 'utf8');

test('task question modal exposes PDF and pasted-text safe import flows', () => {
  for (const label of [
    'Arquivo e fonte', 'Destino', 'Prévia', 'Confirmar',
    'Detectadas', 'Rejeitadas', 'No banco', 'Enriquecidas', 'Adicionadas', 'Conflitos',
  ]) {
    assert.match(source, new RegExp(label));
  }
  for (const destination of ['new_section', 'new_block', 'existing_block']) {
    assert.match(source, new RegExp(destination));
  }
  assert.match(source, /importObjectiveQuestionsFromPdf/);
  assert.match(source, /parseObjectiveQuestions/);
  assert.match(source, /Colar texto/);
  assert.match(source, /buildTaskQuestionImportPreview/);
  assert.match(source, /disabled=\{!canConfirm \|\| isCommitting\}/);
  assert.doesNotMatch(source, /value=["']tec["']/);
  assert.doesNotMatch(source, /persistQuestionBank/);
  assert.doesNotMatch(source, /localStorage/);
});
```

- [ ] **Step 2: Run the contract test and verify it fails**

Run: `npx tsx --test src/components/TaskQuestionPdfImportModal.contract.test.ts`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement modal initialization and parsing**

Define the source selector with `estrategia`, `professor`, `official`, and `other`; deliberately omit `tec`. Fetch editable target options with `fetchPlannerTargets` only while the modal is open, abort on cleanup, and fall back to the task's current target plus `DEFAULT_STUDY_TARGET_PROFILES` when the local Study OS service is unavailable. When `isOpen`, `task`, or `initialDestination` changes, reset file/result/error and initialize:

```ts
setSourceKind('estrategia');
setTargetSlug(task?.targetSlug || '');
setDiscipline(task?.discipline || '');
setBank(task?.bank || 'Outra');
setLesson(task?.assunto || '');
setBlockTitle('Questões importadas');
setDestination(initialDestination);
```

On file selection, derive the source title from the filename and fill empty `sourceName`, `lesson`, `blockTitle`, and a blank `new_section.sectionTitle`. `Processar PDF` calls:

```ts
const imported = await importObjectiveQuestionsFromPdf(file, {
  requireExplicitQuestionLabel: sourceKind === 'professor',
});
setParsed(imported);
```

Catch parser failures, retain the selected file, and show `Não foi possível ler este PDF.` inside the modal.

Add a segmented input selector with `PDF` and `Colar texto`. Text mode renders a labeled textarea and `Processar texto`; it calls `parseObjectiveQuestions(pastedText, { requireExplicitQuestionLabel: sourceKind === 'professor' })`, maps the result to the same structural parsed batch (`fileName: 'texto-colado.txt'`, `pageCount: 0`, parser rejection count), and never mutates task/bank state before confirmation. Empty text or zero detected objective questions keeps confirmation disabled with `Nenhuma questão objetiva detectada.`

- [ ] **Step 4: Implement destination selectors and memoized preview**

List non-section blocks for `existing_block` and section headers for `new_block`. The segmented destination control changes the discriminated union without losing source metadata. Build context and defaults exactly:

```ts
const context: QuestionBankImportContext = {
  sourceKind,
  sourceName: sourceName.trim() || normalizedFileName,
  sourceFileName: parsed.fileName,
  targetSlug: targetSlug || undefined,
  discipline,
  lesson,
  taskTitle: blockTitle,
  bank: effectiveBank,
  tags: [discipline, lesson, sourceName].filter(Boolean),
};

const blockDefaults: TaskQuestionImportBlockDefaults = {
  title: blockTitle.trim() || 'Questões importadas',
  lesson: lesson.trim() || sourceName.trim() || normalizedFileName,
  pages: `${parsed.pageCount} páginas`,
  bank: effectiveBank,
};
```

Use `useMemo` to call `buildTaskQuestionImportPreview`; preview construction must not write storage or dispatch events. Set `canConfirm` only when task, parsed questions, required metadata, destination, and `preview.plan.ok` are present.

- [ ] **Step 5: Implement confirmation and compact responsive UI**

On confirm, guard again on `canConfirm`, call `onCommit(preview.plan.task, preview.nextQuestionBank)`, retain modal state on failure, and only on success call `onImported(preview.plan.summary)` followed by `onClose()`.

Use one full-screen overlay and one `max-w-5xl max-h-[92vh] overflow-y-auto` surface. Use a responsive `grid-cols-1 lg:grid-cols-2` for metadata/destination, a flat stats grid for preview, a scrollable conflict list, and a sticky footer with Cancel and Import buttons. Use lucide `FileUp`, `SearchCheck`, `Loader2`, `CheckCircle2`, and `X`; every icon-only command needs a Portuguese tooltip or `aria-label`.

- [ ] **Step 6: Run modal contracts, TypeScript, and build**

Run: `npx tsx --test src/components/TaskQuestionPdfImportModal.contract.test.ts src/utils/taskQuestionImportPreview.test.ts`

Expected: PASS.

Run: `npm run lint`

Expected: PASS.

Run: `npm run build`

Expected: PASS and Vite emits the production bundle.

- [ ] **Step 7: Commit the modal slice**

```bash
git add src/components/TaskQuestionPdfImportModal.tsx src/components/TaskQuestionPdfImportModal.contract.test.ts
git commit -m "feat: add shared task PDF import modal"
```

---

### Task 5: Wire Every Existing-Task Entry Point

**Files:**
- Modify: `src/App.tsx:1-34,63-93,184-228,278-340,491-499,584-652,688-772`
- Modify: `src/components/ActivityBlockCard.tsx:1-50,91-112,220-317,570-642`
- Modify: `src/components/BlockEditModal.tsx:1-26,169-181`
- Modify: `src/components/SectionEditModal.tsx:1-27,52-133`
- Create: `src/components/TaskQuestionPdfImportEntryPoints.contract.test.ts`

**Interfaces:**
- Consumes: the modal and `useTasks().commitTaskQuestionImport`.
- Produces: task-footer, add-block, create-section, section-header, and activity-block entry points for current and history task views.

- [ ] **Step 1: Write the failing entry-point contract test**

Read the four source files and assert these user-facing contracts with a complete source-level test:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const read = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8');
const appSource = read('../App.tsx');
const blockCardSource = read('./ActivityBlockCard.tsx');
const blockModalSource = read('./BlockEditModal.tsx');
const sectionModalSource = read('./SectionEditModal.tsx');

test('every existing-task surface opens the shared PDF importer', () => {
assert.match(appSource, /Importar questões/);
assert.match(blockCardSource, /Importar PDF nesta seção/);
assert.match(blockCardSource, /Importar PDF neste bloco/);
assert.match(blockModalSource, /Importar questões/);
assert.match(sectionModalSource, /Criar e importar questões/);
assert.match(appSource, /setTaskWorkTab\('questoes'\)/);
assert.match(appSource, /commitTaskQuestionImport/);
assert.match(blockCardSource, /onImportQuestionsFromPdf/);
assert.doesNotMatch(blockCardSource, /importObjectiveQuestionsFromPdf/);
assert.doesNotMatch(blockCardSource, /loadStoredQuestionBank/);
});
```

- [ ] **Step 2: Run the contract and verify it fails**

Run: `npx tsx --test src/components/TaskQuestionPdfImportEntryPoints.contract.test.ts`

Expected: FAIL because the entry points are not wired.

- [ ] **Step 3: Add identity-only import commands to activity and section cards**

Add this prop:

```ts
onImportQuestionsFromPdf?: (destination: TaskQuestionImportDestination) => void;
```

In the section toolbar, add a `FileUp` icon button that emits `{ kind: 'new_block', sectionTitle: block.title }` with tooltip `Importar PDF nesta seção`. In the activity toolbar, add a `FileUp` icon button that emits `{ kind: 'existing_block', blockId: block.id }` with tooltip `Importar PDF neste bloco`. Keep the command available for a locked target so the modal can explain the lock and allow another destination; confirmation remains disabled while the selected destination is locked.

- [ ] **Step 4: Add secondary import commands to block and section modals**

Export `BlockEditModalState` and add `onImportPdf?: (state: BlockEditModalState) => void`. Put a secondary `FileUp` button in the footer; for a new block label it `Importar PDF`, and for an existing block label it `Importar PDF neste bloco`.

Extend `SectionEditModal` with:

```ts
mode: 'create' | 'edit';
onImportPdf?: (sectionTitle: string) => void;
```

In create mode, show the title input, hide layout controls, label the primary action `Criar seção`, and add `Criar e importar PDF`. In edit mode preserve the current layout controls and primary action. Disable either create command when the trimmed title is empty.

- [ ] **Step 5: Coordinate task identity and modal requests in App**

Replace the section modal state with task identity and mode:

```ts
const [sectionModal, setSectionModal] = useState({
  isOpen: false,
  mode: 'edit' as 'create' | 'edit',
  taskId: '',
  title: '',
});

const [taskPdfImportRequest, setTaskPdfImportRequest] = useState<{
  taskId: string;
  destination: TaskQuestionImportDestination;
} | null>(null);
```

Add an opener that receives an explicit task ID so history never accidentally targets the active task:

```ts
const openTaskPdfImport = (
  taskId: string,
  destination: TaskQuestionImportDestination,
) => setTaskPdfImportRequest({ taskId, destination });
```

The task footer opens `new_section` with an empty section title so selecting a file can default it to the normalized source title. The Add Block modal opens `existing_block` when editing, otherwise `new_block` using its lesson if that lesson matches an existing section and an empty section title otherwise. The create-section modal opens `new_section` with its entered title. Pass explicit current/history task IDs to every card callback.

Mount one shared modal after the other app modals:

```tsx
<TaskQuestionPdfImportModal
  isOpen={Boolean(taskPdfImportRequest)}
  task={tasks.find((task) => task.id === taskPdfImportRequest?.taskId) || null}
  initialDestination={taskPdfImportRequest?.destination || null}
  onClose={() => setTaskPdfImportRequest(null)}
  onCommit={commitTaskQuestionImport}
  onImported={(summary) => {
    setTaskWorkTab('questoes');
    const conflicts = summary.contentConflicts + summary.answerKeyConflicts;
    showToast(
      `${summary.enriched} enriquecidas; ${summary.appended} adicionadas; ${summary.duplicates} já presentes; ${conflicts} conflito(s).`,
    );
  }}
/>
```

For history section controls, wire lock/stats/layout/rename operations with `viewingTask.id`; do not use `activeTaskId` as a fallback.

- [ ] **Step 6: Run entry-point contracts and complete frontend regressions**

Run: `npx tsx --test src/components/TaskQuestionPdfImportEntryPoints.contract.test.ts src/components/TaskQuestionPdfImportModal.contract.test.ts`

Expected: PASS.

Run: `npm test`

Expected: PASS for all existing and new TypeScript tests, including standalone PDF parser, question bank, manual question editing, revisions, cards, and task history contracts.

Run: `npm run lint`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

- [ ] **Step 7: Commit the integrated feature**

```bash
git add src/App.tsx src/components/ActivityBlockCard.tsx src/components/BlockEditModal.tsx src/components/SectionEditModal.tsx src/components/TaskQuestionPdfImportEntryPoints.contract.test.ts
git commit -m "feat: import PDF questions into existing tasks"
```

---

### Task 6: Browser Acceptance and Final Regression Gate

**Files:**
- Modify: implementation files only when the acceptance gate reveals a concrete defect.

**Interfaces:**
- Produces: verified desktop/mobile behavior without changing the user's `localhost` task data during destructive test imports.

- [ ] **Step 1: Start or reuse the Vite server**

Run: `npm run dev`

Expected: Vite listens on `0.0.0.0:3000`. If port 3000 is already served by this repository, reuse it instead of starting a second process.

- [ ] **Step 2: Verify new-section import in an isolated browser origin**

Open `http://127.0.0.1:3000/` so localStorage is isolated from the user's real `http://localhost:3000/` data. Create a small task, choose task-footer `Importar PDF`, select `C:\Users\JP\Downloads\ITCD_CE.pdf.pdf`, preview the batch, create `Aula 02 - ITCD`, and confirm.

Expected:
- 25 objective questions are detected for the current ITCD file;
- the section and full-width one-column block appear;
- the view switches to `Questões`;
- imported keys remain hidden until reveal;
- a repeated import into that same block reports all questions already present and leaves the count unchanged.

- [ ] **Step 3: Verify placeholder enrichment and progress preservation**

In the isolated origin, create a block containing question numbers `1-3`, set an answer, doubt, observation, and eliminated alternative on question 2, then import the same PDF into that existing block.

Expected: statements and alternatives appear; question 2 retains its answer, correctness, doubt, observation, elimination, and attempt history; the preview reports enrichment rather than appending three duplicates.

- [ ] **Step 4: Verify all entry points and lock handling at desktop and mobile widths**

At 1440x1000 and 390x844, inspect the task footer, Add Block modal, Create Section modal, section header, and activity toolbar. Open the importer from each entry point and verify its destination is preselected correctly. Lock a block and a section; verify the modal shows the precise locked-destination reason and disables confirmation without overflowing or overlapping controls.

- [ ] **Step 5: Verify history and standalone import regressions**

Open a task through Histórico, invoke the block and section import buttons, and verify the request targets that history task rather than any active task. Return to the empty Caderno screen and run the existing standalone PDF importer; verify it still creates a separate executable task and canonical bank entries.

- [ ] **Step 6: Run the final deterministic gate**

Run: `npm test`

Expected: PASS.

Run: `npm run lint`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

Run: `git diff --check`

Expected: no output.

- [ ] **Step 7: Resolve any acceptance defect through a focused red-green cycle**

If a browser check fails, add a focused failing test to the feature test file that owns the behavior, run it red, make the smallest production correction in that task's mapped file, rerun the focused test and the complete Step 6 gate, then commit the exact changed test and production files with `git commit -m "fix: harden in-task PDF import flow"`. If every browser check passes, keep the worktree clean and do not create an empty commit.

## Acceptance

The feature is complete when an existing current or history task can import a parsed PDF into every supported destination, placeholder progress survives enrichment, canonical bank links are present, repeated import is idempotent, conflicts never overwrite complete manual content, locked destinations fail clearly, task and bank writes roll back together, the standalone importer still works, desktop/mobile checks pass, and the full test/lint/build gate is green.
