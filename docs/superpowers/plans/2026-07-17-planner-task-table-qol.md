# Planner Tasks Table Quality-of-Life Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every Planner task list stable sorting, drag column order, visibility controls, and persisted preferences while preserving the current visual workflow.

**Architecture:** Extract a pure versioned preference/sort module, then make all Planner task tables render from one column registry. DnD uses the repository's existing dnd-kit dependency; the Actions column is outside user preferences and stays fixed last.

**Tech Stack:** React 19, TypeScript 5.8, @dnd-kit/core 6, @dnd-kit/sortable 10, localStorage, Node test runner through `tsx`.

## Global Constraints

- Search, discipline, and quick-view filters continue to combine with AND.
- Header click cycles ascending, descending, and unsorted.
- Missing values sort last in both directions.
- Equal values use task number and then task id as deterministic tie-breakers.
- `actions` is always visible, cannot be dragged or hidden, and is always last.
- Preferences are versioned; malformed/unknown/old values safely migrate without blanking the table.
- List, Pending, Ignored, Archived, and discipline surfaces share the same preferences.
- Restore defaults is always available from the compact `Colunas` menu.

---

### Task 1: Pure Column Preferences and Stable Sort

**Files:**
- Create: `src/utils/plannerTaskTablePreferences.ts`
- Create: `src/utils/plannerTaskTablePreferences.test.ts`

**Interfaces:**

```ts
export type PlannerTaskColumnId =
  | 'number' | 'discipline' | 'format' | 'description' | 'duration'
  | 'performance' | 'status' | 'relevance' | 'schedule';
export type PlannerTaskSort = { column: PlannerTaskColumnId; direction: 'asc' | 'desc' } | null;
export interface PlannerTaskTablePreferences {
  version: 1;
  order: PlannerTaskColumnId[];
  hidden: PlannerTaskColumnId[];
  sort: PlannerTaskSort;
}
export const PLANNER_TASK_TABLE_PREFERENCES_KEY = 'ls_planner_task_table_preferences_v1';
```

- [ ] **Step 1: Write failing tests**

Assert default parsing, malformed JSON, wrong version, unknown ids, missing known columns appended in default order, reorder, hide/show, restore, asc/desc/unsorted cycle, missing-last in both directions, and deterministic ties. Assert the public column union/operations cannot accept `actions`.

```ts
test('cycles asc desc and unsorted without moving missing values first', () => {
  assert.deepEqual(nextPlannerTaskSort(null, 'performance'), { column: 'performance', direction: 'asc' });
  assert.deepEqual(nextPlannerTaskSort({ column: 'performance', direction: 'asc' }, 'performance'), { column: 'performance', direction: 'desc' });
  assert.equal(nextPlannerTaskSort({ column: 'performance', direction: 'desc' }, 'performance'), null);
  assert.deepEqual(sortPlannerTasks(fixtures, { column: 'performance', direction: 'desc' }).map(t => t.id), ['high', 'low', 'missing']);
});
```

- [ ] **Step 2: Run RED**

Run: `npx.cmd tsx --test src/utils/plannerTaskTablePreferences.test.ts`

Expected: FAIL because the utility does not exist.

- [ ] **Step 3: Implement the pure registry operations**

Export `DEFAULT_PLANNER_TASK_COLUMNS`, `DEFAULT_PLANNER_TASK_TABLE_PREFERENCES`, `parsePlannerTaskTablePreferences`, `movePlannerTaskColumn`, `setPlannerTaskColumnHidden`, `nextPlannerTaskSort`, and `sortPlannerTasks`. Parse via allow-lists; never trust stored arrays. Stable sorting decorates each task with its upstream index and uses number/id before that index.

- [ ] **Step 4: Run GREEN and commit**

Run: `npx.cmd tsx --test src/utils/plannerTaskTablePreferences.test.ts`

Expected: PASS.

```bash
git add src/utils/plannerTaskTablePreferences.ts src/utils/plannerTaskTablePreferences.test.ts
git commit -m "feat: add planner task table preferences"
```

---

### Task 2: Configurable Task Table UI

**Files:**
- Modify: `src/components/PlannerArea.tsx`
- Create: `src/components/PlannerTaskTable.contract.test.ts`

**Interfaces:**
- Consumes Task 1's preferences and sort helpers.
- Produces shared table state, sortable headers, a `Colunas` menu, visibility toggles, and restore defaults.

- [ ] **Step 1: Write a failing source contract**

Read `PlannerArea.tsx` and assert the storage key, `DndContext`, `SortableContext`, `horizontalListSortingStrategy`, header sort callbacks, `Colunas`, `Restaurar padrão`, per-column checkboxes, and a separately rendered sticky Actions header/cell. Assert no preference operation receives `'actions'`.

- [ ] **Step 2: Run RED**

Run: `npx.cmd tsx --test src/components/PlannerTaskTable.contract.test.ts`

Expected: FAIL because the table is fixed.

- [ ] **Step 3: Add shared preference state in PlannerArea**

Initialize once from localStorage through `parsePlannerTaskTablePreferences`, persist on change, and derive `sortedDiscoveredTasks = sortPlannerTasks(discoveredTasks, preferences.sort)`. Pass the same preferences to every `TaskTable` and discipline grouping.

- [ ] **Step 4: Render from one column registry**

Create a typed registry inside `PlannerArea.tsx` with header label, sort value, header class, and cell renderer for each public id. `TaskRows` maps only visible ordered registry entries, then renders the existing Actions cell last. The current actions and visual status badges remain unchanged.

- [ ] **Step 5: Add horizontal drag and progressive disclosure**

Use sensors with a small activation distance so header clicks still sort. Each sortable header has a visible drag grip, keyboard support from dnd-kit, sort direction icon/title, and no drag behavior for Actions. The `Colunas` popover lists toggles, disables hiding the last visible data column, and offers `Restaurar padrão`.

- [ ] **Step 6: Run focused and full gates**

Run: `npx.cmd tsx --test src/utils/plannerTaskTablePreferences.test.ts src/components/PlannerTaskTable.contract.test.ts`

Expected: PASS.

Run: `npm.cmd test`

Expected: PASS.

Run: `npm.cmd run lint`

Expected: PASS.

Run: `npm.cmd run build`

Expected: PASS with only the existing non-fatal chunk warning.

- [ ] **Step 7: Commit**

```bash
git add src/components/PlannerArea.tsx src/components/PlannerTaskTable.contract.test.ts
git commit -m "feat: make planner task columns configurable"
```

## Acceptance

The plan is complete when the student can click-sort, drag-reorder, hide/show, and restore task columns across every task view; preferences survive reload; Actions stays fixed; filters remain AND-composed; desktop/mobile tables remain usable; and all deterministic gates pass.
