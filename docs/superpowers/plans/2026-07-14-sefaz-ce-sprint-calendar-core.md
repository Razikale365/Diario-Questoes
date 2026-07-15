# SEFAZ CE Sprint Calendar Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar um calendário Sprint local, auditável e rolante de 1–15 dias que usa as Metas reais da LS como base exata, reserva apenas capacidade para Metas futuras e nunca duplica ou apaga trabalho concluído.

**Architecture:** Um `SprintHorizonEngine` puro calcula todo o intervalo a partir de um snapshot congelado. Um calendário SQLite v12 mantém itens estáveis, previews, assignments, pins e uma cadeia aplicada linear; o dia materializa somente assignments executáveis. A API usa preview/apply com compare-and-swap, e um painel React mínimo prova a fatia vertical antes do redesenho humano do Plano B.

**Tech Stack:** Python 3.11, FastAPI, SQLite migrations/repositories, pytest, React 19, TypeScript 5.8, Vite 6, Node test runner via `tsx`.

## Global Constraints

- Work only in `C:\Docker\Diario-Questoes` on branch `codex/sefaz-ce-18d-sprint`; preserve unrelated user changes.
- Approved design: `docs/superpowers/specs/2026-07-14-sefaz-ce-15-day-human-calendar-design.md` at commit `1debffb`.
- Before migration v12 on the live database, create a fresh SQLite backup and portable export, then verify SHA-256, `integrity_check=ok`, zero foreign-key violations, and schema 11.
- Do not mutate Supabase and do not require internet for calendar generation or execution.
- Real released LS metas are the exact base. Load source tasks/cycles once; never call a side-effecting eligibility query once per future day.
- Unknown future LS metas create non-executable capacity envelopes only. They have no discipline, source task, material, expected gain, result, or evidence.
- Horizon length is inclusive 1–15 days and ends no later than the day before P1.
- Past, completed, active, manual, accepted, and pinned work never moves automatically.
- Capacity precedence is date override → weekday override → global override → learned → default; missing history is not zero.
- Energy changes composition, never explicit available minutes.
- Preview never changes the applied head. Apply requires the current head and unchanged override versions.
- Completion, source-task state, calendar-item state, evidence, and receipt update in one transaction.
- Weekly Codex quota is bounded through 2026-07-21: execute only these slices, use focused tests in Tasks 1–8, and reserve the complete backend/frontend gate for Task 9.
- Use test-first red/green/refactor and commit after every clean task.
- Package `249654`, in-task PDF import, permanent LS scraping, proprietary question content, and the human-shell redesign are outside this plan.

---

## File Structure

### New backend files

- `study_os_service/domain/sprint_calendar.py`: immutable calendar, capacity, request, snapshot, item, assignment, and draft contracts.
- `study_os_service/services/sprint_capacity.py`: bounded capacity learner with manual precedence.
- `study_os_service/services/sprint_horizon_engine.py`: pure one-shot horizon planner.
- `study_os_service/repositories/sprint_calendar.py`: v12 calendar persistence and compare-and-swap queries.
- `study_os_service/services/sprint_calendar.py`: snapshot, preview, apply, overrides, manual items, and documents.
- `study_os_service/api/sprint_calendar.py`: HTTP parsing and stable error translation.

### New frontend files

- `src/study-os/api/sprintCalendar.ts`: strict DTO parsing and requests.
- `src/study-os/api/sprintCalendar.test.ts`: contract/request tests.
- `src/study-os/domain/sprintCalendarView.ts`: pure minimal calendar read model.
- `src/study-os/domain/sprintCalendarView.test.ts`: view-model tests.
- `src/study-os/components/SprintCalendarPanel.tsx`: minimal preview/apply/calendar integration.
- `src/study-os/components/SprintCalendarPanel.test.ts`: source/contract assertions.

### Existing integration files

- `study_os_service/db/migrations.py`: additive v12 migration.
- `study_os_service/services/sprint_engine.py`: frozen-cutoff and energy composition support.
- `study_os_service/services/sprint_day.py`: materialize assignments and commit results atomically.
- `study_os_service/repositories/sprint.py`: source completion and action lookups.
- `study_os_service/app.py`: register calendar router.
- `src/study-os/components/SprintCommandCenter.tsx`: mount the minimal panel.

---

### Task 1: Immutable calendar domain

**Files:**
- Create: `study_os_service/domain/sprint_calendar.py`
- Test: `tests/study_os_service/test_sprint_calendar_domain.py`

**Interfaces:**
- Produces: `CapacityObservation`, `CapacityDefaults`, `CapacityOverride`, `HorizonDayCapacity`, `FutureCycleEnvelope`, `LockedCalendarAssignment`, `HorizonItemDraft`, `HorizonAssignmentDraft`, `HorizonDayDraft`, `SprintHorizonRequest`, `SprintHorizonSnapshot`, `SprintHorizonDraft`.
- Consumes existing: `ExamSprintConfig`, `ExamSubjectProfile`, `SourcePlanTask`, `SourcePlanCycle`, `SprintProjection`, `SprintActionDraft`.

- [ ] **Step 1: Write failing validation and immutability tests**

```python
def test_request_requires_contiguous_capacities_and_at_most_fifteen_days():
    with pytest.raises(ValueError, match="contiguous"):
        SprintHorizonRequest(
            target_slug="sefaz_ce",
            starts_on=date(2026, 7, 18),
            ends_on=date(2026, 7, 20),
            capacities=(capacity(date(2026, 7, 18)), capacity(date(2026, 7, 20))),
        )


def test_placeholder_cannot_claim_source_subject_action_or_gain():
    with pytest.raises(ValueError, match="placeholder"):
        HorizonItemDraft(
            item_key="future-cycle:48:2026-07-18",
            origin="system",
            kind="future_cycle_capacity",
            source_plan_task_id=9,
            subject_profile_id=None,
            title="Capacidade reservada",
            expected_meta_number=48,
        )
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `.\.venv-study-os\Scripts\python.exe -m pytest -q tests\study_os_service\test_sprint_calendar_domain.py`

Expected: FAIL because `study_os_service.domain.sprint_calendar` does not exist.

- [ ] **Step 3: Implement exact enums and frozen dataclasses**

```python
CapacityOrigin = Literal["manual_date", "manual_weekday", "manual_global", "learned", "default"]
CalendarPrecision = Literal["exact", "provisional", "protected"]
CalendarPriorityTier = Literal["critical", "high", "maintenance", "protected"]

@dataclass(frozen=True, slots=True)
class HorizonDayCapacity:
    plan_date: date
    ls_minutes: int
    extra_minutes: int
    energy_level: int
    available: bool
    origin: CapacityOrigin
    confidence_bp: int

    def __post_init__(self) -> None:
        if not 0 <= self.ls_minutes <= 720 or not 0 <= self.extra_minutes <= 240:
            raise ValueError("invalid horizon capacity")
        if not 1 <= self.energy_level <= 5:
            raise ValueError("invalid horizon energy")
        if not self.available and (self.ls_minutes or self.extra_minutes):
            raise ValueError("unavailable day must have zero capacity")

