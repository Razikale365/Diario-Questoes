# SEFAZ CE Human Study Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir a interface orientada ao sistema por uma experiência humana centrada em IA Hoje, Calendário, Tarefas e Mais, preservando conclusão, pins, controle manual e evidência factual.

**Architecture:** O calendário aplicado do Plano A é a fonte de agenda do Sprint. Funções puras constroem rotas, preview, tarefas unificadas, filtros, resultado e recompensa; componentes React apenas orquestram esses contratos. A navegação antiga só é retirada após equivalência, testes de acessibilidade e validação real; o fechamento reconcilia o estudo de hoje no histórico LS com backup e replay idempotente.

**Tech Stack:** React 19, TypeScript 5.8, Vite 6, Tailwind CSS 4, Node test runner via `tsx`, Playwright 1.59, local FastAPI/SQLite from Plan A.

## Global Constraints

- Execute only after every gate in `docs/superpowers/plans/2026-07-14-sefaz-ce-sprint-calendar-core.md` is green.
- The stable identifiers and API from Plan A are authoritative: `calendarItemId`, `sourcePlanTaskId`, `linkedStudyTaskId`, head run, expected versions, preview/apply, and result receipts.
- Keep the old shell reachable until the four new destinations have functional parity and the browser gate passes.
- Desktop and mobile primary navigation must contain exactly `IA Hoje | Calendário | Tarefas | Mais`, in that order; default is `#/today`.
- Calendar remains a primary screen. Completed tasks remain visible on their original day and are not hidden by default.
- Auto-organize always uses backend preview → diff → apply. No client-only scheduling mutation may bypass the applied calendar.
- Drag/date/time creates an explicit pinned override. Manual authority always wins.
- `failed`, `skipped`, `ignored`, and `completed` remain distinct. Failure never earns completion feedback.
- Reward uses only recorded minutes, questions, accuracy, confidence, and recalculated trajectory; no XP, fake streak, or invented point gain.
- Priority color always has icon and text. Green is reserved for completion status.
- Search is accent-insensitive and immediate, with no animation per keystroke.
- Minimum control size is 36 px desktop and 44 px for primary touch actions; honor keyboard, `forced-colors`, `prefers-contrast`, and `prefers-reduced-motion`.
- Weekly Codex quota is bounded through 2026-07-21: execute only these slices, use focused tests in Tasks 1–7, the UI gate in Task 8, and the whole-project gate only in Task 9.
- Do not implement the separate in-task PDF plan here. The drawer exposes an `onImportPdf` callback to the existing/scheduled specialized modal.
- Do not touch package `249654`, create a permanent LS scraper, store credentials, or store proprietary question content.
- Use focused TDD per task; run the full Python/TypeScript/build/browser gate only at milestone cutovers to conserve the remaining quota.

---

## File Structure

### Pure UI/domain utilities

- `src/utils/appRoute.ts`: hash/query parsing and serialization.
- `src/utils/calendarPreview.ts`: preview state reducer, summaries, conflict, and undo request.
- `src/utils/unifiedTasks.ts`: merged read model, search, filters, sort, and pagination.
- `src/utils/taskResultDraft.ts`: tolerant form draft parsing and inline errors.
- `src/utils/completionFeedback.ts`: one-time factual feedback.
- `src/utils/todayAi.ts`: primary action, short queue, progress, and 15-day strip.

### New components

- `src/components/AppShell.tsx`: four-destination layout.
- `src/components/PrimaryNavigation.tsx`: shared desktop/mobile navigation.
- `src/components/TodayAiPage.tsx`: next move and daily progress.
- `src/components/CalendarPage.tsx`: month/week, load, heat, pins, and placeholders.
- `src/components/AutoOrganizePreviewModal.tsx`: non-mutating diff and apply.
- `src/components/UnifiedTasksPage.tsx`: search, quick views, filters, results.
- `src/components/TaskDetailDrawer.tsx`: one task detail surface.
- `src/components/TaskCompletionFeedback.tsx`: factual success/undo.
- `src/components/MorePage.tsx`: tools and secondary views.

### Existing integration files

- `src/types/index.ts`, `src/utils/planner.ts`, `src/study-os/sourcePlanBridge.ts`: durable result and merge semantics.
- `src/App.tsx`: route ownership, execution context, drawer, and final cutover.
- `src/components/PlannerArea.tsx`: remove direct auto-schedule and 13-tab navigation after extraction.
- `src/components/Sidebar.tsx`, `src/components/BottomNav.tsx`: removed from render after parity.
- `src/index.css`: semantic status/priority/motion/contrast tokens.

---

### Task 1: Truthful PlannerTask result semantics

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/utils/planner.ts`
- Modify: `src/utils/planner.test.ts`
- Modify: `src/study-os/sourcePlanBridge.ts`
- Modify: `src/study-os/sourcePlanBridge.test.ts`

**Interfaces:**
- Produces `PlannerTaskStatus` with `failed`; `PlannerTask.completedAt`, `lastOutcome`, `scheduleOrigin`, `schedulePinned`; idempotent `applyPlannerTaskResult`; monotonic source-plan merge.

- [ ] **Step 1: Write failing completion, failure, skip, replay, and reimport tests**

```ts
test('failed remains failed and never receives completedAt', () => {
  const next = applyPlannerTaskResult(makeTask(), { outcome: 'failed', spentMinutes: 30, performance: 20 }, NOW);
  assert.equal(next.status, 'failed');
  assert.equal(next.lastOutcome, 'failed');
  assert.equal(next.completedAt, undefined);
});

