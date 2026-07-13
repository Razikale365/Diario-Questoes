# Study OS M5 Adaptive Review and Weekly Planning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Implement task-by-task with red-green-refactor and one focused commit per task.

**Goal:** Make Study OS learn from completed, partial, skipped, and failed work, produce bounded evidence-driven reviews, detect stale knowledge, and maintain an adaptive weekly shell without storing proprietary TEC question content.

**Architecture:** SQLite remains authoritative. Schema v7 adds an immutable aggregate learning-event ledger, a rebuildable current topic-state projection, bounded review queue items, immutable weekly forecast runs, and forecast slots. Planner/session result transactions append events exactly once. Pure projection code turns those events into mastery, confidence, staleness, and review debt. Weekly forecasts distribute executable candidate identities across dates; the daily planner remains the command layer and records why current evidence caused it to follow or diverge from the forecast.

**Tech Stack:** Python 3.11+, SQLite WAL, FastAPI, React 19, TypeScript 5.8, Vite 6, Node test runner.

## Global Constraints

- M2 remains open until package `249654` is freshly downloaded and verified. Fixture and manual-profile evidence cannot satisfy the real-package gate.
- Store TEC caderno identity/URL and aggregate counts only. Never store TEC question statements, alternatives, answer keys, comments, or scraped HTML.
- Learning events are append-only and idempotent. Current topic state and review queue are rebuildable projections, not hidden source-of-truth mutations.
- A review item is bounded to one target topic and one or more explicit aggregate evidence events. Default proof set is 5-10 TEC questions and may never become a broad “review the discipline” task.
- Staleness is evaluated on request from persisted timestamps; no background daemon or internet connection is required.
- A weekly forecast is immutable evidence. Refresh creates a superseding forecast and preserves the previous one.
- Daily generation stays authoritative. It may diverge from the weekly forecast when fresher outcomes, availability, target changes, or balance constraints justify it, and must persist the reason.
- Generated work remains target-specific. Shared/partial transfer keeps its existing reduced confidence; target-specific content never transfers automatically.
- Generation and import mutations require `Idempotency-Key` and `BEGIN IMMEDIATE`.
- No local LLM, embeddings, vector database, OCR batch, or proprietary-content ingestion.

## Learning Policy

- `completed` theory advances coverage and schedules a later stale check; `partial` preserves the exact cursor and does not claim coverage.
- Question accuracy at or above 80% with at least 10 questions reduces review debt strongly; 60-79% reduces it modestly; below 60% creates or raises bounded review debt.
- Wrong, doubt, favorite, failed, and skipped counts create explicit review evidence. A skip raises urgency less than a failed block.
- A successful bounded review requires a proof set and reduces only the debt supported by the linked evidence; it never erases unrelated errors.
- Default stale intervals are editable per target/topic. Initial policy: `strong=45`, `covered=30`, `weak=7`, `stale=0`, `unread=0` days in pre-edital; pós-edital caps non-unread intervals at 21 days and respects deadline pressure.
- Projection arithmetic uses integer basis points and UTC timestamps. Same ordered events and policy produce byte-identical topic state.

---

## Task 1: Add Schema v7 Learning, Review, and Weekly Records

**Files:**
- Modify: `study_os_service/db/migrations.py`
- Create: `study_os_service/domain/learning.py`
- Create: `study_os_service/domain/weekly.py`
- Create: `tests/study_os_service/test_learning_migration.py`
- Create: `tests/study_os_service/test_learning_domain.py`

**Tables:**

- `learning_events`: unique idempotency key, target/topic, source kind/id, event kind/outcome, aggregate question counts, elapsed/page metadata, occurred/created timestamps, evidence JSON.
- `topic_learning_states`: target/topic, mastery/confidence basis points, coverage status, review debt, last activity/success timestamps, next review/stale timestamps, success/failure streaks, event cursor, version.
- `review_queue_items`: target/topic, due date, state, bounded question count, trigger-event ids JSON, reason, debt basis points, attempt count, resolved event, version/timestamps.
- `planner_week_runs`: idempotency key, target, week start, phase, algorithm/input hash, supersedes id, status/shortfalls, generated timestamp.
- `planner_week_slots`: week/date/position, candidate identity, target topic, block kind, duration/questions, score/evidence snapshot, state, optional materialized day run/block.

