# Study OS Local Service Design

**Status:** Approved design
**Date:** 2026-07-10
**Repository:** `C:\Docker\Diario-Questoes`
**Branch:** `codex/study-os-planner-core`

## 1. Purpose

Study OS is the operational study system inside Diario-Questoes. It must be able to work alongside LS, Trilha Estratégica, Guia Andrety, and TEC, but it must also remain fully useful when none of those sources is available.

The product decides what the user should study today, opens the correct material at the correct place, limits the amount of work, records partial execution, and adapts later decisions from actual results. It does not require a local LLM. ChatGPT or Codex remains an external explanation and correction tool; Study OS only prepares contextual prompts.

The system is personal, local-first, Windows-first, offline-capable, and metadata-only for TEC content.

## 2. Audit Evidence

### 2.1 Current Diario-Questoes state

The current branch already proves several useful concepts:

- a month/week planner and a Today command center;
- imported LS/meta tasks;
- a four-block deterministic planner prototype;
- target-aware scoring and score explanations;
- question result metadata, doubts, favorites, and aggregate performance;
- bounded ChatGPT prompt generation;
- target-aware question-bank isolation;
- LS, Trilha, Andrety, TEC, and manual source signals;
- frontend and pure TypeScript tests.

The current architecture is not yet a durable LS replacement because:

- course, lesson, material, topic, and cursor are not first-class persisted entities;
- coverage and source data are pipe-delimited strings in localStorage;
- the planner cannot resume an exact page;
- session history cannot represent partial reading progress;
- review candidates are broad topic approximations rather than bounded events;
- `PlannerArea.tsx` and `studyPlannerCore.ts` have accumulated multiple responsibilities;
- existing Supabase synchronization covers study tasks, not the complete Study OS state.

### 2.2 Real package state

The audited package at `C:\Users\JP\Downloads\Pacote Regular Fiscal 2023` contains:

- 3,589 PDF files;
- approximately 6.98 GB;
- 22 course/trilha directories containing PDFs;
- lesson numbers from 1 through 47;
- the lesson number in the filename of every audited PDF;
- multiple material variants per lesson, including original, highlighted, simplified, slides, summaries, mind maps, Bizu, and Trilha files.

The course directory identifies the course or discipline. The immediate `PDF` directory does not. The filename identifies the lesson and material variant. A scanner that only searches parent folders for `Aula N` is therefore incorrect for this package.

### 2.3 Fiscal Brain evidence

Fiscal Brain is reference material, not a dependency or target repository.

Concepts worth adapting:

- SQLite repository and migration patterns;
- external question session aggregates;
- idempotent material records;
- TEC aggregate hierarchy parser and question-content boundary tests;
- weekly calendar interaction concepts.

Components that must be rewritten:

- directory scanner and discipline normalization;
- priority engine with fixed edital weight and zero review/phase weights;
- credentialed TEC fetching before production use;
- large repository modules with mixed responsibilities.

Components explicitly excluded:

- Neo4j;
- Qdrant and embeddings;
- GraphRAG;
- Ollama or any mandatory local LLM;
- Whisper/audio transcription;
- Docling or OCR in batch;
- background worker fleets;
- mandatory Docker.

## 3. Architectural Decision

Study OS will use the existing React/Vite frontend plus a small Python service started automatically by `start-app.bat`.

### 3.1 Why not browser-only

Browser directory APIs require a user gesture, browser permission, and browser-specific support. Directory permission can require renewal between sessions. Browser-only storage would also leave file opening, large scans, migrations, backups, and relational queries tied to one browser origin.

### 3.2 Why not CLI-only

A CLI can reliably scan the package but creates recurring manual work. It cannot provide seamless material opening, live progress updates, automatic rescans, or a low-friction daily execution loop. A scan CLI will exist as a diagnostic entry point to the same service code, not as the main product.

### 3.3 Selected topology

```text
start-app.bat
  |-- starts Study OS Python service on 127.0.0.1
  |-- starts Vite during development
  |-- waits for /api/v1/health
  `-- opens http://localhost:3000

React/Vite
  |-- Study OS API client
  |-- Today, Calendar, Course, Review, and Settings views
  `-- existing Diario task/question execution surfaces

Study OS service
  |-- SQLite repository and migrations
  |-- course inventory scanner
  |-- material reader/opener
  |-- deterministic planner
  |-- session and review engines
  |-- source-signal and TEC aggregate adapters
  `-- backup/export service
