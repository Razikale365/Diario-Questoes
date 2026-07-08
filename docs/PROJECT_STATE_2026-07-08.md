# Project State Audit - 2026-07-08

## Active App

The active app is `C:\Docker\Diario-Questoes`.

Windows startup uses `C:\Docker\Diario-Questoes\start-app.bat`, which opens `http://localhost:3000` and runs `npm run dev`.

## Current Branch

The continuation branch is:

```text
codex/study-os-planner-core
```

It was created from `master` at:

```text
e879750 improved question card and ingestion
```

At the time of this audit, `master` and `origin/master` were aligned at that same commit.

## Planner On Diario Master

Diario currently has a lightweight local LS/meta planner, not the Fiscal Brain hybrid planner.

Primary files:

- `src/components/PlannerArea.tsx`
- `src/utils/planner.ts`
- `src/utils/plannerGenerator.ts`
- `src/utils/plannerInsights.ts`
- `src/utils/questionBank.ts`
- `src/utils/studyImportPackage.ts`

Current capabilities:

- Parse pasted LS/meta text.
- Import PDF/objective questions into a local question bank.
- Link compatible question-bank items to planner tasks.
- Schedule planner tasks into month/week views inside `PlannerArea`.
- Generate a simple next-meta draft from current pending tasks and discipline insights.
- Preserve local user progress through localStorage/backup flows.

Missing from Diario:

- Multi-exam target profiles such as BACEN/RFB/SEFAZ.
- `target_slug` on planner tasks.
- Target-aware coverage rows.
- Target-aware scoring table/scoreboard.
- Daily 4-block autonomous plan engine.
- Source normalization for LS, Trilha Estrategica, Estrategia aulas, Guia Andrety, TEC incidence, and manual sources.

## Branches In Diario

Merged into `master`:

```text
codex/question-bank-mvp
feat/double-click-eliminate-alternatives
```

Not merged into `master`:

```text
codex/melhorias-sugeridas
codex/meta-pdf-importer
```

Do not merge those two branches wholesale. Their diffs remove the current planner/question-bank implementation. Review and cherry-pick only isolated useful files if needed.

## Fiscal Brain

Fiscal Brain lives at `C:\Users\JP\Documents\New project 2`.

Its branch `codex/planner-fiscal-ls` contains the heavier Hybrid Planner and multi-exam target implementation. That work is not on Diario and should be treated as reference only unless explicitly requested.

Useful reference files there:

- `planner/hybrid.py`
- `planner/targets.py`
- `api/routers/planner.py`
- `storage/study_repository.py`
- `frontend/src/components/calendar/WeeklyCalendarView.tsx`

Do not continue Study System Fiscal work in Fiscal Brain.

## Verification From Audit

On `C:\Docker\Diario-Questoes`, these passed:

```text
npm run lint
npm test -- src/utils/planner.test.ts src/utils/plannerGenerator.test.ts src/utils/plannerInsights.test.ts src/utils/questionBank.test.ts src/utils/studyImportPackage.test.ts src/utils/objectiveQuestionParser.test.ts src/utils/questionCardDeck.test.ts
npm run build
```

The build still reports existing Vite warnings about a large bundle and Supabase static/dynamic imports.

## Next Slice

Implement the study-OS planner inside Diario on `codex/study-os-planner-core`.

Recommended first slice:

- Add source-normalization types for LS, Trilha Estrategica, Estrategia aula order, Guia Andrety, TEC incidence, and manual rows.
- Add a pure TypeScript scoring engine that outputs today's 4 blocks.
- Keep the engine local and lightweight; do not depend on Fiscal Brain services.
