# In-Task PDF Question Import Design

## Goal

Let the student add complete objective questions from a PDF to an already-created task, including while the task is in progress. The same flow must also enrich blocks that currently contain only question numbers and a manual answer key, without discarding answers, doubts, observations, or attempt history.

## Scope

- Add one shared **Importar PDF** modal for existing tasks.
- Expose it from the task footer, a section header, and an activity block toolbar.
- Reuse the current PDF parser and question-bank metadata model.
- Support three destinations:
  1. create a new section and question block;
  2. create a new question block inside an existing section;
  3. enrich or append questions in an existing activity block.
- Save every accepted imported question in the local question bank and link the task copy to the canonical bank item.
- Keep the current global PDF importer working for creating a standalone task.

## Non-Goals

- No OCR for image-only PDFs in this milestone.
- No extraction of proprietary TEC question bodies.
- No automatic replacement of complete, conflicting question content.
- No redesign of task sections, cards, or gabarito execution outside the import controls.

## Entry Points

All entry points open the same modal with a preselected destination:

- **Task footer:** a new `Importar PDF` command beside `Adicionar Bloco` and `Criar Seção`; defaults to creating a new section and block.
- **Add Block modal:** a secondary `Importar PDF` action switches to the shared importer with `Nova atividade` selected.
- **Create Section modal:** a secondary `Criar e importar PDF` action carries the entered section title into the shared importer.
- **Section header:** a file-import icon with tooltip `Importar PDF nesta seção`; defaults to a new block whose `lesson` matches the section title.
- **Activity block:** a file-import icon with tooltip `Importar PDF neste bloco`; defaults to enriching that block.

The modal may change destination before confirmation. A locked target block or locked section cannot receive an import until it is unlocked.

## Modal Flow

The modal contains four compact stages in one surface:

1. **Arquivo e fonte:** PDF, source kind, source name, target, discipline, bank, and lesson. Task metadata pre-fills target and discipline.
2. **Destino:** segmented choice for `Nova seção`, `Nova atividade`, or `Bloco existente`, followed by the relevant section/block selector.
3. **Prévia:** detected questions, rejected blocks, duplicates, questions to enrich, questions to append, and content/gabarito conflicts.
4. **Confirmar:** one explicit import command. Parsing and preview never mutate task or bank data.

After a successful import, the modal closes, the task remains open, and the work view switches to **Questões**. A toast reports the number enriched, appended, duplicated, and conflicted.

## Import Architecture

PDF extraction remains in `pdfQuestionImport.ts`. The new orchestration is split into two units:

- `TaskQuestionPdfImportModal` owns file selection, metadata, destination selection, preview, and confirmation.
- A pure domain helper in `taskQuestionImport.ts` plans and applies task changes. It receives the target task, parsed questions, canonical question-bank items, and destination. It returns the updated task plus a structured summary and never accesses React or `localStorage`.

`App.tsx` coordinates the modal. Question-bank items are built with `buildQuestionBankItems`, merged with `mergeQuestionBankItems`, and resolved back to their canonical `localId` before the task is updated.

One local commit helper serializes the next task array and question bank before writing either one. It snapshots both previous storage values, writes both keys, restores both snapshots if either write fails, and only then updates React state and dispatches the question-bank update event. This gives the import rollback behavior even though `localStorage` has no native transaction API.

Activity and section components only emit an import request containing their task, section, or block identity. They do not parse PDFs or manipulate question data.

## Merge Semantics

### Question Identity

Within an existing block, an imported question first matches by:

1. canonical `localId` when available;
2. `sourceQuestionNumber`;
3. the placeholder's internal `number` only when it has no complete statement and alternatives.

Fingerprint deduplication remains authoritative in the question bank. A repeated import must be idempotent.

### Enriching Placeholders

When a matching task question contains only an index/gabarito, the import fills:

- statement and alternatives;
- source kind and source name;
- source question number;
- canonical bank `localId`;
- imported answer key when no conflict exists;
- optional exam metadata supplied by the parser.

The following execution fields are always preserved from the existing task question:

- `answer` and `isCorrect`;
- `hasDoubt`, `favorite`, and `observations`;
- `eliminated` and `doubtedAlts`;
- `attempts`.

### Appending Questions

Imported questions without a match are appended in source order. Their internal `number` values are assigned uniquely inside the target block, while `sourceQuestionNumber` preserves the PDF number.

### Conflicts

A complete existing question with different imported content is preserved by default and reported as a content conflict. A different non-empty answer key is also preserved and reported as a gabarito conflict. The initial milestone does not offer a bulk overwrite option; the existing manual question editor remains the deliberate correction path.

Questions without conflicts may still be imported in the same batch. The confirmation summary makes skipped conflicts explicit.

## New Section And Block Defaults

- New section title defaults to the lesson/source title and remains editable.
- A new section receives the existing default section layout.
- A new question block uses full width, one question column, and the current PDF-task responsive layout defaults.
- Source page count appears in `pages`.
- `showGabarito` starts false and imported answer keys remain hidden in execution views.

## Failure Handling

- No file or no detected objective questions: confirmation stays disabled.
- Parser rejection: preview shows the rejected-block count without inventing questions.
- Invalid destination or locked destination: confirmation stays disabled with a precise reason.
- A failed bank/task preparation leaves both unchanged.
- Unexpected persistence failure shows an error toast and retains the modal state for retry.
- Reopening and importing the same file does not duplicate bank items or task questions.

## Testing

### Domain Tests

- Enrich an index-only question by source number while preserving its answer, doubt, observation, alternatives considered, and attempts.
- Preserve an existing manual gabarito when the imported key conflicts and report the conflict.
- Append unmatched questions with unique internal numbers and original source numbers.
- Resolve task questions to canonical bank `localId` values.
- Repeating the same import is idempotent.
- Create a new section and full-width question block from a PDF batch.
- Reject a locked block or section destination.
- Keep complete conflicting content unchanged while importing non-conflicting questions from the same batch.

### Component Tests

- Each entry point opens the modal with the correct destination preselected.
- Preview reports detected, rejected, duplicate, enriched, appended, and conflicted counts.
- Confirmation remains disabled for invalid or locked destinations.
- Successful import closes the modal and returns the task to the Questions view.

### Regression And Visual Verification

- Existing standalone PDF import, manual add/edit question, gabarito import, revision generation, cards, and task history tests continue passing.
- Run `npm test`, `npm run lint`, and `npm run build`.
- Verify desktop and 390 px task views with a new-section import and an in-place placeholder enrichment.
