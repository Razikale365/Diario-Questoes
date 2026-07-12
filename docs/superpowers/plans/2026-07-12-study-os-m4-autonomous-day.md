# Study OS M4 Autonomous Day Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Implement task-by-task with red-green-refactor and one focused commit per task.

**Goal:** Make SQLite generate and explain the best executable study day for one selected target without depending on LS, while retaining LS/trilha as optional comparison evidence.

**Architecture:** Schema v5 makes target profiles, edital/topic weights, immutable planner runs, scored candidates, and executable blocks authoritative in the local Study OS service. Pure services build and score candidates deterministically from inventory, exact progress, explicit transfer rules, manual topic/source metadata, and recent session outcomes. Home reads these persisted blocks directly. Existing browser-local LS tasks remain visible as a comparison baseline until the later migration milestone; generated Study OS blocks are never dual-authored into localStorage.

**Tech Stack:** Python 3.11+, SQLite WAL, FastAPI, React 19, TypeScript 5.8, Vite 6, Node test runner.

## Global Constraints

- M2 remains open until package `249654` is freshly downloaded and verified. M4 fixture/manual-profile evidence must not be reported as real-package acceptance.
- SQLite is authoritative for generated plans, candidates, score evidence, block state, and target configuration.
- No local LLM, embeddings, vector database, graph database, OCR batch, Docker dependency, or internet requirement at runtime.
- TEC stays metadata-only. Store caderno URL/id, target, discipline/topic, planned count, and aggregate results only; never store proprietary question text, alternatives, keys, or comments.
- Dicas/Bizus is optional low-trust support. It cannot be a primary theory source or the only evidence behind a chosen block.
- Every generation/refresh mutation requires an `Idempotency-Key`, uses `BEGIN IMMEDIATE`, and returns structured `{code,message}` errors.
- Planner runs are immutable evidence. Refresh creates a new run linked to the superseded run; it never rewrites prior scores.
- Scoring uses decimal-safe deterministic arithmetic or explicitly rounded integer basis points. Ties use stable keys, never iteration order or wall-clock randomness.
- A normal day targets four 45-75 minute blocks: one theory/reread, two TEC metadata blocks, and one bounded error-driven review.
- No more than two chosen blocks may share a discipline unless the run records `pool_forced_balance_exception`.
- Do not invent a block to satisfy quota. If an executable source is missing, return a visible shortfall with the exact stop reason.

## Exact Executability Stop Conditions

A candidate is excluded, with persisted evidence, when any condition applies:

1. target, lesson, material, or topic relation is missing or mismatched;
2. material is unavailable, outside its registered root, non-PDF for a reading block, or not the selected primary original/reread variant;
3. target-specific content is transferred without `shared` or explicit partial-transfer metadata;
4. progress is `covered`/`strong` and neither stale debt nor a review trigger exists;
5. a TEC block has no external source metadata or a non-positive bounded question count;
6. an error-review block has no recent wrong/doubt/favorite/failed/weak evidence;
7. Dicas/Bizus is the only material evidence;
8. the same material/topic/block kind is already chosen that day without an explicit proof-repeat reason;
9. the daily quota, time budget, or maximum two blocks per discipline would be exceeded;
10. a prerequisite is explicitly blocked or the source is archived/unavailable.

The generator stops when four executable blocks are chosen or the remaining candidates all have stop reasons. `shortfall_count` and `shortfall_reasons` are part of the run contract.

---

## Task 1: Add Planner Schema Version 5 and Domain Records

**Files:**
- Modify: `study_os_service/db/migrations.py`
- Create: `study_os_service/domain/planner.py`
- Create: `tests/study_os_service/test_planner_migration.py`
- Create: `tests/study_os_service/test_planner_domain.py`

**Schema:**

- `exam_targets`: editable target identity, institution, role, banca, phase, deadline, daily quota, priority, source URLs JSON, active/version/timestamps.
- `target_topics`: target, discipline, topic, coverage status, edital weight, incidence, tier, banca fit, overlap value, transfer kind, optional lesson/material, TEC source metadata, review debt, active/version/timestamps.
- `planner_runs`: idempotency key, target/date/phase/quota/time budget, algorithm version, input hash, supersedes id, status, shortfall JSON, generated timestamp.
- `planner_candidates`: run, stable candidate key, block kind/source kind, optional topic/lesson/material, every score component, penalties, final score basis points, chosen position, displaced-by key, stop reason, evidence JSON.
- `planner_blocks`: run/candidate, target/date/position, block kind, title, duration, planned questions, state, optional execution session, aggregate result counts, result version/timestamps.

Add indexes for target/date, run/chosen position, exact topic/material identity, and pending blocks. Use foreign keys and checks for all enums/counts/versions.

