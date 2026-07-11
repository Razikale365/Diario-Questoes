# Study OS M2: Current Package Decision and Real Course Inventory

> Execute with `superpowers:subagent-driven-development` when agent capacity is available. Every behavior change follows RED/GREEN, a task-scoped review, and a commit.

**Goal:** Choose and acquire the current Estrategia package for the active target, then turn its local folder into a durable, idempotent inventory of courses, disciplines, lessons, material variants, and safe local PDF links.

**Architecture:** The FastAPI service remains local-only. A metadata-only scanner produces an immutable snapshot; a reconciliation service writes it transactionally to SQLite schema version 2. HTTP endpoints expose roots, scan state, inventory, issues, and material files. React adds a compact setup/inventory surface inside Study OS. PDF contents are not indexed in M2.

**Tech:** Python 3.11+, `sqlite3`, FastAPI, pathlib, React 19, TypeScript, Node test runner, Vite.

## Binding Decisions

- The old `Pacote Regular Fiscal 2023` is a fixture and scale reference, not the production package.
- Production inventory requires a newly downloaded package selected from the user's current Estrategia account.
- Default recommendation is the current complete `BACEN - Analista - Economia e Financas` package when available and when BACEN remains the active target. RFB or SEFAZ packages are selected only if the active target decision changes first.
- Package choice is recorded as editable data: target, provider, package name/id/URL, edition note, root path, and expected filesystem count. It is never hard-coded as truth.
- Download stays an authenticated user action through Estrategia. Study OS neither scrapes the course site nor stores credentials.
- The real-package acceptance count is the count observed after the new download. The historical `3,589 PDFs` remains a synthetic scale regression and must not be imposed on a different package.
- Scan reads filesystem metadata only. No PDF text, outline, page count, or hash is read during ordinary inventory.
- Stable material identity is `(course_id, normalized_relative_path)`. Rescan never deletes a material, lesson, progress, or session row.
- Lesson number comes from the filename, not the parent folder.
- Original or configured simplified apostila may be primary. Bizu, Trilha, slides, maps, and summaries cannot become automatic primary theory material.
- File responses are resolved by material id and must remain inside a registered root. There is no arbitrary path endpoint.
- Existing browser folder import remains available as a compatibility tool, but the service inventory becomes the authoritative source for course advancement.

## Audited Fixture Matrix

Temporary fixture trees must reproduce these exact names and shapes:

```text
Pacote Regular Fiscal 2023/
  Economia e Financas Publicas/
    PDF/
      Aula 01_Apostila.pdf
      Aula 01_Apostila_grifada.pdf
      Aula 01_Apostila_simplificada.pdf
      Aula 01_01_Slide.pdf
      Aula 1 - Resumo.pdf
      Aula 001 - Mapa Mental.pdf
  Direito Tributario/
    PDF/
      Aula_02_Apostila.pdf
  Trilha Estrategica/
    PDF/
      Aula 01_Trilha.pdf
  Dicas e Bizus/
    PDF/
      Aula 01_Bizu.pdf
```

Additional fixtures cover duplicate provider directories, unknown discipline names, a missing file after rescan, a renamed file with matching metadata, a modified file, uppercase `.PDF`, unsupported files, and a root containing 3,589 empty PDF fixtures.

## Task 1: Decide and Record the Current Estrategia Package

**Files:**
- Create: `docs/study-os/course-package-decision.md`
- Create: `study_os_service/domain/__init__.py`
- Create: `study_os_service/domain/inventory.py`
- Create: `tests/study_os_service/test_inventory_domain.py`

**Interfaces:**

```python
@dataclass(frozen=True, slots=True)
class CoursePackageChoice:
    target_slug: str
    provider: str
    package_name: str
    package_url: str
    edition_note: str
    root_path: Path | None
    download_status: Literal['candidate', 'selected', 'downloaded', 'validated']
    expected_file_count: int | None
```