```

During development, Vite proxies relative `/api/v1` and `/files` requests to the service. A packaged release can let the service host the built frontend. The service binds only to `127.0.0.1`; it does not expose a LAN interface.

## 4. Module Boundaries

The Python service is split into focused modules:

```text
study_os_service/
  app.py                 HTTP composition only
  config.py              paths, ports, retention, feature flags
  domain/                immutable domain records and enums
  db/                    connection, migrations, repositories, backup
  ingest/                scan, classify, reconcile, on-demand PDF metadata
  planner/               candidate generation, scoring, constraints, decisions
  sessions/              start, partial save, finish, skip, resume
  reviews/               review-event lifecycle and confirmation rules
  sources/               edital, LS, Trilha, Andrety, TEC aggregate adapters
  api/                    thin endpoint routers and request/response schemas
  cli.py                  scan, verify, backup, and export diagnostics
```

The frontend gains a `src/study-os/` boundary:

```text
src/study-os/
  api/                    typed HTTP client and error normalization
  domain/                 frontend DTO types only
  hooks/                  query and mutation hooks
  components/             Today, Course, Review, Scoreboard, setup controls
  migration/              one-time localStorage export/import bridge
```

The planner does not read files, perform HTTP requests, or call TEC. It accepts a complete immutable input snapshot and returns candidates, selected blocks, and decision evidence.

## 5. Domain Model

### 5.1 ExamTarget

- `id`, `slug`, `name`, `institution`, `role`, `organizer`;
- `phase`: pre-edital or pos-edital;
- `exam_date`, `notice_date`, `available_minutes_default`;
- `daily_block_limit`, default 4;
- `active`, `created_at`, `updated_at`.

### 5.2 Course

- `id`, `target_id`, `display_name`, `provider`, `root_path`;
- `source_kind`: local_folder, manual_manifest, or imported;
- `active`, `scan_state`, `last_scanned_at`, `created_at`, `updated_at`.

A target may use multiple courses. A discipline may have multiple alternative courses, but only one course is the active advancement source unless the user explicitly changes it.

### 5.3 Discipline

- `id`, canonical `name`, optional `aliases`;
- target-specific `edital_weight`, `tier`, `priority_override`;
- `enabled`, `display_order`.

Weights are data, never hard-coded by discipline name. This supports cases such as Finanças Públicas having a different weight in a specific edital.

### 5.4 Lesson

- `id`, `course_id`, `discipline_id`, `lesson_number`, `title`;
- `sequence_index`, `status`, `estimated_minutes`;
- `available`, `created_at`, `updated_at`.

`lesson_number` is extracted from the filename. `sequence_index` provides deterministic ordering even when lessons use non-numeric labels later.

### 5.5 Topic and LessonTopic

`Topic` contains a canonical discipline-scoped topic name and optional TEC hierarchy identity.

`LessonTopic` maps a lesson to one or more topics with:

- `source`: manual, edital, TOC extraction, TEC mapping, LS, or Trilha;
- `confidence`: 0 through 1;
- `confirmed`: boolean.

Unconfirmed mappings may inform setup screens but cannot independently create high-priority work.

### 5.6 Material

- `id`, `lesson_id`, absolute `path`, `relative_path`;
- `kind`: original, simplified, highlighted, slides, mind_map, summary, bizu, track, other;
- `size_bytes`, `modified_at`, optional lazy `content_hash`;
- `page_count`, `page_offset`, `available`;
- `is_primary`, `trust_level`.

`page_offset` maps a printed page number to the physical PDF page when needed. The original or simplified apostila normally becomes primary. Bizu can never be primary automatically.

### 5.7 ProgressState

- `lesson_id`, `material_id`, `status`: unread, in_progress, covered, stale, weak, strong;
- `cursor_page`, `furthest_page`, `completed_at`, `last_seen_at`;
- `confidence`, `total_minutes`, `session_count`;
- optimistic `version`.

The cursor belongs to a specific material because page numbers are not transferable between original, simplified, and highlighted PDFs.

### 5.8 StudySession

- `id`, `daily_block_id`, `lesson_id`, `material_id`, optional `topic_id`;
- `started_at`, `ended_at`, `elapsed_seconds`;
- `start_page`, `end_page`, `questions_done`;
- `correct_count`, `wrong_count`, `doubt_count`, `favorite_count`;
- `outcome`: partial, completed, failed, skipped, abandoned;
- `skip_reason`, `notes`.

Saving a partial session advances the cursor to the last confirmed page. It does not mark the lesson complete and does not count as failure.

### 5.9 ReviewEvent

- `id`, target, discipline, optional lesson/topic;
- `trigger`: wrong_answer, doubt, favorite, low_performance, stale_coverage, manual;
- `due_at`, `scope_count`, `confirmation_count`, `estimated_minutes`;
- `state`: pending, scheduled, completed, dismissed;
- `source_session_id`, `completed_at`.

### 5.10 QuestionResult

- source and external session/caderno identifiers;
- discipline, topic, bank, date;
- planned and completed counts;
- correct, wrong, doubt, and favorite counts;
- optional local error tags and notes.

TEC question statements, alternatives, answer keys, and proprietary comments are not stored by Study OS.

### 5.11 SourceSignal

- `target_id`, optional discipline/lesson/topic;
- `kind`: edital, course, tec_incidence, ls, trilha, andrety, manual, bizu;
- `value`, `trust`, `observed_at`, `expires_at`;
- source reference and explanatory text.

Source hierarchy is enforced by trust ceilings. Course inventory and edital facts can be authoritative. TEC aggregates and user history are high-trust tactical inputs. LS, Trilha, and Andrety are comparative inputs. Bizu has a low ceiling and cannot create a primary theory block.

### 5.12 DailyStudyBlock and PlannerDecision

`DailyStudyBlock` is an executable instruction:

- action kind: theory, questions, or review;
- discipline, lesson, topic, material;
- page start/end or question/review counts;
- maximum minutes;
- explicit stop condition;
- state and linked session.

`PlannerDecision` stores:

- target, date, planner policy version, and input snapshot hash;
- every candidate and score component;
- chosen/displaced state and constraint reason;
- generated and applied timestamps.

The decision log makes every divergence from LS or Trilha explainable.

## 6. SQLite Persistence

SQLite is the source of truth. Core tables mirror the domain model and use foreign keys, unique constraints, and migrations.

Required operational tables include:

- `schema_migrations`;
- `exam_targets`, `target_disciplines`;
- `courses`, `disciplines`, `course_disciplines`;
- `lessons`, `topics`, `lesson_topics`;
- `materials`, `progress_states`;
- `study_sessions`, `review_events`, `question_results`;
- `source_signals`;
- `planner_runs`, `planner_candidates`, `daily_study_blocks`;
- `import_runs`, `import_issues`, `app_events`.

SQLite configuration:

- `PRAGMA foreign_keys=ON`;
- WAL mode;
- bounded busy timeout;
- short transactions;
- repository methods own SQL;
- service methods own multi-repository transactions.

Backups use the SQLite backup API after a checkpoint rather than copying a live database file. Retention is 14 daily and 8 weekly backups. JSON export is available for portability and debugging.

## 7. Course Ingestion

### 7.1 Scan phase

The scan reads filesystem metadata only:

1. enumerate supported files under a configured course root;
2. identify the course directory above `PDF`;
3. normalize a canonical discipline candidate from the course directory;
4. parse lesson number from the filename using patterns that accept `Aula 01`, `Aula 1`, `Aula 001`, underscores, spaces, and suffixes;
5. classify the material variant;
6. group materials by course, discipline, and lesson;
7. reconcile the result transactionally.

The stable material identity is course plus normalized relative path. Size and modified time detect ordinary changes. A content hash is calculated only when identity is ambiguous or a changed file must be confirmed.

### 7.2 Reconciliation rules

- Existing progress and sessions are never deleted by a scan.
- Missing files are marked unavailable.
- Renames are proposed when size, lesson, kind, and optional hash match.
- Duplicate course providers remain separate courses.
- Unknown discipline mappings enter an issue queue.
- Reimporting the same root is idempotent.

### 7.3 Material selection

Default preference:

1. original apostila;
2. simplified apostila when configured for that discipline;
3. highlighted apostila;
4. other trusted lesson PDF;
5. slides or maps only as support;
6. Bizu never as automatic primary.

The user can set a per-course or per-discipline preference.

### 7.4 On-demand PDF inspection

Page count, document outline, and selected introductory/TOC pages are extracted only when a lesson is opened, mapped, or selected by the planner. Full-text indexing is outside this product.

The service exposes a same-origin local PDF stream. The frontend opens it with a page fragment so a block can start at the recorded physical page.

## 8. Target and Edital Ingestion

An ExamTarget can be created from a manual table or edital import. The first production path is manual/editable because edital structures vary and legal accuracy matters.

Target discipline configuration records:

- edital weight;
- enabled status;
- deadline and phase;
- organizer/banca;
- optional incidence and priority overrides;
- aliases used to map course and TEC names.

No rumor automatically changes an active target. Source URLs and notes remain audit evidence.

## 9. TEC Boundary and Adapters

### 9.1 Supported order

1. manual paste of aggregate hierarchy and counts;
2. import of saved aggregate JSON/HTML;
3. explicit credentialed aggregate fetch after real-session verification;
4. optional browser-assisted aggregate capture.

The existing hierarchy parser is adapted behind fixture tests. The authenticated fetch remains disabled by default until login, cache, rate limiting, payload drift, and failure behavior are verified against a real session.

### 9.2 Hard boundary

The service rejects imports containing question-like fields or paths. It stores only aggregate subject/topic metadata and the user's own result counts. Credentials are read from an ephemeral environment/session and are not written to SQLite.

## 10. Daily Planner

### 10.1 Planning lifecycle

A plan is generated when the day is first opened or the user explicitly requests regeneration. The applied plan remains stable during execution. New results affect the next plan unless the user explicitly refreshes today.

### 10.2 Candidate generation

Candidates are created from:

- an unfinished block or in-progress lesson continuation;
- the next eligible lessons near each discipline's course frontier;
- due review events;
- question practice for covered/current topics;
- recent wrong answers and doubts;
- manual must-do items;
- trusted external source suggestions.

The course frontier allows limited lookahead, default two lessons, so the planner can favor a high-incidence nearby lesson without jumping arbitrarily through the course.

### 10.3 Score components

Every component is normalized from 0 to 10. A versioned policy calculates:

```text
score =
  weakness * phase.weakness
  + incidence * phase.incidence
  + edital_weight * phase.edital_weight
  + coverage_need * phase.coverage_need
  + review_debt * phase.review_debt
  + deadline_pressure * phase.deadline
  + sequence_readiness * phase.sequence
  + continuity * phase.continuity
  + banca_fit * phase.banca
  + external_alignment * phase.external_alignment
  - balance_penalty
  - overload_penalty
  - low_trust_penalty
