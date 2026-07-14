# Sprint V2 Evidence and Real Calibration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace manual and weakly sampled SEFAZ CE score guesses with an auditable post-edital evidence ledger, calibrated P1/P2 projections, bounded LS cycles, and a Command Center that pursues 204/240 weighted points without claiming certainty.

**Architecture:** Add an append-only evidence/import layer and explicit LS-cycle layer beside the existing sprint tables in schema v11. A pure projection service converts the latest revision of each aggregate observation into subject estimates with sample, measurement-kind, board, transferability, doubt, and 21-day recency weights; the sprint engine consumes those estimates, and day snapshots freeze the projection used. The React client remains a strict consumer of backend-owned projection/cycle contracts, while one local-only CLI converts authorized backups into aggregates and never persists proprietary question content.

**Tech Stack:** Python 3.11, FastAPI, raw SQLite migrations/repositories, pytest, React 19, TypeScript 5.8, Vite 6, Node test runner, Tailwind CSS 4.

## Global Constraints

- Work only in `C:\Docker\Diario-Questoes` on `codex/sefaz-ce-18d-sprint`; never alter `master` or revert user changes.
- Baseline is commit `9355914`; the pre-migration online SQLite backup is `data/study-os/backups/study-os-20260714T174456Z.sqlite3`, SHA-256 `DE21B3FFCD84A21F21662BC5543C1339EA840F8F7E23A7204C6E723C5E554B67`, with `integrity_check=ok`, zero FK violations, and schema 10.
- Do not mutate Supabase.
- Never store or transmit question statements, alternatives, answer keys, user answers, cookies, passwords, or other proprietary question/course content. Store only structure, provenance, and aggregate counts.
- Do not build a permanent LS or TEC scraper. Chrome access, if used for planning `119790`, is read-only and only sanitized aggregate rows leave the browser session.
- Weighted objective target is exactly `P1 + 2 * P2 = 204/240` (85%). Stretch trajectory is P1 `64/80` and P2 `70/80`; defensive floors remain P1 `48/80` and P2 `63/80`.
- Raw-equivalent projection must stay explicitly separate from FCC standardized official scoring.
- SEFAZ GO evidence is low-confidence. GO-specific LTE content has transferability zero; only method and trap-pattern signals may transfer as fragility evidence.
- Unknown-sample LS percentages remain low-confidence and cannot independently demote a subject. Demotion requires two recent representative exact-count sets with at least ten answered questions each.
- Evidence import is idempotent by batch and by source-record revision, reports duplicates/conflicts, and a dry run performs no durable write.
- Use test-first red/green/refactor for every behavior change and make a small savepoint commit after every clean task review.
- Final gate: `python -m pytest -q`, `python -m compileall study_os_service`, `npm test`, `npm run lint`, `npm run build`, then real-app desktop and 390px mobile validation.

## File Structure

- `study_os_service/domain/sprint_evidence.py`: immutable evidence, cycle, subject-estimate, and projection value objects plus validation.
- `study_os_service/repositories/sprint_evidence.py`: schema-v11 evidence, batch, cycle, backlog, and latest-revision queries.
- `study_os_service/services/subject_matching.py`: exact-first, ambiguity-safe discipline matching shared by plan and evidence imports.
- `study_os_service/services/sprint_evidence.py`: import preparation, idempotent transaction, provenance filtering, listing, and reports.
- `study_os_service/services/sprint_projection.py`: pure weighting/calibration and projection serialization.
- `study_os_service/services/source_plan_cycles.py`: cycle upsert, eligibility, expiry, and backlog recovery policy.
- `study_os_service/services/evidence_adapters.py`: local aggregate-only adapters for Diario backup, sanitized LS history, and SEFAZ GO baseline.
- `scripts/import_sprint_evidence.py`: local CLI entry point; reads an authorized local file and invokes services without network upload.
- Existing sprint domain/repository/service/API files: integrate the focused modules without moving unrelated code.
- `src/study-os/api/sprint.ts`: strict evidence/projection/cycle/trajectory DTOs, parsers, and requests.
- `src/study-os/components/SprintCommandCenter.tsx`: derived projection, cycle/backlog, confidence, fragility, audit, and explicit manual override UI.

---

### Task 1: Schema v11 and validated evidence/cycle domain

**Files:**
- Create: `study_os_service/domain/sprint_evidence.py`
- Modify: `study_os_service/db/migrations.py`
- Test: `tests/study_os_service/test_sprint_evidence_migration.py`
- Test: `tests/study_os_service/test_sprint_evidence_domain.py`

**Interfaces:**
- Produces: `SprintPerformanceObservation`, `SourcePlanCycle`, `SourcePlanBacklogCandidate`, `SubjectProjection`, `SprintProjection`.
- Produces tables: `sprint_evidence_import_batches`, `sprint_performance_observations`, `source_plan_cycles`, `source_plan_backlog_candidates`; adds nullable `source_cycle_id` to `source_plan_tasks`.

- [ ] **Step 1: Write failing schema-preservation and domain tests**

```python
def test_migration_11_preserves_v10_sprint_state_and_adds_evidence_cycle_tables(tmp_path):
    connection = migrated_connection(tmp_path, target_version=10)
    seed_v10_sprint_state(connection)
    MigrationRunner(connection).migrate()
    assert current_version(connection) == 11
    assert table_names(connection) >= {
        "sprint_evidence_import_batches",
        "sprint_performance_observations",
        "source_plan_cycles",
        "source_plan_backlog_candidates",
    }
    assert source_plan_snapshot(connection) == EXPECTED_V10_SNAPSHOT


def test_migration_11_updates_only_untouched_default_stretch_goals(tmp_path):
    connection = migrated_connection(tmp_path, target_version=10)
    seed_default_and_user_edited_configs(connection)
    MigrationRunner(connection).migrate()
    assert config_goals(connection, "sefaz_ce") == (48, 64, 63, 70)
    assert config_goals(connection, "user_edited") == USER_EDITED_GOALS


def test_observation_requires_consistent_aggregate_and_ordered_source_time():
    with pytest.raises(ValueError, match="percentage"):
        SprintPerformanceObservation(
            **VALID_OBSERVATION,
            correct_count=7,
            wrong_count=3,
            percentage_bp=6000,
        )


def test_cycle_rejects_reversed_dates():
    with pytest.raises(ValueError, match="cycle dates"):
        SourcePlanCycle(**VALID_CYCLE, starts_on=date(2026, 7, 18), ends_on=date(2026, 7, 17))
```

