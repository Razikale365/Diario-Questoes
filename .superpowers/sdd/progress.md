# Study OS SDD Progress

Plan: `docs/superpowers/plans/2026-07-10-study-os-m1-local-service-foundation.md`

| Task | Status | Base | Head | Verification | Review |
| --- | --- | --- | --- | --- | --- |
| 1. Preserve package ingestion experiment | complete | `414dda1` | `32eb809` | 40 tests, lint, build, diff-check | approved |
| 2. Python package and settings | complete | `88e66e4` | `9673a09` | 2 pytest, 126 frontend tests, lint, build | spec and quality approved |
| 3. SQLite connection and migrations | complete | `1ed5bf2` | `4562e0d` | 6 pytest | spec and quality approved |
| 4. Backup and retention | complete | `9a2b51f` | `7e201fc` | 6 focused, 14 full pytest | manual spec and quality review approved after ISO-window fix |
| 5. FastAPI health endpoint | complete | `052a008` | `0b25a4d` | 7 focused, 19 full pytest, compileall | manual spec and quality review approved |
| 6. Operational CLI | complete | `426dc73` | `b785a6d` | 4 focused, 23 full pytest, compileall | manual spec and quality review approved |
| 7. Frontend service health | complete | `12d1f21` | `817b47d` | 3 focused, 129 full tests, lint, build | manual spec and quality review approved |
| 8. Vite proxy and Windows launcher | complete | `48c8d1e` | `89b1e7b` | 23 pytest, 129 frontend tests, lint, build, direct/proxy smoke | manual spec and quality review approved |
| 9. M1 full gate and M2 plan | complete | `eb8fe1a` | `5c9ef66` | 23 pytest, 129 frontend tests, lint, build, direct/proxy/backup/browser smoke | approved; mobile defect fixed in `fd6d4cf` |

## Notes

- Work is intentionally continuing in the existing feature branch because Task 1 started there before the SDD ledger was introduced.
- Do not mark a task complete until its task-scoped review is clean.
- Task 2's low-priority frozen-dataclass and invalid-port test gap was closed in Task 5.

## M2: Current Package and Course Inventory

Plan: `docs/superpowers/plans/2026-07-11-study-os-m2-course-inventory.md`

| Task | Status | Base | Head | Verification | Review |
| --- | --- | --- | --- | --- | --- |
| 1. Decide and record current Estrategia package | in progress | `5c9ef66` | `ab52696` | 58 pytest, compileall, fresh-root gate; authenticated download still pending | spec approved; quality findings fixed, final external re-review unavailable |
| 2. Inventory schema version 2 | complete | `ab52696` | `2c21827` | 71 pytest, compileall, diff-check | manual spec and quality review approved; external reviewer unavailable |
| 3. Lesson parser and material classifier | complete | `2c21827` | `c878499` | 32 focused, 103 full pytest, compileall, diff-check | manual spec and quality review approved |
| 4. Metadata-only filesystem scanner | complete | `c878499` | `77408a4` | 9 focused + 1 symlink skip, 112 full pytest, 3,589-file fixture | manual spec and quality review approved |
| 5. Transactional scan reconciliation | complete | `46c3fa8` | `1104b8e` | 8 focused, 120 full pytest, compileall, diff-check | manual spec and quality review approved; external reviewer unavailable |
| 6. Inventory and safe file APIs | complete | `1104b8e` | `c5e65a8` | 133 pytest, compileall, diff-check; async/range/target/error tests | manual spec and quality review approved; external reviewer usage-limited |
| 7. Typed inventory client and setup UI | complete | `c5e65a8` | `0544b9c` | 132 frontend tests, tsc, build; empty/fixture/rescan smoke at desktop and 390px | manual spec and quality review approved; polling defect found and fixed during browser smoke |
| 8. Newly downloaded real package verification | pending | pending | pending | pending | pending |
| 9. M2 gate and M3 plan | pending | pending | pending | pending | pending |