```

Default emphasis:

- pre-edital favors coverage, sequence, and continuity while still prioritizing weakness;
- pos-edital increases weakness, incidence, edital weight, deadline, and banca influence;
- LS, Trilha, and Andrety alignment remains capped below decisive user-history and edital factors;
- Bizu receives a low-trust penalty and cannot be the only material source.

Target-specific edital weight is read from the target discipline record. It is never inferred from a global discipline default.

### 10.4 Selection constraints

Default day:

- available budget: 240 minutes;
- maximum 4 blocks;
- preferred mix: 1 theory, 2 question, 1 review;
- block duration: 45 to 75 minutes;
- maximum 2 blocks from the same discipline;
- no duplicate action for the same lesson/topic;
- no review block without a bounded review event;
- total planned minutes cannot exceed the available budget.

The preferred mix is a target, not a reason to invent work. If no review is due, the slot may become continuation or questions. If the user has less time, the planner returns fewer blocks instead of shrinking every block into ineffective fragments.

### 10.5 Executable stop conditions

Theory block example:

```text
Continue Aula 07, PDF original, physical pages 18-42.
Stop after page 42 or 60 minutes, whichever comes first.
```

The page range uses the user's observed reading rate for that discipline and material kind. Until enough history exists, the default is 20 physical pages per 60 minutes, bounded to 10-30 pages.

Question block example:

```text
Do 25 TEC questions for topics X and Y.
Stop after 25 questions or 55 minutes.
```

Review block example:

```text
Correct 6 recent errors, then do 8 confirmation questions.
Stop after confirmation or 45 minutes.
```

## 11. Session and Progress Rules

### 11.1 Theory

- Starting creates a StudySession with the exact cursor.
- Page updates are explicitly confirmed or saved at finish.
- Partial outcome advances the cursor and preserves the block as a continuity candidate.
- Lesson completion requires reaching the material end or explicit completion.

### 11.2 Questions

- The app stores planned and completed counts and aggregate outcomes.
- Wrong and doubt counts create bounded ReviewEvents.
- High performance can strengthen topic coverage but does not automatically mark an unread lesson as read.

### 11.3 Skip and failure

Skip reasons are quick choices: lack of time, fatigue, wrong material, blocked prerequisite, too difficult, or other.

- lack of time carries the block forward without a weakness penalty;
- fatigue reduces immediate overload and avoids scheduling a larger next day;
- wrong material creates an import/configuration issue;
- blocked prerequisite changes eligibility;
- too difficult creates weakness/review evidence;
- repeated skip increases continuity debt with a cap.

## 12. Review Engine

Review is event-based, not a recurring broad reread task.

Rules:

- wrong answer: next-day correction event;
- doubt: correction event within 1-3 days depending on incidence;
- low-performance block: bounded concept review plus confirmation questions;
- stale high-incidence topic: short active recall or small question set;
- completed lesson: optional 3/10/30-day checkpoints only when edital weight, incidence, or weakness justifies them;
- successful confirmation closes the event;
- repeated failure creates a new narrower event rather than reopening the entire lesson.

No review event may request an unbounded reread. Every event records a count, page range, or time limit and an explicit completion condition.

## 13. Local API

Initial API surface:

```text
GET  /api/v1/health
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