- [ ] **Step 2: Run migration/domain tests and verify RED**

Run: `\.\.venv-study-os\Scripts\python.exe -m pytest -q tests\study_os_service\test_sprint_evidence_migration.py tests\study_os_service\test_sprint_evidence_domain.py`

Expected: FAIL because schema version 11, the four tables, and the evidence/cycle value objects do not exist.

- [ ] **Step 3: Implement the value objects, then add migration 11**

Implement frozen/slot dataclasses with exact enum/date/count validation before adding SQL. `SprintProjection` calculates its weighted total only as `p1.projected + 2 * p2.projected` and exposes score kind `raw_weighted_equivalent_not_fcc_standardized`; no constructor accepts an already-computed conflicting weighted value.

```sql
CREATE TABLE sprint_evidence_import_batches (
  batch_id TEXT PRIMARY KEY CHECK (length(trim(batch_id)) > 0),
  target_slug TEXT NOT NULL REFERENCES exam_targets(target_slug) ON DELETE RESTRICT,
  origin TEXT NOT NULL CHECK (length(trim(origin)) > 0),
  payload_hash TEXT NOT NULL CHECK (length(payload_hash)=64),
  item_count INTEGER NOT NULL CHECK (item_count >= 0),
  inserted_count INTEGER NOT NULL CHECK (inserted_count >= 0),
  duplicate_count INTEGER NOT NULL CHECK (duplicate_count >= 0),
  conflict_count INTEGER NOT NULL CHECK (conflict_count >= 0),
  report_json TEXT NOT NULL CHECK (json_valid(report_json) AND json_type(report_json)='object'),
  imported_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW'))
);

CREATE TABLE sprint_performance_observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_slug TEXT NOT NULL REFERENCES exam_targets(target_slug) ON DELETE RESTRICT,
  batch_id TEXT NOT NULL REFERENCES sprint_evidence_import_batches(batch_id) ON DELETE RESTRICT,
  subject_profile_id INTEGER REFERENCES exam_subject_profiles(id) ON DELETE RESTRICT,
  subject_key TEXT,
  discipline TEXT NOT NULL CHECK (length(trim(discipline)) > 0),
  topic_hint TEXT NOT NULL DEFAULT '',
  observed_on TEXT NOT NULL CHECK (length(observed_on)=10 AND date(observed_on)=observed_on),
  origin TEXT NOT NULL CHECK (length(trim(origin)) > 0),
  source_record_id TEXT NOT NULL CHECK (length(trim(source_record_id)) > 0),
  source_revision TEXT NOT NULL CHECK (length(trim(source_revision)) > 0),
  source_updated_at TEXT NOT NULL CHECK (length(source_updated_at) >= 20),
  measurement_type TEXT NOT NULL CHECK (measurement_type IN (
    'full_exam','sectional_mock','unseen_set','mixed_set','error_review',
    'ls_percentage','sprint_action','baseline'
  )),
  exam_board TEXT NOT NULL DEFAULT '',
  correct_count INTEGER CHECK (correct_count IS NULL OR correct_count >= 0),
  wrong_count INTEGER CHECK (wrong_count IS NULL OR wrong_count >= 0),
  doubt_count INTEGER NOT NULL DEFAULT 0 CHECK (doubt_count >= 0),
  percentage_bp INTEGER CHECK (percentage_bp IS NULL OR percentage_bp BETWEEN 0 AND 10000),
  transfer_scope TEXT NOT NULL DEFAULT 'content' CHECK (transfer_scope IN ('content','method','trap_pattern')),
  transferability_bp INTEGER NOT NULL DEFAULT 10000 CHECK (transferability_bp BETWEEN 0 AND 10000),
  content_hash TEXT NOT NULL CHECK (length(content_hash)=64),
  provenance_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(provenance_json) AND json_type(provenance_json)='object'),
  created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW')),
  UNIQUE (target_slug, origin, source_record_id, source_revision),
  CHECK ((correct_count IS NULL) = (wrong_count IS NULL)),
  CHECK (correct_count IS NOT NULL OR percentage_bp IS NOT NULL),
  CHECK (correct_count IS NULL OR percentage_bp = ROUND(10000.0 * correct_count / MAX(1, correct_count + wrong_count))),
  CHECK (correct_count IS NULL OR doubt_count <= correct_count + wrong_count)
);

CREATE TABLE source_plan_cycles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_slug TEXT NOT NULL REFERENCES exam_targets(target_slug) ON DELETE RESTRICT,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('ls','trilha','manual')),
  plan_label TEXT NOT NULL CHECK (length(trim(plan_label)) > 0),
  meta_number INTEGER CHECK (meta_number IS NULL OR meta_number >= 0),
  released_at TEXT NOT NULL,
  starts_on TEXT NOT NULL CHECK (length(starts_on)=10 AND date(starts_on)=starts_on),
  ends_on TEXT NOT NULL CHECK (length(ends_on)=10 AND date(ends_on)=ends_on),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  imported_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW')),
  updated_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW')),
  UNIQUE (target_slug, source_kind, plan_label),
  CHECK (starts_on <= ends_on)
);

CREATE TABLE source_plan_backlog_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_slug TEXT NOT NULL REFERENCES exam_targets(target_slug) ON DELETE RESTRICT,
  source_cycle_id INTEGER NOT NULL REFERENCES source_plan_cycles(id) ON DELETE RESTRICT,
  source_plan_task_id INTEGER NOT NULL UNIQUE REFERENCES source_plan_tasks(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL CHECK (reason='cycle_closed_pending'),
  return_score_milli INTEGER NOT NULL CHECK (return_score_milli >= 0),
  state TEXT NOT NULL DEFAULT 'candidate' CHECK (state IN ('candidate','recovered','dismissed')),
  discovered_on TEXT NOT NULL CHECK (length(discovered_on)=10 AND date(discovered_on)=discovered_on),
  recovered_on TEXT CHECK (recovered_on IS NULL OR (length(recovered_on)=10 AND date(recovered_on)=recovered_on)),
  created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW')),
  updated_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW'))
);

ALTER TABLE source_plan_tasks ADD COLUMN source_cycle_id INTEGER REFERENCES source_plan_cycles(id) ON DELETE RESTRICT;
```

Add indexes for latest observation, subject/date, cycle/date, and backlog state. A latest-revision query orders each `(target, origin, source_record_id)` by `source_updated_at DESC, id DESC`, so importing an older snapshot later cannot replace a known newer result. Conditionally update only the untouched original SEFAZ default tuple `(48,48,52,63,67)` to `(48,48,64,63,70)`.

