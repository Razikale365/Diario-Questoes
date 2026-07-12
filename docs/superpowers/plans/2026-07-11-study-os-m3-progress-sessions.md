# Study OS M3 Exact Progress and Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist an exact material/page cursor and a durable study-session lifecycle so a lesson can be stopped midway, the app restarted, and work resumed at the confirmed physical PDF page.

**Architecture:** SQLite remains authoritative. A focused progress repository owns cursor/version updates, a session service owns transactional lifecycle rules, and thin FastAPI endpoints expose start/checkpoint/finish/skip operations. PDF page count is inspected lazily. The Course inventory receives the first execution UI; M4 will reuse these APIs from Home blocks.

**Tech Stack:** Python 3.11+, SQLite WAL, FastAPI, `pypdf` for lazy page metadata, React 19, TypeScript 5.8, Vite 6, Node test runner.

## Global Constraints

- M2 remains open until package `249654` is freshly downloaded and verified; M3 fixture evidence must never be reported as real-package acceptance.
- Personal, local-first, Windows-first, offline-capable after acquisition; bind only to `127.0.0.1`.
- No Docker, local LLM, graph database, vector database, OCR batch, or background worker fleet.
- TEC remains metadata-only; no question statements, alternatives, answer keys, or proprietary comments enter Study OS SQLite.
- SQLite repositories own SQL; services own multi-repository transactions.
- Every mutating session endpoint uses an idempotency key and structured `{code,message}` errors.
- Page cursors belong to one material and never transfer silently across original/simplified/highlighted variants.
- Partial completion advances the confirmed cursor without marking the lesson complete or failed.
- Every new behavior follows red-green-refactor and ends in a focused commit.

---

## Task 1: Add Progress and Session Schema Version 4

**Files:**
- Modify: `study_os_service/db/migrations.py`
- Create: `study_os_service/domain/sessions.py`
- Create: `tests/study_os_service/test_session_migration.py`
- Create: `tests/study_os_service/test_session_domain.py`

**Interfaces:**
- Produces `ProgressStatus`, `SessionOutcome`, `SkipReason`, `ProgressState`, and `StudySession` immutable domain records.
- Produces schema tables `progress_states` and `study_sessions` for later repositories.

**Schema:**

```sql
CREATE TABLE progress_states (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lesson_id INTEGER NOT NULL REFERENCES lessons(id) ON DELETE RESTRICT,
  material_id INTEGER NOT NULL REFERENCES materials(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'unread'
    CHECK (status IN ('unread','in_progress','covered','stale','weak','strong')),
  cursor_page INTEGER NOT NULL DEFAULT 1 CHECK (cursor_page >= 1),
  furthest_page INTEGER NOT NULL DEFAULT 1 CHECK (furthest_page >= cursor_page),
  completed_at TEXT,
  last_seen_at TEXT,
  confidence REAL NOT NULL DEFAULT 0 CHECK (confidence BETWEEN 0 AND 1),
  total_seconds INTEGER NOT NULL DEFAULT 0 CHECK (total_seconds >= 0),
  session_count INTEGER NOT NULL DEFAULT 0 CHECK (session_count >= 0),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (lesson_id, material_id)
);

CREATE TABLE study_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  idempotency_key TEXT NOT NULL UNIQUE CHECK (length(trim(idempotency_key)) > 0),
  target_slug TEXT NOT NULL CHECK (length(trim(target_slug)) > 0),
  lesson_id INTEGER NOT NULL REFERENCES lessons(id) ON DELETE RESTRICT,
  material_id INTEGER NOT NULL REFERENCES materials(id) ON DELETE RESTRICT,
  state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active','finished')),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  elapsed_seconds INTEGER NOT NULL DEFAULT 0 CHECK (elapsed_seconds >= 0),
  start_page INTEGER NOT NULL CHECK (start_page >= 1),
  end_page INTEGER CHECK (end_page IS NULL OR end_page >= start_page),
  questions_done INTEGER NOT NULL DEFAULT 0 CHECK (questions_done >= 0),
  correct_count INTEGER NOT NULL DEFAULT 0 CHECK (correct_count >= 0),
  wrong_count INTEGER NOT NULL DEFAULT 0 CHECK (wrong_count >= 0),
  doubt_count INTEGER NOT NULL DEFAULT 0 CHECK (doubt_count >= 0),
  favorite_count INTEGER NOT NULL DEFAULT 0 CHECK (favorite_count >= 0),
  outcome TEXT CHECK (outcome IS NULL OR outcome IN ('partial','completed','failed','skipped','abandoned')),
  skip_reason TEXT CHECK (skip_reason IS NULL OR skip_reason IN ('lack_of_time','fatigue','wrong_material','blocked_prerequisite','too_difficult','other')),
  notes TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((state='active' AND outcome IS NULL AND ended_at IS NULL) OR (state='finished' AND outcome IS NOT NULL AND ended_at IS NOT NULL))
);
```

