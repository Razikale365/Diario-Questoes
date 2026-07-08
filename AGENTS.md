# Project Guardrails

This repository is the active study app.

- Treat `C:\Docker\Diario-Questoes` as the working project for Diario Questoes / Study System Fiscal.
- Do not edit Fiscal Brain (`C:\Users\JP\Documents\New project 2` or `C:\Docker\Fiscal Brain`) for study-OS work unless the user explicitly asks for Fiscal Brain.
- Fiscal Brain planner code may be used only as reference material. Port ideas deliberately into this repo; do not cross-wire the apps.
- The Windows startup shortcut runs `C:\Docker\Diario-Questoes\start-app.bat`, which opens `http://localhost:3000` and runs `npm run dev`.
- Current planner code in this repo is local/frontend-first: `src/components/PlannerArea.tsx`, `src/utils/planner.ts`, `src/utils/plannerGenerator.ts`, `src/utils/plannerInsights.ts`, `src/utils/questionBank.ts`, and `src/utils/studyImportPackage.ts`.
- Do not merge `codex/melhorias-sugeridas` or `codex/meta-pdf-importer` wholesale into this branch; they delete current planner/question-bank files. Cherry-pick only specific useful pieces after review.
- For Estrategia/TEC material, store structure, metadata, source names, progress, and user-entered results only. Do not scrape or copy proprietary question/course content into the repo.

Before claiming completion on code changes, run:

```bash
npm run lint
npm test
npm run build
```