- [ ] **Step 4: Run domain and migration GREEN tests**

The tests cover exact-count consistency, unknown-sample percentages, doubt bounds, transfer scope, source timestamp, date order, immutable tuples, weighted target 204, and rejection of invalid enums. Run:

`\.\.venv-study-os\Scripts\python.exe -m pytest -q tests\study_os_service\test_sprint_evidence_domain.py tests\study_os_service\test_sprint_evidence_migration.py`

Expected: PASS.

- [ ] **Step 5: Commit the schema/domain savepoint**

```powershell
git add study_os_service/domain/sprint_evidence.py study_os_service/db/migrations.py tests/study_os_service/test_sprint_evidence_domain.py tests/study_os_service/test_sprint_evidence_migration.py
git commit -m "feat: add sprint evidence and cycle schema"
```

---

### Task 2: Idempotent evidence import and exact-first subject mapping

**Files:**
- Create: `study_os_service/services/subject_matching.py`
- Create: `study_os_service/repositories/sprint_evidence.py`
- Create: `study_os_service/services/sprint_evidence.py`
- Modify: `study_os_service/services/sprint.py`
- Modify: `study_os_service/api/sprints.py`
- Test: `tests/study_os_service/test_sprint_evidence_api.py`
- Test: `tests/study_os_service/test_sprint_profile_source_api.py`

**Interfaces:**
- Produces: `SprintEvidenceService.import_batch(payload)`, `list_observations(target_slug)`.
- Produces: `POST /api/v1/sprints/evidence/import`, `GET /api/v1/sprints/evidence?targetSlug=...`.
- Produces report fields: `batchId`, `dryRun`, `replayed`, `insertedCount`, `duplicateCount`, `conflictCount`, `unresolvedCount`, `items`.

- [ ] **Step 1: Write failing API/import behavior tests**

```python
def test_economia_exact_alias_never_maps_to_financas_publicas(client):
    result = import_evidence(client, observation(discipline="Economia"))
    assert result["items"][0]["subjectKey"] == "p1_economia"


def test_dry_run_reports_without_writing_and_reimport_is_duplicate(client):
    payload = evidence_batch(batch_id="ls-47-v1", dry_run=True)
    preview = client.post("/api/v1/sprints/evidence/import", json=payload).json()
    assert preview["insertedCount"] == 1
    assert list_evidence(client) == []
    payload["dryRun"] = False
    assert client.post("/api/v1/sprints/evidence/import", json=payload).json()["insertedCount"] == 1
    replay = client.post("/api/v1/sprints/evidence/import", json=payload).json()
    assert replay["replayed"] is True


def test_same_source_revision_with_changed_aggregate_is_a_conflict(client):
    first = evidence_batch(batch_id="a")
    second = evidence_batch(batch_id="b", correct_count=7, wrong_count=3)
    assert client.post("/api/v1/sprints/evidence/import", json=first).status_code == 201
    report = client.post("/api/v1/sprints/evidence/import", json=second).json()
    assert report["conflictCount"] == 1
    assert len(list_evidence(client)) == 1


def test_same_batch_id_with_a_different_payload_is_409(client):
    first = evidence_batch(batch_id="stable-batch")
    changed = evidence_batch(batch_id="stable-batch", source_revision="v2")
    assert client.post("/api/v1/sprints/evidence/import", json=first).status_code == 201
    response = client.post("/api/v1/sprints/evidence/import", json=changed)
    assert response.status_code == 409
    assert response.json()["code"] == "evidence_batch_conflict"
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `\.\.venv-study-os\Scripts\python.exe -m pytest -q tests\study_os_service\test_sprint_evidence_api.py tests\study_os_service\test_sprint_profile_source_api.py -k "Economia or evidence"`

Expected: FAIL because endpoints/modules are absent and the existing matcher uses substring-first behavior.

- [ ] **Step 3: Implement exact-first, ambiguity-safe matching**

```python
def match_subject(discipline: str, subjects: Sequence[ExamSubjectProfile]) -> SubjectMatch:
    candidate = normalize_subject_text(discipline)
    exact = {subject.subject_key for subject in subjects for alias in aliases(subject) if normalize_subject_text(alias) == candidate}
    if len(exact) == 1:
        return SubjectMatch(next(iter(exact)), "exact")
    if len(exact) > 1:
        return SubjectMatch(None, "ambiguous")
    approximate = {
        subject.subject_key
        for subject in subjects
        for alias in aliases(subject)
        if token_phrase_match(candidate, normalize_subject_text(alias))
    }
    return SubjectMatch(next(iter(approximate)), "approximate") if len(approximate) == 1 else SubjectMatch(None, "ambiguous" if approximate else "unresolved")