- [ ] **Step 1: Write migration and domain RED tests**

```python
def test_version_three_upgrades_without_losing_inventory(connection):
    install_version_three(connection)
    material_id = seed_inventory(connection)
    assert MigrationRunner(connection).migrate() == 4
    assert connection.execute("SELECT id FROM materials").fetchone()[0] == material_id
    assert {"progress_states", "study_sessions"} <= table_names(connection)

def test_session_domain_rejects_cross_field_invalid_state():
    with pytest.raises(ValueError, match="active session cannot have an outcome"):
        StudySession(
            id=1,
            idempotency_key="session-1",
            target_slug="rfb_auditor",
            lesson_id=10,
            material_id=20,
            state="active",
            started_at=NOW,
            ended_at=NOW,
            elapsed_seconds=60,
            start_page=1,
            end_page=2,
            questions_done=0,
            correct_count=0,
            wrong_count=0,
            doubt_count=0,
            favorite_count=0,
            outcome="partial",
            skip_reason=None,
            notes="",
            version=1,
        )
```

- [ ] **Step 2: Verify RED**

Run: `python -m pytest tests/study_os_service/test_session_migration.py tests/study_os_service/test_session_domain.py -q`

Expected: failures because migration 4 and session domain records do not exist.

- [ ] **Step 3: Implement migration 4 and immutable records**

Validate timezone-aware timestamps, positive pages, count bounds, state/outcome consistency, and skip-reason/outcome consistency in `__post_init__`.

- [ ] **Step 4: Verify GREEN and regressions**

Run: `python -m pytest tests/study_os_service/test_session_migration.py tests/study_os_service/test_session_domain.py tests/study_os_service/test_inventory_migration.py -q`

Expected: all pass; schema version is 4.

- [ ] **Step 5: Commit**

```powershell
git add study_os_service/db/migrations.py study_os_service/domain/sessions.py tests/study_os_service/test_session_migration.py tests/study_os_service/test_session_domain.py
git commit -m "feat: add Study OS progress and session schema"
```

## Task 2: Inspect PDF Page Metadata Lazily

**Files:**
- Modify: `pyproject.toml`
- Create: `study_os_service/ingest/pdf_metadata.py`
- Modify: `study_os_service/repositories/inventory.py`
- Create: `tests/study_os_service/test_pdf_metadata.py`

**Interfaces:**
- Produces `inspect_pdf(path: Path) -> PdfMetadata` where `PdfMetadata.page_count >= 1`.
- Produces `InventoryRepository.update_material_page_metadata(material_id, page_count, page_offset)`.
- Consumes only a material selected/opened by the user; ordinary root scans never call this module.

- [ ] **Step 1: Add `pypdf>=5,<7` and write failing lazy-inspection tests**

```python
def test_inspect_pdf_returns_physical_page_count(valid_three_page_pdf):
    assert inspect_pdf(valid_three_page_pdf).page_count == 3

def test_course_scanner_still_never_imports_pdf_reader(monkeypatch, fixture_root):
    monkeypatch.setattr(pdf_metadata, "PdfReader", fail)
    assert scan_course_root(fixture_root, "rfb_auditor", "Estrategia").material_count == 9
```

- [ ] **Step 2: Verify RED**

Run: `python -m pytest tests/study_os_service/test_pdf_metadata.py tests/study_os_service/test_course_scanner.py -q`

Expected: missing module/function failure.

- [ ] **Step 3: Implement strict local PDF inspection**

```python
@dataclass(frozen=True, slots=True)
class PdfMetadata:
    page_count: int

def inspect_pdf(path: Path) -> PdfMetadata:
    resolved = path.resolve(strict=True)
    if resolved.suffix.casefold() != ".pdf":
        raise ValueError("material is not a PDF")
    with resolved.open("rb") as handle:
        count = len(PdfReader(handle, strict=False).pages)
    if count < 1:
        raise ValueError("PDF has no readable pages")
    return PdfMetadata(page_count=count)
```

- [ ] **Step 4: Verify GREEN and scanner boundary**

Run: `python -m pytest tests/study_os_service/test_pdf_metadata.py tests/study_os_service/test_course_scanner.py -q`

- [ ] **Step 5: Commit**