- [ ] Inspect the current Estrategia catalog/account and compare owned/current BACEN Economia e Financas, RFB Auditor/Analista, and temporary SEFAZ options.
- [ ] Record candidates against target alignment, completeness, freshness, banca, current ownership/cost, and whether the package includes all core disciplines.
- [ ] Select one package. Prefer current BACEN Economia e Financas if it is complete and available; record why, not just the result.
- [ ] Download the selected package to a stable local folder outside the repository.
- [ ] Write failing domain validation tests: URL must be HTTP(S), downloaded/validated choices require an existing root, counts are non-negative, and target/provider/name are non-empty.
- [ ] Implement the immutable choice model and JSON serialization used by later API DTOs.
- [ ] Commit: `feat: record Study OS course package choice`.

The task may finish with `download_status=selected` while a large download is in progress, but M2 itself cannot be marked complete until the status is `validated`.

## Task 2: Add Inventory Schema Version 2

**Files:**
- Modify: `study_os_service/db/migrations.py`
- Create: `study_os_service/repositories/__init__.py`
- Create: `study_os_service/repositories/inventory.py`
- Create: `tests/study_os_service/test_inventory_migration.py`

**Migration 2 tables:**

```text
course_roots
  id, target_slug, provider, package_name, package_url, edition_note,
  root_path, source_kind, download_status, expected_file_count,
  active, last_scanned_at, created_at, updated_at

courses
  id, root_id, display_name, provider, relative_path,
  active, scan_state, last_scanned_at, created_at, updated_at

disciplines
  id, canonical_name, aliases_json, created_at, updated_at

course_disciplines
  course_id, discipline_id, display_order, active

lessons
  id, course_id, discipline_id, lesson_number, title,
  sequence_index, status, estimated_minutes, available,
  created_at, updated_at

materials
  id, course_id, lesson_id, absolute_path, relative_path, kind,
  size_bytes, modified_at, content_hash, page_count, page_offset,
  available, is_primary, trust_level, created_at, updated_at

import_runs
  id, root_id, state, discovered_count, reconciled_count,
  issue_count, started_at, completed_at, error_message

import_issues
  id, import_run_id, root_id, issue_kind, severity,
  relative_path, context_json, state, created_at, resolved_at
```

**Constraints:**

- unique normalized `course_roots.root_path`;
- unique `(root_id, relative_path)` for courses;
- unique canonical discipline name;
- unique `(course_id, discipline_id, sequence_index)` for lessons;
- unique `(course_id, relative_path)` for materials;
- foreign keys use `RESTRICT` or `SET NULL`, never scan-triggered cascade deletion;
- JSON columns have valid defaults;
- enum-like fields use CHECK constraints.

- [ ] Write empty-to-v2 and v1-to-v2 migration tests.
- [ ] Test idempotence, exact constraints, and rollback on migration failure.
- [ ] Add repository CRUD for package/root registration and inventory reads.
- [ ] Test target isolation and canonical-path uniqueness.
- [ ] Commit: `feat: add Study OS inventory schema`.

## Task 3: Parse Lessons and Classify Material Variants

**Files:**
- Create: `study_os_service/ingest/__init__.py`
- Create: `study_os_service/ingest/course_parser.py`
- Create: `study_os_service/ingest/material_classifier.py`
- Create: `tests/study_os_service/test_course_parser.py`
- Create: `tests/study_os_service/test_material_classifier.py`

**Interfaces:**

```python
parse_lesson_number(filename: str) -> int | None
normalize_discipline_candidate(course_directory: str) -> str
classify_material(filename: str, course_directory: str) -> MaterialClassification
choose_primary_material(materials, preference='original') -> str | None
```

`parse_lesson_number` accepts `Aula 01`, `Aula 1`, `Aula 001`, `Aula_02`, mixed separators, accents, case, and suffixes. It rejects question numbers, years, and a directory-only lesson hint.

Material kinds: `original`, `simplified`, `highlighted`, `slides`, `mind_map`, `summary`, `bizu`, `track`, `other`.

Default trust/primary behavior:

| Kind | Trust | Automatic primary |
| --- | ---: | --- |
| original | 10 | first choice |
| simplified | 9 | configured choice |
| highlighted | 8 | fallback |
| other | 7 | trusted fallback only |
| slides | 5 | no |
| mind_map | 5 | no |
| summary | 5 | no |
| track | 4 | no |
| bizu | 2 | never |