```

Use this function in both `SourcePlanService` and `SprintEvidenceService`; never resolve a multi-match by alias length.

- [ ] **Step 4: Implement batch transaction and strict provenance filter**

Accepted observation JSON is aggregate-only:

```json
{
  "discipline": "Economia",
  "topicHint": "Microeconomia",
  "observedOn": "2026-07-14",
  "sourceRecordId": "meta47-task12",
  "sourceRevision": "2026-07-14T10:00:00Z",
  "sourceUpdatedAt": "2026-07-14T10:00:00Z",
  "measurementType": "ls_percentage",
  "examBoard": "FCC",
  "correctCount": null,
  "wrongCount": null,
  "doubtCount": 0,
  "percentageBp": 7800,
  "transferScope": "content",
  "transferabilityBp": 10000,
  "provenance": {"planningId": "119790", "metaNumber": 47}
}
```

Accept only the top-level keys in the documented observation schema; reject extras. Bound `discipline` to one line/120 characters and `topicHint` to one line/200 characters. Provenance is a flat scalar-only object whose only allowed keys are `planningId`, `metaNumber`, `sourceTaskId`, `sourceOrder`, `provider`, `importFileSha256`, `timestampQuality`, `originalScheduledDate`, and `sourceKind`; reject every other key even when its name appears benign, all nested objects/arrays, line breaks, and scalar strings over 200 characters. Adapters construct this payload field-by-field and never forward arbitrary source dictionaries. Compute a canonical content hash after normalization. Begin the transaction before looking up the batch so concurrent replay is deterministic. Dry-run uses the same validation/matching/dedup queries but always rolls back and never stores a batch. Expose a repository-level `append_observation_in_transaction(...)` primitive that assumes the caller owns the transaction; `import_batch` wraps that primitive rather than nesting transactions.

- [ ] **Step 5: Add routes/error contracts and run focused/full sprint tests**

Run:

```powershell
.\.venv-study-os\Scripts\python.exe -m pytest -q tests\study_os_service\test_sprint_evidence_api.py tests\study_os_service\test_sprint_profile_source_api.py
.\.venv-study-os\Scripts\python.exe -m pytest -q tests\study_os_service\test_sprint_api.py tests\study_os_service\test_sprint_engine.py
```

Expected: PASS.

- [ ] **Step 6: Commit the evidence-import savepoint**

```powershell
git add study_os_service/services/subject_matching.py study_os_service/repositories/sprint_evidence.py study_os_service/services/sprint_evidence.py study_os_service/services/sprint.py study_os_service/api/sprints.py tests/study_os_service/test_sprint_evidence_api.py tests/study_os_service/test_sprint_profile_source_api.py
git commit -m "feat: import auditable sprint evidence"
```

---

### Task 3: Calibrated projection service and API

**Files:**
- Create: `study_os_service/services/sprint_projection.py`
- Modify: `study_os_service/repositories/sprint_evidence.py`
- Modify: `study_os_service/api/sprints.py`
- Test: `tests/study_os_service/test_sprint_projection.py`
- Test: `tests/study_os_service/test_sprint_evidence_api.py`

**Interfaces:**
- Produces: `SprintProjectionService.project(target_slug, as_of)`.
- Produces: `GET /api/v1/sprints/projection?targetSlug=sefaz_ce&asOf=YYYY-MM-DD`.
- Formula version: `sefaz-ce-projection-v2`; interval is a labeled 90% raw-equivalent interval.

- [ ] **Step 1: Write failing calibration acceptance tests**

```python
def test_small_perfect_set_cannot_create_a_perfect_projection(service):
    add_exact(service, kind="unseen_set", correct=3, wrong=0)
    projection = service.project(TARGET, AS_OF)
    assert projection.subject("p1_economia").estimate_bp < 9000
    assert projection.confidence_bp < 5000


def test_three_high_error_reviews_do_not_raise_direct_projection(service):
    before = service.project(TARGET, AS_OF).subject("p2_lte").estimate_bp
    for day in range(3):
        add_exact(service, kind="error_review", correct=10, wrong=0, day=day)
    after = service.project(TARGET, AS_OF).subject("p2_lte")
    assert after.estimate_bp == before
    assert after.fragility_bp > 0


def test_representative_simulation_outweighs_unknown_sample_ls_percentage(service):
    add_percentage(service, kind="ls_percentage", percentage_bp=9900)
    add_exact(service, kind="sectional_mock", correct=12, wrong=8)
    assert service.project(TARGET, AS_OF).subject(KEY).estimate_bp < 8000


def test_doubts_raise_fragility_even_when_answers_are_correct(service):
    add_exact(service, kind="unseen_set", correct=10, wrong=0, doubts=6)
    assert service.project(TARGET, AS_OF).subject(KEY).fragility_bp >= 5000


def test_go_lte_content_has_zero_projection_transfer(service):
    add_exact(service, origin="sefaz_go", subject="p2_lte", correct=20, wrong=0, transferability_bp=0)
    projection = service.project(TARGET, AS_OF).subject("p2_lte")
    assert projection.dominant_origin != "sefaz_go"


def test_as_of_ignores_future_observations(service):
    add_exact(service, observed_on="2026-07-15", correct=20, wrong=0)
    projection = service.project(TARGET, date(2026, 7, 14))
    assert projection.subject(KEY).effective_sample == 0


def test_demotion_requires_two_recent_representative_sets_of_ten(service):
    add_percentage(service, kind="ls_percentage", percentage_bp=10000)
    add_exact(service, kind="unseen_set", correct=10, wrong=0)
    assert service.project(TARGET, AS_OF).subject(KEY).demotion_eligible is False
    add_exact(service, kind="sectional_mock", correct=10, wrong=0, source_record_id="second")
    assert service.project(TARGET, AS_OF).subject(KEY).demotion_eligible is True


def test_old_representative_set_does_not_count_for_demotion(service):
    add_exact(service, kind="unseen_set", correct=10, wrong=0, observed_on="2026-06-01")
    add_exact(service, kind="sectional_mock", correct=10, wrong=0, observed_on="2026-07-14", source_record_id="recent")
    assert service.project(TARGET, date(2026, 7, 14)).subject(KEY).demotion_eligible is False