```powershell
git add pyproject.toml study_os_service/ingest/pdf_metadata.py study_os_service/repositories/inventory.py tests/study_os_service/test_pdf_metadata.py
git commit -m "feat: inspect Study OS PDF metadata lazily"
```

## Task 3: Add Progress Repository and Reading-Rate Model

**Files:**
- Create: `study_os_service/repositories/progress.py`
- Create: `study_os_service/services/reading_rate.py`
- Create: `tests/study_os_service/test_progress_repository.py`
- Create: `tests/study_os_service/test_reading_rate.py`

**Interfaces:**

```python
ProgressRepository.get_or_create(lesson_id: int, material_id: int) -> ProgressState
ProgressRepository.advance_cursor(lesson_id: int, material_id: int, cursor_page: int, elapsed_seconds: int, expected_version: int) -> ProgressState
ProgressRepository.mark_completed(lesson_id: int, material_id: int, final_page: int, elapsed_seconds: int, expected_version: int) -> ProgressState
ProgressRepository.get_active_session(lesson_id: int, material_id: int) -> StudySession | None
calculate_reading_rate(sessions: Sequence[StudySession]) -> ReadingRate
estimate_page_target(cursor_page: int, page_count: int | None, available_minutes: int, rate: ReadingRate | None) -> int
```

Default estimate is 20 pages per 60 minutes, bounded to 10-30 pages per 60 minutes. Reading-rate samples require at least 300 elapsed seconds and positive page movement.

- [ ] **Step 1: Write repository and rate RED tests**

Cover get-or-create idempotence, target/material relation validation, optimistic version conflict, monotonic furthest page, page-count ceiling, restart persistence, insufficient samples, weighted observed rate, and 10-30 page bounds.

- [ ] **Step 2: Verify RED**

Run: `python -m pytest tests/study_os_service/test_progress_repository.py tests/study_os_service/test_reading_rate.py -q`

- [ ] **Step 3: Implement SQL repository and pure rate functions**

Use `UPDATE progress_states SET cursor_page=?, furthest_page=?, version=version+1 WHERE id=? AND version=?`; zero changed rows raises `ProgressConflictError`. Never decrease `furthest_page`; allow an explicit cursor correction only through a separate tested method.

- [ ] **Step 4: Verify GREEN**

Run: `python -m pytest tests/study_os_service/test_progress_repository.py tests/study_os_service/test_reading_rate.py -q`

- [ ] **Step 5: Commit**

```powershell
git add study_os_service/repositories/progress.py study_os_service/services/reading_rate.py tests/study_os_service/test_progress_repository.py tests/study_os_service/test_reading_rate.py
git commit -m "feat: persist exact Study OS progress"
```

## Task 4: Implement Transactional Session Lifecycle

**Files:**
- Create: `study_os_service/services/sessions.py`
- Create: `tests/study_os_service/test_session_service.py`

**Interfaces:**

```python
SessionService.start(target_slug, lesson_id, material_id, idempotency_key) -> SessionStart
SessionService.checkpoint(session_id, end_page, elapsed_seconds, expected_version) -> StudySession
SessionService.finish(session_id, outcome, end_page, elapsed_seconds, questions_done, correct_count, wrong_count, doubt_count, favorite_count, notes, expected_version) -> SessionResult
SessionService.skip(session_id, reason, notes, expected_version) -> SessionResult
```

`SessionStart` includes `session`, `progress`, and `open_url` ending in `?targetSlug=<slug>#page=<cursor>`. Start rejects unavailable/non-PDF material and lesson/material/target mismatches.

- [ ] **Step 1: Write lifecycle RED tests**

```python
def test_partial_finish_advances_cursor_without_covering_lesson(session_service):
    started = session_service.start(
        target_slug="rfb_auditor",
        lesson_id=10,
        material_id=20,
        idempotency_key="start-1",
    )
    result = session_service.finish(
        session_id=started.session.id,
        outcome="partial",
        end_page=18,
        elapsed_seconds=1200,
        questions_done=0,
        correct_count=0,
        wrong_count=0,
        doubt_count=0,
        favorite_count=0,
        notes="",
        expected_version=started.session.version,
    )
    assert result.progress.cursor_page == 18
    assert result.progress.status == "in_progress"

def test_restart_resumes_same_material_page(session_service_factory):
    service = session_service_factory()
    first = service.start("rfb_auditor", 10, 20, "start-1")
    service.finish(
        first.session.id, "partial", 18, 1200,
        0, 0, 0, 0, 0, "", first.session.version,
    )
    resumed = session_service_factory().start(
        "rfb_auditor", 10, 20, "start-2"
    )
    assert resumed.session.start_page == 18
    assert resumed.open_url.endswith("#page=18")
```