GET  /api/v1/targets
PUT  /api/v1/targets/{id}
PUT  /api/v1/targets/{id}/disciplines

POST /api/v1/planner/day/generate
POST /api/v1/planner/day/apply
GET  /api/v1/planner/day/{date}
GET  /api/v1/planner/runs/{id}/scoreboard

POST /api/v1/sessions
PATCH /api/v1/sessions/{id}
POST /api/v1/sessions/{id}/finish
POST /api/v1/sessions/{id}/skip

GET  /api/v1/reviews/due
POST /api/v1/question-results
POST /api/v1/source-signals/import
POST /api/v1/tec/aggregate/import

POST /api/v1/migrations/legacy-diario
POST /api/v1/backups
GET  /api/v1/exports/study-os.json
```

Mutating endpoints support idempotency keys where retries could duplicate a session, import, or planner run.

## 14. Frontend Design

Home/Painel remains the command center:

- target selector;
- available-time control;
- today's best blocks;
- continuation cursor;
- start/open material command;
- quick finish, partial, fail, and skip actions;
- compact reason and stop condition;
- expandable scoreboard and LS comparison.

Secondary views:

- **Course:** inventory, lesson frontier, material variants, mappings, scan issues;
- **Calendar:** applied blocks and history, not speculative score candidates;
- **Reviews:** bounded due events and confirmation state;
- **Sources:** edital, TEC aggregates, LS, Trilha, Andrety, and trust;
- **Settings:** roots, active course, material preferences, backup, migration.

The current 3,800-line PlannerArea is decomposed while each vertical workflow is moved. Existing screens continue to work during migration.

## 15. Error Handling and Observability

- API errors use stable codes, a user-safe message, and optional diagnostics.
- Import runs persist counts, warnings, unresolved mappings, and failed files.
- A failed file never aborts the entire scan.
- A failed scan does not replace the last valid inventory.
- Planner runs persist their input hash and policy version.
- Missing material prevents block application and produces a repair action.
- Database migrations run transactionally and create a pre-migration backup.
- Service logs rotate locally and never include PDF content or credentials.
- `/health` reports database, migrations, configured roots, and backup freshness.

## 16. Migration and Coexistence

SQLite becomes authoritative incrementally.

1. The existing Diario app remains operational.
2. A one-time browser migration bundle imports target profiles, planner tasks, result aggregates, and question metadata.
3. Existing local PDF question content remains in Diario's execution module and is not copied into the Study OS TEC store.
4. Imported records carry legacy IDs and idempotency keys.
5. Each Study OS frontend workflow switches to API data only after its vertical milestone passes.
6. localStorage Study OS keys become read-only compatibility inputs, then are removed in a later migration.
7. Existing Supabase task sync stays isolated until a complete Study OS backup/sync design is explicitly approved.

The uncommitted package-ingestion experiment present when this design was requested is preserved. The implementation plan must decide which pure parsing tests to retain and which UI work is superseded by the service scanner.

## 17. Testing Strategy

### 17.1 Scanner fixtures

Fixtures reproduce exact real naming patterns:

- `Aula 01_Apostila.pdf`;
- `Aula 01_Apostila_grifada.pdf`;
- `Aula 01_Apostila_simplificada.pdf`;
- `Aula 01_01_Slide.pdf`;
- `Aula 001 - ...` and unpadded variants;
- duplicate course providers;
- Trilha and Bizu course directories;
- missing, renamed, and modified files.

### 17.2 Domain and repository

- migrations from an empty and previous-version database;
- idempotent scan and import;
- progress preservation across rescan;
- transaction rollback;
- backup and restore;
- query isolation by target.

### 17.3 Planner

- exact page continuation wins when appropriate;
- high-ROI weakness beats LS alignment;
- edital weight changes priority per target;
- pre-edital favors coverage and sequence;
- pos-edital favors incidence, weakness, deadline, and banca;
- no more than two blocks per discipline;
- no budget overflow;
- no broad review task;
- low-trust material cannot become primary;
- partial, skipped, failed, and completed sessions alter the next day correctly;
- identical input and policy version produce identical decisions.

### 17.4 TEC boundary

- aggregate hierarchy accepted;
- question-like content rejected;
- forbidden endpoints absent;
- credentials absent from SQLite and logs;
- cache/rate-limit/failure fixtures for optional authenticated capture.

### 17.5 API and frontend

- API contract tests using a temporary SQLite database and fixture tree;
- Home empty/setup state;
- scan progress and issue recovery;
- start material at exact page;
- partial session and resume;
- generated no-LS day with four executable blocks;
- LS comparison without LS control;
- production build, typecheck, browser smoke, and desktop/mobile layout checks.

## 18. Vertical Milestones

### M1. Local service foundation

Deliver:

- service process, health endpoint, SQLite migrations, repository skeleton;
- Vite proxy and `start-app.bat` orchestration;
- backup and diagnostics CLI.

Acceptance: one command opens the existing app, health is visible, database initializes, and backup/restore tests pass.

### M2. Real course inventory

Deliver:

- root configuration and metadata-only scanner;
- course/discipline/lesson/material records;
- material classification and primary selection;
- Course inventory UI and local PDF opening.

Acceptance: the real package scans idempotently, reports 3,589 PDFs, detects lesson numbers from filenames, groups variants, and opens a selected material.

### M3. Exact progress and sessions

Deliver:

- ProgressState and StudySession lifecycle;
- exact page opening, partial save, resume, completion, and skip reason;
- reading-rate calculation.

Acceptance: stop halfway through a lesson, restart the app, and resume at the confirmed page without manual reconstruction.

### M4. Autonomous no-LS day

Deliver:

- target/editable edital configuration;
- candidate generation, versioned scoring, constraints, PlannerDecision;
- Home blocks with material, pages/count, time, stop condition, and reasons.

Acceptance: a target with course inventory and no LS generates a balanced executable day within the time budget and records a complete scoreboard.

### M5. Bounded review loop

Deliver:

- QuestionResult aggregates, ReviewEvent lifecycle, correction/confirmation blocks;
- adaptive handling of partial, skipped, failed, and successful sessions.

Acceptance: six wrong answers create one bounded review, successful confirmation closes it, and the next day changes without broad rereading.

### M6. External source hierarchy

Deliver:

- TEC manual/JSON aggregate imports;
- LS, Trilha, Andrety, and edital SourceSignals;
- comparison and mismatch UI;
- optional authenticated aggregate capture behind a disabled-by-default feature flag after real verification.

Acceptance: the planner explains source agreement/divergence, target mismatch does not leak, and no external source can override the command layer alone.

### M7. Migration and cutover

Deliver:

- idempotent migration of existing Study OS metadata;
- removal of duplicate localStorage ownership;
- end-to-end backup/export and offline validation;
- production startup without Docker.

Acceptance: after migration and restart, course cursor, sessions, reviews, plans, and decisions remain intact; the app operates without LS and without internet.

## 19. Product Completion Criteria

The Study OS is not complete merely because it can rank topics. Completion requires evidence that it can:

1. inventory a real course and all lesson/material variants;
2. identify and resume the exact study cursor;
3. generate an executable day without LS;
4. enforce workload and balance constraints;
5. open the correct material and page;
6. record partial and completed sessions;
7. create and close bounded review events;
8. learn from question aggregates, errors, doubts, time, skips, and failures;
9. incorporate edital weight and TEC incidence;
10. treat LS, Trilha, Andrety, and Bizu according to their trust hierarchy;
11. explain every planner decision and displaced alternative;
12. survive restart, rescan, migration, and backup restore;
13. run offline without Docker, a local LLM, vector database, or graph database.

The active thread goal is achieved only when all thirteen criteria are implemented and verified against the real application state.