```

- [ ] **Step 2: Run tests and verify RED**

Run: `\.\.venv-study-os\Scripts\python.exe -m pytest -q tests\study_os_service\test_sprint_projection.py`

Expected: FAIL because projection service is absent.

- [ ] **Step 3: Implement the deterministic weighting formula**

Use these exact constants:

```python
MEASUREMENT_WEIGHT = {
    "full_exam": 1.00,
    "sectional_mock": 0.90,
    "unseen_set": 0.75,
    "mixed_set": 0.60,
    "sprint_action": 0.65,
    "ls_percentage": 0.15,
    "baseline": 0.20,
    "error_review": 0.00,
}
BOARD_WEIGHT = {"FCC": 1.00, "": 0.85}
RECENCY_HALF_LIFE_DAYS = 21
UNKNOWN_SAMPLE_EQUIVALENT_N = 2.0
PRIOR_EQUIVALENT_N = 12.0
INTERVAL_Z = 1.645
REPRESENTATIVE_TYPES = frozenset({"full_exam", "sectional_mock", "unseen_set", "mixed_set"})
REPRESENTATIVE_RECENCY_DAYS = 21
```

Query only observations with `observed_on <= as_of`, select the greatest `source_updated_at` for each `(target, origin, source_record_id)`, and calculate `recency = 0.5 ** (age_days / 21)` with non-negative age. Multiply by measurement, board (`0.70` for a known non-FCC board), and transferability. Exact-count observations contribute at most 80 effective questions each; unknown-sample percentages contribute at most two. `error_review`, `method`, and `trap_pattern` affect fragility only. If no explicit `baseline` observation exists for a subject, use its profile baseline (or 50%) as the 12-question statistical prior. Once a baseline observation exists, use a neutral 50% smoothing prior and treat that observation as the sole imported baseline signal, preventing double counting; zero-transfer GO LTE content therefore cannot move the mean. Calculate a bounded posterior mean and normal-approximation 90% interval. Confidence derives only from effective observed sample: `round(9500 * (1 - exp(-effective_n / 30)))`. Demotion counts only the named representative types, each with at least ten exact answers and `0 <= age_days <= 21`.

Aggregate paper points as `sum(subject.question_count * subject.mean)`, then `weighted = P1 + 2 * P2`, target `204`, and `distance = 204 - weighted`. Return subject estimates, interval, effective sample, confidence, representative-set count, demotion eligibility, doubt fragility, dominant origin, and warnings.

- [ ] **Step 4: Add strict projection route and run tests**

Expected response core:

```json
{
  "targetSlug": "sefaz_ce",
  "asOf": "2026-07-14",
  "formulaVersion": "sefaz-ce-projection-v2",
  "scoreKind": "raw_weighted_equivalent_not_fcc_standardized",
  "p1": {"projected": 0, "low": 0, "high": 0, "floor": 48, "stretch": 64},
  "p2": {"projected": 0, "low": 0, "high": 0, "floor": 63, "stretch": 70},
  "weighted": {"projected": 0, "low": 0, "high": 0, "target": 204, "distanceToTarget": 204},
  "confidenceBp": 0,
  "dominantOrigin": "baseline",
  "subjects": []
}
```

Run: `\.\.venv-study-os\Scripts\python.exe -m pytest -q tests\study_os_service\test_sprint_projection.py tests\study_os_service\test_sprint_evidence_api.py`

Expected: PASS.

- [ ] **Step 5: Commit the projection savepoint**

```powershell
git add study_os_service/services/sprint_projection.py study_os_service/repositories/sprint_evidence.py study_os_service/api/sprints.py tests/study_os_service/test_sprint_projection.py tests/study_os_service/test_sprint_evidence_api.py
git commit -m "feat: derive calibrated sprint projections"
```

---

### Task 4: Projection-owned sprint engine and frozen day snapshots

**Files:**
- Modify: `study_os_service/services/sprint_engine.py`
- Modify: `study_os_service/services/sprint_day.py`
- Test: `tests/study_os_service/test_sprint_engine.py`
- Test: `tests/study_os_service/test_sprint_api.py`
- Test: `tests/study_os_service/test_sprint_projection.py`

**Interfaces:**
- `SprintEngine.generate(..., subject_projections: Mapping[str, SubjectProjection], projection: SprintProjection)` replaces recent-three-task averaging.
- Day generation derives projection when both manual fields are absent. Both numeric fields together are a backward-compatible manual override and freeze `projectionOrigin="manual"`.

- [ ] **Step 1: Write failing engine/snapshot integration tests**

Cover: derived generation without 42/55; partial override returns 422; full manual override is visibly marked; high doubt increases action priority without reducing its score estimate; two LS percentages cannot demote focus; representative calibrated estimates determine gain/deficit; complete projection/interval/confidence/formula is frozen in the run snapshot.

- [ ] **Step 2: Verify RED**

Run: `\.\.venv-study-os\Scripts\python.exe -m pytest -q tests\study_os_service\test_sprint_engine.py tests\study_os_service\test_sprint_api.py -k "projection or doubt or override or snapshot"`

Expected: FAIL on old 42/55 fallback, partial override acceptance, and recent-three averaging.

- [ ] **Step 3: Replace `_estimate` and `_at_goal_twice` inputs**

```python
def _estimate(subject: ExamSubjectProfile, projections: Mapping[str, SubjectProjection]) -> tuple[int, int]:
    projection = projections[subject.subject_key]
    return projection.estimate_bp, projection.confidence_bp


def _at_goal_twice(subject: ExamSubjectProfile, projections: Mapping[str, SubjectProjection]) -> bool:
    projection = projections[subject.subject_key]
    return projection.demotion_eligible and projection.estimate_bp >= subject.target_low_bp
```

Add a bounded fragility bonus to gain/deficit so doubts can raise priority without pretending the estimated score fell. Set `algorithm_version = "sefaz-ce-sprint-v2"`.

- [ ] **Step 4: Derive or explicitly override and freeze the projection**

```python
derived = SprintProjectionService(connection).project(target_slug, plan_date)
manual_values = (prepared["p1_projection"], prepared["p2_projection"])
if (manual_values[0] is None) != (manual_values[1] is None):
    raise ValueError("P1 and P2 manual projections must be supplied together")
if manual_values == (None, None):
    effective = derived
    projection_origin = "derived"
else:
    effective = derived.with_manual_papers(float(manual_values[0]), float(manual_values[1]))
    projection_origin = "manual"
