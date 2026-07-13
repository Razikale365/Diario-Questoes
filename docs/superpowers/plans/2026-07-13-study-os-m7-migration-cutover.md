# Study OS M7 Migration and Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make SQLite the only Study OS command-layer owner, migrate useful browser metadata exactly once, provide verified portable export/restore, and prove the app runs offline without LS or Docker.

**Architecture:** Schema v9 records resumable browser migrations and legacy-ID mappings while the existing `app_settings` table stores the selected target. A strict migration service delegates to the existing target, strategy, and learning services using deterministic stage keys; proprietary question content is rejected before persistence. The frontend sanitizes legacy browser state, removes only `study_os_*` keys after a confirmed import, and retires the old local Study OS generator while preserving the optional LS/Diario execution surface.

**Tech Stack:** Python 3.11+, FastAPI, SQLite, React 19, TypeScript, Vite, Node test runner, PowerShell startup.

## Global Constraints

- Study OS remains local and personal; no credentials or proprietary TEC question content may enter SQLite, logs, migration reports, or exports.
- LS, Trilha, Passo, Andrety, Bizu, and TEC remain advisory inputs; the SQLite planner remains the command layer.
- Existing Diario task/question localStorage remains isolated and operational; only duplicated `study_os_*` ownership is removed.
- Migration, replay, restart, backup, restore, and export must be deterministic and auditable.
- Startup and offline execution must not require Docker, a local LLM, vector database, graph database, or internet.
- M2/M6 real-package acceptance remains open until package `249654` has a fresh validated manifest and real scan.

---

### Task 1: Schema v9 Migration Ledger and Active Target Preference

**Files:**
- Modify: `study_os_service/db/migrations.py`
- Create: `study_os_service/repositories/cutover.py`
- Create: `study_os_service/services/preferences.py`
- Create: `tests/study_os_service/test_cutover_migration.py`
- Create: `tests/study_os_service/test_preferences.py`

**Interfaces:**
- Produces: `CutoverRepository`, `MigrationRunRecord`, `LegacyIdRecord`.
- Produces: `PreferenceService.get_active_target()` and `set_active_target(target_slug)`.

- [ ] Add failing migration tests proving v1-v8 preservation, v9 rollback, JSON constraints, unique migration keys, and unique `(record_kind, legacy_id)` mappings.
- [ ] Add migration 9 with `legacy_migration_runs` and `legacy_id_mappings`; keep `app_settings` as the preference store.
- [ ] Add repository tests for begin/resume/complete/fail and deterministic legacy ID lookup.
- [ ] Add preference tests proving the stored target must exist and be active, and the default is the highest-priority active target with a stable slug tie-break.
- [ ] Implement the repository and preference service with canonical JSON and optimistic setting updates in one transaction.
- [ ] Run focused tests, previous-version migration regressions, compileall, and commit `feat: persist Study OS cutover state`.

### Task 2: Resumable Sanitized Browser Migration Service

**Files:**
- Create: `study_os_service/domain/cutover.py`
- Create: `study_os_service/services/legacy_migration.py`
- Create: `tests/study_os_service/fixtures/cutover/browser_bundle_v1.json`
- Create: `tests/study_os_service/test_legacy_migration.py`

**Interfaces:**
- Consumes: `PlannerProfileService`, `StrategyIngestionService`, `LearningImportService`, `PreferenceService`, and `CutoverRepository`.
- Produces: `LegacyBrowserBundle.from_payload(payload)` and `LegacyMigrationService.import_bundle(bundle, migration_key)`.
- Bundle schema: `study-os.browser-migration.v1` with `migrationId`, `exportedAt`, `activeTargetSlug`, `targetProfiles`, `coverageRows`, `lsTasks`, `sourceSignals`, and aggregate-only `learningItems`.