test('completion timestamp is stable across replay', () => {
  const first = applyPlannerTaskResult(makeTask(), { outcome: 'completed', spentMinutes: 45, performance: 90 }, NOW);
  const replay = applyPlannerTaskResult(first, { outcome: 'completed', spentMinutes: 45, performance: 90 }, LATER);
  assert.equal(replay.completedAt, NOW);
});

test('source-plan refresh cannot regress local completion or pin', () => {
  const merged = mergeSourcePlanTasks([completedPinnedTask()], [stalePendingImport()]);
  assert.equal(merged[0].status, 'completed');
  assert.equal(merged[0].schedulePinned, true);
  assert.equal(merged[0].spentMinutes, 60);
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npx --no-install tsx --test src/utils/planner.test.ts src/study-os/sourcePlanBridge.test.ts`

Expected: FAIL because failed becomes completed and the new fields do not exist.

- [ ] **Step 3: Implement exact transitions**

```ts
export type PlannerTaskStatus =
  | 'pending' | 'started' | 'completed' | 'failed' | 'ignored' | 'archived';

if (result.outcome === 'completed') {
  return {
    ...task,
    status: 'completed',
    lastOutcome: 'completed',
    completedAt: task.completedAt ?? now,
    performance: sanitizePerformance(result.performance),
    spentMinutes: sanitizeSpentMinutes(result.spentMinutes, task.spentMinutes),
    updatedAt: now,
  };
}
if (result.outcome === 'failed') {
  return { ...task, status: 'failed', lastOutcome: 'failed', completedAt: undefined,
    performance: sanitizePerformance(result.performance ?? 0),
    spentMinutes: sanitizeSpentMinutes(result.spentMinutes, task.spentMinutes), updatedAt: now };
}
if (result.outcome === 'skipped') {
  return { ...task, status: 'pending', lastOutcome: 'skipped', completedAt: undefined,
    spentMinutes: sanitizeSpentMinutes(result.spentMinutes, task.spentMinutes), updatedAt: now };
}
```

For source-plan merge, preserve local `status`, `completedAt`, `lastOutcome`, `spentMinutes`, `performance`, `linkedStudyTaskId`, `scheduleOrigin`, and `schedulePinned` when the existing `updatedAt` is newer or the existing state is completed/active/manual/pinned. A new source revision may update description/material fields without regressing execution.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npx --no-install tsx --test src/utils/planner.test.ts src/study-os/sourcePlanBridge.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the semantics savepoint**

```powershell
git add src/types/index.ts src/utils/planner.ts src/utils/planner.test.ts src/study-os/sourcePlanBridge.ts src/study-os/sourcePlanBridge.test.ts
git commit -m "fix: preserve truthful planner results"
```

---

### Task 2: Auto-organize preview state machine

**Files:**
- Create: `src/utils/calendarPreview.ts`
- Create: `src/utils/calendarPreview.test.ts`
- Create: `src/components/AutoOrganizePreviewModal.tsx`
- Create: `src/components/AutoOrganizePreviewModal.test.ts`
- Modify: `src/components/PlannerArea.tsx`

**Interfaces:**
- Consumes Plan A: `previewSprintCalendar`, `applySprintCalendarRun`, restore-preview mode, head/override versions.
- Produces:

```ts
type PreviewPhase = 'closed' | 'loading' | 'ready' | 'applying' | 'conflict' | 'error';
type AutoOrganizeMode = 'reflow_open' | 'fill_open';
type CalendarPreviewEvent =
  | { type: 'OPEN'; mode: AutoOrganizeMode }
  | { type: 'LOADED'; document: SprintCalendarDocument }
  | { type: 'APPLY' }
  | { type: 'APPLIED'; document: SprintCalendarDocument }
  | { type: 'CONFLICT'; message: string }
  | { type: 'ERROR'; message: string }
  | { type: 'CANCEL' };
```

- [ ] **Step 1: Write failing reducer, cancel, apply, conflict, and undo tests**

```ts
test('cancel closes without changing the applied calendar snapshot', () => {
  const before = structuredClone(APPLIED);
  const state = reducePreview({ phase: 'ready', applied: APPLIED, draft: DRAFT }, { type: 'CANCEL' });
  assert.deepEqual(state.applied, before);
  assert.equal(state.phase, 'closed');
});

test('undo creates a restore preview against the current head', () => {
  assert.deepEqual(buildUndoPreviewInput({ currentRunId: 9, undoRunId: 7 }), {
    mode: 'restore_run', expectedRunId: 9, restoreRunId: 7,
  });
});
```

- [ ] **Step 2: Run focused preview tests and verify RED**

Run: `npx --no-install tsx --test src/utils/calendarPreview.test.ts src/components/AutoOrganizePreviewModal.test.ts`

Expected: FAIL because files do not exist.

- [ ] **Step 3: Implement pure state and summary**

```ts
export function summarizeCalendarDiff(diff: SprintCalendarDiff): CalendarDiffSummary {
  return {
    added: diff.items.filter(item => item.kind === 'added').length,
    moved: diff.items.filter(item => item.kind === 'moved').length,
    preserved: diff.items.filter(item => item.kind === 'preserved').length,
    completed: diff.items.filter(item => item.reason === 'completed').length,
    noSpace: diff.items.filter(item => item.kind === 'unscheduled').length,
    placeholderReplacements: diff.items.filter(item => item.kind === 'placeholder_replaced').length,
    overloadDays: diff.days.filter(day => day.overageMinutes > 0).length,
  };
}
```

The reducer never mutates `applied`. A 409 enters `conflict` and exposes only `Recalcular`; it never retries apply automatically.

- [ ] **Step 4: Implement modal and replace direct autoSchedule mutation**

`AutoOrganizePreviewModal` lists summary counts, each before/after move, pinned/completed preserved items, capacity overflow, Cancel, and Apply. `PlannerArea.autoOrganize` now opens backend preview; remove the direct call to `autoSchedulePlannerTasks` from that command. Keep the old utility only for non-Sprint legacy data until final cutover.

```tsx
<button type="button" onClick={() => onPreview('reflow_open')}>Auto-organizar</button>
<details>
  <summary>Outra opção</summary>
  <button type="button" onClick={() => onPreview('fill_open')}>Só preencher espaços</button>
</details>
```

- [ ] **Step 5: Run preview tests, lint, and build**

```powershell
npx --no-install tsx --test src/utils/calendarPreview.test.ts src/components/AutoOrganizePreviewModal.test.ts
npm run lint
npm run build
```

Expected: all exit 0.

- [ ] **Step 6: Commit the preview savepoint**

```powershell
git add src/utils/calendarPreview.ts src/utils/calendarPreview.test.ts src/components/AutoOrganizePreviewModal.tsx src/components/AutoOrganizePreviewModal.test.ts src/components/PlannerArea.tsx
git commit -m "feat: preview calendar reorganization"
```

---

### Task 3: Hash routes and four-destination AppShell

**Files:**
- Create: `src/utils/appRoute.ts`
- Create: `src/utils/appRoute.test.ts`
- Create: `src/components/AppShell.tsx`
- Create: `src/components/PrimaryNavigation.tsx`
- Create: `src/components/PrimaryNavigation.test.ts`
- Modify: `src/App.tsx`

**Interfaces:**
- Produces `PrimaryDestination`, `AppRoute`, `parseAppRoute`, `buildAppHash`, and `useAppRoute`.

- [ ] **Step 1: Write failing route round-trip and exact navigation tests**

```ts
test('unknown or empty hashes resolve to IA Hoje', () => {
  assert.equal(parseAppRoute('').destination, 'today');
  assert.equal(parseAppRoute('#/unknown').destination, 'today');
});

test('task query survives hash round trip', () => {
  const route = parseAppRoute('#/tasks?q=icms&status=pending&task=source-12');
  assert.equal(buildAppHash(route), '#/tasks?q=icms&status=pending&task=source-12');
});

test('primary navigation exposes exactly four ordered destinations', () => {
  assert.deepEqual(PRIMARY_DESTINATIONS.map(item => item.id), ['today', 'calendar', 'tasks', 'more']);
});
```

- [ ] **Step 2: Run route/navigation tests and verify RED**

Run: `npx --no-install tsx --test src/utils/appRoute.test.ts src/components/PrimaryNavigation.test.ts`

Expected: FAIL because the new shell does not exist.

- [ ] **Step 3: Implement route parsing without a router dependency**

```ts
export type PrimaryDestination = 'today' | 'calendar' | 'tasks' | 'more';
const DESTINATIONS = new Set<PrimaryDestination>(['today', 'calendar', 'tasks', 'more']);

export function parseAppRoute(hash: string): AppRoute {
  const raw = hash.replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  const destination = DESTINATIONS.has(path as PrimaryDestination) ? path as PrimaryDestination : 'today';
  return { destination, params: new URLSearchParams(query) };
}

export function buildAppHash(route: AppRoute): string {
  const query = route.params.toString();
  return `#/${route.destination}${query ? `?${query}` : ''}`;
}
```

`useAppRoute` listens to `hashchange`, uses `history` only through the hash, and preserves query on back/reload.

- [ ] **Step 4: Implement shell/navigation in isolation**

`AppShell` receives the active destination and four page nodes. `PrimaryNavigation` renders the same ordered data on desktop/mobile, labels icons, and provides 44 px touch targets. Mount the shell in `App.tsx` while retaining the legacy pages inside the appropriate new destination until Task 8.

- [ ] **Step 5: Run tests, lint, and build**

```powershell
npx --no-install tsx --test src/utils/appRoute.test.ts src/components/PrimaryNavigation.test.ts
npm run lint
npm run build
```

Expected: all exit 0; initial URL is `#/today`.

- [ ] **Step 6: Commit the shell savepoint**

```powershell
git add src/utils/appRoute.ts src/utils/appRoute.test.ts src/components/AppShell.tsx src/components/PrimaryNavigation.tsx src/components/PrimaryNavigation.test.ts src/App.tsx
git commit -m "feat: add four-destination study shell"
```

---

### Task 4: CalendarPage as the central visual surface

**Files:**
- Create: `src/components/CalendarPage.tsx`
- Create: `src/components/CalendarPage.test.ts`
- Modify: `src/study-os/domain/sprintCalendarView.ts`
- Modify: `src/study-os/domain/sprintCalendarView.test.ts`
- Modify: `src/index.css`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes Plan A calendar document/view and Task 2 preview.
- Produces `CalendarPageProps` with open-task, preview, day override, and item override callbacks, plus `getCalendarPriorityLegend()` for the always-visible hot/cold legend.

- [ ] **Step 1: Write failing completed, pin, placeholder, heat, and load tests**

```ts
test('calendar view retains completed items on their original date', () => {
  const view = buildSprintCalendarView(calendarWithCompletedItem());
  assert.equal(view.days[0].items[0].status, 'completed');
  assert.equal(view.days[0].items[0].date, '2026-07-18');
});

test('placeholder has no execute command and priority has non-color label', () => {
  const item = buildSprintCalendarView(calendarWithPlaceholder()).days[0].items[0];
  assert.equal(item.canExecute, false);
  assert.equal(item.priorityLabel, 'Manutenção');
});

test('hot/cold priority legend is stable and never reuses completion green', () => {
  assert.deepEqual(
    getCalendarPriorityLegend().map(({ tier, label, icon, temperature }) => ({ tier, label, icon, temperature })),
    [
      { tier: 'critical', label: 'Crítica', icon: 'flame', temperature: 'hot' },
      { tier: 'high', label: 'Alta', icon: 'arrow-up', temperature: 'warm' },
      { tier: 'maintenance', label: 'Manutenção', icon: 'refresh-cw', temperature: 'cool' },
      { tier: 'protected', label: 'Protegida', icon: 'shield', temperature: 'cold' },
    ],
  );
});
```

- [ ] **Step 2: Run calendar tests and verify RED**

Run: `npx --no-install tsx --test src/study-os/domain/sprintCalendarView.test.ts src/components/CalendarPage.test.ts`

Expected: FAIL on missing rich day/items view and component.

- [ ] **Step 3: Extend the pure calendar view**

```ts
type CalendarPriorityIcon = 'flame' | 'arrow-up' | 'refresh-cw' | 'shield';
type CalendarTemperature = 'hot' | 'warm' | 'cool' | 'cold';
type CalendarPriorityMeta = {
  label: string;
  icon: CalendarPriorityIcon;
  temperature: CalendarTemperature;
};

const PRIORITY_META: Record<CalendarPriorityTier, CalendarPriorityMeta> = {
  critical: { label: 'Crítica', icon: 'flame', temperature: 'hot' },
  high: { label: 'Alta', icon: 'arrow-up', temperature: 'warm' },
  maintenance: { label: 'Manutenção', icon: 'refresh-cw', temperature: 'cool' },
  protected: { label: 'Protegida', icon: 'shield', temperature: 'cold' },
};

export function getCalendarPriorityLegend(): ReadonlyArray<CalendarPriorityMeta & { tier: CalendarPriorityTier }> {
  return (['critical', 'high', 'maintenance', 'protected'] as const).map(tier => ({
    tier,
    ...PRIORITY_META[tier],
  }));
}

export function toCalendarItemView(item: CalendarItem, assignment: CalendarAssignment): CalendarItemView {
  return {
    key: `calendar-${item.id}`,
    calendarItemId: item.id,
    date: assignment.date,
    title: item.title,
    status: item.state,
    pinned: assignment.pinned,
    priorityTier: assignment.priorityTier,
    priorityLabel: PRIORITY_META[assignment.priorityTier].label,
    priorityIcon: PRIORITY_META[assignment.priorityTier].icon,
    priorityTemperature: PRIORITY_META[assignment.priorityTier].temperature,
    precision: assignment.precision,
    canExecute: item.kind !== 'future_cycle_capacity' && item.state !== 'completed',
  };
}
```

- [ ] **Step 4: Build month/week UI and manual overrides**

Extract the existing month/week interaction from `PlannerArea` into `CalendarPage`. Render the calendar as the largest region, with compact capacity/backlog controls. Each day shows `itemCount · reservedMinutes`; completed stays visible with green check; priority uses semantic token + icon + label. Render the four-item `Crítica → Alta → Manutenção → Protegida` hot/cold legend directly under the calendar toolbar on desktop and as a wrapping one-line chip row on mobile; it must remain visible without opening a tooltip or menu. Dropping a real item calls:

```ts
onOverrideItem(item.calendarItemId, {
  planDate: targetDate,
  startTime: targetTime,
  pinned: true,
  expectedVersion: item.overrideVersion,
});
```

Placeholder uses dashed treatment and `Capacidade reservada · aguardando Meta`.

- [ ] **Step 5: Run tests, lint, and build**

```powershell
npx --no-install tsx --test src/study-os/domain/sprintCalendarView.test.ts src/components/CalendarPage.test.ts
npm run lint
npm run build
```

Expected: all exit 0.

- [ ] **Step 6: Commit the calendar page**

```powershell
git add src/components/CalendarPage.tsx src/components/CalendarPage.test.ts src/study-os/domain/sprintCalendarView.ts src/study-os/domain/sprintCalendarView.test.ts src/index.css src/App.tsx
git commit -m "feat: make calendar the study hub"
```

---

### Task 5: Unified tasks, search, filters, and pagination

**Files:**
- Create: `src/utils/unifiedTasks.ts`
- Create: `src/utils/unifiedTasks.test.ts`
- Create: `src/components/UnifiedTasksPage.tsx`
- Create: `src/components/UnifiedTasksPage.test.ts`
- Modify: `src/App.tsx`

**Interfaces:**
- Produces `UnifiedTaskItem`, `UnifiedTaskFilters`, `buildUnifiedTasks`, `normalizeTaskSearch`, `filterUnifiedTasks`, `parseTaskFilters`, `serializeTaskFilters`, `paginateUnifiedTasks`.

- [ ] **Step 1: Write failing dedupe, accent search, AND/OR, URL, and pagination tests**

```ts
test('linked planner and study tasks become one item while orphans remain', () => {
  const items = buildUnifiedTasks({
    plannerTasks: [linkedPlanner(), orphanPlanner()], studyTasks: [linkedStudy(), orphanStudy()],
    calendarItems: [], assignments: [],
  });
  assert.equal(items.length, 3);
});

test('accent-insensitive search and grouped filters are deterministic', () => {
  const items = [task({ title: 'Constituição', status: 'pending', discipline: 'Direito' })];
  assert.equal(filterUnifiedTasks(items, filters({ query: 'constituicao', statuses: ['pending'], disciplines: ['Direito'] })).length, 1);
});
```

- [ ] **Step 2: Run pure task tests and verify RED**

Run: `npx --no-install tsx --test src/utils/unifiedTasks.test.ts`

Expected: FAIL because the read model does not exist.

- [ ] **Step 3: Implement stable merge and filters**

```ts
export function normalizeTaskSearch(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

const keyFor = (planner?: PlannerTask, study?: StudyTask, calendar?: CalendarItem) =>
  calendar ? `calendar-${calendar.id}` : planner ? `planner-${planner.id}` : `study-${study!.id}`;

export function filterUnifiedTasks(items: UnifiedTaskItem[], filters: UnifiedTaskFilters): UnifiedTaskItem[] {
  const query = normalizeTaskSearch(filters.query);
  return items.filter(item =>
    (!query || item.searchText.includes(query)) &&
    (!filters.statuses.length || filters.statuses.includes(item.status)) &&
    (!filters.disciplines.length || filters.disciplines.includes(item.discipline)) &&
    (!filters.sources.length || filters.sources.includes(item.source)) &&
    (filters.hasQuestions === undefined || (item.questionCount > 0) === filters.hasQuestions)
  );
}
```

Include task/meta number, discipline, title, description, source, format, material, target, relevance, duration, date, scheduled/loose, and question availability. Sort ties by stable key. URL serialization emits sorted keys/values for deterministic history.

- [ ] **Step 4: Implement UnifiedTasksPage**

Render persistent search, quick views `Hoje | Em andamento | Pendentes | Concluídas`, filter chips/count/clear, desktop filter row, mobile sheet, sorting, 50-item pages, and an empty state that names active filters. A row is keyboard-openable; Execute remains a distinct button.

- [ ] **Step 5: Run tests, lint, and build**

```powershell
npx --no-install tsx --test src/utils/unifiedTasks.test.ts src/components/UnifiedTasksPage.test.ts
npm run lint
npm run build
```

Expected: all exit 0.

- [ ] **Step 6: Commit unified tasks**

```powershell
git add src/utils/unifiedTasks.ts src/utils/unifiedTasks.test.ts src/components/UnifiedTasksPage.tsx src/components/UnifiedTasksPage.test.ts src/App.tsx
git commit -m "feat: unify study task discovery"
```

---

### Task 6: One task drawer and tolerant result input

**Files:**
- Create: `src/utils/taskResultDraft.ts`
- Create: `src/utils/taskResultDraft.test.ts`
- Create: `src/components/TaskDetailDrawer.tsx`
- Create: `src/components/TaskDetailDrawer.test.ts`
- Modify: `src/components/CalendarPage.tsx`
- Modify: `src/components/UnifiedTasksPage.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Produces `TaskResultDraft`, `parseResultDraft`, and `TaskDetailDrawerProps` from the approved design.

- [ ] **Step 1: Write failing tolerant-input and drawer-state tests**

```ts
test('numeric drafts allow incomplete typing and validate only on parse', () => {
  assert.deepEqual(parseResultDraft({ outcome: 'completed', spentMinutes: '', correct: '1', wrong: '-' }), {
    ok: false,
    errors: { spentMinutes: 'Informe os minutos', wrong: 'Use um número inteiro' },
  });
});

test('completed task exposes reopen but not complete again', () => {
  const actions = getDrawerActions(completedUnifiedTask());
  assert.equal(actions.includes('reopen'), true);
  assert.equal(actions.includes('complete'), false);
});
```

- [ ] **Step 2: Run drawer tests and verify RED**

Run: `npx --no-install tsx --test src/utils/taskResultDraft.test.ts src/components/TaskDetailDrawer.test.ts`

Expected: FAIL because files do not exist.

- [ ] **Step 3: Implement parser and drawer action model**

```ts
function percentage(correct: number | null, wrong: number | null): number | undefined {
  if (correct === null || wrong === null || correct + wrong === 0) return undefined;
  return Math.round((100 * correct) / (correct + wrong));
}

export function parseResultDraft(draft: TaskResultDraft): ParsedResultDraft {
  const errors: Record<string, string> = {};
  const spent = parseInteger(draft.spentMinutes);
  if (spent === null || spent < 0) errors.spentMinutes = 'Informe os minutos';
  const correct = parseOptionalNonNegativeInteger(draft.correct, 'correct', errors);
  const wrong = parseOptionalNonNegativeInteger(draft.wrong, 'wrong', errors);
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { outcome: draft.outcome, spentMinutes: spent!, performance: percentage(correct, wrong) } };
}
```

- [ ] **Step 4: Implement accessible desktop drawer/mobile sheet**

Use `role="dialog"`, `aria-modal="true"`, a labeled heading, focus trap, Escape, focus return, and unsaved-draft confirmation. Write `task` into the hash query. All calendar/task rows open it by click, Enter, or Space. `Executar` reuses `linkedStudyTaskId`; `onImportPdf` delegates without embedding the PDF flow.

- [ ] **Step 5: Run tests, lint, and build**

```powershell
npx --no-install tsx --test src/utils/taskResultDraft.test.ts src/components/TaskDetailDrawer.test.ts
npm run lint
npm run build
```

Expected: all exit 0.

- [ ] **Step 6: Commit the drawer savepoint**

```powershell
git add src/utils/taskResultDraft.ts src/utils/taskResultDraft.test.ts src/components/TaskDetailDrawer.tsx src/components/TaskDetailDrawer.test.ts src/components/CalendarPage.tsx src/components/UnifiedTasksPage.tsx src/App.tsx
git commit -m "feat: unify task detail and results"
```

---

### Task 7: IA Hoje and factual completion feedback

**Files:**
- Create: `src/utils/todayAi.ts`
- Create: `src/utils/todayAi.test.ts`
- Create: `src/utils/completionFeedback.ts`
- Create: `src/utils/completionFeedback.test.ts`
- Create: `src/components/TodayAiPage.tsx`
- Create: `src/components/TaskCompletionFeedback.tsx`
- Create: `src/components/TaskCompletionFeedback.test.ts`
- Modify: `src/App.tsx`
- Modify: `src/components/TaskDetailDrawer.tsx`

**Interfaces:**
- Produces `buildTodayAiView`, `getCompletionFeedback(before, after, dayProgress)`, and `TodayAiPageProps.onOpenTask(taskKey)` so IA Hoje reuses the same global drawer.

- [ ] **Step 1: Write failing next-action, four-item, factual reward, failure, and replay tests**

```ts
test('today exposes one primary action and at most four visible queue items', () => {
  const view = buildTodayAiView(calendarDayWithSixItems());
  assert.equal(view.primaryAction?.key, 'critical-first');
  assert.equal(view.queue.length, 4);
  assert.equal(view.overflowCount, 2);
  assert.equal(view.queue.every(item => item.detailTaskKey.length > 0), true);
});

test('feedback exists only on a new completion transition', () => {
  assert.notEqual(getCompletionFeedback(pendingTask(), completedTask(), progress()), null);
  assert.equal(getCompletionFeedback(completedTask(), completedTask(), progress()), null);
  assert.equal(getCompletionFeedback(pendingTask(), failedTask(), progress()), null);
});
```

- [ ] **Step 2: Run today/reward tests and verify RED**

Run: `npx --no-install tsx --test src/utils/todayAi.test.ts src/utils/completionFeedback.test.ts src/components/TaskCompletionFeedback.test.ts`

Expected: FAIL because files do not exist.

- [ ] **Step 3: Implement pure today and reward models**

```ts
export function getCompletionFeedback(before: UnifiedTaskItem, after: UnifiedTaskItem, progress: DayProgress): CompletionFeedback | null {
  if (before.status === 'completed' || after.status !== 'completed') return null;
  return {
    taskKey: after.key,
    title: 'Conquista comprovada',
    summary: [after.spentMinutes ? `${after.spentMinutes} min` : null, after.performance != null ? `${after.performance}%` : null]
      .filter(Boolean).join(' · '),
    dayProgress: `${progress.completed} de ${progress.total} concluídas`,
  };
}
```

`buildTodayAiView` chooses the first executable applied assignment, displays at most four, derives real completed minutes/count, and shows a compact 15-day exact/provisional/protected strip. Audit and `Por que agora?` remain collapsed.

- [ ] **Step 4: Implement TodayAiPage and one-time feedback**

Render one dominant Execute/Continue action, short queue, daily progress, horizon strip, and disclosure. The primary card title and every queue card call `onOpenTask(detailTaskKey)` and write the task key to the hash; Execute/Continue remains a separate action. Completion feedback uses `aria-live="polite"`, 180–260 ms state animation, no spatial movement under reduced motion, and one temporary Undo action that opens restore preview.

- [ ] **Step 5: Run tests, lint, and build**

```powershell
npx --no-install tsx --test src/utils/todayAi.test.ts src/utils/completionFeedback.test.ts src/components/TaskCompletionFeedback.test.ts
npm run lint
npm run build
```

Expected: all exit 0.

- [ ] **Step 6: Commit IA Hoje**

```powershell
git add src/utils/todayAi.ts src/utils/todayAi.test.ts src/utils/completionFeedback.ts src/utils/completionFeedback.test.ts src/components/TodayAiPage.tsx src/components/TaskCompletionFeedback.tsx src/components/TaskCompletionFeedback.test.ts src/App.tsx src/components/TaskDetailDrawer.tsx
git commit -m "feat: focus today on the next win"
```

---

### Task 8: More, final navigation cutover, accessibility, and browser gate

**Files:**
- Create: `src/components/MorePage.tsx`
- Create: `src/components/MorePage.test.ts`
- Modify: `src/components/PlannerArea.tsx`
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/components/BottomNav.tsx`
- Modify: `src/App.tsx`
- Modify: `src/index.css`
- Create: `playwright.config.ts`
- Create: `tests/e2e/human-study-shell.spec.ts`
- Modify: `package.json`

**Interfaces:**
- Produces the final four-route shell and `npm run test:e2e`.

- [ ] **Step 1: Write failing parity and source-structure tests**

```ts
test('More keeps every secondary capability reachable', () => {
  assert.deepEqual(MORE_SECTIONS.map(item => item.id), [
    'meta', 'review', 'courses', 'insights', 'maps', 'history', 'import', 'backup', 'sync', 'account',
  ]);
});

test('legacy thirteen-tab planner navigation is absent after cutover', () => {
  const source = readFileSync(plannerAreaPath, 'utf8');
  assert.equal(source.includes('SECTION_NAV'), false);
  assert.equal(source.includes("label: 'Por Disciplina'"), false);
});
```

- [ ] **Step 2: Run parity tests and verify RED**

Run: `npx --no-install tsx --test src/components/MorePage.test.ts src/components/PrimaryNavigation.test.ts`

Expected: FAIL because More/cutover is incomplete.

- [ ] **Step 3: Move secondary surfaces and remove redundant navigation**

Map Meta, review/bank, courses/materials, insights/maps, history, import, backup, sync, and account into `MorePage`. Remove `SECTION_NAV` and its horizontal bar only after each mapped section renders. Stop rendering legacy Sidebar/BottomNav; either delete them if no imports remain or reduce them to exports of `PrimaryNavigation` during the same commit. Caderno opens only from Execute/Continue with an origin hash for return.

- [ ] **Step 4: Add semantic tokens and motion/contrast rules**

```css
:root {
  --priority-critical: #ef4444;
  --priority-high: #f59e0b;
  --priority-maintenance: #3b82f6;
  --priority-protected: #06b6d4;
  --status-completed: #84cc16;
}
.metric-number { font-variant-numeric: tabular-nums; }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; transition-duration: 0.01ms !important; animation-duration: 0.01ms !important; } }
@media (forced-colors: active) { [data-selected="true"], :focus-visible { outline: 2px solid CanvasText; outline-offset: 2px; } }
```

- [ ] **Step 5: Add Playwright configuration and acceptance test**

```ts
test.describe('human study shell', () => {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    test(`four destinations, calendar, drawer, preview at ${viewport.width}`, async ({ page, context }) => {
      await page.setViewportSize(viewport);
      await context.route('https://**/*', route => route.abort());
      await page.goto('/#/today');
      for (const label of ['IA Hoje', 'Calendário', 'Tarefas', 'Mais']) {
        await expect(page.getByRole('navigation').getByText(label, { exact: true })).toBeVisible();
      }
      await page.getByRole('link', { name: 'Calendário' }).click();
      await expect(page.getByText('Concluída').first()).toBeVisible();
      await page.getByRole('button', { name: 'Auto-organizar' }).click();
      await expect(page.getByRole('dialog', { name: /prévia/i })).toBeVisible();
      await page.keyboard.press('Escape');
      const fitsViewport = await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      );
      expect(fitsViewport).toBe(true);
    });
  }
});
```

Add `"test:e2e": "playwright test"` to `package.json`. Extend the test to open the same task drawer from IA Hoje, Calendário, and Tarefas; also verify the visible four-label priority legend, keyboard focus return, 200% zoom, reduced motion, forced colors, placeholder no Execute, failed no reward, completion reward once, console errors, and back/reload state.

- [ ] **Step 6: Run the complete UI gate**

```powershell
npm test
npm run lint
npm run build
npm run test:e2e
```

Expected: all exit 0 at desktop and 390 px with external internet blocked.

- [ ] **Step 7: Commit the human-shell cutover**

```powershell
git add src/components/MorePage.tsx src/components/MorePage.test.ts src/components/PlannerArea.tsx src/components/Sidebar.tsx src/components/BottomNav.tsx src/App.tsx src/index.css playwright.config.ts tests/e2e/human-study-shell.spec.ts package.json
git commit -m "feat: cut over to the human study shell"
```

---

### Task 9: Reconcile today's LS execution and close production

**Files:**
- Create locally under ignored path: `data/study-os/imports/ls-today-reconciliation-2026-07-14.json`
- Create locally under ignored path: `data/study-os/imports/ls-today-reconciliation-2026-07-14-report.json`
- Modify tracked files only if a reproducible, tested defect blocks reconciliation.

**Interfaces:**
- Consumes the authorized logged-in Chrome LS page, `POST /api/v1/source-plans/import`, evidence import CLI/API, Plan A calendar preview/apply, backup/portable restore.
- Produces an aggregate-only, idempotent report and visible completed tasks in the app.

- [ ] **Step 1: Create verified rollback artifacts before reading or mutating live state**

```powershell
git status --short
.\.venv-study-os\Scripts\python.exe -m study_os_service.cli backup
.\.venv-study-os\Scripts\python.exe -m study_os_service.cli export --output C:\Backups\study-os-pre-ls-today-2026-07-14.zip
Get-FileHash C:\Backups\study-os-pre-ls-today-2026-07-14.zip -Algorithm SHA256
```

Require a clean/intentional worktree, readable backup, schema 12, `integrity_check=ok`, and no FK violations. With the app/service stopped, the exact rollback command is `\.\.venv-study-os\Scripts\python.exe -m study_os_service.cli restore --from C:\Backups\study-os-pre-ls-today-2026-07-14.zip`.

- [ ] **Step 2: Inspect LS through the authorized Chrome session**

Use the `chrome:control-chrome` skill at execution time. Open `https://aluno.lsensino.com.br/#/app/metasTarefasDisciplinas`, planning `119790`, current Meta/day, and task-by-discipline history. If authentication expired, stop and let the user log in directly; never read cookies, tokens, passwords, or authorization headers.

Capture only planning ID, meta number, provider task ID/order, discipline/topic short label, format, planned/spent minutes, status/completion date, percentage, and visible aggregate correct/wrong counts. Never capture statements, alternatives, answer keys, user answers, or material bodies.

- [ ] **Step 3: Build and validate the sanitized reconciliation file**

Identity order is provider task ID, then exact one-to-one fallback `${metaNumber}:${sourceOrder}`. Reject ambiguous title-only matches. Compare against the existing sanitized history file if present; write only changed/current-day aggregate rows.

```powershell
Get-FileHash data\study-os\imports\ls-today-reconciliation-2026-07-14.json -Algorithm SHA256
rg -n 'statement|alternatives|correctAnswer|"answer"|cookie|authorization|password' data\study-os\imports\ls-today-reconciliation-2026-07-14.json
```

Expected: hash printed; `rg` exits 1 with no forbidden keys.

- [ ] **Step 4: Dry-run source-task and evidence reconciliation**

Preview the source-plan import with a deterministic payload/idempotency key derived from planning ID and file hash. Then run:

```powershell
$sha = (Get-FileHash data\study-os\imports\ls-today-reconciliation-2026-07-14.json -Algorithm SHA256).Hash.ToLowerInvariant()
.\.venv-study-os\Scripts\python.exe scripts\import_sprint_evidence.py --format ls-history --input data\study-os\imports\ls-today-reconciliation-2026-07-14.json --target-slug sefaz_ce --planning-id 119790 --batch-id "ls-today:119790:$sha" --dry-run
```

Require exact item totals, zero proprietary fields, understood unresolved aliases, and no conflicts. Do not commit if dry-run differs from the visible LS history.

- [ ] **Step 5: Commit the two idempotent lanes and prove replay**

1. `POST /api/v1/source-plans/import` with a new deterministic `Idempotency-Key` updates completed/ignored, spent minutes, and current Meta tasks without duplicates.
2. Repeat the evidence CLI with `--commit`, then repeat the same commit command and require replay/zero new observations.
3. Repeat the source-plan request and require `replayed: true`.

No calendar apply occurs yet.

- [ ] **Step 6: Verify task, evidence, projection, and capacity state**

Read:

```text
GET /api/v1/source-plans/tasks?targetSlug=sefaz_ce&includeInactive=true
GET /api/v1/sprints/evidence?targetSlug=sefaz_ce
GET /api/v1/sprints/projection?targetSlug=sefaz_ce&asOf=2026-07-14
GET /api/v1/sprints/trajectory?targetSlug=sefaz_ce
GET /api/v1/source-plans/backlog?targetSlug=sefaz_ce&includeAll=true
GET /api/v1/sprints/calendar?targetSlug=sefaz_ce&startDate=2026-07-14
```

Require unique provider/source IDs, current-day completed states/minutes, no false completion for failed/skipped work, and no duplicate calendar items. Generate a new calendar preview from the current head; confirm completed/past/pinned are preserved and only future open work moves. Apply only after the diff satisfies those invariants.

- [ ] **Step 7: Validate the real app and write the aggregate report**

In IA Hoje, Calendar, and Tarefas confirm today's completed LS items stay green/visible, factual minutes/performance appear, daily progress updates, capacity learner sees result-bearing history, and the same tasks do not appear tomorrow. Write report fields: backup/export paths and hashes, planning/meta/date, sanitized input hash, source/evidence idempotency keys, created/updated/replayed/unresolved/conflict counts, projection before/after, calendar run IDs, and verification results.

- [ ] **Step 8: Run final project gate and review**

```powershell
.\.venv-study-os\Scripts\python.exe -m study_os_service.cli health
.\.venv-study-os\Scripts\python.exe -m pytest -q
.\.venv-study-os\Scripts\python.exe -m compileall study_os_service
npm test
npm run lint
npm run build
npm run test:e2e
git diff --check
git status --short
```

Expected: all automated gates green; ignored reconciliation artifacts only; no console error; no external request required for the app. If any aggregate or integrity check fails, stop, restore the portable archive, and report only sanitized diagnostics.

- [ ] **Step 9: Final whole-branch review and push gate**

Review from the Plan A merge-base through HEAD for design compliance, security, data integrity, accessibility, and unnecessary scope. Fix Critical/Important findings with covering tests, rerun Step 8, and only then prepare the branch for push/PR if the user requests publication.