@dataclass(frozen=True, slots=True)
class SprintHorizonRequest:
    target_slug: str
    starts_on: date
    ends_on: date
    capacities: tuple[HorizonDayCapacity, ...]

    def __post_init__(self) -> None:
        expected = tuple(
            self.starts_on + timedelta(days=offset)
            for offset in range((self.ends_on - self.starts_on).days + 1)
        )
        if not 1 <= len(expected) <= 15:
            raise ValueError("horizon must contain between 1 and 15 days")
        if tuple(item.plan_date for item in self.capacities) != expected:
            raise ValueError("horizon capacities must be contiguous")
```

Implement every remaining dataclass named in **Interfaces** with scalar/range validation, tuple/mapping freezing, and the placeholder invariant from the spec. `SprintHorizonSnapshot.planning_cutoff` must be timezone-aware UTC.

- [ ] **Step 4: Run domain tests and verify GREEN**

Run: `.\.venv-study-os\Scripts\python.exe -m pytest -q tests\study_os_service\test_sprint_calendar_domain.py`

Expected: PASS.

- [ ] **Step 5: Commit the domain savepoint**

```powershell
git add study_os_service/domain/sprint_calendar.py tests/study_os_service/test_sprint_calendar_domain.py
git commit -m "feat: add sprint calendar domain"
```

---

### Task 2: Bounded capacity learning

**Files:**
- Create: `study_os_service/services/sprint_capacity.py`
- Test: `tests/study_os_service/test_sprint_capacity.py`

**Interfaces:**
- Consumes: `CapacityObservation`, `CapacityDefaults`, `CapacityOverride`, `HorizonDayCapacity` from Task 1.
- Produces `suggest_horizon_capacities(*, dates: tuple[date, ...], defaults: CapacityDefaults, observations: tuple[CapacityObservation, ...], overrides: tuple[CapacityOverride, ...], previous: Mapping[date, HorizonDayCapacity]) -> tuple[HorizonDayCapacity, ...]`.

- [ ] **Step 1: Write failing precedence, sparse-history, missing-day, and bound tests**

```python
def test_missing_days_do_not_become_zero_and_three_samples_enable_learning():
    dates = (date(2026, 7, 18),)
    sparse = suggest_horizon_capacities(
        dates=dates, defaults=defaults(240), observations=two_observations(),
        overrides=(), previous={},
    )
    assert sparse[0].ls_minutes == 240
    assert sparse[0].origin == "default"
    learned = suggest_horizon_capacities(
        dates=dates, defaults=defaults(240), observations=three_observations(),
        overrides=(), previous={},
    )
    assert learned[0].origin == "learned"
    assert 180 <= learned[0].ls_minutes <= 300


def test_date_override_beats_weekday_global_and_learned():
    result = suggest_horizon_capacities(
        dates=(date(2026, 7, 18),), defaults=defaults(240),
        observations=three_observations(), overrides=override_stack(), previous={},
    )
    assert result[0].origin == "manual_date"
    assert result[0].ls_minutes == 180
```

- [ ] **Step 2: Run the capacity test and verify RED**

Run: `.\.venv-study-os\Scripts\python.exe -m pytest -q tests\study_os_service\test_sprint_capacity.py`

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement the exact learner**

```python
def _effective_minutes(item: CapacityObservation) -> int:
    ratio = item.completed_actions / item.scheduled_actions
    return round(item.actual_minutes + max(0, item.planned_minutes - item.actual_minutes) * ratio)

def _sample_weight(item: CapacityObservation, target: date, energy: int) -> int:
    weight = 1
    if item.plan_date.weekday() == target.weekday():
        weight *= 2
    if abs(item.energy_level - energy) <= 1:
        weight *= 2
    return min(4, weight)

def _bounded_update(default: int, previous: int, observed: int) -> int:
    blended = round(previous * 0.70 + observed * 0.30)
    floor, ceiling = round(default * 0.75), round(default * 1.25)
    step_floor, step_ceiling = round(previous * 0.85), round(previous * 1.15)
    return min(ceiling, step_ceiling, max(floor, step_floor, blended))
```

Use only result-bearing observations; exclude missing and explicitly unavailable days from learning. Weighted median ties choose the lower value. Confidence is `min(9000, 5500 + 1000 * (sample_count - 3))`. An unavailable date override returns zero minutes and `available=False`.

- [ ] **Step 4: Run capacity tests and verify GREEN**

Run: `.\.venv-study-os\Scripts\python.exe -m pytest -q tests\study_os_service\test_sprint_capacity.py`

Expected: PASS.

- [ ] **Step 5: Commit the capacity savepoint**

```powershell
git add study_os_service/services/sprint_capacity.py tests/study_os_service/test_sprint_capacity.py
git commit -m "feat: learn bounded sprint capacity"
```

---

### Task 3: Pure cycle-first horizon engine

**Files:**
- Create: `study_os_service/services/sprint_horizon_engine.py`
- Modify: `study_os_service/services/sprint_engine.py`
- Test: `tests/study_os_service/test_sprint_horizon_engine.py`
- Test: `tests/study_os_service/test_sprint_engine.py`

**Interfaces:**
- Consumes: Task 1 contracts, existing `SprintEngine.generate`, released `SourcePlanCycle` and `SourcePlanTask` snapshots.
- Produces `SprintHorizonEngine.algorithm_version = "sefaz-ce-calendar-v1"` and `SprintHorizonEngine.plan(*, request: SprintHorizonRequest, snapshot: SprintHorizonSnapshot) -> SprintHorizonDraft`.

- [ ] **Step 1: Write failing uniqueness, LS-cycle, placeholder, energy, and D-1 tests**

```python
def test_each_released_ls_task_is_reserved_once_across_the_horizon():
    draft = engine().plan(request=three_days(), snapshot=meta47_snapshot())
    ids = [a.source_plan_task_id for d in draft.days for a in d.assignments if a.source_plan_task_id]
    assert len(ids) == len(set(ids))


def test_unknown_meta_uses_non_executable_capacity_envelope():
    draft = engine().plan(request=fifteen_days(), snapshot=meta47_only_snapshot())
    future = next(i for i in draft.items if i.kind == "future_cycle_capacity")
    assignment = next(a for d in draft.days for a in d.assignments if a.item_key == future.item_key)
    assert assignment.precision == "provisional"
    assert assignment.action is None
    assert assignment.expected_gain_milli == 0


def test_energy_one_and_five_change_composition_not_minutes():
    low = engine().plan(request=one_day(energy=1), snapshot=heavy_snapshot())
    high = engine().plan(request=one_day(energy=5), snapshot=heavy_snapshot())
    assert low.days[0].capacity.total_minutes == high.days[0].capacity.total_minutes
    assert [a.kind for a in low.days[0].assignments] != [a.kind for a in high.days[0].assignments]
