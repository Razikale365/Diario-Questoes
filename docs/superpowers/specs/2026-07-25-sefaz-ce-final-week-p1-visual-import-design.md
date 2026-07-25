# SEFAZ CE Final Week, P1 Curation, and Visual PDF Import Design

## Goal

Produce one private local study package for 25–30 July 2026 that archives the ten simulation rounds, offers a polished offline schedule with stable links, imports a hand-curated set into Diário de Questões, and preserves tables, charts, formulas, and diagrams from PDF questions.

## Decisions

- Assume seven to eight net study hours per day and that only round 1 is already familiar.
- Treat P1 as the priority bottleneck because the user scored 47/100 in SEFAZ SP P1 and made 37 P1 errors in SEFAZ GO. Do not claim a separate P1 cutoff: the SEFAZ CE edital requires 150 in the sum of standardized objective scores.
- Use two full unseen P1 simulations and four curated days. Do not prescribe one full P1 plus one full P2 every day.
- Keep P2 active because its standardized score participates in the combined threshold and its specific paper carries greater ranking leverage.
- Videos are error-triggered. A video enters the day only after a diagnostic or battery identifies the corresponding gap; the schedule links the focused Math Finance, Statistics, Administration, Economy, Financial Law, Constitutional, and Administrative sessions.
- Download all 50 authorized course PDFs into the user’s private archive. Keep only stable lesson/course links in the manifest; signed API URLs are transient and must never be persisted.
- The repository stores code and metadata only. Course PDFs, extracted question bodies, answer keys, and curated question payloads remain outside Git.

## Archive

Create `C:\Users\JP\Downloads\Reta Final SEFAZ CE 2026`:

- `index.html`: offline schedule, progress saved in its own `localStorage` key, filters, and links.
- `manifest.json`: round, resource kind, lesson ID, local relative path, permanent lesson URL, size, SHA-256, page count, and validation state.
- `materiais\rodada-01` through `materiais\rodada-10`: `p1.pdf`, `p2.pdf`, `p3.pdf`, `gabarito-preliminar.pdf`, `relatorio-final.pdf`.
- `curadoria\selecoes.json`: question references only (`round`, `paper`, `sourceQuestionNumber`, `page`, `discipline`, `priorityReason`, `setId`), with no question body.
- `curadoria\gabaritos.json`: selected number-to-answer mappings keyed by source document, validated for count and uniqueness.

Archive validation requires 50 PDFs, five per round, no zero-byte files, distinct lesson IDs, readable PDF headers, page counts, hashes, and working relative links. Duplicate byte-identical resources are recorded rather than silently removed.

## Curation

The curator parses all P1 papers and their definitive keys, excludes round 1 from fresh diagnostics, fingerprints normalized stems to suppress repeats, and scores candidates using:

1. historical weakness: Math/Statistics/Logic, Administration, Constitutional/Administrative, Economy, and Financial Law;
2. CE P1 weight;
3. FCC reasoning value;
4. visual/calculation value;
5. novelty across rounds;
6. topic diversity;
7. manageable correction cost.

Accounting, Audit, and Portuguese remain present as protection/maintenance. Questions with tables, charts, figures, dense formulas, or statement text containing `tabela`, `quadro`, `gráfico`, `figura`, `demonstrativo`, or `balanço` receive a visual-source flag and are manually reviewed.

Schedule:

- 25/07: complete unseen P1 diagnostic, 80 questions in four hours, then correction and an error ledger.
- 26/07: 48 curated P1 questions, weighted toward calculation and public management/law, plus 20–24 P2 questions.
- 27/07: 56 curated P1 questions, including all selected visual/calculation items, plus 20 P2 questions.
- 28/07: second complete unseen P1, 80 questions in four hours, using an explicit abandon-and-return rule.
- 29/07: 40 P1 questions drawn only from remaining errors/uncertain topics plus 24–30 P2 questions.
- 30/07: 30-question P1 safety set, 20 P2 protection questions, short formula/law review, and an early stop.

Full P1 rules: first pass answers only high-confidence and short items; calculation items receive a fixed time box; unresolved items are marked and revisited; correction classifies knowledge, calculation, reading, time, or trap.

## Visual PDF import

### Data contract

Add optional local source metadata to parsed, bank, and task questions:

```ts
interface QuestionSourcePage {
  documentId: string;
  pageNumber: number;
  likelyVisual: boolean;
}
```

The PDF parser records the nearest `[Pagina N]` marker for each question. On confirmed import, the original PDF is stored once in IndexedDB under a deterministic hash-based `documentId`; questions store only the lightweight page reference. Preview remains non-mutating.

### Rendering

`SourcePageViewer` loads the local PDF record, renders the referenced page with the existing `pdfjs-dist`, scales to the card, supports 100%/150% zoom and reset, and reports loading, missing-document, and render errors. Likely-visual questions show the source button prominently; every PDF-imported question can open its original page.

The full page is the reliability fallback. No automatic crop is required for the final-week release because an incorrect crop could hide table rows, legends, or alternatives. The viewer never blocks answering when the document is unavailable.

### Persistence

IndexedDB uses `diario-questoes-source-documents`, version 1, store `documents`, key `id`. A record contains the original `ArrayBuffer`, file name, MIME type, page count, SHA-256 fingerprint, and import time. Re-importing the same PDF is idempotent.

Existing localStorage question-bank data remains compatible because all new fields are optional. Backup JSON keeps page references; the private archive retains the source PDFs. A missing source record shows a precise re-import instruction instead of a broken canvas.

## Selection and import UX

Both standalone and in-task PDF import previews allow selecting individual detected questions. The default is all selected for ordinary import; curated work can select by source number, filter likely-visual questions, and import only the chosen subset. Counts report detected, selected, rejected, duplicated, and visual-source questions.

The final curated tasks are imported through the real connected Chrome app. Each answer key is validated before persistence for expected count, unique printed numbers, and first/last pairs. After import, the real UI must show the exact selected count, original source numbers, visual-source affordances, and zero answer-key mismatches.

## Failure handling

- Authentication loss stops course download and preserves the completed manifest entries.
- Expired signed URLs are refreshed from the permanent lesson page; never reused from the manifest.
- A PDF that fails header/page validation is retried from its lesson page and remains marked invalid until replaced.
- IndexedDB failure leaves the question bank and task unchanged.
- A source-page render failure leaves the question answerable and offers retry/re-import.
- A duplicate or familiar question is excluded from fresh diagnostics unless deliberately tagged as a protection item.

## Verification

- Unit tests cover page marker association, visual detection, source-document deduplication, selected-question filtering, and backward-compatible sanitation.
- Integration tests cover confirmed persistence, preview non-mutation, missing source documents, and repeated imports.
- Regression gates: `npm run lint`, `npm test`, `npm run build`.
- Manual QA uses the real connected Chrome at desktop and 390 px, imports the known table question 66, reloads, opens the original page, zooms it, and confirms the table remains readable.
- The offline HTML is opened locally at 375, 768, and 1280 px; progress persistence, filters, all relative links, and keyboard focus are checked.
