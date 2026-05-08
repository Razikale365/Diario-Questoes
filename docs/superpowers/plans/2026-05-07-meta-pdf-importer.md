# Meta PDF Importer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second importer that ingests a Meta LS PDF and creates a reviewed queue of tasks, while keeping the existing pasted-text single-task importer unchanged.

**Architecture:** Keep PDF extraction, meta parsing, task conversion, and UI separate. `MetaImportArea` extracts text from a selected PDF, calls `parseMetaText`, lets the user review drafts, then imports selected drafts in one batch through `useTasks.addTasks`.

**Tech Stack:** React 19, TypeScript, Vite, `pdfjs-dist`, node:test.

---

### Task 1: Meta Parser

**Files:**
- Create: `src/utils/metaParser.ts`
- Create: `src/utils/metaParser.test.ts`

- [ ] Write failing tests for table-style meta rows, multi-line descriptions, ignored orientation text, and conversion to `StudyTask`.
- [ ] Run: `npx tsx src/utils/metaParser.test.ts`. Expected: fails because `metaParser.ts` does not exist.
- [ ] Implement `parseMetaText(text)` and `createTasksFromMetaDrafts(drafts, options)`.
- [ ] Run: `npx tsx src/utils/metaParser.test.ts`. Expected: pass.

### Task 2: PDF Text Extractor

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/utils/pdfTextExtractor.ts`
- Create: `src/utils/pdfTextExtractor.test.ts`

- [ ] Add `pdfjs-dist`.
- [ ] Write a failing unit test around unsupported file validation and dependency-injected page extraction.
- [ ] Run: `npx tsx src/utils/pdfTextExtractor.test.ts`. Expected: fails because extractor does not exist.
- [ ] Implement `extractPdfText(file)` with a dynamic `pdfjs-dist` import and `extractPdfTextWithLoader(file, loader)` for tests.
- [ ] Run: `npx tsx src/utils/pdfTextExtractor.test.ts`. Expected: pass.

### Task 3: Batch Import Hook

**Files:**
- Modify: `src/hooks/useTasks.ts`

- [ ] Add `addTasks(tasks: StudyTask[])` that normalizes all task layouts and stamps one `updatedAt`.
- [ ] Use this only for meta imports so the existing `addTask` behavior remains unchanged.

### Task 4: Meta Import UI

**Files:**
- Create: `src/components/MetaImportArea.tsx`
- Modify: `src/App.tsx`

- [ ] Build the PDF-only importer with file picker, extraction status, detection summary, mobile cards, selected-task toggles, raw text details, and "Criar fila da meta".
- [ ] Keep `ImportArea` rendered as the normal single-task pasted-text importer.
- [ ] Wire `MetaImportArea` to `addTasks`, then activate the first imported task.

### Task 5: Verification And Commit

**Files:**
- Modify as needed after verification.

- [ ] Run parser/extractor tests directly.
- [ ] Run `npm run lint`.
- [ ] Run `npm run build`.
- [ ] Start the app on an available port and inspect the caderno tab.
- [ ] Commit and push `codex/meta-pdf-importer`.