```

- [ ] **Step 2: Run focused engine tests and verify RED**

Run: `.\.venv-study-os\Scripts\python.exe -m pytest -q tests\study_os_service\test_sprint_horizon_engine.py tests\study_os_service\test_sprint_engine.py`

Expected: FAIL on the missing horizon engine and identical energy behavior.

- [ ] **Step 3: Allow a frozen projection cutoff and add energy policy to the daily engine**

```python
if projection.as_of > plan_date:
    raise ValueError("projection cutoff cannot be after plan date")

def _energy_eligible(action: SprintActionDraft, energy_level: int) -> bool:
    if energy_level <= 2 and action.action_kind in {"simulation", "discursive"}:
        return False
    return True

def _energy_cap(energy_level: int) -> int | None:
    return 25 if energy_level == 1 else 35 if energy_level == 2 else None
```

Apply the cap by returning an `ls_compress` action with the same source identity and an explicit energy rationale. At level 5, simulation/discursive wins ties; no energy path changes the configured total budget.

- [ ] **Step 4: Implement the one-shot reservation loop**

```python
remaining = {task.id: task for task in snapshot.source_tasks if task.status in {"pending", "started"}}
reserved_keys: set[str] = set(item.item_key for item in snapshot.locked_assignments)
for capacity in request.capacities:
    released = tuple(
        task for task in remaining.values()
        if _cycle_allows(task, snapshot.cycles, capacity.plan_date)
    )
    exact_through = max((cycle.ends_on for cycle in snapshot.cycles), default=request.starts_on - timedelta(days=1))
    if capacity.plan_date > exact_through and capacity.ls_minutes:
        add_future_capacity_envelope(capacity)
    daily = self.daily_engine.generate(
        config=replace(snapshot.config, ls_budget_minutes=max(15, capacity.ls_minutes), extra_budget_minutes=capacity.extra_minutes),
        subjects=snapshot.subjects,
        source_tasks=released,
        plan_date=capacity.plan_date,
        energy_level=capacity.energy_level,
        subject_projections={item.subject_key: item for item in snapshot.projection.subjects},
        projection=snapshot.projection,
        afo_rescues_this_week=virtual_afo_count,
        has_scheduled_simulation=virtual_simulation_present,
    )
    reserve_unique_actions(daily.actions, remaining, reserved_keys)
```

Do not pass future LS tasks into days outside their cycle. Protect past/locked assignments before ranking. Assign tiers deterministically: protection reason → protected; expiry within two days → critical; first third by frozen ranking → high; remainder → maintenance. D-2/D-1 rules remain those in the spec.

- [ ] **Step 5: Run engine tests and verify GREEN**

Run: `.\.venv-study-os\Scripts\python.exe -m pytest -q tests\study_os_service\test_sprint_horizon_engine.py tests\study_os_service\test_sprint_engine.py tests\study_os_service\test_sprint_api.py`

Expected: PASS.

- [ ] **Step 6: Commit the engine savepoint**

```powershell
git add study_os_service/services/sprint_horizon_engine.py study_os_service/services/sprint_engine.py tests/study_os_service/test_sprint_horizon_engine.py tests/study_os_service/test_sprint_engine.py
git commit -m "feat: plan cycle-first sprint horizon"
```

---

### Task 4: Schema v12 and calendar repository

**Files:**
- Modify: `study_os_service/db/migrations.py`
- Create: `study_os_service/repositories/sprint_calendar.py`
- Create: `tests/study_os_service/test_sprint_calendar_migration.py`
- Create: `tests/study_os_service/test_sprint_calendar_repository.py`
- Modify: `tests/study_os_service/test_sprint_evidence_migration.py`
- Modify: `tests/study_os_service/test_strategy_migration.py`
- Modify: `tests/study_os_service/test_learning_migration.py`
- Modify: `tests/study_os_service/test_cutover_migration.py`
- Modify: `tests/study_os_service/test_cutover_api.py`

**Interfaces:**
- Produces repository methods `get_head`, `get_run`, `get_run_by_idempotency`, `list_days`, `list_items`, `list_assignments`, `insert_preview_in_transaction`, `apply_run_in_transaction`, `upsert_day_override`, `upsert_item_override`, `complete_item_for_source_in_transaction`.

- [ ] **Step 1: Write failing additive migration and constraint tests**

```python
def test_v12_adds_calendar_tables_without_changing_v11_state(tmp_path):
    connection = migrated_connection(tmp_path, target_version=11)
    expected = seed_and_snapshot_v11(connection)
    MigrationRunner(connection).migrate()
    assert current_version(connection) == 12
    assert expected == snapshot_v11_tables(connection)
    assert calendar_tables(connection) == {
        "sprint_calendar_runs", "sprint_calendar_days", "sprint_calendar_items",
        "sprint_calendar_assignments", "sprint_calendar_materializations",
        "sprint_calendar_day_overrides", "sprint_calendar_item_overrides",
    }


def test_calendar_rejects_placeholder_with_source_task(connection):
    with pytest.raises(sqlite3.IntegrityError):
        insert_placeholder(connection, source_plan_task_id=1)
```

- [ ] **Step 2: Run migration tests and verify RED**

Run: `.\.venv-study-os\Scripts\python.exe -m pytest -q tests\study_os_service\test_sprint_calendar_migration.py tests\study_os_service\test_sprint_evidence_migration.py`

Expected: FAIL because schema 12 and calendar tables do not exist.

- [ ] **Step 3: Add complete v12 DDL**

```sql
CREATE TABLE sprint_calendar_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  idempotency_key TEXT NOT NULL UNIQUE,
  target_slug TEXT NOT NULL REFERENCES exam_targets(target_slug) ON DELETE RESTRICT,
  window_start TEXT NOT NULL CHECK (date(window_start)=window_start),
  window_end TEXT NOT NULL CHECK (date(window_end)=window_end),
  planning_cutoff TEXT NOT NULL,
  exact_through TEXT NOT NULL CHECK (date(exact_through)=exact_through),
  algorithm_version TEXT NOT NULL,
  request_hash TEXT NOT NULL CHECK (length(request_hash)=64),
  input_hash TEXT NOT NULL CHECK (length(input_hash)=64),
  base_applied_run_id INTEGER,
  supersedes_run_id INTEGER,
  decision TEXT NOT NULL CHECK (decision IN ('draft','applied','rejected')),
  status TEXT NOT NULL CHECK (status IN ('generated','shortfall')),
  warnings_json TEXT NOT NULL CHECK (json_valid(warnings_json) AND json_type(warnings_json)='array'),
  shortfalls_json TEXT NOT NULL CHECK (json_valid(shortfalls_json) AND json_type(shortfalls_json)='array'),
  projection_snapshot_json TEXT NOT NULL CHECK (json_valid(projection_snapshot_json)),
  capacity_snapshot_json TEXT NOT NULL CHECK (json_valid(capacity_snapshot_json)),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  generated_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW')),
  applied_at TEXT,
  UNIQUE (id, target_slug),
  CHECK (window_start <= window_end),
  CHECK (julianday(window_end)-julianday(window_start) BETWEEN 0 AND 14),
  CHECK (supersedes_run_id IS NULL OR supersedes_run_id != id),
  CHECK (
    (decision='applied' AND applied_at IS NOT NULL) OR
    (decision!='applied' AND applied_at IS NULL)
  ),
  FOREIGN KEY (base_applied_run_id, target_slug)
    REFERENCES sprint_calendar_runs(id, target_slug) ON DELETE RESTRICT,
  FOREIGN KEY (supersedes_run_id, target_slug)
    REFERENCES sprint_calendar_runs(id, target_slug) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX uq_sprint_calendar_supersedes
