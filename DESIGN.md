# Diário de Questões — Design System

## 0. Research Log

- Existing-product lane: extracted the current dark execution shell, lime completion accent, violet navigation state, slate supporting surfaces, compact type, and 44 px interaction targets from `src/index.css` and the active study components.
- Operational-dashboard lane: the interface must privilege reading, answering, correction, and source inspection over decorative density.
- Final-week companion lane: the standalone schedule reuses the app vocabulary so switching between the HTML and the app carries no visual or cognitive reset.

## 1. Direction

The product is a dark, focused study instrument. Matte charcoal surfaces reduce glare; lime marks progress and confirmed actions; violet marks navigation and context; amber and rose are reserved for attention and risk. The memorable interaction is the source-page reveal: a question expands into its original PDF page without leaving the card.

## 2. Tokens

### Color

- Canvas: `#1a1a1a`, `#202020`, `#2d2d2d`
- Raised surface: `#262626`, `#404040`, `#525252`
- Text: `#f5f5f5`, `#d1d5db`, `#9ca3af`
- Progress/confirmed: `#84cc16`, hover `#65a30d`, focus `#bef264`
- Navigation/context: `#8b5cf6`, soft `rgb(139 92 246 / .18)`
- Warning: `#f59e0b`
- Risk: `#fb7185`
- Information: `#60a5fa`
- Protected/fresh: `#67e8f9`

### Type

- Family: `ui-sans-serif, system-ui, "Segoe UI", Arial, sans-serif`
- Display: 24–32 px, weight 900, tight leading
- Section: 14–18 px, weight 800–900
- Body: 14–16 px, weight 400–600, leading 1.55
- Metadata: 10–12 px, weight 800–900, uppercase only for short labels
- Numeric progress uses tabular numerals.

### Space and shape

- Base unit: 4 px
- Common gaps: 8, 12, 16, 20, 24 px
- Control height: minimum 44 px
- Radius: 8 px for compact controls, 12 px for cards, 16 px for primary panels
- Borders: `rgb(255 255 255 / .09)`; no ornamental double borders
- Depth: tonal separation first, one soft shadow only for dialogs and the expanded source viewer

## 3. Layout

- The question card owns vertical scrolling; the PDF source viewer stays inside the card flow.
- Wide screens use a reading column no wider than 960 px.
- At 390 px, controls wrap and the PDF canvas scales to the available inline size without horizontal page scrolling.
- The standalone schedule uses a sticky “Hoje” rail on desktop and a single document flow on mobile.

## 4. Motion and accessibility

- Motion communicates state only: reveal, collapse, progress, selection, and dialog entry.
- Animate `opacity` and `transform`; never animate layout dimensions.
- Respect `prefers-reduced-motion`.
- Every icon-only control has an accessible name.
- Focus uses the lime focus token with a 2 px visible outline.
- Source-page rendering includes a text label with file name and page number; the canvas is supplementary.

## 5. Reusable primitives

- `StudyPanel`: matte raised surface, section heading, optional status badge.
- `ProgressMeter`: tabular count plus lime bar; complete, active, and blocked states.
- `PriorityBadge`: critical, high, maintenance, and protected color states.
- `SourcePageViewer`: collapsed button, loading, rendered, missing-document, render-error, zoomed, and reduced-motion states.
- `ScheduleBlock`: date, objective, question references, theory/video link, correction rule, and complete state.
- `ResourceLink`: local-file primary link with permanent course-page fallback.
- `QuestionSelectionRow`: selected, unselected, visual-source, duplicate, and already-seen states.

## 6. Content rules

- Do not imply that 150 standardized points equal 150 raw answers.
- P1 is labeled “gargalo prioritário”, not a separate eliminatory cutoff in SEFAZ CE.
- No CPF, signed download URL, access token, or student name is written to the archive or UI.
- Proprietary question bodies stay in the user’s local PDFs and browser data, never in the repository.