## M3: Exact Progress and Study Sessions

Plan: `docs/superpowers/plans/2026-07-11-study-os-m3-progress-sessions.md`

| Task | Status | Base | Head | Verification | Review |
| --- | --- | --- | --- | --- | --- |
| 1. Progress and session schema v4 | complete | `bdc6fe5` | `2c935b4` | migration/domain tests; 164 pytest, 1 skipped | manual spec and quality review approved |
| 2. Lazy PDF page metadata | complete | `2c935b4` | `e8b035b` | focused parser/scanner tests; 169 pytest, 1 skipped | scanner remains metadata-only; launcher dependency hash reviewed |
| 3. Exact progress and bounded reading rate | complete | `e8b035b` | `6b5b8ee` | repository/rate tests; 185 pytest, 1 skipped | optimistic and monotonic cursor rules approved |
| 4. Transactional session lifecycle | complete | `6b5b8ee` | `3d6665c` | 16 focused; 201 pytest, 1 skipped | rollback, outcomes, six skip reasons, and idempotent start approved |
| 5. Session, progress, inspection, and rate APIs | complete | `3d6665c` | `0d8097c` | 7 focused; 208 pytest, 1 skipped; compileall | target isolation, worker-owned inspection, and structured conflicts approved |
| 6. Strict typed session client | complete | `0d8097c` | `4a6386e` | 6 focused; 138 frontend tests; tsc | DTO, enum, body, header, and error parsing approved |
| 7. Exact-page Course Inventory execution UI | complete | `4a6386e` | `2959577` | 143 frontend tests, tsc, build; desktop and 390px browser smoke | popup navigation and cached-page remount defects found and fixed during browser review |
| 8. Restart, backup, and offline M3 gate | complete | `2959577` | `eed0df9` | 211 pytest, 1 skipped; 143 frontend; 3 deck; compileall, tsc, build, diff; HTTPS-blocked browser flow | exact cursor/version/history restore approved; remote Google font removed; M2 real-package gate remains open |

### M3 Acceptance Evidence

- A 24-page fixture was started at page 1, saved partial at page 18, reloaded through a fresh browser page, resumed with a same-origin URL ending `#page=18`, and completed at page 24.
- At 390px, document width equaled viewport width, the active panel was 314px wide, controls wrapped without overlap, and both desktop/mobile consoles were clean.
- The permanent durability test closes the first FastAPI lifespan/SQLite connection, opens a fresh app on the same database, and verifies page 18, progress version 3, session version 2, 1200 seconds, and one completed partial session.
- Backup restore runs `PRAGMA integrity_check` and compares inventory, progress, and session counts plus exact cursor/version/history values.
- With all HTTPS requests blocked, the app reloaded, loaded the course inventory, finished and resumed a session, opened the local PDF, and completed the session. CDP observed only `http://localhost:3000` requests and no console errors.
- The legacy gate path `src/lib/question-deck.test.mjs` never existed in this repository; the maintained equivalent is `src/utils/questionCardDeck.test.ts`, which is also included by `npm test`.
- M3 completion is fixture-backed. M2 Tasks 1, 8, and 9 remain open until package `249654` is freshly downloaded and validated from Estratégia.

## M4: Autonomous Target-Aware Day

Plan: `docs/superpowers/plans/2026-07-12-study-os-m4-autonomous-day.md`

