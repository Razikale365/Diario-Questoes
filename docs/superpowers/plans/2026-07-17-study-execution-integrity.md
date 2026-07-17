# Study Execution Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make one rich, durable study result update Planner, IA Hoje, Calendar, backlog, and calibration without requeueing completed work.

**Architecture:** Add an append-only schema-v13 execution record and a service command that projects the result inside one SQLite transaction. The existing sprint-action endpoint and a new source-task endpoint share that command. Frontend surfaces use one typed result draft and one invalidation event, while Calendar remains the scheduler and IA Hoje becomes a refreshed projection of its applied state.

**Tech Stack:** Python 3.13, SQLite, FastAPI, React 19, TypeScript 5.8, Vite 6, Node test runner through `tsx`.

## Global Constraints

- `performedOn` is the local execution date and must never be replaced by `recordedAt` or a planned date.
- Completed tasks remain visible as positive historical feedback but are never executable candidates. Failed/skipped attempts remain auditable and may be explicitly rescheduled without duplicating in the recorded day/run.
- One accepted result must update execution, source task, action, backlog, calendar, and evidence in one transaction.
- Idempotency replay returns the first execution; key reuse with another payload returns HTTP 409.
- `exerciseMinutes <= taskMinutes`; counts are non-negative; `correctCount + wrongCount <= questionsTotal`; future `performedOn` is rejected.
- Derive `performanceBp` from correct and wrong counts when they exist; never invent zero-percent evidence for a task with no answered questions.
- A saved result remains visible when the later day/calendar refresh fails.
- Local LS completion cannot be downgraded by a later pending browser/LS source-plan import.
- Auto-organize reflows only pending, unstarted tasks from today through the active cycle end and preserves completed, active, manual, and pinned work.
- Do not download or scrape proprietary material.

---

### Task 1: Schema-v13 Execution Ledger

**Files:**
- Modify: `study_os_service/db/migrations.py`
- Create: `study_os_service/domain/task_execution.py`
- Create: `study_os_service/repositories/task_execution.py`
- Create: `tests/study_os_service/test_task_execution_schema.py`

**Interfaces:**
- Produces `TaskExecution`, `TaskExecutionInput`, `TaskExecutionRepository.insert_or_replay()`, `get()`, and `list_for_source_task()`.
- Consumes existing `source_plan_tasks(id,target_slug)` and optional `sprint_actions(id,run_id,target_slug)` identities.

- [ ] **Step 1: Write migration and domain tests first**

Add tests that migrate a schema-12 database and assert the previous source task/calendar rows are byte-equivalent, `CURRENT_SCHEMA_VERSION == 13`, and the new table enforces the checks below. Add pure-domain tests for a backdated result, derived basis points, exercise-over-total rejection, count overflow, and future-date rejection.