- [ ] Write failing tests for every audited filename and false positives.
- [ ] Test original preference, simplified override, and Bizu-only returning no primary.
- [ ] Implement pure functions without filesystem or database access.
- [ ] Commit: `feat: parse Study OS course materials`.

## Task 4: Build a Metadata-Only Filesystem Scanner

**Files:**
- Create: `study_os_service/ingest/course_scanner.py`
- Create: `tests/study_os_service/fixture_tree.py`
- Create: `tests/study_os_service/test_course_scanner.py`

**Interfaces:**

```python
scan_course_root(root: Path, target_slug: str, provider: str) -> CourseScanSnapshot
```

The immutable snapshot contains discovered courses, discipline candidates, lessons, materials, and issues. Each material records only resolved path, normalized relative path, size, and nanosecond modified time.

- [ ] Build temporary fixture trees using the exact audited names above.
- [ ] Prove the course directory is the segment immediately above `PDF`, not `PDF` itself.
- [ ] Prove lesson number comes from the filename.
- [ ] Reject a nonexistent root, a file passed as root, and files resolving outside the root.
- [ ] Ignore unsupported files and count uppercase `.PDF`.
- [ ] Keep duplicate course providers as separate courses.
- [ ] Emit issues for unknown discipline/lesson mappings without dropping the file.
- [ ] Monkeypatch PDF readers to fail if called; scanner tests must still pass.
- [ ] Generate 3,589 empty PDFs and assert exact count and bounded runtime without reading content.
- [ ] Commit: `feat: scan Study OS course metadata`.

## Task 5: Reconcile Scans Transactionally

**Files:**
- Create: `study_os_service/services/__init__.py`
- Create: `study_os_service/services/inventory.py`
- Modify: `study_os_service/repositories/inventory.py`
- Create: `tests/study_os_service/test_inventory_reconciliation.py`

**Interfaces:**

```python
InventoryService.scan_and_reconcile(root_id: int) -> ImportRunSummary
```

- [ ] Register an import run before scanning and finish it as `completed` or `failed` with an error message.
- [ ] Reconcile courses, disciplines, lessons, and materials in one `BEGIN IMMEDIATE` transaction.
- [ ] Prove identical rescan preserves IDs and produces no duplicates.
- [ ] Mark missing materials and empty lessons unavailable; do not delete rows.
- [ ] Preserve manually selected primary material unless it disappeared or became disallowed.
- [ ] Recompute automatic primary deterministically for new lessons.
- [ ] Emit a rename proposal issue when size, lesson, kind, and modified metadata plausibly match; do not silently move identity.
- [ ] Roll back all inventory changes if reconciliation fails, while recording the failed import run in a separate short transaction.
- [ ] Prove a future progress row referencing a material would remain valid after the material disappears.
- [ ] Commit: `feat: reconcile Study OS course scans`.

## Task 6: Expose Inventory and Safe File APIs

**Files:**
- Create: `study_os_service/api/inventory.py`
- Modify: `study_os_service/app.py`
- Create: `tests/study_os_service/test_inventory_api.py`
- Create: `tests/study_os_service/test_material_file_api.py`

**Endpoints:**

```text
GET  /api/v1/setup/status
GET  /api/v1/course-roots
POST /api/v1/course-roots
POST /api/v1/scans
GET  /api/v1/scans/{id}
GET  /api/v1/courses
GET  /api/v1/courses/{id}/lessons
GET  /api/v1/lessons/{id}
PUT  /api/v1/lessons/{id}/mapping
GET  /api/v1/materials/{id}/file
```