Also cover idempotent start, one active session per lesson/material, checkpoint, explicit completion, failed outcome, six skip reasons, wrong-material issue creation, rollback, and stale version conflict.

- [ ] **Step 2: Verify RED**

Run: `python -m pytest tests/study_os_service/test_session_service.py -q`

- [ ] **Step 3: Implement service transactions**

Use `BEGIN IMMEDIATE`; update session and progress atomically. Partial/completed sessions increment `session_count` and `total_seconds` once. `lack_of_time` and `fatigue` do not create weakness. `too_difficult` sets progress to `weak`. `wrong_material` remains a durable session skip reason and is exposed as a repair action; it does not mutate or delete inventory evidence.

- [ ] **Step 4: Verify GREEN and inventory preservation**

Run: `python -m pytest tests/study_os_service/test_session_service.py tests/study_os_service/test_inventory_reconciliation.py -q`

- [ ] **Step 5: Commit**

```powershell
git add study_os_service/services/sessions.py tests/study_os_service/test_session_service.py
git commit -m "feat: manage Study OS study sessions"
```

## Task 5: Expose Progress, Material Inspection, and Session APIs

**Files:**
- Create: `study_os_service/api/sessions.py`
- Modify: `study_os_service/api/inventory.py`
- Modify: `study_os_service/app.py`
- Create: `tests/study_os_service/test_session_api.py`

**Endpoints:**

```text
POST  /api/v1/materials/{id}/inspect
GET   /api/v1/progress?lessonId=10&materialId=20&targetSlug=rfb_auditor
GET   /api/v1/reading-rates?targetSlug=rfb_auditor
POST  /api/v1/sessions
GET   /api/v1/sessions/{id}
PATCH /api/v1/sessions/{id}
POST  /api/v1/sessions/{id}/finish
POST  /api/v1/sessions/{id}/skip
```

- [ ] **Step 1: Write API RED tests**

Test minimal start, required `Idempotency-Key`, duplicate retry returns the same session, target mismatch 404, exact `#page`, inspect updates `pageCount`, checkpoint conflict 409, partial and completed responses, all skip reasons, and malformed counts/pages as structured 422 errors.

- [ ] **Step 2: Verify RED**

Run: `python -m pytest tests/study_os_service/test_session_api.py -q`

- [ ] **Step 3: Implement thin router and off-loop PDF inspection**

`POST /materials/{id}/inspect` uses `asyncio.to_thread`, a worker-owned SQLite connection for the final metadata update, and the same containment checks as the file endpoint.

- [ ] **Step 4: Verify GREEN and full Python regression**

Run: `python -m pytest tests/study_os_service -q`

- [ ] **Step 5: Commit**

```powershell
git add study_os_service/api/sessions.py study_os_service/api/inventory.py study_os_service/app.py tests/study_os_service/test_session_api.py
git commit -m "feat: expose Study OS session API"
```

## Task 6: Add Typed Session Client

**Files:**
- Create: `src/study-os/api/sessions.ts`
- Create: `src/study-os/api/sessions.test.ts`

**Interfaces:**

```typescript
fetchProgress(targetSlug, lessonId, materialId, signal?): Promise<ProgressState>
inspectMaterial(materialId, targetSlug): Promise<MaterialSummary>
startStudySession(input, idempotencyKey): Promise<SessionStart>
checkpointStudySession(sessionId, input): Promise<StudySession>
finishStudySession(sessionId, input): Promise<SessionResult>
skipStudySession(sessionId, input): Promise<SessionResult>
```

- [ ] **Step 1: Write strict parser and request RED tests**

Cover every DTO, enum, nullable timestamp, optimistic version, `Idempotency-Key` header, exact request body, and structured conflict error.

- [ ] **Step 2: Verify RED**

Run: `node --import tsx --test src/study-os/api/sessions.test.ts`

- [ ] **Step 3: Implement typed client**

Reuse `requestJson`; do not duplicate error normalization. Validate nested session/progress/material objects before returning them.

- [ ] **Step 4: Verify GREEN and typecheck**

Run: `node --import tsx --test src/study-os/api/sessions.test.ts && npm.cmd run lint`

- [ ] **Step 5: Commit**

```powershell
git add src/study-os/api/sessions.ts src/study-os/api/sessions.test.ts
git commit -m "feat: add typed Study OS session client"
```

## Task 7: Add Exact Resume Workflow to Course Inventory

**Files:**
- Create: `src/study-os/components/StudySessionPanel.tsx`
- Modify: `src/study-os/components/CourseInventory.tsx`
- Create: `src/study-os/domain/sessionView.ts`
- Create: `src/study-os/domain/sessionView.test.ts`

