# Phase 15 — UI Review

**Audited:** 2026-04-02
**Baseline:** Abstract 6-pillar standards (no UI-SPEC.md present)
**Screenshots:** Captured (desktop, mobile, tablet)

---

## Pillar Scores

| Pillar | Score | Key Finding |
|--------|-------|-------------|
| 1. Copywriting | 3/4 | Portuguese copy is contextual and specific; one typo and `alert()` fallbacks need attention |
| 2. Visuals | 3/4 | Strong hierarchy with purple sidebar and card-based layout; some icon-only buttons lack aria-labels |
| 3. Color | 2/4 | Consistent purple/green/red semantic palette, but 100+ hardcoded hex values instead of CSS variables |
| 4. Typography | 2/4 | 6 font sizes and 5 font weights in use (exceeds abstract standard of ≤4 sizes, ≤2 weights) |
| 5. Spacing | 3/4 | Tailwind scale used consistently; ~40 arbitrary values (mostly `text-[10px]`, `w-[1px]`, `max-w-[150px]`) |
| 6. Experience Design | 2/4 | Good empty/disabled state coverage, but zero loading states and `alert()` used for errors |

**Overall: 15/24**

---

## Top 3 Priority Fixes

1. **No loading states anywhere** — Users have no feedback during async operations (localStorage save, clipboard write, file import) — Add a toast-based loading indicator or skeleton overlay in `App.tsx` for import/export operations
2. **100+ hardcoded hex color values** — Colors like `#262626`, `#333333`, `#404040`, `#525252` are repeated across every component — Define CSS custom properties in `index.css` (e.g., `--surface-1: #1a1a1a; --surface-2: #262626; --border: #404040`) and replace inline hex values
3. **`alert()` used for error feedback** — `App.tsx:242`, `App.tsx:256`, `App.tsx:272`, `App.tsx:285`, `App.tsx:296`, `TaskHeader.tsx:155` use native `alert()` for errors — Replace with the existing `showToast` pattern for consistent UX

---

## Detailed Findings

### Pillar 1: Copywriting (3/4)

**Strengths:**
- All user-facing text is in Portuguese and context-specific (e.g., "Importar Nova Tarefa", "Gerar Lista de Revisão", "Finalizar Tarefa")
- No generic "Submit", "Click Here", or "OK" labels found
- Empty states are descriptive: "Nenhuma tarefa registrada ainda." (`HistoryList.tsx:148`), "Nenhuma tarefa finalizada encontrada no histórico." (`RevisionArea.tsx:102`)
- Error copy is contextual: "JSON inválido." (`App.tsx:285`), "Erro ao exportar." (`App.tsx:242`)

**Issues:**
- **Typo in PasteBackupModal.tsx:48**: "restaurar ou **mesclado** suas tarefas" should be "mesclar"
- **Native `alert()` for errors** (`App.tsx:242,256,272,285,296`, `TaskHeader.tsx:155`) breaks the polished UX — these should use the `showToast` pattern already established in the app
- **Generic confirm text**: `ConfirmModal.tsx` is called with `message="Excluir?"` (`App.tsx:553`) — too terse, should be "Tem certeza que deseja excluir esta tarefa? Esta ação não pode ser desfeita."

### Pillar 2: Visuals (3/4)

**Strengths:**
- Clear visual hierarchy: purple sidebar (`bg-[#5c2092]`) as primary nav, dark card surfaces (`bg-[#333333]`, `bg-[#262626]`) for content
- Strong focal points: green "Finalizar Tarefa" CTA (`TaskHeader.tsx:405`), purple "Revisar com IA" button with glow effect (`TaskHeader.tsx:368`)
- Drag-and-drop visual feedback: opacity reduction (`opacity: 0.6`), ring highlight during resize (`ring-2 ring-purple-500`), ghost dimension overlay (`ActivityBlockCard.tsx:431`)
- Section headers have clear visual separation with `border-b-2 border-white/10` and large typography (`text-3xl font-black`)

**Issues:**
- **Icon-only buttons without aria-labels**: `ActivityBlockCard.tsx:346` (edit), `ActivityBlockCard.tsx:347` (delete), `ActivityBlockCard.tsx:334` (gabarito toggle), `HistoryList.tsx:230` (delete) — all have `title` attributes but no `aria-label` for screen readers
- **Collapsed sidebar** (`Sidebar.tsx`): When collapsed, navigation items lose text labels and rely solely on icons with `title` tooltips — acceptable for sighted users but problematic for accessibility
- **Toast positioning**: `App.tsx:314` uses `fixed bottom-8 left-1/2` — on mobile this could overlap with the bottom of the viewport or be obscured by virtual keyboards

### Pillar 3: Color (2/4)

**Strengths:**
- Consistent semantic color usage: purple (`#84cc16` is actually lime-green used as primary accent, purple for secondary), green for success/correct, red for errors/incorrect, orange for doubts
- The 60/30/10 split is roughly respected: dark backgrounds dominate (~60%), card surfaces and borders (~30%), accent colors on CTAs and highlights (~10%)
- No `text-primary`/`bg-primary` Tailwind class usage (0 occurrences) — colors are applied directly

**Issues:**
- **100+ hardcoded hex color values** across all components. Key repeated values:
  - `#1a1a1a` — deepest surface (used 15+ times)
  - `#262626` — card surface (used 20+ times)
  - `#333333` — elevated card (used 15+ times)
  - `#404040` — border color (used 25+ times)
  - `#525252` — subtle border/divider (used 10+ times)
  - `#84cc16` — primary accent lime-green (used 20+ times)
- These should be extracted to CSS custom properties in `index.css` for maintainability and theming support
- **Inconsistent accent usage**: Purple (`purple-500`, `purple-600`) is used for interactive elements, but lime-green (`#84cc16`) is used for primary CTAs — two competing accent colors without clear semantic distinction