- [ ] Write migration/domain RED tests, including v4-to-v5 preservation and invalid cross-field records.
- [ ] Run `python -m pytest tests/study_os_service/test_planner_migration.py tests/study_os_service/test_planner_domain.py -q` and confirm RED.
- [ ] Implement migration and immutable validated records.
- [ ] Run focused tests plus `tests/study_os_service/test_session_migration.py`.
- [ ] Commit `feat: add Study OS planner schema`.

## Task 2: Persist Editable Targets and Topic Evidence

**Files:**
- Create: `study_os_service/repositories/planner_profiles.py`
- Create: `study_os_service/services/planner_profiles.py`
- Create: `study_os_service/api/planner_profiles.py`
- Modify: `study_os_service/app.py`
- Create: `tests/study_os_service/test_planner_profiles.py`
- Create: `tests/study_os_service/test_planner_profile_api.py`

**Endpoints:**

```text
GET  /api/v1/planner/targets
PUT  /api/v1/planner/targets
POST /api/v1/planner/targets/seed
GET  /api/v1/planner/topics?targetSlug=...
PUT  /api/v1/planner/topics
```

Seed editable local defaults for `bacen_economia_financas`, `rfb_auditor`, `rfb_analista`, and `sefaz_ce`. Import the existing frontend seed values as initial data only, not hard-coded truth. Preserve user edits on reseed. Discipline weight is per target/topic and may be `2` or another valid value; never assume ordinary weight `1` in pós-edital mode.

- [ ] RED tests: seed idempotence, manual edit preservation, target isolation, phase/deadline validation, explicit transfer policy, and SEFAZ Finanças Públicas weight override.
- [ ] Implement repository/service/API transactions and structured errors.
- [ ] Verify profile APIs with and without course inventory.
- [ ] Commit `feat: persist Study OS target profiles`.

## Task 3: Build Executable Candidates with Persisted Stop Evidence

**Files:**
- Create: `study_os_service/services/planner_candidates.py`
- Create: `tests/study_os_service/test_planner_candidates.py`

**Candidate sources:**

- theory/reread from available primary original course material and exact material progress;
- TEC question blocks from external source metadata and target/topic evidence;
- error review from recent wrong/doubt/favorite aggregates, failed sessions, `weak` progress, or explicit review debt;
- optional LS/trilha/manual alignment as one evidence component, never the command source.

Return both executable candidates and rejected candidates with one canonical stop reason plus evidence. Preserve material variant identity and explicit target transfer confidence.

- [ ] RED tests for all ten stop conditions.
- [ ] Prove BACEN excludes RFB-specific content unless explicitly transferable.
- [ ] Prove Dicas/Bizus cannot become primary and ordinary scans remain content-blind.
- [ ] Implement pure candidate builder with stable candidate keys.
- [ ] Commit `feat: build executable Study OS candidates`.

## Task 4: Implement Deterministic Target-Aware Scoring

**Files:**
- Create: `study_os_service/services/planner_scoring.py`
- Create: `tests/study_os_service/test_planner_scoring.py`

**Score components persisted for every candidate:**

`weakness`, `incidence`, `tier`, `coverage_need`, `review_debt`, `ls_alignment`, `target_fit`, `overlap_value`, `deadline_pressure`, `banca_fit`, `edital_weight`, `balance_penalty`, `low_trust_penalty`, `final_score`.

Pre-edital base weights: weakness `3.0`, incidence `1.5`, tier `1.5`, coverage `2.0`, review debt `1.5`, LS alignment `0.5`.

Pós-edital base weights: weakness `3.5`, incidence `2.5`, tier `1.5`, coverage `1.0`, review debt `1.0`, LS alignment `0.5`.

Target fit, overlap, deadline, banca fit, and edital weight are normalized inputs with explicit tested coefficients. Use basis points and stable tie-break order: final score, weakness, edital weight, incidence, candidate key.

- [ ] RED tests: high-ROI weakness beats LS alignment; pre-edital favors unread/stale; pós-edital favors incidence/deadline; edital weight override changes order; mismatch transfer loses; same input produces byte-identical score evidence.
- [ ] Implement pure scorer and canonical JSON input hash.
- [ ] Commit `feat: score Study OS planner candidates`.

## Task 5: Generate and Refresh an Idempotent Balanced Day

**Files:**
- Create: `study_os_service/repositories/planner_runs.py`
- Create: `study_os_service/services/planner_generation.py`
- Create: `study_os_service/api/planner.py`
- Modify: `study_os_service/app.py`
- Create: `tests/study_os_service/test_planner_generation.py`
- Create: `tests/study_os_service/test_planner_api.py`

**Endpoints:**

```text
POST /api/v1/planner/generate-day
POST /api/v1/planner/refresh-day
GET  /api/v1/planner/day?targetSlug=...&date=YYYY-MM-DD
GET  /api/v1/planner/scoreboard?runId=...
POST /api/v1/planner/blocks/{id}/result
```