| Task | Status | Base | Head | Verification | Review |
| --- | --- | --- | --- | --- | --- |
| 1. Planner schema and domain | complete | `eed0df9` | `b2651c9` | migration/domain regression, full pytest | target-owned immutable records approved |
| 2. Editable targets and topic evidence | complete | `b2651c9` | `1fa9049` | seed/profile/API tests | reseed preserves edits; SEFAZ Finanças Públicas weight 2 covered |
| 3. Executable candidates and stop evidence | complete | `1fa9049` | `7037e1c` | all ten stop conditions | low-trust and transfer safeguards approved |
| 4. Deterministic target-aware scoring | complete | `7037e1c` | `ef9ba2a` | scoring/tie/input-hash tests | basis-point ordering approved |
| 5. Idempotent balanced day and refresh | complete | `ef9ba2a` | `c4d4829` | BACEN/RFB full-day, shortfall, concurrency, refresh tests | immutable supersession approved |
| 6. Strict client and execution links | complete | `c4d4829` | `2d70475` | parser/request/session-link tests | exact-page linkage and partial resume approved |
| 7. Autonomous Home command center | complete | `2d70475` | `ed90f43` | 151 frontend tests, tsc, build, desktop/390px smoke | target/day/score/result flow approved |
| 8. Durability and adaptive refresh gate | complete | `ed90f43` | `c94dc28` | 277 pytest, 1 skipped; 151 frontend; compileall, tsc, build, fresh-process/backup/offline gates | TEC-without-PDF evidence and target-load race found and fixed |

### M4 Acceptance Evidence

- A second fresh Uvicorn process opened the same schema-v6 database and returned byte-identical persisted day JSON (`BF90FD06EF076F0E` hash prefix) to the running service.
- Backup `data/study-os/backups/study-os-20260712T223719Z.sqlite3` passed `PRAGMA integrity_check` and matched target, topic, run, candidate, block, and session table counts/hashes.
- `test_planner_durability.py` proves partial exact-page theory, completed TEC, skipped TEC, failed review, adaptive supersession, prior-run immutability, restart, and backup restore in one regression.
- The durability gate exposed and fixed aggregate TEC evidence being ignored for topics without PDF mappings.
- The compact offline browser gate rendered the persisted shortfall day at 1440x900 and 390x844 with two real blocks, no horizontal overflow, no external request, and no console error.
- BACEN and RFB fixture/manual profiles generate the full `theory, questions, questions, review` mix; real-package acceptance remains blocked on the fresh Estratégia download.
- M2 Tasks 1, 8, and 9 remain open. No M4 fixture, seed, or browser proof is being presented as validation of package `249654`.

## M5: Adaptive Review and Weekly Planning

Plan: `docs/superpowers/plans/2026-07-12-study-os-m5-adaptive-review-tec.md`

| Task | Status | Base | Head | Verification | Review |
| --- | --- | --- | --- | --- | --- |
| 1. Learning/review/weekly schema v7 | complete | `f13f423` | `744b00b` | migration/domain regression; v4-v6 preservation | immutable validated records approved |
| 2. Outcome event projection | complete | `744b00b` | `9538018` | finalized/partial/skipped/failed transaction and replay tests | atomic event/state projection approved |
| 3. Bounded review queue and stale detector | complete | `9538018` | `dd4b439` | 5-10 question, isolation, deferral, stale/deadline tests | broad LS-style review prohibited |
| 4. Adaptive day feedback | complete | `dd4b439` | `975428b` | cooldown, weak review, partial resume, stale return tests | persisted adaptation reasons approved |
| 5. Immutable weekly forecast | complete | `975428b` | `a0ed73c` | target isolation, balance, exhaustion, supersession, divergence tests | prior week immutability approved |
| 6. Strict clients and aggregate migration | complete | `a0ed73c` | `026deab` | strict parser/API, proprietary rejection, idempotency tests | aggregate-only boundary approved |
| 7. Weekly/review Home surfaces | complete | `026deab` | `29a00cd` | 163 frontend tests, tsc, build, desktop/390px offline smoke | today-first week/review UI approved |
| 8. M5 durability gate and M6 plan | complete | `29a00cd` | `07a2706` | 326 pytest, 1 skipped; 163 frontend; compile/build/restart/backup/offline gates | seven-day adaptation and M6 scope approved |

### M5 Acceptance Evidence