```

Persist the complete projection document and origin in `score_snapshot_json`; never fall back to hidden 42/55 values. Existing v1 snapshots remain readable.

- [ ] **Step 5: Run engine/API regression and commit**

```powershell
.\.venv-study-os\Scripts\python.exe -m pytest -q tests\study_os_service\test_sprint_engine.py tests\study_os_service\test_sprint_api.py tests\study_os_service\test_sprint_projection.py
git add study_os_service/services/sprint_engine.py study_os_service/services/sprint_day.py tests/study_os_service/test_sprint_engine.py tests/study_os_service/test_sprint_api.py tests/study_os_service/test_sprint_projection.py
git commit -m "feat: drive sprint with calibrated projections"
```

---

### Task 5: Atomic action evidence and auditable trajectory

**Files:**
- Modify: `study_os_service/services/sprint_day.py`
- Modify: `study_os_service/services/sprint_evidence.py`
- Modify: `study_os_service/repositories/sprint_evidence.py`
- Modify: `study_os_service/repositories/sprint.py`
- Modify: `study_os_service/api/sprints.py`
- Test: `tests/study_os_service/test_sprint_api.py`
- Test: `tests/study_os_service/test_sprint_projection.py`

**Interfaces:**
- Finalized question-bearing actions create one internal batch plus one aggregate observation in the same caller-owned transaction.
- Trajectory exposes v2 projection snapshots while preserving v1 run readability.

- [ ] **Step 1: Write failing atomicity/replay/trajectory tests**

Cover: completed representative simulation changes projection more than an error review; internal batch ID is `sprint-action:{action_id}:v{resulting_version}`; replayed result creates neither a second batch nor observation; forced observation failure rolls back the action update; no question refs/answers enter provenance; trajectory exposes P1/P2 intervals, confidence, weighted total, distance, formula, and origin; old v1 snapshots return explicit `legacy_manual` metadata rather than crashing.

- [ ] **Step 2: Verify RED**

Run: `\.\.venv-study-os\Scripts\python.exe -m pytest -q tests\study_os_service\test_sprint_api.py tests\study_os_service\test_sprint_projection.py -k "action_evidence or trajectory or rollback or replay"`

Expected: FAIL because action results do not append ledger evidence and trajectory is v1-only.

- [ ] **Step 3: Append through transaction-aware repository primitives**

Inside the existing `BEGIN IMMEDIATE` for an action result, create/reuse the internal batch and call `append_observation_in_transaction` directly; neither helper begins or commits. Stable source record is `sprint-action:{action_id}`, revision is `v{resulting_version}`, `source_updated_at` is the action update UTC timestamp, and measurement type is `sectional_mock` for simulations, `error_review` for reviews, otherwise `sprint_action`. Batch and observation failure roll back together with the action.

- [ ] **Step 4: Extend trajectory without rewriting old runs**

Return `latest` plus runs with `projection`, `projectionOrigin`, `confidenceBp`, `weightedProjected`, `distanceToTarget`, `dominantOrigin`, and `formulaVersion`. A snapshot lacking v2 fields receives `projectionOrigin="legacy_manual"`, null interval/confidence, and its stored P1/P2 only.

- [ ] **Step 5: Run focused/backend regression and commit**

```powershell
.\.venv-study-os\Scripts\python.exe -m pytest -q tests\study_os_service\test_sprint_api.py tests\study_os_service\test_sprint_projection.py tests\study_os_service\test_sprint_evidence_api.py
.\.venv-study-os\Scripts\python.exe -m pytest -q tests\study_os_service
git add study_os_service/services/sprint_day.py study_os_service/services/sprint_evidence.py study_os_service/repositories/sprint_evidence.py study_os_service/repositories/sprint.py study_os_service/api/sprints.py tests/study_os_service/test_sprint_api.py tests/study_os_service/test_sprint_projection.py
git commit -m "feat: record sprint outcomes as evidence"
```

---

### Task 6: Source-plan cycles, eligibility, and explicit backlog

**Files:**
- Create: `study_os_service/services/source_plan_cycles.py`
- Modify: `study_os_service/repositories/sprint_evidence.py`
- Modify: `study_os_service/repositories/sprint.py`
- Modify: `study_os_service/domain/sprint.py`
- Modify: `study_os_service/services/sprint.py`
- Modify: `study_os_service/services/sprint_day.py`
- Modify: `study_os_service/api/sprints.py`
- Test: `tests/study_os_service/test_source_plan_cycles.py`
- Test: `tests/study_os_service/test_sprint_profile_source_api.py`
- Test: `tests/study_os_service/test_sprint_api.py`

**Interfaces:**
- Extends `POST /source-plans/import` with `cycle: {releasedAt, startsOn, endsOn}`.
- Source-task payload adds `cycle` and nullable `backlog` documents.
- `SourcePlanCycleService.eligible_tasks(target_slug, plan_date)` returns `SourcePlanEligibility(task, cycle, backlog)` records and is the only source-task selector used by day generation. `SprintDayService` passes each `.task` to the engine and freezes cycle/backlog audit metadata in action evidence; source-plan API serialization returns the same cycle/backlog context.

- [ ] **Step 1: Write failing cycle acceptance tests**

```python
def test_meta_47_never_yields_tasks_after_july_17(service):
    import_meta(service, 47, cycle=("2026-07-11", "2026-07-11", "2026-07-17"), task_dates=["2026-07-17", "2026-07-21"])
    assert service.eligible_tasks(TARGET, date(2026, 7, 18)) == ()
    assert all(task.scheduled_date is None or task.scheduled_date <= date(2026, 7, 17) for task in service.list_tasks(TARGET))


def test_meta_48_can_be_imported_on_release_but_not_used_before_july_18(service):
    import_meta(service, 48, cycle=("2026-07-17T08:00:00-03:00", "2026-07-18", "2026-07-24"))
    assert service.eligible_tasks(TARGET, date(2026, 7, 17)) == ()
    assert service.eligible_tasks(TARGET, date(2026, 7, 18))


def test_closed_pending_tasks_become_explicit_backlog_candidates(service):
    import_pending_high_and_low_return_meta(service)
    eligible = service.eligible_tasks(TARGET, date(2026, 7, 18))
    assert all(task.backlog is not None for task in eligible)
    assert {task.external_task_id for task in eligible} == {"high-return"}
    assert service.list_backlog(TARGET, include_all=True).count == 2