ON sprint_calendar_runs(supersedes_run_id) WHERE supersedes_run_id IS NOT NULL;

CREATE INDEX idx_sprint_calendar_runs_head
ON sprint_calendar_runs(target_slug, decision, id DESC);

CREATE UNIQUE INDEX uq_source_plan_tasks_id_target
ON source_plan_tasks(id, target_slug);

CREATE UNIQUE INDEX uq_exam_subject_profiles_id_target
ON exam_subject_profiles(id, target_slug);

CREATE UNIQUE INDEX uq_sprint_day_runs_id_target
ON sprint_day_runs(id, target_slug);

CREATE UNIQUE INDEX uq_sprint_actions_id_run_target
ON sprint_actions(id, run_id, target_slug);

CREATE TABLE sprint_calendar_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_slug TEXT NOT NULL REFERENCES exam_targets(target_slug) ON DELETE RESTRICT,
  item_key TEXT NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('source','manual','system')),
  kind TEXT NOT NULL CHECK (kind IN ('source_task','manual','intervention','future_cycle_capacity')),
  source_plan_task_id INTEGER,
  subject_profile_id INTEGER,
  title TEXT NOT NULL,
  expected_meta_number INTEGER CHECK (expected_meta_number IS NULL OR expected_meta_number >= 0),
  state TEXT NOT NULL CHECK (state IN ('pending','active','completed','failed','ignored','archived')),
  result_json TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(result_json) AND json_type(result_json)='object'),
  completed_at TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW')),
  updated_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW')),
  UNIQUE (id, target_slug),
  UNIQUE (target_slug, item_key),
  UNIQUE (target_slug, source_plan_task_id),
  CHECK (kind!='source_task' OR (origin='source' AND source_plan_task_id IS NOT NULL)),
  CHECK (
    kind!='future_cycle_capacity' OR (
      origin='system' AND source_plan_task_id IS NULL AND
      subject_profile_id IS NULL AND state='pending' AND
      result_json='{}' AND completed_at IS NULL
    )
  ),
  FOREIGN KEY (source_plan_task_id, target_slug)
    REFERENCES source_plan_tasks(id, target_slug) ON DELETE RESTRICT,
  FOREIGN KEY (subject_profile_id, target_slug)
    REFERENCES exam_subject_profiles(id, target_slug) ON DELETE RESTRICT
);

CREATE TABLE sprint_calendar_days (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL,
  target_slug TEXT NOT NULL,
  plan_date TEXT NOT NULL CHECK (date(plan_date)=plan_date),
  precision TEXT NOT NULL CHECK (precision IN ('exact','provisional','protected')),
  availability_source TEXT NOT NULL CHECK (
    availability_source IN ('manual_date','manual_weekday','manual_global','learned','default')
  ),
  available INTEGER NOT NULL CHECK (available IN (0,1)),
  available_minutes INTEGER NOT NULL CHECK (available_minutes BETWEEN 0 AND 960),
  ls_minutes INTEGER NOT NULL CHECK (ls_minutes BETWEEN 0 AND 720),
  extra_minutes INTEGER NOT NULL CHECK (extra_minutes BETWEEN 0 AND 240),
  reserved_minutes INTEGER NOT NULL CHECK (reserved_minutes >= 0),
  overage_minutes INTEGER NOT NULL CHECK (overage_minutes >= 0),
  energy_level INTEGER NOT NULL CHECK (energy_level BETWEEN 1 AND 5),
  confidence_bp INTEGER NOT NULL CHECK (confidence_bp BETWEEN 0 AND 10000),
  warnings_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(warnings_json) AND json_type(warnings_json)='array'),
  UNIQUE (run_id, plan_date),
  CHECK (available_minutes = ls_minutes + extra_minutes),
  CHECK (
    (available=0 AND available_minutes=0) OR
    (available=1 AND available_minutes>0)
  ),
  CHECK (overage_minutes = MAX(reserved_minutes - available_minutes, 0)),
  FOREIGN KEY (run_id, target_slug)
    REFERENCES sprint_calendar_runs(id, target_slug) ON DELETE RESTRICT
);

CREATE TABLE sprint_calendar_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL,
  target_slug TEXT NOT NULL,
  item_id INTEGER NOT NULL,
  plan_date TEXT NOT NULL CHECK (date(plan_date)=plan_date),
  position INTEGER NOT NULL CHECK (position > 0),
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes BETWEEN 1 AND 720),
  precision TEXT NOT NULL CHECK (precision IN ('exact','provisional','protected')),
  priority_tier TEXT NOT NULL CHECK (priority_tier IN ('critical','high','maintenance','protected')),
  reason_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(reason_json) AND json_type(reason_json)='array'),
  pinned_snapshot INTEGER NOT NULL DEFAULT 0 CHECK (pinned_snapshot IN (0,1)),
  action_json TEXT CHECK (
    action_json IS NULL OR (json_valid(action_json) AND json_type(action_json)='object')
  ),
  expected_gain_milli INTEGER NOT NULL DEFAULT 0 CHECK (expected_gain_milli >= 0),
  replaces_placeholder_item_id INTEGER,
  UNIQUE (id, target_slug),
  UNIQUE (run_id, item_id),
  UNIQUE (run_id, plan_date, position),
  CHECK (replaces_placeholder_item_id IS NULL OR replaces_placeholder_item_id != item_id),
  FOREIGN KEY (run_id, target_slug)
    REFERENCES sprint_calendar_runs(id, target_slug) ON DELETE RESTRICT,
  FOREIGN KEY (run_id, plan_date)
    REFERENCES sprint_calendar_days(run_id, plan_date) ON DELETE RESTRICT,
  FOREIGN KEY (item_id, target_slug)
    REFERENCES sprint_calendar_items(id, target_slug) ON DELETE RESTRICT,
  FOREIGN KEY (replaces_placeholder_item_id, target_slug)
    REFERENCES sprint_calendar_items(id, target_slug) ON DELETE RESTRICT
);

