# Phase 15 Research: UX & Interactivity Improvements

## Objetivos

- [x] Layout Fluido (12 colunas) with snaps (3, 6, 9, 12)
- [x] Drag-and-drop para reordenação de blocos
- [x] Redimensionamento por arraste de bordas
- [x] Animações suaves com Framer Motion

## 1. @dnd-kit Suitability for React 19

**Verdict:** Strongly Recommended.
- **Why:** It is headless, modular, and works natively with React 19’s concurrency model.
- **Pitfalls:** 
  - **Performance:** Reordering large components like `ActivityBlockCard` can trigger "Rerender Storms". Total isolation of the "active" drag item and strict `React.memo` wrapping are mandatory.
  - **Sensors:** Memoize sensors (`useSensor`) to prevent initialization loops during re-renders.

## 2. Resizing Logic & 'Live' Feedback

**Strategy:** Custom 'Grid-Aware' Resize Hook.
- **The Formula:** `newSpan = Math.round(startSpan + deltaX / columnWidth)`.
- **Implementation:** 
  - Do NOT use `react-resizable` for this; it’s too heavy for simple col-span mapping.
  - Use a custom `onMouseDown` on resizing edges. 
  - **Critical:** Call `e.stopPropagation()` on the resize handle to prevent `@dnd-kit` from starting a drag operation.
  - **Preview Mode:** Update a local `previewSpan` during the `mousemove` event and commit to the global state only on `mouseup` to prevent heavy DB/State thrashing.

## 3. Responsiveness & Fluid Grids
**Strategy:** Hybrid Layout.
- Use Tailwind's `grid-cols-[repeat(auto-fill,minmax(250px,1fr))]` for the default fluid behavior.
- Use inline styles or dynamic Tailwind classes (`col-span-{n}`) for the manual overrides saved in the user's layout state.
- **Max Width:** Transition from `max-w-6xl` to `max-w-[1920px]` or `w-full px-8` to truly utilize modern monitors.

## 4. The 'Premium' Feel (SOTA)
**Strategy:** Motion-Driven Layouts.
- **Framer Motion:** Wrap `SortableContext` items in `<motion.div layout />`. This automatically animates items into their new positions when the underlying array reorders, providing that "Apple-like" smoothness.
- **Transition:** Use a `spring` transition for reordering (damping 20-30) to make it feel physical rather than robotic.

## Prescriptive Feedback for Implementation
The original plan to "map delta-x to columns" is the correct path, but it must be implemented via a **Snap-to-Grid** logic. If the user drags 20px but a column is 300px, nothing should happen visually until they cross the ~150px threshold. This prevents "jittery" layouts.