```

- [ ] **Step 2: Verify RED**

Run: `\.\.venv-study-os\Scripts\python.exe -m pytest -q tests\study_os_service\test_source_plan_cycles.py`

Expected: FAIL because cycles/backlog are not implemented.

- [ ] **Step 3: Implement cycle import and overrun normalization**

Validate `releasedAt`, `startsOn`, `endsOn`, and `startsOn <= endsOn`. Upsert by `(target, sourceKind, planLabel)` only when the exact cycle agrees; a conflicting reimport returns 409 rather than silently changing dates. Link every imported task. If its supplied `scheduledDate > endsOn`, store the original in aggregate-safe provenance as `originalScheduledDate`, set durable `scheduled_date=NULL`, and report `cycleOverrunCount`.

- [ ] **Step 4: Implement eligibility/backlog policy**

Before selection, insert one backlog row for each pending/started task whose cycle ended before `plan_date`. Normal tasks are eligible only while `starts_on <= plan_date <= ends_on` and when unscheduled/overrun or due on/before the day. Closed-cycle recovery requires `return_score_milli >= 1000`, computed deterministically from relevance, paper weight, calibrated deficit, and fragility; low-return rows remain visible backlog but are not selected. Mark a candidate `recovered` only when its generated action is accepted/completed, not merely when displayed. D-2/D-1 engine modes retain precedence over ordinary cycle ordering.

- [ ] **Step 5: Run cycle and sprint regression**

```powershell
.\.venv-study-os\Scripts\python.exe -m pytest -q tests\study_os_service\test_source_plan_cycles.py tests\study_os_service\test_sprint_profile_source_api.py tests\study_os_service\test_sprint_api.py tests\study_os_service\test_sprint_engine.py
```

Expected: PASS.

- [ ] **Step 6: Commit the cycle savepoint**

```powershell
git add study_os_service/services/source_plan_cycles.py study_os_service/repositories/sprint_evidence.py study_os_service/repositories/sprint.py study_os_service/domain/sprint.py study_os_service/services/sprint.py study_os_service/services/sprint_day.py study_os_service/api/sprints.py tests/study_os_service/test_source_plan_cycles.py tests/study_os_service/test_sprint_profile_source_api.py tests/study_os_service/test_sprint_api.py
git commit -m "feat: bound LS cycles and preserve backlog"
```

---

### Task 7: Local aggregate-only adapters and import CLI

**Files:**
- Create: `study_os_service/services/evidence_adapters.py`
- Create: `scripts/import_sprint_evidence.py`
- Test: `tests/study_os_service/test_evidence_adapters.py`
- Test: `tests/study_os_service/test_evidence_import_cli.py`

**Interfaces:**
- `observations_from_diario_backup(document, target_slug, snapshot_at)`.
- `observations_from_ls_history(document, target_slug, planning_id)`.
- `sefaz_go_baseline_observations(subjects)`.
- CLI formats: `diario-backup`, `ls-history`, `sefaz-go-baseline`; flags `--input`, `--target-slug`, `--batch-id`, `--snapshot-at`, `--dry-run`.

- [ ] **Step 1: Write failing sanitization/aggregation tests**

```python
def test_diario_adapter_counts_results_but_never_emits_question_content():
    document = [{
        "id": "task-1", "date": "2026-07-14", "discipline": "Economia",
        "blocks": [{"id": "b1", "title": "Micro", "questions": [
            {"statement": "PROPRIETARY", "alternatives": [{"text": "SECRET"}], "correctAnswer": "A", "answer": "A", "isCorrect": True, "hasDoubt": True},
            {"statement": "PROPRIETARY-2", "isCorrect": False, "hasDoubt": False},
        ]}],
    }]
    observations = observations_from_diario_backup(document, "sefaz_ce", datetime(2026, 7, 14, tzinfo=UTC))
    encoded = json.dumps([item.to_payload() for item in observations])
    assert observations[0].correct_count == 1
    assert observations[0].wrong_count == 1
    assert observations[0].doubt_count == 1
    assert "PROPRIETARY" not in encoded and "SECRET" not in encoded


def test_missing_target_requires_explicit_cli_target_and_missing_updated_at_uses_hash_revision():
    with pytest.raises(ValueError, match="target"):
        observations_from_diario_backup(BACKUP, "", datetime(2026, 7, 14, tzinfo=UTC))
    first = observations_from_diario_backup(BACKUP, "sefaz_ce", datetime(2026, 7, 14, tzinfo=UTC))
    second = observations_from_diario_backup(BACKUP, "sefaz_ce", datetime(2026, 7, 14, tzinfo=UTC))
    assert first[0].source_revision == second[0].source_revision


def test_go_lte_baseline_content_is_nontransferable():
    lte = next(item for item in sefaz_go_baseline_observations(SUBJECTS) if item.subject_key == "p2_lte")
    assert lte.transferability_bp == 0
