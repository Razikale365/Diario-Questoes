# Study OS M6 Fresh Course and Strategy Ingestion Plan

**Goal:** Turn the freshly acquired Estratégia package and optional LS/trilha/Andréty/TEC metadata into target-owned, editable topic-to-source evidence so the autonomous planner can choose both *what* to study and *which source* to use without scraping proprietary question content or treating any guide as unquestionable truth.

**Architecture:** M6 completes the still-open M2 acquisition gate before adding schema v8. The existing inventory remains the authority for local files; new ingestion records only source metadata, extracted headings, mappings, confidence, and provenance. Ambiguous mappings stay unresolved until approved. Planner candidates receive an immutable source-choice snapshot. The external Estratégia Downloader remains a separate manually authenticated tool and Study OS never stores credentials.

**Primary acquisition:** package `249654`, Receita Federal Auditor, with regular courses and Passo Estratégico. This is the first production source because it is owned and broad, not because RFB is permanently selected over BACEN.

**Tech stack:** Python 3.13, FastAPI, SQLite, local PDF metadata/text extraction workers, React 19, TypeScript, Vite, node:test.

---

## Non-Negotiable Boundaries

1. The old `Pacote Regular Fiscal 2023` directory remains fixture-only.
2. Package `249654` is not production evidence until a fresh downloader manifest, independent PDF count, zero unexplained failures, scan reconciliation, and backup gate all pass.
3. Study OS does not automate login, persist credentials, bypass access controls, or absorb the downloader into this repository.
4. TEC contributes caderno identifiers, URLs, aggregate outcomes, banca, and incidence metadata only. Questions, alternatives, answers, comments, and observations never enter SQLite through this ingestion path.
5. Original course PDFs outrank Passo/Trilha/LS/Andréty summaries for primary theory. Passo and guides can change order or suggest review, but cannot become sole authority for a topic.
6. Cross-target transfer requires an explicit `shared` or `partial` mapping. Exam-specific law never transfers merely because discipline names match.
7. Every automatic mapping and source choice stores its inputs, algorithm version, confidence, and displaced alternatives.

## Task 1: Complete the Fresh Package 249654 Acquisition Gate

**Repositories/files:**
- External: `C:\Docker\Cursos Estratégia\AutoDownloadEstrategiaConcurso`
- Update: `docs/study-os/course-package-decision.md`
- Update: `.superpowers/sdd/progress.md`
- Test: existing M2 inventory/acquisition suites

Run the reviewed package-scoped PDF-only adapter with manual authenticated login into a new, previously nonexistent destination. Preserve downloader/upstream commits, acquisition id, package URL/id, timestamps, expected/observed PDF counts, and failed items in `.study-os-download.json`.

- [ ] Verify the adapter repository is clean at the reviewed commit or document intentional changes.
- [ ] Download every currently available PDF for package `249654` into a fresh root.
- [ ] Require `%PDF-` validation, independent recursive PDF count, and an explicit failure report.
- [ ] Register the exact root through the inventory API and reconcile scan count with manifest count.
- [ ] Prove at least one current regular course and one Passo course are represented.
- [ ] Keep M2 pending if login, download, manifest, count, or reconciliation is incomplete.
- [ ] Commit `docs: validate fresh Estrategia package acquisition` only after the real gate passes.

## Task 2: Add Strategy Source Schema v8

**Files:**
- Modify: `study_os_service/db/migrations.py`
- Create: `study_os_service/domain/strategy.py`
- Create: `study_os_service/repositories/strategy.py`
- Create: `tests/study_os_service/test_strategy_migration.py`
- Create: `tests/study_os_service/test_strategy_domain.py`

Add immutable ingestion runs and editable mapping records:

- `strategy_sources`: target, source kind, name, trust tier, package/root/material identity, external URL/id, edition, active flag, notes, optimistic version.
- `strategy_source_items`: source-owned discipline/topic/order, lesson/material ids when local, incidence/banca metadata, content role, provenance, source fingerprint.
- `topic_source_mappings`: target topic, source item, transfer kind, mapping status, confidence basis points, primary eligibility, manual override, notes, version.
- `strategy_ingestion_runs`: idempotency key, source, input hash, algorithm version, totals, unresolved report, created time.
- `source_choice_runs` and `source_choice_rows`: immutable chosen/displaced snapshots used by day/week candidates.

