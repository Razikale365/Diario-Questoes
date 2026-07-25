# SEFAZ CE Final Week and Visual PDF Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and verify the private final-week archive, P1-first curated schedule, selective import flow, and source-page PDF rendering in Diário de Questões.

**Architecture:** Keep course artifacts outside Git, record only stable metadata and hashes in the private archive, and store imported PDF binaries once in IndexedDB. Questions carry lightweight page references; one viewer renders the original page on demand. Selection remains a pure filter before existing bank/task merge semantics.

**Tech Stack:** React 19, TypeScript 5.8, Vite 6, Tailwind CSS 4, pdfjs-dist 6, IndexedDB, Node test runner, connected Chrome.

## Global Constraints

- Preserve all existing task progress and current uncommitted work.
- Do not store proprietary course/question content, PII, signed URLs, or access tokens in Git.
- Preview must not persist a PDF or mutate tasks/question bank.
- New source metadata is optional and backward compatible.
- The complete source page is the final-week reliability fallback; do not auto-crop.
- Validate every imported answer-key mapping before persistence and compare all displayed values afterward.
- Use the connected real Chrome for persistent app changes and final QA.

---

### Task 1: Visual source contracts and parser association

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/utils/objectiveQuestionParser.ts`
- Modify: `src/utils/objectiveQuestionParser.test.ts`
- Create: `src/utils/questionVisualSource.ts`
- Create: `src/utils/questionVisualSource.test.ts`

**Interfaces:**
- Produces: `QuestionSourcePage`, `sourcePage?: QuestionSourcePage`, `attachSourcePages(questions, documentId)`, and `isLikelyVisualQuestion(question)`.

- [ ] Write failing parser tests proving questions inherit the nearest preceding `[Pagina N]` marker and a later marker changes subsequent questions.
- [ ] Run `npm test -- src/utils/objectiveQuestionParser.test.ts` and verify the source-page assertion fails.
- [ ] Add `sourcePageNumber?: number` to parsed questions and associate markers without changing statement fingerprints.
- [ ] Write failing visual tests with literal table/chart keywords and a plain-text control question.
- [ ] Run the tests and verify the missing helper failure.
- [ ] Implement `QuestionSourcePage` and `attachSourcePages`, preserving order and returning new objects.
- [ ] Run both targeted test files and confirm green.

### Task 2: IndexedDB source-document store

**Files:**
- Create: `src/storage/questionSourceDocuments.ts`
- Create: `src/storage/questionSourceDocuments.test.ts`

**Interfaces:**
- Produces: `QuestionSourceDocumentRecord`, `buildQuestionSourceDocumentId(data)`, `saveQuestionSourceDocument(file, pageCount)`, and `loadQuestionSourceDocument(id)`.

- [ ] Write failing tests against an injected in-memory store for deterministic SHA-256 ID, one-write deduplication, byte-preserving load, and missing record.
- [ ] Run the targeted test and verify the functions are missing.
- [ ] Implement hashing with `crypto.subtle.digest`, a small `QuestionSourceDocumentStore` interface, and the browser IndexedDB adapter.
- [ ] Run the targeted test and confirm green.

### Task 3: Selective confirmed import

**Files:**
- Modify: `src/utils/pdfQuestionImport.ts`
- Modify: `src/components/QuestionPdfImport.tsx`
- Modify: `src/components/TaskQuestionPdfImportModal.tsx`
- Modify: `src/utils/questionBank.ts`
- Modify: `src/utils/questionBank.test.ts`

**Interfaces:**
- Consumes: parsed source page numbers and source-document storage.
- Produces: selected-question preview state and persisted `sourcePage` on bank/task questions.

- [ ] Write failing bank sanitation/conversion tests proving `sourcePage` survives backup import and `questionBankItemToQuestion`.
- [ ] Run the targeted bank tests and verify the metadata is missing.
- [ ] Implement backward-compatible sanitation and conversion.
- [ ] Add pure selected-ID filtering tests to the import preview utilities and verify red.
- [ ] Implement select all/none, per-question selection, selected/detected counts, and likely-visual filter without mutating preview.
- [ ] Persist the PDF only inside the confirmed save/create operation; attach its `documentId` to selected questions before bank merge.
- [ ] Run targeted import and bank tests and confirm green.

### Task 4: Source page viewer

**Files:**
- Create: `src/components/QuestionSourcePageViewer.tsx`
- Create: `src/components/QuestionSourcePageViewer.contract.test.ts`
- Modify: `src/components/QuestionCardDeck.tsx`
- Modify: `src/components/ActivityBlockCard.tsx`

**Interfaces:**
- Consumes: `QuestionSourcePage` and `loadQuestionSourceDocument`.
- Produces: expandable responsive canvas with retry and 100%/150% zoom.

- [ ] Write a failing contract test for accessible source label, loading/error/missing states, zoom controls, and use from both question renderers.
- [ ] Run the test and verify the viewer/imports are absent.
- [ ] Implement the viewer with pdfjs canvas cleanup, render cancellation, responsive sizing, and no answer-state coupling.
- [ ] Insert it additively below the statement, preserving current stopwatch, ordering, keyboard, favorite, and navigation work.
- [ ] Run the contract and related question-card tests and confirm green.

### Task 5: Private course archive and curation

**Files outside Git:**
- Create: `C:\Users\JP\Downloads\Reta Final SEFAZ CE 2026\index.html`
- Create: `C:\Users\JP\Downloads\Reta Final SEFAZ CE 2026\manifest.json`
- Create: `C:\Users\JP\Downloads\Reta Final SEFAZ CE 2026\curadoria\selecoes.json`
- Create: `C:\Users\JP\Downloads\Reta Final SEFAZ CE 2026\curadoria\gabaritos.json`

**Interfaces:**
- Produces: validated 50-PDF archive, stable local/permanent links, curated question references, and offline progress.

- [ ] Refresh each lesson’s signed download URL from the authenticated page and save the five named PDFs under each of ten round folders.
- [ ] Calculate file size, SHA-256, PDF page count, lesson ID, permanent lesson URL, and validation state.
- [ ] Parse P1 questions/keys, fingerprint stems, mark familiar/duplicate/visual candidates, and create two full simulations plus four curated sets using the spec weights.
- [ ] Manually review every selected reference and every visual-source candidate; fix wrong subject/page/key associations.
- [ ] Generate the standalone HTML with today focus, day cards, resource library, filters, local progress, print styles, reduced motion, and stable relative links.
- [ ] Run an archive verifier that fails unless all 50 PDFs and every selection/key/link invariant pass.

### Task 6: Real-app import and completion gates

**Files:**
- No repository additions beyond prior tasks; persistent data changes occur only through the app UI.

**Interfaces:**
- Consumes: curated PDF selections and validated answer mappings.
- Produces: final-week tasks visible in the connected Chrome app.

- [ ] Run `npm run lint`, `npm test`, and `npm run build`; resolve only failures caused by this work and record unrelated pre-existing failures separately.
- [ ] In connected Chrome, run an invalid answer block first and confirm no persistence.
- [ ] Import each curated batch through the selective PDF flow, apply its validated key, and compare count, unique source numbers, first/last pairs, and every displayed answer.
- [ ] Reload the app, open table question 66, expand its source page, zoom it, and confirm the table is readable at desktop and 390 px.
- [ ] Open the offline HTML at 375, 768, and 1280 px and verify progress persistence, filters, local PDF links, permanent lesson fallbacks, focus order, and print output.
- [ ] Reconcile every requirement in the design against current files, manifest, tests, and browser evidence before marking the goal complete.