- A schema-v7 service restart preserved byte-identical day (`8badb923e7d63081`), week (`c5913febf3ff7fa9`), and review queue (`eef46741adfc3a9f`) hash prefixes. Learning events, projected topic state, queue, week, day, candidate, and block table hashes also matched before and after restart.
- Backup `data/study-os/backups/study-os-20260713T004553Z.sqlite3` passed `PRAGMA integrity_check`; a temporary restore matched all target/topic/day/week/event/state/queue table counts. Deleting a projected state and rebuilding it from its immutable event returned an equal domain record with the same event cursor and version.
- `test_seven_day_outcome_sequence_stays_bounded_and_explicit` executes seven consecutive plans with low accuracy, success, skip, and failure outcomes. Every missing block remains a named shortfall, every review remains topic-owned and 5-10 questions, and exactly one learning event is emitted per finalized day.
- The Home gate rendered a persisted BACEN shortfall day plus a 15-slot weekly shell at 1440px and 390px. The document had no horizontal overflow, external request, console error, or proprietary fixture content; the mobile week used contained horizontal scrolling.
- Full current regression: 326 Python tests passed with 1 intentional skip, 163 frontend tests passed, Python compileall and TypeScript passed, and the production build completed. The remaining Vite large-chunk warning is pre-existing and non-fatal.
- M2 fresh-package Tasks 1, 8, and 9 remain open. M5 fixture, seed, and browser evidence does not validate package `249654` or any old fiscal directory.

## M6: Strategy Ingestion and Source Choice

Plan: `docs/superpowers/plans/2026-07-13-study-os-m6-strategy-ingestion.md`

| Task | Status | Base | Head | Verification | Review |
| --- | --- | --- | --- | --- | --- |
| 1. Fresh package 249654 acquisition | in progress | external `bb2c490` | external `d8b6f8b` | 21 downloader tests; run3 login timeout; clean run4 active | no credentials stored; real manifest still absent |
| 2. Strategy source schema v8 | complete | `ca8ba23` | `f94b7d5` | migration/domain/repository tests; v1-v7 preservation | metadata-only and immutable-choice constraints approved |
| 3. Course lesson to edital mapping | complete | `f94b7d5` | `46a8667` | exact/alias/token/transfer/idempotency fixtures | ambiguous and target-specific mappings remain non-executable |
| 4. Strategy metadata ingestion | complete | `46a8667` | `3edcc67` | Estratégia/LS/Trilha/Andréty/TEC API and adapter tests | proprietary TEC fields rejected recursively |
| 5. Deterministic source choice | complete | `3edcc67` | `58b2fc2` | trust/freshness/order/target/banca/availability tests | current course, Passo review, TEC practice, and displacement evidence approved |
| 6. Day/week source integration | complete | `58b2fc2` | `261f755` | full no-LS day, named shortfall, refresh and immutable divergence tests | source choices frozen into day/week evidence |
| 7. Home strategy workbench | complete | `261f755` | `d47bcd2` | 170 frontend tests; tsc; build; desktop/390px; console clean | today-first UI, optimistic mapping/source trust, and target-specific gaps approved |
| 8. M6 production gate | in progress | `d47bcd2` | pending | 367 pytest, 1 skipped; 172 frontend; compileall, tsc, build; live scan-to-strategy route | authenticated real-package evidence and real-PDF/offline comparison remain open |

### M6 Current Evidence