No table accepts question text, alternative text, answer keys, comments, or observations.

- [ ] RED migration/domain tests from schema v7, rollback, enums, bounds, target isolation, and forbidden fields.
- [ ] Preserve every v1-v7 fixture and current planner/event row.
- [ ] Add indexes for target/topic, source/order, unresolved mappings, and chosen source lookup.
- [ ] Commit `feat: add Study OS strategy source schema`.

## Task 3: Map Fresh Course Lessons to Edital Topics

**Files:**
- Create: `study_os_service/services/course_mapping.py`
- Extend: `study_os_service/services/inventory.py`
- Create: `tests/study_os_service/test_course_mapping.py`
- Create: `tests/study_os_service/fixtures/strategy_mapping/`

Build a deterministic local mapper using inventory discipline, course, lesson number/title, material kind, heading tokens, and target topic aliases. Matching stages are exact normalized topic, configured alias, discipline-constrained token score, then unresolved. Do not use body-text similarity as silent truth.

- [ ] RED tests for accents, aula numbering, reform editions, duplicate titles, Passo vs regular, and ambiguous topics.
- [ ] Map regular PDFs as primary-theory eligible when trust and target match.
- [ ] Map Passo PDFs as review/support unless manually promoted with a recorded reason.
- [ ] Preserve one lesson mapping to multiple edital topics only as explicit scored rows.
- [ ] Reject another target's specific law even when filenames are similar.
- [ ] Re-running the same inventory snapshot must be idempotent and preserve manual decisions.
- [ ] Commit `feat: map Estrategia lessons to edital topics`.

## Task 4: Ingest Trilha, LS, Andréty, and TEC Metadata

**Files:**
- Create: `study_os_service/services/strategy_ingestion.py`
- Create: `study_os_service/services/adapters/estrategia_steps.py`
- Create: `study_os_service/services/adapters/ls_trilha.py`
- Create: `study_os_service/services/adapters/andrety.py`
- Create: `study_os_service/services/adapters/tec_incidence.py`
- Create: `study_os_service/api/strategy.py`
- Create: `tests/study_os_service/test_strategy_ingestion.py`
- Create: `tests/study_os_service/test_strategy_api.py`

Support local PDF/table/paste inputs through source-specific adapters. Each adapter emits one strict neutral DTO: target, discipline, topic hint, source order, source role, incidence, banca, lesson/material/external reference, and provenance.

- [ ] Estratégia regular order comes from the validated inventory, never dashboard scraping inside Study OS.
- [ ] Passo/Trilha steps retain their prescribed order and revision emphasis as advisory metadata.
- [ ] LS metas retain target identity and task linkage; mismatched targets are partial or rejected.
- [ ] Andréty guides enter as editable advisory rows with source date/version.
- [ ] TEC paste accepts aggregate incidence and caderno metadata only and fails closed on question-content fields.
- [ ] Ambiguous or unmapped rows return a visible rejection report and do not mutate planner evidence.
- [ ] Every retry is idempotent; changed payload under the same key returns a structured conflict.
- [ ] Commit `feat: ingest Study OS strategy metadata`.

## Task 5: Score and Explain Source Choice

**Files:**
- Create: `study_os_service/services/source_choice.py`
- Modify: `study_os_service/services/planner_candidates.py`
- Modify: `study_os_service/domain/planner.py`
- Create: `tests/study_os_service/test_source_choice.py`

For each target topic/block kind, score candidate sources using:

- target match and transfer confidence;
- source trust and primary eligibility;
- freshness/edition;
- lesson order and prerequisite readiness;
- TEC incidence and banca fit;
- current coverage state and review queue reason;
- material availability;
- LS/Trilha/Andréty alignment;
- low-trust and mismatch penalties.

Store `source_fit`, `freshness`, `order_readiness`, `strategy_alignment`, `material_availability`, `primary_trust`, penalties, final score, chosen flag, and `displaced_by`.

- [ ] Original current course beats summary-only theory.
- [ ] A bounded review may prefer Passo/Trilha or TEC when evidence supports it.
- [ ] High-incidence TEC metadata can reorder question practice without replacing theory authority.
- [ ] A stale PDF loses to a current edition; missing current material remains an explicit shortfall.
- [ ] BACEN cannot silently inherit RFB-specific law; shared economics transfers with reduced confidence.
- [ ] Manual overrides remain editable, versioned, and visible in the explanation.
- [ ] Commit `feat: choose Study OS sources per topic`.