Selection is a deterministic constrained pass: reserve the required mix, choose highest score per slot, apply balance and duplicate constraints, then persist all chosen/displaced/rejected alternatives in one transaction. Retry with the same key returns the same run. Refresh consumes finished/skipped/failed blocks and creates a linked immutable run.

- [ ] RED tests for full no-LS four-block BACEN and RFB days, balance, source mix, shortfall, idempotency, concurrent generation, and refresh after each result state.
- [ ] Implement repositories/service/router with `BEGIN IMMEDIATE`.
- [ ] Verify scoreboard exposes every component, chosen position, displaced-by, and stop reason.
- [ ] Commit `feat: generate autonomous Study OS days`.

## Task 6: Add Strict Planner Client and Execution Links

**Files:**
- Create: `src/study-os/api/planner.ts`
- Create: `src/study-os/api/planner.test.ts`
- Modify: `study_os_service/api/sessions.py`
- Modify: `study_os_service/services/sessions.py`
- Create: `tests/study_os_service/test_planner_session_link.py`

The client strictly parses targets, topics, day/run/block DTOs, score evidence, shortfall reasons, and structured conflicts. Theory blocks start an exact material session linked to `planner_block_id`; TEC/review blocks launch the existing external flow and submit aggregate results only.

- [ ] RED parser/request tests and backend link tests.
- [ ] Implement optional validated `plannerBlockId` on session start and atomic block/session linkage.
- [ ] Prove another target/run cannot claim the block.
- [ ] Commit `feat: link Study OS plans to execution`.

## Task 7: Make Home the Autonomous Command Center

**Files:**
- Create: `src/study-os/components/AutonomousDay.tsx`
- Create: `src/study-os/domain/dayView.ts`
- Create: `src/study-os/domain/dayView.test.ts`
- Modify: `src/components/PlannerArea.tsx`

**UI:**

- target selector and date at the top;
- “Melhores 4 blocos de hoje” as the primary surface;
- each row shows discipline/topic, block kind, duration/questions, source trust, exact start/continue command, and one concise “por que agora” line;
- expandable scoreboard table with all components, chosen/displaced evidence, and explicit shortfalls;
- LS/trilha comparison is secondary and labeled match/partial mismatch/target mismatch;
- completion, skip, fail, TEC aggregate result, ChatGPT prompt, and PDF resume remain one action away;
- no nested cards, no proprietary TEC content, responsive at 390px with no overlap.

- [ ] RED pure view tests for block labels, shortfalls, score explanation, and execution state.
- [ ] Implement component using the strict API client; generated blocks never enter localStorage.
- [ ] Run frontend tests, lint, and build.
- [ ] Browser smoke: no-LS day, score table, theory resume, TEC result, target switch, empty-profile guidance, desktop/390px, clean console.
- [ ] Commit `feat: run autonomous Study OS day from Home`.

## Task 8: M4 Gate, Adaptive Refresh Proof, and M5 Plan

**Files:**
- Update: `.superpowers/sdd/progress.md`
- Create: `docs/superpowers/plans/2026-07-12-study-os-m5-adaptive-review-tec.md`

- [ ] Run complete Python/frontend/question-deck/build/diff gates.
- [ ] Restart service and verify the same immutable day, scores, block state, and session links.
- [ ] Backup/restore schema v5 and compare run/candidate/block evidence.
- [ ] Run offline browser acceptance with no LS and no external runtime assets.
- [ ] Prove completed, partial, failed, and skipped blocks alter the next run predictably while the prior run remains unchanged.
- [ ] Write M5 plan for bounded error review, TEC aggregate feedback, stale detection, SRS migration, and weekly adaptation.
- [ ] Commit `docs: plan adaptive Study OS review`.

## M4 Acceptance

M4 is complete only when all are true:

1. one selected target owns every run, candidate, score, and block;
2. editable target/topic weights persist and survive reseed, restart, and backup restore;
3. a no-LS profile with executable inventory/TEC metadata generates up to four balanced blocks without invented sources;
4. a normal full-pool day contains one theory/reread, two TEC blocks, and one bounded error review;
5. short pools return explicit shortfalls and stop reasons instead of filler;
6. deterministic inputs produce identical score evidence and stable ordering;
7. every chosen and displaced alternative exposes all component scores;
8. target-specific content never transfers blindly and Dicas/Bizus never becomes primary;
9. Home executes theory at the exact material cursor and stores only aggregate TEC results;
10. refresh uses persisted outcomes and preserves the superseded immutable run;
11. desktop/mobile, restart, backup/restore, offline, full regression, and legacy question-deck gates pass;
12. the separate freshly downloaded package `249654` M2 gate remains explicitly visible until completed.