```

- [ ] **Step 2: Verify RED**

Run: `\.\.venv-study-os\Scripts\python.exe -m pytest -q tests\study_os_service\test_evidence_adapters.py tests\study_os_service\test_evidence_import_cli.py`

Expected: FAIL because adapters/CLI are absent.

- [ ] **Step 3: Implement local-only aggregation**

For Diario backup, produce one observation per task block with answered questions only: `correct_count = count(isCorrect is True)`, `wrong_count = count(isCorrect is False)`, `doubt_count = count(hasDoubt is True among answered)`. Construct a new allowlisted record from task/block IDs, dates, bounded one-line discipline, bounded one-line structural title/lesson, board label, and aggregate counts; never spread/copy source dictionaries or any nested question field. Stable record is `diario:{task.id}:{block.id}`; revision is `updatedAt` when present, otherwise the SHA-256 of the aggregate-only record. `sourceUpdatedAt` is the task timestamp when present and otherwise the required CLI `--snapshot-at` timestamp, so revisions remain chronologically ordered. Unknown target never defaults silently.

For sanitized LS history, accept only the evidence endpoint shape plus planning/meta/task IDs; percentages without counts remain `ls_percentage`. For baseline, generate one low-confidence `baseline` record per subject profile and force `p2_lte` content transferability to zero.

- [ ] **Step 4: Implement dry-run-first CLI and tests**

The CLI opens the local configured SQLite through project services, never uses HTTP, never reads browser/session state, and prints only the aggregate import report. It requires a second invocation without `--dry-run` to commit. It must not log the source document or rejected proprietary fields.

Run focused tests, then:

`\.\.venv-study-os\Scripts\python.exe -m pytest -q tests\study_os_service\test_evidence_adapters.py tests\study_os_service\test_evidence_import_cli.py tests\study_os_service\test_sprint_evidence_api.py`

Expected: PASS.

- [ ] **Step 5: Commit the adapter savepoint**

```powershell
git add study_os_service/services/evidence_adapters.py scripts/import_sprint_evidence.py tests/study_os_service/test_evidence_adapters.py tests/study_os_service/test_evidence_import_cli.py
git commit -m "feat: add safe local evidence adapters"
```

---

### Task 8: Strict frontend contracts and auditable Command Center

**Files:**
- Modify: `src/study-os/api/sprint.ts`
- Modify: `src/study-os/api/sprint.test.ts`
- Modify: `src/study-os/components/SprintCommandCenter.tsx`
- Modify: `src/study-os/components/SprintCommandCenter.test.ts`
- Modify: `src/study-os/sourcePlanBridge.ts`
- Modify: `src/study-os/sourcePlanBridge.test.ts`

**Interfaces:**
- Adds strict DTOs/parsers/fetchers for `SprintProjection`, `SprintEvidenceList`, `SprintTrajectory`, `SourcePlanCycle`, and backlog metadata.
- `SprintCommandCenter` loads config, optional day, projection, trajectory, evidence summary, and `fetchSourcePlanTasks(targetSlug, undefined, true)` together, so cycle/backlog remain visible even when no day exists.

- [ ] **Step 1: Write failing strict parser/request tests**

Cover exact projection/evidence/trajectory/cycle documents, malformed nested intervals/confidence rejection, `asOf` URL, evidence import body, cycle import body, and preservation of abort signals/idempotency headers.

- [ ] **Step 2: Write failing Command Center/source tests**

Assert that source contains visible labels `204/240`, `85%`, `equivalente bruto`, `não é a nota padronizada da FCC`, `Confiança`, `Fragilidade`, `Ciclo vigente`, `Backlog da meta encerrada`, `Por que agora`, `Origem dominante`, and an explicit `Usar override manual` control. Assert that initial `useState(42)` and `useState(55)` no longer exist. Assert cycle-overrun tasks do not hydrate calendar dates after `endsOn`.

- [ ] **Step 3: Verify RED**

Run:

```powershell
npx --no-install tsx --test src/study-os/api/sprint.test.ts src/study-os/components/SprintCommandCenter.test.ts src/study-os/sourcePlanBridge.test.ts
```

Expected: FAIL on missing contracts/labels and old 42/55 defaults.

- [ ] **Step 4: Implement strict contracts and derived-first state**

Load projection as authoritative. Keep override inputs unset until the user enables the manual control; send no P1/P2 override fields in derived mode. Render P1/P2 projected/interval/floor/stretch, weighted projected/204/distance, confidence, dominant origin, formula version, and the FCC distinction. The day audit shows run ID, generation time, algorithm, supersession/replay, and whether projection origin is derived/manual.

Render current cycle release/start/end and status. Show pending closed-meta backlog with original cycle label and return rationale. Each action shows confidence and fragility badge beside the existing `whyNow`; its details list every rationale rather than only the first twelve scalar fields.

- [ ] **Step 5: Keep responsive hierarchy and verify frontend**

At mobile widths, keep the next executable queue before trajectory/evidence detail, use two compact metric columns, and confine dense history to internal horizontal scrolling. Run:

```powershell
npm test
npm run lint
npm run build
```

Expected: PASS; only the pre-existing Vite large-chunk/dynamic-import warnings may remain.

- [ ] **Step 6: Commit the frontend savepoint**

```powershell
git add src/study-os/api/sprint.ts src/study-os/api/sprint.test.ts src/study-os/components/SprintCommandCenter.tsx src/study-os/components/SprintCommandCenter.test.ts src/study-os/sourcePlanBridge.ts src/study-os/sourcePlanBridge.test.ts
git commit -m "feat: show auditable sprint calibration"
```

---

### Task 9: Authorized live backfill, cycle repair, and full production gate

**Files:**
- Create locally only under ignored `data/study-os/imports/`: sanitized LS-history aggregate export and reports.
- Modify tracked files only if a failing acceptance test or review finding requires a tested fix.
- Test: all suites plus real app.

**Interfaces:**
- Durable local DB reaches schema 11 only after the verified schema-10 backup.
- Live evidence import reports are retained in SQLite batches; no proprietary source file is committed.

- [ ] **Step 1: Apply schema 11 and verify the protected database**

Run health/initialize only now that the backup exists. Verify `PRAGMA integrity_check`, `foreign_key_check`, schema version 11, and preserved counts for Meta 46/47 and all pre-v11 command tables.

- [ ] **Step 2: Repair Meta 47 cycle and preview Meta 48/49 rules**

Attach Meta 47 to `releasedAt=2026-07-11`, `startsOn=2026-07-11`, `endsOn=2026-07-17`; preserve completed/ignored states and null only out-of-cycle future scheduled dates while recording originals in provenance. Exercise fixture imports proving Meta 48 release `2026-07-17`, eligibility `2026-07-18`, and Meta 49 `2026-07-25..2026-07-31`; do not fabricate live Meta 48/49 tasks before they exist.

- [ ] **Step 3: Import the Diario backup dry-run then commit**

Use explicit target `sefaz_ce` and deterministic batch ID based on the file hash. Compare dry-run and committed inserted/duplicate/conflict/unresolved counts. Re-run the same batch and require replay with no additional observations. Inspect the stored projection/evidence JSON to prove none of `statement`, `alternatives`, `correctAnswer`, or `answer` exists.

- [ ] **Step 4: Read LS planning 119790 only if Chrome is already authenticated**

Navigate read-only from 24/04/2026 through the current meta. Capture only planning ID, meta, task ID/order, discipline/topic label, aggregate percentage, exact counts when visibly available, completion date, and board. Do not read/store credentials, cookies, or question text. Save the sanitized local export under ignored data, run CLI dry-run, inspect conflicts, then commit and replay. If authentication is absent, report that external-state blocker precisely without weakening any code/data acceptance already completed.

- [ ] **Step 5: Seed SEFAZ GO low-confidence baseline**

Run the baseline adapter once, verify LTE content transferability zero, and replay it. Confirm a GO LTE record cannot move projected P2 while method/trap signals can only increase fragility.

- [ ] **Step 6: Verify the live projection and day behavior**

Check `GET /sprints/projection`, `GET /sprints/evidence`, `GET /sprints/trajectory`, Meta 47 eligibility on 17/18 July, explicit backlog, derived generation without manual fields, manual override labeling, and action-result projection refresh. Confirm weighted arithmetic is exactly `P1 + 2*P2` with target 204.

- [ ] **Step 7: Run complete automated gate**

```powershell
.\.venv-study-os\Scripts\python.exe -m pytest -q
.\.venv-study-os\Scripts\python.exe -m compileall study_os_service
npm test
npm run lint
npm run build
```

Expected: all tests pass; compile/lint/build exit 0.

- [ ] **Step 8: Validate the real app at desktop and mobile**

Start the actual local app/service. At desktop and 390px, verify cycle, 204 distance, confidence, fragility, dominant origin, `whyNow`, derived/manual distinction, queues, backlog, no page-level horizontal overflow, no console error, and no external request needed for the Command Center. Record screenshots/log evidence locally.

- [ ] **Step 9: Final whole-branch review, fixes, and push**

Generate a review package from merge-base through HEAD. Require both spec compliance and code-quality approval; fix Critical/Important findings as one reviewed wave and re-run covering tests. Run the complete gate again, create a final savepoint commit if necessary, and push `codex/sefaz-ce-18d-sprint` only after every available acceptance check is green.

---

## Self-Review

- Spec coverage: ledger/import, aliases, calibration, recency, sample confidence, GO/LTE transfer, automatic projection/interval/weighted target, manual override, cycles/backlog, trajectory/UI, authorized local imports, and full gates are each assigned to a task.
- Placeholder scan: no TBD/TODO/future implementation placeholders; external LS authentication is an explicit acceptance condition, not substituted with fabricated data.
- Type consistency: the same `SprintPerformanceObservation`, `SubjectProjection`, `SprintProjection`, cycle fields, formula version, target/floor/stretch constants, and derived/manual origin names are used through backend, engine, snapshots, API, and frontend.