## Task 6: Integrate Source Choice Into Day and Week Planning

**Files:**
- Modify: `study_os_service/services/planner_generation.py`
- Modify: `study_os_service/services/weekly_planner.py`
- Modify: `study_os_service/repositories/planner_runs.py`
- Modify: `study_os_service/api/planner.py`
- Extend: planner/adaptive/weekly tests

Every candidate receives the immutable chosen source and alternatives snapshot. Day execution opens the selected local material or external TEC caderno. Refresh may change source only when new persisted evidence changes the source score, with an explicit adaptation reason.

- [ ] No-LS planning remains complete when validated course/TEC metadata exists.
- [ ] LS/trilha alignment is advisory and target-aware.
- [ ] Week forecasts preserve source choices; daily divergence never mutates the old week.
- [ ] Missing or ambiguous source mapping creates a named shortfall, never a fabricated task.
- [ ] Review blocks remain 5-10 questions and topic-bounded after strategy integration.
- [ ] Commit `feat: plan with auditable Study OS sources`.

## Task 7: Add the Strategy Mapping Workbench to Home

**Files:**
- Create: `src/study-os/api/strategy.ts`
- Create: `src/study-os/api/strategy.test.ts`
- Create: `src/study-os/domain/strategyView.ts`
- Create: `src/study-os/domain/strategyView.test.ts`
- Create: `src/study-os/components/StrategyWorkbench.tsx`
- Modify: `src/study-os/components/AutonomousDay.tsx`
- Modify: `src/study-os/components/AdaptiveWeek.tsx`

Keep today's execution first. Add a compact source label and “why this source” disclosure to each block. Put the mapping workbench under configuration: unresolved mappings first, side-by-side source alternatives, manual target/topic assignment, primary eligibility, trust, and notes.

- [ ] Show fresh package/manifest status before mappings can be applied.
- [ ] Show course vs Passo/Trilha/LS/Andréty/TEC alternatives without nested cards.
- [ ] Make ambiguous rows editable in a dense table with save/conflict states.
- [ ] Show source choice and displaced alternative in day/week explanations.
- [ ] Empty BACEN source coverage gives actionable gaps without borrowing RFB-specific content.
- [ ] Run frontend tests, TypeScript, build, desktop, and 390 px gates.
- [ ] Commit `feat: manage Study OS strategy mappings`.

## Task 8: M6 Production Gate

**Files:**
- Update: `.superpowers/sdd/progress.md`
- Update: `docs/study-os/course-package-decision.md`
- Create: next milestone plan only after real-package evidence reveals remaining work

- [ ] Run all Python and frontend regressions, compileall, TypeScript, build, and diff checks.
- [ ] Restart and compare inventory/mapping/source-choice/week/day hashes.
- [ ] Backup/restore the production database and replay mapping ingestion idempotently.
- [ ] Run offline desktop/390 px execution from a real mapped regular PDF and a metadata-only TEC block.
- [ ] Confirm no proprietary TEC content appears in API payloads, SQLite, logs, or browser state.
- [ ] Compare at least one topic where course order, Passo advice, LS/trilha, Andréty, and TEC incidence disagree; preserve the full explanation table.
- [ ] Keep BACEN gaps explicit and show transfer from fiscal preparation only where approved.
- [ ] Commit `docs: close Study OS strategy ingestion gate`.

## M6 Acceptance

M6 is complete only when all are true:

1. package `249654` has a fresh validated downloader manifest and reconciled real PDF inventory;
2. regular and Passo materials are distinguishable and mapped with provenance;
3. ambiguous mappings never enter planning without approval;
4. Trilha, LS, Andréty, and TEC inputs are advisory, target-aware, editable, and idempotent;
5. no TEC question content crosses the aggregate metadata boundary;
6. source choice is deterministic, versioned, explained, and preserved in immutable day/week snapshots;
7. original current course material remains primary theory unless a recorded override says otherwise;
8. BACEN/RFB/SEFAZ transfer rules prevent exam-specific leakage;
9. Home shows today's source choice without displacing execution with configuration UI;
10. restart, backup/restore, real-PDF, offline, desktop/mobile, and full regression gates pass.