```python
def valid_input(**overrides):
    payload = dict(
        target_slug="sefaz_ce",
        source_plan_task_id=1,
        sprint_action_id=None,
        outcome="completed",
        performed_on=date(2026, 7, 16),
        task_minutes=60,
        exercise_minutes=35,
        questions_total=20,
        correct_count=16,
        wrong_count=4,
        doubt_count=2,
        energy_after=3,
        notes="Revisão de ontem",
    )
    payload.update(overrides)
    return TaskExecutionInput(**payload)

def test_counts_derive_performance_without_inventing_empty_evidence():
    assert valid_input().performance_bp == 8000
    assert valid_input(questions_total=0, correct_count=0, wrong_count=0).performance_bp is None
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `python -m pytest tests/study_os_service/test_task_execution_schema.py -q`

Expected: FAIL because schema 13 and the task-execution modules do not exist.

- [ ] **Step 3: Add migration 13**

Append this table shape to `MIGRATIONS`:

```sql
CREATE TABLE task_executions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  idempotency_key TEXT NOT NULL UNIQUE CHECK (length(trim(idempotency_key)) > 0),
  request_hash TEXT NOT NULL CHECK (length(request_hash)=64),
  target_slug TEXT NOT NULL REFERENCES exam_targets(target_slug) ON DELETE RESTRICT,
  source_plan_task_id INTEGER NOT NULL,
  sprint_action_id INTEGER,
  outcome TEXT NOT NULL CHECK (outcome IN ('started','completed','failed','skipped')),
  performed_on TEXT NOT NULL CHECK (length(performed_on)=10 AND date(performed_on)=performed_on),
  task_minutes INTEGER NOT NULL CHECK (task_minutes BETWEEN 0 AND 720),
  exercise_minutes INTEGER NOT NULL CHECK (exercise_minutes BETWEEN 0 AND task_minutes),
  questions_total INTEGER NOT NULL CHECK (questions_total BETWEEN 0 AND 10000),
  correct_count INTEGER NOT NULL CHECK (correct_count BETWEEN 0 AND questions_total),
  wrong_count INTEGER NOT NULL CHECK (wrong_count BETWEEN 0 AND questions_total),
  doubt_count INTEGER NOT NULL CHECK (doubt_count BETWEEN 0 AND questions_total),
  performance_bp INTEGER CHECK (performance_bp IS NULL OR performance_bp BETWEEN 0 AND 10000),
  energy_after INTEGER CHECK (energy_after IS NULL OR energy_after BETWEEN 1 AND 5),
  notes TEXT NOT NULL DEFAULT '',
  recorded_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version=1),
  UNIQUE (id, target_slug),
  CHECK (correct_count + wrong_count <= questions_total),
  CHECK (
    ((correct_count + wrong_count)=0 AND performance_bp IS NULL) OR
    ((correct_count + wrong_count)>0 AND performance_bp=ROUND(10000.0*correct_count/(correct_count+wrong_count)))
  ),
  FOREIGN KEY (source_plan_task_id, target_slug)
    REFERENCES source_plan_tasks(id, target_slug) ON DELETE RESTRICT,
  FOREIGN KEY (sprint_action_id)
    REFERENCES sprint_actions(id) ON DELETE RESTRICT
);
CREATE INDEX idx_task_executions_source_date
  ON task_executions(target_slug, source_plan_task_id, performed_on DESC, id DESC);
```

- [ ] **Step 4: Implement immutable domain and repository**

`TaskExecutionInput` validates at construction and exposes `performance_bp`. `TaskExecutionRepository.insert_or_replay(input, idempotency_key, request_hash)` must require an active transaction, return `(row, False)` on insert, return `(existing, True)` for an equal replay, and raise `TaskExecutionIdempotencyConflict` for a different hash.

- [ ] **Step 5: Run focused and migration regression tests GREEN**

Run: `python -m pytest tests/study_os_service/test_task_execution_schema.py tests/study_os_service/test_migrations.py -q`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add study_os_service/db/migrations.py study_os_service/domain/task_execution.py study_os_service/repositories/task_execution.py tests/study_os_service/test_task_execution_schema.py
git commit -m "feat: add immutable study execution ledger"
```

---

### Task 2: Canonical Transaction and API

**Files:**
- Create: `study_os_service/services/task_execution.py`
- Create: `study_os_service/api/task_executions.py`
- Modify: `study_os_service/app.py`
- Modify: `study_os_service/repositories/sprint.py`
- Modify: `study_os_service/repositories/sprint_calendar.py`
- Modify: `study_os_service/services/sprint_day.py`
- Modify: `study_os_service/services/sprint_evidence.py`
- Modify: `study_os_service/services/sprint.py`
- Create: `tests/study_os_service/test_task_execution_api.py`
- Modify: `tests/study_os_service/test_sprint_calendar_materialization.py`
- Modify: `tests/study_os_service/test_sprint_profile_source_api.py`

**Interfaces:**
- Produces `POST /api/v1/source-plans/tasks/{task_id}/executions` and `TaskExecutionService.record()`.
- Keeps `PUT /api/v1/sprints/actions/{action_id}` backward compatible by delegating terminal result payloads to the same service.
- Returns `{execution, sourceTask, sprintAction, calendarItem, replayed, refreshRequired}`.

- [ ] **Step 1: Write failing API and transaction tests**

Cover these exact scenarios:

```python
def rich_payload(performed_on="2026-07-16"):
    return {
        "outcome": "completed",
        "performedOn": performed_on,
        "taskMinutes": 60,
        "exerciseMinutes": 35,
        "questionsTotal": 20,
        "correctCount": 16,
        "wrongCount": 4,
        "doubtCount": 2,
        "energyAfter": 3,
        "notes": "Revisão registrada no dia correto",
    }

def test_complete_then_reflow_never_requeues(client, seeded_source_task):
    saved = client.post(
        f"/api/v1/source-plans/tasks/{seeded_source_task}/executions",
        headers={"Idempotency-Key": "exec-1"}, json=rich_payload(),
    )
    assert saved.status_code == 201
    preview = preview_and_apply_calendar(client)
    assert seeded_source_task not in executable_source_ids(preview)
```

Also assert backdated evidence uses `2026-07-16`, future date returns 422, replay returns the same execution id, changed replay returns 409, injected calendar failure rolls back every table, direct Planner completion updates a materialized action, and Calendar/Backlog both become terminal.

Add a source reimport test: after the execution, import the same `externalTaskId` as pending with a newer browser timestamp; assert source remains completed and no preview/day returns it.

- [ ] **Step 2: Run tests and verify RED**

Run: `python -m pytest tests/study_os_service/test_task_execution_api.py tests/study_os_service/test_sprint_calendar_materialization.py tests/study_os_service/test_sprint_profile_source_api.py -q`

Expected: FAIL at the missing route/service and the pending reimport regression.

- [ ] **Step 3: Implement `TaskExecutionService.record`**

Use one `BEGIN IMMEDIATE` and this order:

```python
execution, replayed = executions.insert_or_replay(...)
source_task = sprint.update_source_task_result_in_transaction(...)
sprint_action = sprint.reconcile_actions_for_source_in_transaction(...)
backlog = cycles.mark_recovered_in_transaction(source_task.id, input.performed_on)
calendar_item = calendar.project_execution_for_source_in_transaction(...)
evidence.append_task_execution_in_transaction(execution, source_task)
receipt = execution_document(...)
connection.commit()
```

On any exception, rollback. `update_source_task_result_in_transaction` stores terminal status, task minutes, derived performance, and merges `observedOn`, `completedAt`, `lastOutcome`, question counts, and exercise minutes into provenance without dropping existing provenance keys. Started results set `started`; skipped remains non-executable for the recorded run while retaining history; failed marks the calendar failed.

- [ ] **Step 4: Reconcile sprint actions and evidence**

For a supplied action, enforce `expectedVersion`. For direct source completion, reconcile every pending/active materialized action for that source to the terminal outcome so an old IA Hoje run cannot remain executable. `append_task_execution_in_transaction` uses source record `task-execution:{execution.id}`, `observed_on=execution.performed_on`, exact counts when present, and emits once because execution idempotency is authoritative.

- [ ] **Step 5: Preserve terminal execution during source imports**

In `SprintSourcePlanService._merge_existing_evidence`, treat a source task with a latest `task_executions` outcome of completed/failed/skipped as authoritative over a pending `planner-local-sync` or LS-visible-history import. Metadata may refresh, but status, spent minutes, performance, execution provenance, calendar terminal state, and backlog recovery cannot regress.

- [ ] **Step 6: Register the route and delegate existing action results**

The new endpoint requires `Idempotency-Key` and maps not-found/validation/version/idempotency/storage errors to structured 404/422/409 responses. Existing `update_sprint_action` keeps decision-only changes in `SprintDayService`; any payload containing `performedOn`, `taskMinutes`, or a terminal accepted result delegates to `TaskExecutionService` using the action's source task.

- [ ] **Step 7: Run focused and full backend tests GREEN**

Run: `python -m pytest tests/study_os_service/test_task_execution_api.py tests/study_os_service/test_sprint_api.py tests/study_os_service/test_sprint_calendar_materialization.py tests/study_os_service/test_sprint_profile_source_api.py -q`

Expected: PASS.

Run: `python -m pytest -q`

Expected: PASS with only the repository's intentional skip.

- [ ] **Step 8: Commit**

```bash
git add study_os_service/app.py study_os_service/api/task_executions.py study_os_service/services/task_execution.py study_os_service/services/sprint_day.py study_os_service/services/sprint_evidence.py study_os_service/services/sprint.py study_os_service/repositories/sprint.py study_os_service/repositories/sprint_calendar.py tests/study_os_service/test_task_execution_api.py tests/study_os_service/test_sprint_calendar_materialization.py tests/study_os_service/test_sprint_profile_source_api.py
git commit -m "fix: reconcile study results across sprint and calendar"
```