CREATE TRIGGER trg_sprint_calendar_placeholder_assignment_insert
BEFORE INSERT ON sprint_calendar_assignments
WHEN EXISTS (
  SELECT 1 FROM sprint_calendar_items AS item
  WHERE item.id=NEW.item_id AND item.target_slug=NEW.target_slug
    AND item.kind='future_cycle_capacity'
) AND (NEW.action_json IS NOT NULL OR NEW.expected_gain_milli != 0)
BEGIN
  SELECT RAISE(ABORT, 'future cycle capacity cannot be executable');
END;

CREATE TABLE sprint_calendar_materializations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_slug TEXT NOT NULL,
  assignment_id INTEGER NOT NULL,
  sprint_day_run_id INTEGER NOT NULL,
  sprint_action_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW')),
  UNIQUE (assignment_id),
  UNIQUE (sprint_action_id),
  FOREIGN KEY (assignment_id, target_slug)
    REFERENCES sprint_calendar_assignments(id, target_slug) ON DELETE RESTRICT,
  FOREIGN KEY (sprint_day_run_id, target_slug)
    REFERENCES sprint_day_runs(id, target_slug) ON DELETE RESTRICT,
  FOREIGN KEY (sprint_action_id, sprint_day_run_id, target_slug)
    REFERENCES sprint_actions(id, run_id, target_slug) ON DELETE RESTRICT
);

CREATE TABLE sprint_calendar_day_overrides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_slug TEXT NOT NULL REFERENCES exam_targets(target_slug) ON DELETE RESTRICT,
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('date','weekday','global')),
  scope_value TEXT NOT NULL,
  availability TEXT NOT NULL CHECK (availability IN ('default','available','unavailable')),
  ls_minutes INTEGER CHECK (ls_minutes IS NULL OR ls_minutes BETWEEN 0 AND 720),
  extra_minutes INTEGER CHECK (extra_minutes IS NULL OR extra_minutes BETWEEN 0 AND 240),
  energy_level INTEGER CHECK (energy_level IS NULL OR energy_level BETWEEN 1 AND 5),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW')),
  updated_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW')),
  CHECK (
    (scope_kind='date' AND date(scope_value)=scope_value) OR
    (scope_kind='weekday' AND scope_value IN ('0','1','2','3','4','5','6')) OR
    (scope_kind='global' AND scope_value='*')
  ),
  CHECK (
    (availability='unavailable' AND ls_minutes=0 AND extra_minutes=0) OR
    (availability!='unavailable' AND
      (ls_minutes IS NULL OR ls_minutes BETWEEN 1 AND 720) AND
      (extra_minutes IS NULL OR extra_minutes BETWEEN 0 AND 240))
  )
);

CREATE UNIQUE INDEX uq_sprint_calendar_active_day_override
ON sprint_calendar_day_overrides(target_slug, scope_kind, scope_value)
WHERE active=1;