**UI:**

- primary material row shows `Começar` or `Continuar p. N`;
- opening starts an idempotent session and routes the reusable viewer window to `#page=N`;
- active session panel shows start page, confirmed page input, elapsed minutes, and page count;
- commands: save checkpoint, finish partial, complete lesson, fail, or skip with one of six reasons;
- after finish, persisted cursor/status/version refresh immediately;
- unavailable or changed material gives a repair message and never opens another variant silently.

- [ ] **Step 1: Write pure session-view RED tests**

```typescript
test('partial result remains resumable at the confirmed page', () => {
  assert.deepEqual(buildSessionView(progressAt(18, 'in_progress')), {
    commandLabel: 'Continuar p. 18',
    startPage: 18,
    canComplete: true,
  });
});
```

Also test unread, covered, unavailable material, page bounds, elapsed-minute conversion, and skip labels.

- [ ] **Step 2: Verify RED**

Run: `node --import tsx --test src/study-os/domain/sessionView.test.ts`

- [ ] **Step 3: Implement pure view model and component**

Use icon+text commands, compact numeric inputs, no nested cards, stable responsive grids, and a synchronous `window.open('about:blank', 'study-os-material')` before awaiting session start so browsers do not block the viewer.

- [ ] **Step 4: Verify component integration**

Run: `npm.cmd test && npm.cmd run lint && npm.cmd run build`

- [ ] **Step 5: Browser acceptance with fixture**

At desktop and 390px: start Aula 01 at page 1, save page 18 partial, reload the whole app, reselect the lesson, assert `Continuar p. 18`, open URL ending `#page=18`, complete, and verify no overlap or console errors. Remove fixture rows/files afterward.

- [ ] **Step 6: Commit**

```powershell
git add src/study-os/components/StudySessionPanel.tsx src/study-os/components/CourseInventory.tsx src/study-os/domain/sessionView.ts src/study-os/domain/sessionView.test.ts
git commit -m "feat: resume Study OS lessons by exact page"
```

## Task 8: M3 Gate, Backup/Restart Proof, and M4 Plan

**Files:**
- Update: `.superpowers/sdd/progress.md`
- Create: `docs/superpowers/plans/2026-07-12-study-os-m4-autonomous-day.md`

- [ ] **Step 1: Run complete gates**

```powershell
python -m pytest -q
python -m compileall -q study_os_service
npm.cmd test
npm.cmd run lint
npm.cmd run build
node --test src/lib/question-deck.test.mjs
git diff --check
```

- [ ] **Step 2: Prove restart persistence**

Create a fixture session, save partial at page 18, close both service/database connections, create a fresh app instance against the same database, and assert progress/session APIs return page 18 and the same completed session history.

- [ ] **Step 3: Prove backup restore**

Create a SQLite backup, restore into a temporary data directory, run `PRAGMA integrity_check`, and compare progress/session/inventory counts plus exact cursor/version values.

- [ ] **Step 4: Prove offline operation**

With network disabled for the browser context after fixture acquisition, load Course inventory, start/resume/finish a session, and open the same-origin PDF. Google-hosted fonts or any other runtime network dependency are a defect to remove.

- [ ] **Step 5: Write and self-review M4 plan**

M4 plan must cover persisted targets/edital weights, planner candidates/runs/blocks, exact executable stop conditions, deterministic scoring, balanced no-LS day, Home integration, and score evidence.

- [ ] **Step 6: Commit**

```powershell
git add .superpowers/sdd/progress.md docs/superpowers/plans/2026-07-12-study-os-m4-autonomous-day.md
git commit -m "docs: plan autonomous Study OS day"
```

## M3 Acceptance

M3 is complete only when all are true:

1. progress is stored per exact lesson/material and survives process restart;
2. a partial session advances only to the user-confirmed physical PDF page;
3. reopening the lesson produces a same-origin URL with the exact `#page=N` cursor;
4. completion, failure, abandonment, and all six skip reasons are durably distinguishable;
5. optimistic versions prevent silent cursor overwrite;
6. reading rate uses bounded defaults until enough valid history exists;
7. ordinary course scans still never read PDF content or page metadata;
8. material page count is inspected only on demand and cached;
9. target/material/lesson mismatches cannot leak or mutate another target;
10. desktop/mobile execution UI passes restart, partial, resume, and complete smoke;
11. backup/restore preserves exact cursor, versions, and session history;
12. all Python, frontend, build, legacy question-deck, diff, and offline gates pass.

The fresh real-package M2 acceptance remains a separate required gate; fixture-only M3 completion cannot close M2.