- [ ] Write failing parser tests for canonical valid input, unsupported fields, malformed IDs/counts/dates, cross-target records, and duplicate legacy IDs.
- [ ] Write recursive rejection tests for `statement`, `question`, `questionText`, `alternatives`, `correctAnswer`, cookies, credentials, tokens, and passwords at any depth.
- [ ] Write service tests proving target/profile import, coverage matching, LS/source ingestion, learning aggregate import, preference selection, and legacy-ID mappings.
- [ ] Prove replay returns the original report; the same migration key with a different payload returns a conflict; a failed stage resumes without duplicating completed stages.
- [ ] Implement strict immutable domain records and a stage-based migration service using deterministic idempotency keys for each delegated service.
- [ ] Run focused and strategy/learning/profile regressions, compileall, and commit `feat: migrate legacy Study OS metadata safely`.

### Task 3: Cutover API and Strict Frontend Client

**Files:**
- Create: `study_os_service/api/cutover.py`
- Modify: `study_os_service/app.py`
- Create: `tests/study_os_service/test_cutover_api.py`
- Create: `src/study-os/api/cutover.ts`
- Create: `src/study-os/api/cutover.test.ts`

**Interfaces:**
- `GET /api/v1/cutover/status` returns schema ownership, active target, migration history, and legacy mapping counts.
- `PUT /api/v1/preferences/active-target` accepts `{targetSlug, version}`.
- `POST /api/v1/cutover/browser-migration` requires `Idempotency-Key` and returns the persisted migration report.

- [ ] Write failing API tests for empty state, preference update/conflict, first import, byte-equivalent replay, changed-payload conflict, and structured validation errors.
- [ ] Implement routes and a `CutoverApiError` handler without returning raw payloads or proprietary fields.
- [ ] Write failing TypeScript parser/request tests for every DTO and error response.
- [ ] Implement the strict client with abort support and explicit idempotency headers.
- [ ] Run focused backend/frontend tests, TypeScript, compileall, and commit `feat: expose Study OS cutover API`.

### Task 4: Portable Export and Offline Restore

**Files:**
- Create: `study_os_service/db/portable.py`
- Modify: `study_os_service/cli.py`
- Modify: `study_os_service/config.py`
- Create: `tests/study_os_service/test_portable_archive.py`
- Modify: `tests/study_os_service/test_cli.py`
- Modify: `README.md`

**Interfaces:**
- Produces: `create_portable_archive(connection, destination, schema_version)`.
- Produces: `restore_portable_archive(archive_path, database_path, backup_dir)`.
- CLI: `study-os export --output PATH` and `study-os restore --from PATH`.

- [ ] Write failing archive tests for canonical manifest, SHA-256, SQLite integrity, exact allowed members, and no PDF/question content.
- [ ] Write failing restore tests for round-trip equality, bad checksum, traversal members, unsupported schema, corrupt SQLite, and automatic pre-restore backup.
- [ ] Implement ZIP creation with a SQLite online backup and a minimal canonical manifest.
- [ ] Implement restore validation before replacement; close all handles and use same-volume atomic replacement with rollback on failure.
- [ ] Extend the CLI parser and structured diagnostics; document that restore runs with the local service stopped.
- [ ] Run archive/CLI/durability tests, compileall, and commit `feat: export and restore Study OS portably`.

### Task 5: One-Time Browser Bridge and Active Target Cutover

**Files:**
- Create: `src/study-os/migration/legacyBundle.ts`
- Create: `src/study-os/migration/legacyBundle.test.ts`
- Create: `src/study-os/components/CutoverStatus.tsx`
- Modify: `src/components/PlannerArea.tsx`
- Modify: `src/study-os/components/CourseInventory.tsx`
- Modify: `src/components/QuestionPdfImport.tsx`

**Interfaces:**
- Produces: `buildLegacyBrowserBundle(storage, now)` and `clearMigratedStudyOsKeys(storage)`.
- `CutoverStatus` imports once, clears only the five duplicated `study_os_*` keys after a confirmed completed run, and exposes retry plus export guidance.
- Active target reads/writes through the cutover API; no Study OS target/profile/coverage/source key is written to localStorage.