Add foreign keys, enum/count/version checks, target/date/due indexes, unique source-event identity, and unique week/date/position constraints.

- [x] RED migration/domain tests, including v6-to-v7 preservation and invalid proprietary payload rejection.
- [x] Implement immutable validated records and migration.
- [x] Verify v4/v5/v6 fixtures still migrate to v7 without row loss.
- [x] Commit `feat: add Study OS adaptive learning schema`.

## Task 2: Project Planner and Session Outcomes into Learning State

**Files:**
- Create: `study_os_service/repositories/learning.py`
- Create: `study_os_service/services/learning_projection.py`
- Modify: `study_os_service/services/planner_generation.py`
- Modify: `study_os_service/services/sessions.py`
- Create: `tests/study_os_service/test_learning_projection.py`
- Create: `tests/study_os_service/test_learning_transactions.py`

Append one event in the same transaction that finalizes a planner block or study session. Replaying the same idempotency key returns the existing event. Projection is a pure ordered fold with a repository command that can rebuild and compare the stored state.

- [x] RED tests for completed/partial/skipped/failed theory and TEC/review aggregates.
- [x] Prove rollback leaves neither result nor event partially committed.
- [x] Prove rebuilding from events returns the exact stored projection.
- [x] Prove no event field accepts question text or answer content.
- [x] Commit `feat: project Study OS learning evidence`.

## Task 3: Build a Bounded Review Queue and Stale Detector

**Files:**
- Create: `study_os_service/services/review_queue.py`
- Create: `study_os_service/api/review.py`
- Modify: `study_os_service/app.py`
- Modify: `study_os_service/services/planner_candidates.py`
- Create: `tests/study_os_service/test_review_queue.py`
- Create: `tests/study_os_service/test_review_api.py`

**Endpoints:**

```text
GET  /api/v1/review/queue?targetSlug=...&asOf=YYYY-MM-DD
POST /api/v1/review/rebuild
POST /api/v1/review/items/{id}/defer
```

Review candidates must reference a queue item, its trigger events, and a proof-set count. Completing a review resolves or reduces only that item. Stale detection creates deterministic due evidence on read/generation; it does not require a scheduler.

- [x] RED tests for 5-10 question bounds, topic isolation, debt reduction, deferral, stale intervals, and deadline caps.
- [x] Prove repeated rebuild/detection is idempotent.
- [x] Prove a broad LS-style discipline review cannot be emitted.
- [x] Commit `feat: build bounded Study OS review queue`.

## Task 4: Feed Adaptive State Back into Day Generation

**Files:**
- Modify: `study_os_service/services/planner_candidates.py`
- Modify: `study_os_service/services/planner_scoring.py`
- Modify: `study_os_service/services/planner_generation.py`
- Modify: `study_os_service/domain/planner.py`
- Create: `tests/study_os_service/test_adaptive_day.py`

Replace cumulative raw-count scoring with projected current debt where available, while retaining raw event evidence in the scoreboard. Persist `weekly_alignment` and `adaptation_reason`. A completed high-accuracy topic cools down, a failed/low-accuracy topic receives bounded review, partial theory resumes, and stale topics re-enter coverage without erasing prior mastery.

- [x] RED tests for cooldown, low-accuracy review, partial resume, stale return, deadline pressure, and deterministic replay.
- [x] Prove old raw planner rows still generate through a compatibility fallback.
- [x] Prove refresh never mutates the superseded run or week.
- [x] Commit `feat: adapt Study OS day from outcomes`.

## Task 5: Generate an Immutable Weekly Forecast

**Files:**
- Create: `study_os_service/repositories/weekly.py`
- Create: `study_os_service/services/weekly_planner.py`
- Modify: `study_os_service/api/planner.py`
- Create: `tests/study_os_service/test_weekly_planner.py`
- Create: `tests/study_os_service/test_weekly_api.py`

**Endpoints:**

```text
POST /api/v1/planner/generate-week
POST /api/v1/planner/refresh-week
GET  /api/v1/planner/week?targetSlug=...&weekStart=YYYY-MM-DD
```

The forecast spans Monday-Sunday using editable per-day quota/time budgets. It distributes executable identities without accidental same-week duplication, reserves the normal block mix where evidence permits, and records explicit shortfalls. Generating/refreshing a day links materialized blocks to forecast slots and records follow/diverge reasons.

