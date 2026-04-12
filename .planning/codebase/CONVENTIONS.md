# CONVENTIONS.md — Coding Conventions & Patterns

## TypeScript Style
- **Strict mode** enabled (`"strict": true` in tsconfig)
- Types declared as `interface` (not `type`) for domain objects
- Inline `as any` casts used in a few places to work around partial layout type merges (known tech debt in `useTasks.ts` lines 175, 190, 213)
- `any` also used for `revisionTaskModal` state in `App.tsx` (line 143) and `setEditForm` prop (line 17 `TaskHeader.tsx`)
- `crypto.randomUUID()` used natively (no uuid library)

## React Patterns

### State Architecture
- **All state hoisted at `App.tsx`** — no Context API, no Zustand, no Redux
- Children receive data via props and callbacks; this is an intentional flat prop-drilling pattern
- `useMemo` used for derived data (`activeTask`, `inProgressTasks`, `viewingTask`, `generatedRevision`, `uniqueDisciplines`, `availableLessons`)

### Component Patterns
```tsx
// Functional component with typed props interface
interface MyComponentProps { ... }
export const MyComponent: React.FC<MyComponentProps> = ({ ... }) => { ... };

// Memo + forwardRef (ActivityBlockCard only)
export const ActivityBlockCard = memo(forwardRef<HTMLDivElement, Props>((props, ref) => { ... }));
```

### Hook Pattern
```ts
// Hooks use useState + useEffect for persistence
const [tasks, setTasks] = useState<StudyTask[]>(() => {
  try { return JSON.parse(localStorage.getItem('key') || '[]'); }
  catch { return []; }
});
useEffect(() => { localStorage.setItem('key', JSON.stringify(tasks)); }, [tasks]);
```

### Immutable State Updates
All state mutations in `useTasks` use immutable `.map()` + spread:
```ts
setTasks(prev => prev.map(task =>
  task.id === taskId
    ? { ...task, blocks: task.blocks.map(block => ...) }
    : task
));
```

### Event Handling
- Callbacks are passed as `on*` named props (e.g., `onUpdateQuestion`, `onToggleLock`)
- No event bubbling prevention except in `useSnapResizer.ts` (`e.stopPropagation()` on mouse down)

## Naming

### Files
- Components: `PascalCase.tsx`
- Hooks: `usePascalCase.ts`
- Utilities/lib: `camelCase.ts` or `PascalCase.ts`
- Types: `index.ts` (domain), `sync.ts` (sync-specific)

### Variables
- React state: `const [stateVar, setStateVar] = useState(...)`
- Boolean flags: `is*` (e.g., `isLocked`, `isResizing`, `isEditing`, `isDragging`)
- Visibility toggles: `show*` (e.g., `showStats`, `showGabarito`)
- Handlers in `App.tsx`: `handle*` (e.g., `handleDragEnd`, `handlePasteImport`)
- Callbacks passed as props: `on*` (e.g., `onToggleLock`, `onImport`)

## Error Handling
- `try/catch` with silent fallback for localStorage operations (return `[]` or `null`)
- Supabase errors caught and stored in `SyncState.lastError`
- User-facing errors use `alert()` (backup import/export failures) — not a toast
- No global error boundary

## CSS / Tailwind Patterns
- All styling via inline Tailwind classes on JSX elements
- No custom CSS utilities or `@apply` directives
- Color design tokens used as literals (no CSS variables):
  - Accent: `#84cc16` (lime/green)
  - Sidebar: `#5c2092` (purple)
  - Dark backgrounds: `#1a1a1a`, `#2d2d2d`, `#262626`, `#333333`, `#404040`
- Responsive: `md:`, `xl:`, `lg:` prefixes used in grid layouts
- Hover/active states: `hover:*`, `active:scale-95` common pattern
- Animations: mix of Tailwind `animate-in` utilities and Framer Motion `motion.div`

## Import Order Convention
```tsx
// 1. React (and hooks)
import React, { useState, useEffect } from 'react';
// 2. Third-party packages
import { motion } from 'framer-motion';
import { useSortable } from '@dnd-kit/sortable';
// 3. Internal types
import { ActivityBlock, Question } from '../types';
// 4. Internal hooks
import { useSnapResizer } from '../hooks/useSnapResizer';
// 5. Internal components (where needed)
```

## Key Business Logic Patterns

### Question Grading (auto-correct)
When `answer` or `correctAnswer` is set, `isCorrect` is auto-computed:
- `CERTO` → `C`, `ERRADO` → `E` normalization
- `ANULADA` correctAnswer → always `isCorrect: true`
- Otherwise: `isCorrect = userAns === correctAns`

### Section Grouping
Sections and their child blocks are linked by **title/lesson equality** (case-insensitive `.trim().toLowerCase()`):
- `section.title === block.lesson` → block belongs to section
- Section stats are computed in `App.tsx` before each render of `ActivityBlockCard`

### Bank-aware Answer Mode
```tsx
// Determines C/E (CEBRASPE) vs A-E (other banks)
const options = q.isMultipleChoice || (block.bank !== 'CEBRASPE' && block.bank !== 'CESPE')
  ? ['A', 'B', 'C', 'D', 'E']
  : ['C', 'E'];
```
CEBRASPE/CESPE questions default to C/E mode unless individually toggled with double-click.

### DnD Section Move (Recursive)
When a section header is dragged, all child blocks automatically move with it:
```ts
// useTasks.moveBlock() CASE 1: Moving section header + all children together
```

### Eliminated Answers
`question.eliminated?: string[]` — double-click on an answer button toggles eliminated state (strikethrough visual).