- [ ] Write failing bundle tests proving stable migration IDs, LS task/source conversion, aggregate-only question evidence, and recursive absence of proprietary fields.
- [ ] Prove successful cleanup removes only `study_os_target_v1`, `study_os_phase_v1`, `study_os_coverage_table_v1`, `study_os_target_profiles_v1`, and `study_os_source_signals_v1`; LS/Diario keys remain untouched.
- [ ] Implement the pure bundle builder and strict localStorage adapter.
- [ ] Add the cutover status surface and preference-backed active target flow with loading, retry, completed, and service-unavailable states.
- [ ] Make Course Inventory fetch target names from the service and make Question PDF import fetch the active target preference instead of reading `study_os_target_v1`.
- [ ] Run focused tests, full TypeScript, build, and desktop/390 px smoke; commit `feat: cut over Study OS browser ownership`.

### Task 6: Retire the Duplicate Local Planner Command Layer

**Files:**
- Modify: `src/components/PlannerArea.tsx`
- Delete or reduce unused local-only Study OS helpers in `src/utils/studyPlannerCore.ts` only when no remaining caller uses them.
- Modify: affected `src/utils/*.test.ts`
- Modify: `.superpowers/sdd/progress.md`

**Interfaces:**
- Home continues to render `AutonomousDay` first.
- The collapsed LS agenda/calendar remains an optional baseline and execution bridge.
- Target/profile/coverage/source configuration is available only through service-backed Home panels and Strategy Workbench.

- [ ] Add a source-level regression proving PlannerArea no longer references duplicated Study OS storage keys or renders `StudyOSPlannerPanel`.
- [ ] Remove the old local Study OS generator, generated-day/week/refresh apply paths, local profile/coverage/source drafts, and their persistence effects.
- [ ] Preserve LS import/history/calendar/task execution and pass it to Home only as comparison metadata.
- [ ] Remove now-dead imports/helpers while keeping established Diario question-card flows unchanged.
- [ ] Run all frontend tests, TypeScript, build, browser desktop/mobile smoke, and commit `refactor: make local service the Study OS command layer`.

### Task 7: M7 Durability, Offline, and Production Cutover Gate

**Files:**
- Create: `tests/study_os_service/test_cutover_durability.py`
- Modify: `scripts/start-study-os.ps1`
- Modify: `start-app.bat` only if the gate finds a startup defect.
- Modify: `.superpowers/sdd/progress.md`
- Modify: `docs/study-os/course-package-decision.md`

**Interfaces:**
- Production evidence includes migration report/hash, settings, legacy mappings, inventory, progress, sessions, review, planner, strategy, and learning table hashes.

- [ ] Import a realistic legacy browser bundle twice and prove identical reports plus table hashes across restart.
- [ ] Export, restore into a fresh data directory, and compare all command-layer hashes and exact session cursor/version values.
- [ ] Start through `start-app.bat` with Docker stopped/unavailable and block every HTTPS request.
- [ ] Complete one real mapped regular-PDF block, one metadata-only TEC block, one bounded review, and a next-day refresh without LS.
- [ ] Verify no proprietary question content or credential-like field appears in API payloads, SQLite, logs, migration reports, or archive members.
- [ ] Run full Python/frontend regressions, compileall, TypeScript, build, diff checks, and desktop/390 px browser gates.
- [ ] Close M2/M6/M7 only after package `249654` is freshly validated, scanned, mapped, and included in this gate; commit `docs: close Study OS production cutover`.

## M7 Acceptance

M7 is complete only when migration and replay are idempotent, the browser has no duplicate Study OS ownership, a portable archive restores every command-layer decision and cursor, startup works offline without Docker, and the real-package no-LS execution gate passes. Fixture evidence may complete Tasks 1-6 but cannot close Task 7 or the active thread goal.