- [x] RED tests for no-LS BACEN/RFB weeks, target isolation, weekly balance, pool exhaustion, idempotency, supersession, and day divergence after new evidence.
- [x] Prove a daily refresh cannot rewrite prior forecast slots.
- [x] Commit `feat: forecast adaptive Study OS weeks`.

## Task 6: Add Strict Clients and Aggregate-Only Legacy Migration

**Files:**
- Create: `src/study-os/api/learning.ts`
- Create: `src/study-os/api/learning.test.ts`
- Extend: `src/study-os/api/planner.ts`
- Extend: `src/study-os/api/planner.test.ts`
- Create: `src/study-os/domain/legacyAggregate.ts`
- Create: `src/study-os/domain/legacyAggregate.test.ts`
- Create: `study_os_service/api/learning.py`
- Create: `tests/study_os_service/test_learning_import_api.py`

Add `POST /api/v1/learning/import-aggregates`. The browser groups existing local attempts by explicit target/discipline/topic/date and sends counts only. Ambiguous target/topic rows are rejected into a visible report. No question statement, alternative, answer, comment, or observation crosses the boundary.

- [x] RED parser tests and import contract tests.
- [x] Prove malformed/proprietary fields fail closed.
- [x] Prove retry is idempotent and does not double debt.
- [x] Commit `feat: migrate aggregate Study OS evidence`.

## Task 7: Add Weekly and Review Surfaces to Home

**Files:**
- Create: `src/study-os/components/AdaptiveWeek.tsx`
- Create: `src/study-os/components/ReviewQueue.tsx`
- Modify: `src/study-os/components/AutonomousDay.tsx`
- Modify: `src/components/PlannerArea.tsx`
- Create: `src/study-os/domain/adaptiveView.ts`
- Create: `src/study-os/domain/adaptiveView.test.ts`

Home keeps today’s best blocks first. Below it, show a compact seven-day forecast with today emphasized, planned mix/shortfalls, and follow/diverge status. A review block opens its bounded evidence reasons and proof-set target. Add an aggregate migration report, not a question-content importer. Keep the legacy LS calendar folded and secondary.

- [x] RED view-model tests for due/overdue review, stale topics, weekly divergence, and import rejection reporting.
- [x] Run frontend tests, lint, and build.
- [x] Compact browser gate at desktop/390px with no overflow, external request, console error, or proprietary content.
- [x] Commit `feat: show adaptive Study OS week and reviews`.

## Task 8: M5 Durability Gate and M6 Plan

**Files:**
- Update: `.superpowers/sdd/progress.md`
- Create: `docs/superpowers/plans/2026-07-13-study-os-m6-strategy-ingestion.md`

- [ ] Run full Python/frontend/compile/build/diff gates.
- [ ] Restart and compare event/state/queue/week/day hashes.
- [ ] Backup/restore and rebuild topic state from immutable events.
- [ ] Run offline desktop/390px acceptance.
- [ ] Prove a seven-day simulated outcome sequence adapts without broad review or hidden filler.
- [ ] Plan M6 for fresh Estratégia package validation, lesson-to-edital mapping, trilha/guia/LS metadata ingestion, “mais cai” incidence updates, and source-choice comparison.
- [ ] Commit `docs: plan Study OS strategy ingestion`.

## M5 Acceptance

M5 is complete only when all are true:

1. every finalized planner/session outcome creates exactly one aggregate learning event;
2. current topic state rebuilds byte-identically from the event ledger;
3. review tasks are topic-bounded, evidence-linked, and use a 5-10 question proof set;
4. stale detection is deterministic, phase/deadline-aware, and daemon-free;
5. successful work cools down while low accuracy, failures, doubts, favorites, and skips raise bounded debt predictably;
6. weekly forecasts are immutable, target-owned, balanced, and explicit about shortfalls;
7. daily plans may diverge only with a persisted adaptation reason;
8. legacy migration sends aggregate counts only and rejects proprietary question fields;
9. Home executes today first and shows the weekly/review context without making LS primary;
10. restart, rebuild, backup/restore, offline, desktop/mobile, and full regression gates pass;
11. the freshly downloaded package `249654` M2 gate remains separately visible until completed.