---

### Task 3: Strict Frontend Contract and Shared Draft

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/study-os/api/sprint.ts`
- Modify: `src/study-os/api/sprint.test.ts`
- Modify: `src/study-os/sourcePlanBridge.ts`
- Modify: `src/study-os/sourcePlanBridge.test.ts`
- Replace: `src/utils/taskResultDraft.ts`
- Modify: `src/utils/taskResultDraft.test.ts`
- Create: `src/study-os/dataChanged.ts`
- Create: `src/study-os/dataChanged.test.ts`

**Interfaces:**
- Produces `TaskExecutionDraft`, `parseTaskExecutionDraft()`, `recordSourceTaskExecution()`, `STUDY_OS_DATA_CHANGED`, and typed execution response parsers.
- Adds `sourcePlanTaskId?: number` to `PlannerTask`; hydration owns it and imports omit it.

- [ ] **Step 1: Write failing contract/parser tests**

Use this draft shape:

```ts
export interface TaskExecutionDraft {
  performedOn: string;
  taskMinutes: string;
  exerciseMinutes: string;
  questionsTotal: string;
  correctCount: string;
  wrongCount: string;
  doubtCount: string;
  energyAfter: number;
  notes: string;
}
```

Tests must prove incomplete typing is tolerated until submit, yesterday is accepted, future dates/time/count overflows are rejected, counts derive `performanceBp`, zero answered questions yield `null`, API request URL/body/idempotency are exact, malformed response fields are rejected, and source-plan hydration retains numeric `sourcePlanTaskId` through merges.

- [ ] **Step 2: Run tests RED**

Run: `npx.cmd tsx --test src/utils/taskResultDraft.test.ts src/study-os/api/sprint.test.ts src/study-os/sourcePlanBridge.test.ts src/study-os/dataChanged.test.ts`

Expected: FAIL for missing rich fields, endpoint, and event module.

- [ ] **Step 3: Implement strict parsing and API client**

`recordSourceTaskExecution(taskId, input, idempotencyKey)` POSTs to `/api/v1/source-plans/tasks/${taskId}/executions`. Keep every response parser structural and reject unknown/malformed terminal states. `parseTaskExecutionDraft` returns numeric counts/minutes plus derived performance and never silently converts a blank field to invented evidence.

- [ ] **Step 4: Implement one refresh event**

```ts
export const STUDY_OS_DATA_CHANGED = 'study-os:data-changed';
export type StudyOsResource = 'source-plan' | 'sprint-day' | 'calendar' | 'evidence' | 'questions';
export const announceStudyOsDataChanged = (detail: {
  targetSlug: string;
  taskId?: number;
  resources: StudyOsResource[];
}) => window.dispatchEvent(new CustomEvent(STUDY_OS_DATA_CHANGED, { detail }));
```

Validate event details before consumers act; duplicate resource names are normalized.

- [ ] **Step 5: Run focused tests GREEN and commit**

Run: `npx.cmd tsx --test src/utils/taskResultDraft.test.ts src/study-os/api/sprint.test.ts src/study-os/sourcePlanBridge.test.ts src/study-os/dataChanged.test.ts`

Expected: PASS.

```bash
git add src/types/index.ts src/study-os/api/sprint.ts src/study-os/api/sprint.test.ts src/study-os/sourcePlanBridge.ts src/study-os/sourcePlanBridge.test.ts src/utils/taskResultDraft.ts src/utils/taskResultDraft.test.ts src/study-os/dataChanged.ts src/study-os/dataChanged.test.ts
git commit -m "feat: add rich study execution client contract"
```

---

### Task 4: Unified Result UI, Calendar Refresh, and Auto-Organize Integrity

**Files:**
- Create: `src/components/TaskExecutionFields.tsx`
- Create: `src/components/TaskExecutionFields.contract.test.ts`
- Modify: `src/components/PlannerArea.tsx`
- Modify: `src/components/PlannerArea.commandLayer.test.ts`
- Modify: `src/study-os/components/SprintCommandCenter.tsx`
- Modify: `src/study-os/components/SprintCommandCenter.test.ts`
- Modify: `src/study-os/components/SprintCalendarPanel.tsx`
- Modify: `src/study-os/components/SprintCalendarPanel.test.ts`

**Interfaces:**
- Consumes Task 3's API, parser, source identity, and refresh event.
- Produces one LS-style field surface and refreshes Planner/IA Hoje/Calendar after a successful execution.

- [ ] **Step 1: Extend the existing red regression and add UI/invalidation tests**

Keep `a saved result is retained locally when the day refresh fails` as the first regression. Add source/component contracts asserting labels `Data realizada`, `Ontem`, `Tempo total`, `Tempo de exercícios`, `Questões`, `Certas`, `Erradas`, `Dúvidas`, `Energia depois`, and `Observações`; derived performance is read-only when counts exist; Planner calls `recordSourceTaskExecution` before auto-organize; both Calendar and IA Hoje subscribe to `STUDY_OS_DATA_CHANGED` and reload only matching target/resources.

- [ ] **Step 2: Run focused tests RED**

Run: `npx.cmd tsx --test src/components/TaskExecutionFields.contract.test.ts src/components/PlannerArea.commandLayer.test.ts src/study-os/components/SprintCommandCenter.test.ts src/study-os/components/SprintCalendarPanel.test.ts`

Expected: FAIL for missing shared fields and shared invalidation.

- [ ] **Step 3: Build `TaskExecutionFields`**

Render a compact responsive grid, inline errors, a date input defaulting to local today, an `Ontem` shortcut, numeric inputs, derived performance summary, energy buttons 1-5, and notes. The component owns no persistence and emits draft changes only.

- [ ] **Step 4: Make Planner completion service-owned**

Change `applyTaskResult` to async. Ensure the current plan import has completed, resolve `sourcePlanTaskId`, call `recordSourceTaskExecution`, then merge the returned source task into local Planner state. On success emit resources `source-plan,sprint-day,calendar,evidence`; on failure keep the modal open and show a precise error. `autoOrganize` starts only after the durable mutation is complete and Calendar's auto-organize handler fetches the current applied head before preview/apply.

- [ ] **Step 5: Make IA Hoje use the same command**

Replace terminal `updateSprintAction` submission with the canonical source-task execution call including `sprintActionId` and `expectedVersion`. Immediately replace the returned action in local `day` before attempting recalculation. If recalculation/audit fails, preserve the saved action and show `Resultado salvo; recálculo pendente.`

- [ ] **Step 6: Refresh Calendar and IA Hoje from one event**

Both components subscribe with cleanup, ignore other targets, and invoke their existing `load` callback. Calendar continues to show completed cards with terminal color/feedback; its executable selectors exclude terminal items. Avoid nested duplicate calendar ownership in IA Hoje: render the shared panel once in the Planner route while the command center consumes the applied day's projection.

- [ ] **Step 7: Run focused and full frontend gates GREEN**

Run: `npx.cmd tsx --test src/components/TaskExecutionFields.contract.test.ts src/components/PlannerArea.commandLayer.test.ts src/study-os/components/SprintCommandCenter.test.ts src/study-os/components/SprintCalendarPanel.test.ts`

Expected: PASS, including the baseline saved-result regression.

Run: `npm.cmd test`

Expected: PASS.

Run: `npm.cmd run lint`

Expected: PASS.

Run: `npm.cmd run build`

Expected: PASS with only the existing non-fatal chunk warning.

- [ ] **Step 8: Commit**

```bash
git add src/components/TaskExecutionFields.tsx src/components/TaskExecutionFields.contract.test.ts src/components/PlannerArea.tsx src/components/PlannerArea.commandLayer.test.ts src/study-os/components/SprintCommandCenter.tsx src/study-os/components/SprintCommandCenter.test.ts src/study-os/components/SprintCalendarPanel.tsx src/study-os/components/SprintCalendarPanel.test.ts
git commit -m "fix: unify planner calendar and sprint execution"
```

## Acceptance

The plan is complete when a result recorded from Planner or IA Hoje stores a backdated LS-style execution, immediately updates both surfaces, remains saved through refresh failure, never returns after auto-organize or reimport, keeps completed cards visible in Calendar/history, and all backend/frontend gates pass.