- Schema-v8 live service was backed up to `data/study-os/backups/study-os-20260713T140528Z.sqlite3`, restarted on port 4317, and returned healthy database/backup status.
- The permanent strategy durability regression hashes sources, source items, mappings, ingestion runs, source-choice runs/rows, week slots, day candidates, and blocks; it verifies restart equality, idempotent LS replay, backup integrity, and restore equality.
- The source mapping workbench exposes package state, unresolved mappings, competing mappings, target/topic assignment, editable trust, transfer type, status, primary eligibility, and notes. Mapping and shared source versions save atomically and stale source evidence rolls back the mapping write.
- A completed validated course scan can now be mapped into strategy sources through `POST /api/v1/course-roots/{root_id}/strategy-map` or the Inventory command. Replays return the same source/run IDs, unresolved counts remain visible, and package/scan/target safeguards return structured errors.
- The current bridge gate passed 367 Python tests with one intentional skip, 172 frontend tests, TypeScript, production build, compileall, and live service smoke on schema 8.
- Desktop at 1280x720 and mobile at 390x844 had no page-level horizontal overflow or console errors. Dense tables retain their own horizontal scrolling; the mobile command center still starts with today's target and blocks.
- BACEN with no package/source rows displays a BACEN-specific acquisition gap. Cross-target API tests reject labeling an RFB source as BACEN-specific.
- Package `249654` is still `selected`, not `downloaded` or `validated`. Run3 produced zero PDFs/no manifest after login timeout; run4 is the active clean retry. No fixture or empty production table is being presented as real-package acceptance.

## M7: Migration and Production Cutover

Plan: `docs/superpowers/plans/2026-07-13-study-os-m7-migration-cutover.md`

| Task | Status | Base | Head | Verification | Review |
| --- | --- | --- | --- | --- | --- |
| 1. Schema v9 and active target preference | complete | `f474d25` | `c119de1` | focused migration/repository tests; compileall | resumable migrations and preference ownership approved |
| 2. Sanitized resumable browser import | complete | `c119de1` | `e1c5361` | 39 focused tests; compileall | deterministic stages and recursive proprietary rejection approved |
| 3. Cutover API and strict frontend client | complete | `e1c5361` | `c17358c` | 34 Python and 4 frontend tests; compileall; TypeScript | exact command and stale preference contracts approved |
| 4. Portable export and restore | complete | `c17358c` | `68fefb5` | 18 tests; compileall | checksums, integrity, traversal rejection, backup and rollback approved |
| 5. One-time browser bridge | complete | `68fefb5` | `54448fa` | 15 focused frontend tests; TypeScript; build; desktop/390px smoke | five duplicated keys removed only after confirmed import |
| 6. Local planner command retirement | complete | `54448fa` | `c923266` | 181 frontend tests; TypeScript; build; desktop/390px smoke | local Study OS generator removed; LS execution bridge preserved |
| 7. Final durability, offline, and real-package gate | in progress | `c923266` | current task commit | 416 pytest, 1 skipped; 182 frontend; compileall; TypeScript; build; `.bat` offline gate | fixture sequence approved; package `249654` remains the external acceptance blocker |

### M7 Current Evidence

- The live browser completed one sanitized migration with 17 legacy-ID mappings, and the active target now persists through the local service rather than Study OS localStorage keys.
- PlannerArea has a source-level regression forbidding the five retired `study_os_*` keys and the duplicate `StudyOSPlannerPanel` command surface.
- The service-owned Home rendered at 1280x720 and 390x844 with SQLite active, the SEFAZ target selected, no duplicate planner, no page-level horizontal overflow, and no console errors.
- LS import, history, local calendar, task execution, question cards, TEC metadata, and the LS next-meta utility remain available as optional comparison/execution surfaces.
- `test_cutover_durability.py` proves byte-stable migration replay, every SQLite command-table hash across portable restore, exact `(12, 12, covered, 2700, 1, 3)` progress and finished-session versions, a valid local PDF, metadata-only TEC, bounded review, and next-day no-LS refresh.
- The default `start-app.bat` gate exposed Windows PowerShell lacking `Get-FileHash`; startup now uses .NET SHA-256, starts with Docker stopped, and renders at 390x844 and 1280x720 while every HTTPS request is blocked. No external request, failed response, overflow, or console error occurred.
- Missing day/week reads now use explicit `allowMissing=true` success responses, so an empty target renders setup guidance without noisy expected 404s.
- Final closure now requires only the fresh authenticated package manifest followed by real scan, mapping, regular-PDF/TEC/review/refresh execution, and count reconciliation.