### Pillar 4: Typography (2/4)

**Font sizes in use (6 distinct):**
| Size | Usage |
|------|-------|
| `text-[8px]` | Gabarito label (`ActivityBlockCard.tsx:399`) |
| `text-[10px]` | Metadata badges, labels, tracking text (40+ occurrences) |
| `text-xs` | Small labels, button text |
| `text-sm` | Body text, form labels |
| `text-lg` | Subheadings |
| `text-xl` | Section headings |
| `text-2xl` | Task title (`TaskHeader.tsx:219`) |
| `text-3xl` | Section header title (`ActivityBlockCard.tsx:212`) |

**Font weights in use (5 distinct):**
| Weight | Usage |
|--------|-------|
| `font-black` | Badges, labels, emphasis (60+ occurrences) |
| `font-bold` | Headings, buttons (40+ occurrences) |
| `font-semibold` | Table cells, stats |
| `font-medium` | Descriptive text |
| `font-normal` | Default body text |

**Issues:**
- **Exceeds abstract standard** of ≤4 font sizes and ≤2 font weights
- `font-black` is overused (60+ occurrences) — creates visual noise where everything competes for attention
- `text-[10px]` is used 40+ times as an arbitrary value — should be mapped to a defined `text-2xs` or similar in the theme
- No `text-base` usage at all — the default body text is `text-sm`, which may be too small for accessibility (WCAG recommends 16px minimum for body text)

### Pillar 5: Spacing (3/4)

**Top spacing classes:**
| Class | Count |
|-------|-------|
| `py-2` | 42 |
| `gap-2` | 39 |
| `px-6` | 23 |
| `gap-1` | 23 |
| `px-4` | 23 |
| `px-3` | 22 |
| `py-4` | 22 |
| `p-1` | 21 |
| `gap-3` | 17 |
| `py-1` | 16 |

**Arbitrary spacing values (~40 occurrences):**
- `text-[10px]`, `text-[8px]` — font size (not spacing, but arbitrary)
- `w-[1px]` — divider lines (`ActivityBlockCard.tsx:52,57,66,391`)
- `max-w-[150px]` — slider containers (`TaskHeader.tsx:338,350`)
- `min-w-[28px]` — answer buttons (`ActivityBlockCard.tsx:382`)
- `min-w-[2rem]` — number displays (`BlockEditModal.tsx:139,157`)
- `blur-[80px]` — decorative blurs (`SectionEditModal.tsx:33,34`)
- `backdrop-blur-[1px]` — resize overlay (`ActivityBlockCard.tsx:431`)
- `ml-0.5`, `mb-0.5`, `mb-1.5` — micro-adjustments

**Issues:**
- Most arbitrary values are justified (micro-adjustments for specific UI elements)
- The `w-[1px]` divider pattern appears 4 times — could be extracted to a utility class
- `max-w-[150px]` appears twice with identical purpose — could use `max-w-[9.375rem]` or a theme token

### Pillar 6: Experience Design (2/4)

**State coverage analysis:**

| State | Present? | Details |
|-------|----------|---------|
| Loading states | ❌ No | Zero loading indicators anywhere in the codebase |
| Error states | ⚠️ Partial | `try/catch` in `useTasks.ts:7-13,28,38` for localStorage; `alert()` for user-facing errors |
| Empty states | ✅ Yes | `HistoryList.tsx:145-149`, `RevisionArea.tsx:100-104`, `ImportArea.tsx:27-29` |
| Disabled states | ✅ Yes | `BlockEditModal.tsx:175`, `GabaritoModal.tsx:91`, `ImportArea.tsx:144`, `PasteBackupModal.tsx:62`, `HistoryList.tsx:249` |
| Confirmation for destructive | ✅ Yes | `ConfirmModal.tsx` used for task deletion (`App.tsx:551-554`) |
| Locked/disabled interactions | ✅ Yes | `block.isLocked` checks in `ActivityBlockCard.tsx:309,329,381,390,392,394` |

**Issues:**
- **Zero loading states**: File imports (`App.tsx:246-260`), clipboard operations (`TaskHeader.tsx:202`), localStorage saves (`useTasks.ts:24-28`) have no loading feedback
- **`alert()` for errors**: 6 instances of native `alert()` break the app's polished UX and provide no visual consistency
- **No error boundary**: No `ErrorBoundary` component — a crash in any component would white-screen the entire app
- **No optimistic updates**: Block reordering via drag-and-drop happens synchronously, but if localStorage fails, the user has no indication

---

## Files Audited

- `src/App.tsx` (559 lines)
- `src/components/ActivityBlockCard.tsx` (438 lines)
- `src/components/TaskHeader.tsx` (415 lines)
- `src/components/SectionEditModal.tsx` (139 lines)
- `src/components/BlockEditModal.tsx` (185 lines)
- `src/components/HistoryList.tsx` (301 lines)
- `src/components/Sidebar.tsx` (139 lines)
- `src/components/PasteBackupModal.tsx` (80 lines)
- `src/components/GabaritoModal.tsx` (101 lines)
- `src/components/RevisionArea.tsx` (176 lines)
- `src/components/ImportArea.tsx` (153 lines)
- `src/components/CreateTaskModal.tsx` (121 lines)
- `src/components/ConfirmModal.tsx` (63 lines)
- `src/hooks/useTasks.ts` (522 lines)
- `src/hooks/useSnapResizer.ts` (79 lines)
- `src/utils/parser.ts` (153 lines)
- `src/utils/constants.ts` (38 lines)
- `src/types/index.ts` (52 lines)
- `src/main.tsx` (10 lines)
- `src/index.css` (12 lines)

**Total: 20 files, 3,736 lines audited**