- [ ] Validate root paths and package metadata with structured `{code,message}` errors.
- [ ] Make root registration idempotent by canonical path.
- [ ] Run scan/reconcile off the event loop with a new SQLite connection owned by the worker.
- [ ] Return a scan id immediately; expose `queued`, `running`, `completed`, and `failed` states.
- [ ] Make repeated scan submission for the same active root return the active run instead of duplicating work.
- [ ] Return courses grouped with counts and issue summaries; paginate lesson lists.
- [ ] Allow manual discipline/title mapping without mutating filesystem-derived evidence.
- [ ] Resolve file requests by material id, re-resolve the registered root and file path, reject escape/traversal, require an available PDF, and serve inline with range support.
- [ ] Test another target/root cannot access mismatched inventory through query filters.
- [ ] Commit: `feat: expose Study OS course inventory API`.

## Task 7: Add Typed Inventory Client and Package Setup UI

**Files:**
- Create: `src/study-os/api/inventory.ts`
- Create: `src/study-os/api/inventory.test.ts`
- Create: `src/study-os/components/CourseInventory.tsx`
- Modify: `src/components/PlannerArea.tsx`

**UI:**

- compact package decision row: target, package name, source URL, download state, root path;
- root validation and scan commands;
- scan status/counts and unresolved issue count;
- dense course/discipline/lesson table with variant count and primary material;
- explicit `Abrir PDF` action using `/api/v1/materials/{id}/file#page=1`;
- empty state for `selected but not downloaded`, `downloaded but not registered`, and `registered but not scanned`;
- service unavailable state keeps existing planner usable.

- [ ] Write parser tests for every DTO and structured API error.
- [ ] Fetch setup and inventory in parallel after service health succeeds.
- [ ] Do not poll globally; poll only an active scan and abort on unmount.
- [ ] Keep the operational layout dense, unframed where possible, and responsive without document overflow.
- [ ] Preserve the existing target selector and current Study OS planning state.
- [ ] Commit: `feat: manage Study OS course inventory`.

## Task 8: Verify the Newly Downloaded Real Package

**Files:**
- Modify only for tested defects.
- Update: `docs/study-os/course-package-decision.md`

- [ ] Confirm the selected package root exists and record the filesystem PDF count independently with `Get-ChildItem`.
- [ ] Register the root through the API and scan it twice.
- [ ] Assert both scans report the independent count and the second scan creates no duplicate courses, lessons, or materials.
- [ ] Sample at least one original, simplified/highlighted, slide/map/summary, Trilha, and Bizu variant when present.
- [ ] Confirm each sample's lesson number, material kind, trust, and primary decision.
- [ ] Open one selected primary PDF through the API and verify `%PDF` bytes, range response, and `#page=1` browser rendering.
- [ ] Resolve or explicitly document every import issue category. Do not hide unknown disciplines.
- [ ] Record actual package name/id/URL, root, PDF count, scan duration, course count, lesson count, material count, and issue count.

## Task 9: M2 End-to-End Gate and M3 Plan

- [ ] `python -m pytest tests/study_os_service -q`
- [ ] `python -m compileall -q study_os_service`
- [ ] `npm.cmd test`
- [ ] `npm.cmd run lint`
- [ ] `npm.cmd run build`
- [ ] `git diff --check`
- [ ] Browser smoke at desktop and 390px: package status, scan progress, inventory table, target controls, PDF launch, no overlap, no console errors.
- [ ] Backup the schema-v2 database and restore it into a temporary data directory; inventory counts and integrity must match.
- [ ] Verify offline operation after the package is downloaded: no network request is required for scan, inventory, or PDF open.
- [ ] Create `docs/superpowers/plans/2026-07-11-study-os-m3-progress-sessions.md` before implementing progress/session code.
- [ ] Commit: `docs: plan Study OS progress and sessions`.

## M2 Acceptance

M2 is complete only when all are true:

1. one current Estrategia package is explicitly selected for the active target and downloaded;
2. its root and independent PDF count are recorded;
3. two scans are idempotent and equal the independent count;
4. lesson numbers are derived from filenames across padded/unpadded variants;
5. material variants are grouped and primary selection obeys trust rules;
6. missing/renamed/unknown files produce durable state or issues without deletion;
7. a selected material opens through a safe same-origin file endpoint;
8. historical 3,589-file fixture regression passes without reading PDF content;
9. target/package setup and inventory work at desktop/mobile without breaking the planner;
10. all Python/frontend/build/browser/backup gates pass.