CREATE TABLE sprint_calendar_item_overrides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_slug TEXT NOT NULL,
  item_id INTEGER NOT NULL,
  plan_date TEXT NOT NULL CHECK (date(plan_date)=plan_date),
  start_time TEXT CHECK (
    start_time IS NULL OR
    (length(start_time)=5 AND time(start_time)=start_time || ':00')
  ),
  position INTEGER CHECK (position IS NULL OR position > 0),
  duration_minutes INTEGER CHECK (duration_minutes IS NULL OR duration_minutes BETWEEN 1 AND 720),
  pinned INTEGER NOT NULL DEFAULT 1 CHECK (pinned IN (0,1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW')),
  updated_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW')),
  CHECK (active=0 OR pinned=1),
  FOREIGN KEY (item_id, target_slug)
    REFERENCES sprint_calendar_items(id, target_slug) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX uq_sprint_calendar_active_item_override
ON sprint_calendar_item_overrides(target_slug, item_id)
WHERE active=1;

CREATE INDEX idx_sprint_calendar_days_target_date
ON sprint_calendar_days(target_slug, plan_date, run_id);

CREATE INDEX idx_sprint_calendar_assignments_date_position
ON sprint_calendar_assignments(target_slug, plan_date, position);

CREATE INDEX idx_sprint_calendar_items_state
ON sprint_calendar_items(target_slug, state, updated_at);
```

Keep assignments immutable after preview insertion. The service must verify that `replaces_placeholder_item_id` names a `future_cycle_capacity` item and that only a real released source item may replace it; the insert trigger independently blocks executable actions or gains on placeholders.

- [ ] **Step 4: Implement repository round trips and CAS primitives**

```python
class SprintCalendarRepository:
    def get_head(self, target_slug: str) -> sqlite3.Row | None:
        return self.connection.execute(
            """SELECT run.* FROM sprint_calendar_runs AS run
               WHERE run.target_slug=? AND run.decision='applied'
                 AND NOT EXISTS (
                   SELECT 1 FROM sprint_calendar_runs AS child
                   WHERE child.supersedes_run_id=run.id AND child.decision='applied'
                 )
               ORDER BY run.id DESC LIMIT 1""",
            (target_slug,),
        ).fetchone()

    def apply_run_in_transaction(self, run_id: int, expected_head_id: int | None) -> sqlite3.Row:
        head = self.get_head_for_update_target(run_id)
        if (head["id"] if head else None) != expected_head_id:
            raise CalendarSupersessionConflictError("calendar head changed")
        updated = self.connection.execute(
            """UPDATE sprint_calendar_runs SET decision='applied', applied_at=STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW'), version=version+1
               WHERE id=? AND decision='draft'""",
            (run_id,),
        )
        if updated.rowcount != 1:
            raise CalendarRunStateError("calendar draft is not applicable")
        return self.get_run(run_id)
```

- [ ] **Step 5: Run migration/repository tests and verify GREEN**

Run: `.\.venv-study-os\Scripts\python.exe -m pytest -q tests\study_os_service\test_sprint_calendar_migration.py tests\study_os_service\test_sprint_calendar_repository.py tests\study_os_service\test_migrations.py`

Expected: PASS and `CURRENT_SCHEMA_VERSION == 12` everywhere.

- [ ] **Step 6: Commit the persistence savepoint**

```powershell
git add study_os_service/db/migrations.py study_os_service/repositories/sprint_calendar.py tests/study_os_service/test_sprint_calendar_migration.py tests/study_os_service/test_sprint_calendar_repository.py tests/study_os_service/test_sprint_evidence_migration.py tests/study_os_service/test_strategy_migration.py tests/study_os_service/test_learning_migration.py tests/study_os_service/test_cutover_migration.py tests/study_os_service/test_cutover_api.py
git commit -m "feat: persist sprint calendar previews"
```

---

### Task 5: Preview/apply service and LS-cycle refresh

**Files:**
- Create: `study_os_service/services/sprint_calendar.py`
- Test: `tests/study_os_service/test_sprint_calendar_service.py`

**Interfaces:**
- Consumes: engine, capacity learner, `SprintProjectionService`, `SprintProfileService`, `SourcePlanCycleService`, calendar repository.
- Produces: `preview(payload, idempotency_key)`, `apply(run_id, payload, idempotency_key)`, `get_head(target_slug, start_date)`, `update_day_override`, `update_item_override`, `create_manual_item`.
- Preview accepts `mode: 'reflow_open' | 'fill_open' | 'restore_run'`; `restore_run` requires `restoreRunId` and clones that historical applied layout into a new draft based on the current head.

- [ ] **Step 1: Write failing idempotency, stale-head, frozen-snapshot, and Meta refresh tests**

```python
def test_preview_is_draft_and_replay_is_exact(client):
    first = preview_calendar(client, key="preview-1")
    replay = preview_calendar(client, key="preview-1")
    assert first["run"]["decision"] == "draft"
    assert replay == first | {"replayed": True}
    assert get_calendar_head(client) is None


def test_new_ls_meta_only_changes_a_new_preview(client):
    applied = apply_calendar(client, preview_calendar(client, key="before-meta"))
    import_meta48(client)
    assert get_calendar_head(client)["run"]["id"] == applied["run"]["id"]
    draft = preview_calendar(client, key="after-meta", expected_run_id=applied["run"]["id"])
    assert draft["diff"]["placeholderReplacements"] > 0


def test_undo_is_a_new_restore_preview_not_a_mutation_of_history(client):
    old = applied_calendar(client, key="old")
    current = applied_calendar(client, key="current", expected_run_id=old["run"]["id"])
    restored = preview_calendar(
        client, key="restore", expected_run_id=current["run"]["id"],
        mode="restore_run", restore_run_id=old["run"]["id"],
    )
    assert restored["run"]["decision"] == "draft"
    assert restored["run"]["baseAppliedRunId"] == current["run"]["id"]
    assert get_calendar_run(client, old["run"]["id"])["run"]["decision"] == "applied"
```

- [ ] **Step 2: Run service tests and verify RED**

Run: `.\.venv-study-os\Scripts\python.exe -m pytest -q tests\study_os_service\test_sprint_calendar_service.py`

Expected: FAIL because the orchestration service does not exist.

- [ ] **Step 3: Implement transactional preview**

```python
def preview(self, payload, *, idempotency_key):
    prepared = self._prepare_preview(payload)
    self.connection.execute("BEGIN IMMEDIATE")
    try:
        replay = self._replay("calendar-preview", idempotency_key, prepared.request_hash)
        if replay is not None:
            self.connection.commit()
            return replay | {"replayed": True}
        self._require_head(prepared.target_slug, prepared.expected_run_id)
        snapshot = self._frozen_snapshot(prepared)
        capacities = suggest_horizon_capacities(**prepared.capacity_inputs(snapshot))
        draft = self.engine.plan(request=prepared.request(capacities), snapshot=snapshot)
        saved = self.repository.insert_preview_in_transaction(prepared, snapshot, draft)
        response = self._calendar_document(saved, include_diff=True)
        self._save_receipt("calendar-preview", idempotency_key, prepared.request_hash, response)
        self.connection.commit()
        return response | {"replayed": False}
    except Exception:
        self.connection.rollback()
        raise
```

`input_hash` includes algorithm version, config/subject versions, projection digest, source-task/cycle IDs and versions, capacity/override versions, locked assignments, and planning cutoff. Source cycles/tasks are loaded once. Current released Meta tasks are exact; dates after the latest known cycle receive LS envelopes.

For `mode='restore_run'`, validate that `restoreRunId` is an applied historical run of the same target, copy its still-valid assignments into a new draft, retain current completed/active/pinned items, and report any historical item that is no longer eligible as preserved/removed in the diff.

- [ ] **Step 4: Implement apply and override CAS**

```python
def apply(self, run_id, payload, *, idempotency_key):
    expected_head = _optional_int(payload.get("expectedRunId"))
    expected_overrides = _version_map(payload.get("expectedOverrideVersions", {}))
    self.connection.execute("BEGIN IMMEDIATE")
    try:
        self.repository.assert_override_versions(expected_overrides)
        run = self.repository.apply_run_in_transaction(run_id, expected_head)
        response = self._calendar_document(run, include_diff=True) | {
            "undoRunId": expected_head,
        }
        self._save_receipt("calendar-apply", idempotency_key, _hash(payload), response)
        self.connection.commit()
        return response
    except Exception:
        self.connection.rollback()
        raise
```

Manual date/weekday/global overrides and item pin/unpin/move use `expectedVersion`. A pin above capacity remains fixed and sets shortfall; it is not moved.

- [ ] **Step 5: Run service tests and verify GREEN**

Run: `.\.venv-study-os\Scripts\python.exe -m pytest -q tests\study_os_service\test_sprint_calendar_service.py tests\study_os_service\test_sprint_profile_source_api.py`

Expected: PASS, including current Meta exact, future Meta provisional, and import-triggered preview only.

- [ ] **Step 6: Commit the service savepoint**

```powershell
git add study_os_service/services/sprint_calendar.py tests/study_os_service/test_sprint_calendar_service.py
git commit -m "feat: preview and apply sprint calendars"
```

---

### Task 6: Stable calendar HTTP API

**Files:**
- Create: `study_os_service/api/sprint_calendar.py`
- Modify: `study_os_service/app.py`
- Test: `tests/study_os_service/test_sprint_calendar_api.py`

**Interfaces:**
- Produces the seven endpoints and error codes defined in the approved design.

- [ ] **Step 1: Write failing route, payload, replay, and error-shape tests**

```python
def test_preview_apply_and_head_contract(client):
    draft = client.post(
        "/api/v1/sprints/calendar/preview",
        headers={"Idempotency-Key": "p-1"},
        json={"targetSlug": "sefaz_ce", "startDate": "2026-07-18", "endDate": "2026-07-31", "expectedRunId": None},
    )
    assert draft.status_code == 201
    applied = client.post(
        f"/api/v1/sprints/calendar/runs/{draft.json()['run']['id']}/apply",
        headers={"Idempotency-Key": "a-1"},
        json={"expectedRunId": None, "expectedOverrideVersions": {}},
    )
    assert applied.status_code == 200
    assert client.get("/api/v1/sprints/calendar", params={"targetSlug": "sefaz_ce", "startDate": "2026-07-18"}).json()["run"]["id"] == draft.json()["run"]["id"]
```

- [ ] **Step 2: Run API tests and verify RED**

Run: `.\.venv-study-os\Scripts\python.exe -m pytest -q tests\study_os_service\test_sprint_calendar_api.py`

Expected: FAIL with 404 routes.

- [ ] **Step 3: Implement router and exact error translation**

```python
@router.post("/sprints/calendar/preview", status_code=201)
async def preview_calendar(request: Request, payload: dict = Body(...), idempotency_key: str = Header(alias="Idempotency-Key")):
    try:
        return SprintCalendarService(request.app.state.connection).preview(payload, idempotency_key=idempotency_key)
    except Exception as exc:
        raise _translate_calendar_error(exc) from exc

@router.post("/sprints/calendar/runs/{run_id}/apply")
async def apply_calendar(run_id: int, request: Request, payload: dict = Body(...), idempotency_key: str = Header(alias="Idempotency-Key")):
    try:
        return SprintCalendarService(request.app.state.connection).apply(run_id, payload, idempotency_key=idempotency_key)
    except Exception as exc:
        raise _translate_calendar_error(exc) from exc
```

Add GET head/run, PUT day/item override, and POST manual item. Translate 404 `calendar_*_not_found`, 409 idempotency/stale/supersession, and 422 invalid window/capacity/placeholder exactly. Register the router under `/api/v1` in `app.py`.

- [ ] **Step 4: Run API tests and verify GREEN**

Run: `.\.venv-study-os\Scripts\python.exe -m pytest -q tests\study_os_service\test_sprint_calendar_api.py tests\study_os_service\test_sprint_api.py`

Expected: PASS.

- [ ] **Step 5: Commit the API savepoint**

```powershell
git add study_os_service/api/sprint_calendar.py study_os_service/app.py tests/study_os_service/test_sprint_calendar_api.py
git commit -m "feat: expose sprint calendar API"
```

---

### Task 7: Daily materialization and global completion

**Files:**
- Modify: `study_os_service/services/sprint_day.py`
- Modify: `study_os_service/repositories/sprint.py`
- Modify: `study_os_service/repositories/sprint_calendar.py`
- Test: `tests/study_os_service/test_sprint_calendar_materialization.py`
- Test: `tests/study_os_service/test_sprint_api.py`

**Interfaces:**
- Produces `materialize_day_in_transaction(calendar_run_id, plan_date, day_run_id, actions)` and `complete_item_for_source_in_transaction(source_task_id, result, completed_at)`.

- [ ] **Step 1: Write failing materialization, placeholder, completion, skip, and rollback tests**

```python
def test_completed_action_closes_calendar_item_and_source_task_atomically(client, connection):
    action = materialized_action(client)
    response = complete_action(client, action, key="complete-once")
    assert response["state"] == "completed"
    assert scalar(connection, "SELECT state FROM sprint_calendar_items WHERE source_plan_task_id=?", action["sourcePlanTaskId"]) == "completed"
    assert scalar(connection, "SELECT status FROM source_plan_tasks WHERE id=?", action["sourcePlanTaskId"]) == "completed"


def test_placeholder_never_materializes(client):
    day = generate_day_from_calendar(client, provisional_date())
    assert all(item["sourcePlanTaskId"] is not None for item in day["actions"])
```

- [ ] **Step 2: Run materialization tests and verify RED**

Run: `.\.venv-study-os\Scripts\python.exe -m pytest -q tests\study_os_service\test_sprint_calendar_materialization.py`

Expected: FAIL because day generation does not consult the applied calendar.

- [ ] **Step 3: Prefer exact assignments and write append-only links**

```python
preferences = calendar_repository.executable_assignments_for_date(target_slug, plan_date)
preferences_by_source_task = {
    row["source_plan_task_id"]: row
    for row in preferences
    if row["source_plan_task_id"] is not None
}
source_tasks = _ordered_by_calendar_preference(source_tasks, preferences)
for position, action in enumerate(draft.actions, start=1):
    saved_action = self.repository.insert_action(
        run_id=run["id"],
        target_slug=target_slug,
        position=position,
        values=self._action_values(action),
    )
    preference = preferences_by_source_task.get(action.source_plan_task_id)
    if preference is not None:
        calendar_repository.insert_materialization_in_transaction(
            assignment_id=preference["assignment_id"],
            sprint_day_run_id=run["id"],
            sprint_action_id=saved_action["id"],
        )
```

Use calendar priority only as an auditable preference; current eligibility still gates execution. Never materialize `future_cycle_capacity`.

- [ ] **Step 4: Extend the existing result transaction**

```python
saved = self.repository.update_action(action_id, expected_version=expected_version, values=values)
self.repository.insert_action_question_refs(action_id, refs)
SprintEvidenceService(self.connection).append_action_result_in_transaction(saved)
if saved["source_plan_task_id"] is not None and saved["state"] == "completed":
    self.repository.mark_source_task_completed_in_transaction(saved["source_plan_task_id"])
    self.calendar_repository.complete_item_for_source_in_transaction(
        saved["source_plan_task_id"], result=saved, completed_at=saved["updated_at"]
    )
```

`failed` updates item state to failed; day-level `skipped` leaves item/source pending; explicit ignore remains a separate mutation. Preserve receipt replay and rollback all writes if evidence persistence fails.

- [ ] **Step 5: Run materialization and sprint regression tests**

Run: `.\.venv-study-os\Scripts\python.exe -m pytest -q tests\study_os_service\test_sprint_calendar_materialization.py tests\study_os_service\test_sprint_api.py tests\study_os_service\test_sprint_evidence_api.py`

Expected: PASS.

- [ ] **Step 6: Commit the execution savepoint**

```powershell
git add study_os_service/services/sprint_day.py study_os_service/repositories/sprint.py study_os_service/repositories/sprint_calendar.py tests/study_os_service/test_sprint_calendar_materialization.py tests/study_os_service/test_sprint_api.py
git commit -m "fix: persist sprint completion globally"
```

---

### Task 8: Strict TypeScript client and minimal visible calendar

**Files:**
- Create: `src/study-os/api/sprintCalendar.ts`
- Create: `src/study-os/api/sprintCalendar.test.ts`
- Create: `src/study-os/domain/sprintCalendarView.ts`
- Create: `src/study-os/domain/sprintCalendarView.test.ts`
- Create: `src/study-os/components/SprintCalendarPanel.tsx`
- Create: `src/study-os/components/SprintCalendarPanel.test.ts`
- Modify: `src/study-os/components/SprintCommandCenter.tsx`

**Interfaces:**
- Produces `parseSprintCalendar`, `fetchSprintCalendarHead`, `fetchSprintCalendarRun`, `previewSprintCalendar`, `applySprintCalendarRun`, `updateSprintCalendarDay`, `updateSprintCalendarItemOverride`, `createSprintCalendarItem`, and `buildSprintCalendarView`.

- [ ] **Step 1: Write failing strict parser and request tests**

```ts
test('parser rejects executable provisional placeholders', () => {
  assert.throws(() => parseSprintCalendar({
    ...VALID_CALENDAR,
    items: [{ ...VALID_PLACEHOLDER, sourcePlanTaskId: 12 }],
  }), /placeholder/);
});

test('preview and apply preserve idempotency and expected head', async () => {
  await previewSprintCalendar({
    targetSlug: 'sefaz_ce', startDate: '2026-07-18', endDate: '2026-07-31',
    expectedRunId: 7, mode: 'restore_run', restoreRunId: 6,
  }, 'preview-key');
  assert.equal(requests[0].headers['Idempotency-Key'], 'preview-key');
  assert.equal(requests[0].body.expectedRunId, 7);
  assert.equal(requests[0].body.mode, 'restore_run');
  assert.equal(requests[0].body.restoreRunId, 6);
});
```

- [ ] **Step 2: Run frontend contract tests and verify RED**

Run: `npx --no-install tsx --test src/study-os/api/sprintCalendar.test.ts src/study-os/domain/sprintCalendarView.test.ts`

Expected: FAIL because files/exports do not exist.

- [ ] **Step 3: Implement strict types, parsers, and request wrappers**

```ts
export type CalendarPrecision = 'exact' | 'provisional' | 'protected';
export type CalendarDecision = 'draft' | 'applied' | 'rejected';
export type CalendarPreviewMode = 'reflow_open' | 'fill_open' | 'restore_run';

export type SprintCalendarPreviewInput = {
  targetSlug: string;
  startDate: string;
  endDate: string;
  expectedRunId: number | null;
  mode: CalendarPreviewMode;
  restoreRunId?: number;
};

export async function previewSprintCalendar(
  input: SprintCalendarPreviewInput,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<SprintCalendarDocument> {
  return parseSprintCalendar(await requestJson('/api/v1/sprints/calendar/preview', {
    method: 'POST', signal,
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(input),
  }));
}
```

Reject duplicate dates/positions/item IDs, invalid confidence, inconsistent totals, placeholders with execution fields, missing hashes/version, and applied documents without `appliedAt`. Before sending a preview, require `restoreRunId` exactly when `mode === 'restore_run'`.

- [ ] **Step 4: Implement the pure view and minimal panel**

```ts
export function buildSprintCalendarView(document: SprintCalendarDocument): SprintCalendarView {
  return {
    runId: document.run.id,
    decision: document.run.decision,
    days: document.days.map((day) => ({
      date: day.date,
      label: day.precision === 'provisional' ? 'Provisório' : day.precision === 'protected' ? 'Protegido' : 'Exato',
      minutes: day.reservedMinutes,
      capacityMinutes: day.availableMinutes,
      itemCount: document.assignments.filter((item) => item.date === day.date).length,
      overCapacity: day.overageMinutes > 0,
    })),
  };
}
```

`SprintCalendarPanel` loads the head, shows 1–15 day buttons, exact/provisional/protected labels, capacity/load, warnings, Preview and Apply. It mounts above the existing daily Sprint surface; the current Planner remains available until Plan B.

- [ ] **Step 5: Run frontend tests, lint, and build**

```powershell
npx --no-install tsx --test src/study-os/api/sprintCalendar.test.ts src/study-os/domain/sprintCalendarView.test.ts src/study-os/components/SprintCalendarPanel.test.ts
npm run lint
npm run build
```

Expected: all exit 0; existing Vite chunk warnings may remain.

- [ ] **Step 6: Commit the vertical UI slice**

```powershell
git add src/study-os/api/sprintCalendar.ts src/study-os/api/sprintCalendar.test.ts src/study-os/domain/sprintCalendarView.ts src/study-os/domain/sprintCalendarView.test.ts src/study-os/components/SprintCalendarPanel.tsx src/study-os/components/SprintCalendarPanel.test.ts src/study-os/components/SprintCommandCenter.tsx
git commit -m "feat: show adaptive sprint calendar"
```

---

### Task 9: Durability, live migration, and Plan A gate

**Files:**
- Create: `tests/study_os_service/test_sprint_calendar_durability.py`
- Modify only if a gate exposes a tested defect: files covered by that defect.

**Interfaces:**
- Proves restart, backup/restore, portable archive, offline rendering, current-head linearity, and no synthetic Meta tasks.

- [ ] **Step 1: Write the failing restart/backup/restore scenario**

```python
def test_calendar_survives_restart_backup_restore_and_refresh(tmp_path):
    source = bootstrap_calendar_database(tmp_path)
    expected = create_apply_pin_complete_and_snapshot(source)
    backup = create_backup(source, tmp_path / "backups", NOW)
    source.close()
    restarted = connect_database(database_path(tmp_path))
    assert calendar_snapshot(restarted) == expected
    restored = connect_database(backup)
    assert restored.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    assert restored.execute("PRAGMA foreign_key_check").fetchall() == []
    assert calendar_snapshot(restored) == expected
```

- [ ] **Step 2: Run focused durability tests and verify RED, then implement only missing durability hooks**

Run: `.\.venv-study-os\Scripts\python.exe -m pytest -q tests\study_os_service\test_sprint_calendar_durability.py`

Expected before fixes: FAIL on the first uncovered restart/restore behavior. After the minimal covered fix: PASS.

- [ ] **Step 3: Create a fresh live pre-v12 backup and portable archive**

```powershell
.\.venv-study-os\Scripts\python.exe -m study_os_service.cli backup
.\.venv-study-os\Scripts\python.exe -m study_os_service.cli export --output C:\Backups\study-os-pre-calendar-v12.zip
Get-FileHash C:\Backups\study-os-pre-calendar-v12.zip -Algorithm SHA256
```

Open the produced SQLite backup read-only and require schema 11, `PRAGMA integrity_check = ok`, and empty `PRAGMA foreign_key_check`. Stop if any condition fails.

- [ ] **Step 4: Run the complete automated gate before touching live calendar state**

```powershell
.\.venv-study-os\Scripts\python.exe -m pytest -q
.\.venv-study-os\Scripts\python.exe -m compileall study_os_service
npm test
npm run lint
npm run build
git diff --check
```

Expected: all exit 0.

- [ ] **Step 5: Migrate the live local DB and generate only an unapplied preview**

Run the normal local-service initialization, verify schema 12/integrity/FKs, then preview the current 1–15 day window. Require:

```text
released LS tasks = exact
dates after latest released cycle = provisional capacity envelopes
duplicate source-task assignments = 0
future placeholders with Execute/material/evidence = 0
applied head changed by preview = false
```

- [ ] **Step 6: Validate desktop, 390 px, restart, and offline**

Open the real app with internet blocked. Confirm the minimal panel loads from the local service, labels exact/provisional/protected, shows capacity/load, never exposes Execute for placeholders, and reconnects to the same head after service restart.

- [ ] **Step 7: Commit the durability proof**

```powershell
git add tests/study_os_service/test_sprint_calendar_durability.py
git commit -m "test: prove sprint calendar durability"
```

- [ ] **Step 8: Final Plan A review**

Review merge-base through HEAD for spec compliance and code quality. Fix Critical/Important findings as one test-covered wave, rerun Step 4, and do not start Plan B until every gate is green.
