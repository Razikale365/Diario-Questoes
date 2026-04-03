# Phase 7: Paginação para histórico longo - Plan

**Status:** Draft
**Mode:** Auto-generated

<plan>
## Implementation Plan

1. **State & Imports Update (src/App.tsx):**
   - Import `ChevronLeft, ChevronRight` from `lucide-react`.
   - Add state: `const [historyPage, setHistoryPage] = useState(1);`.

2. **Pagination Logic Integration:**
   - Define `ITEMS_PER_PAGE = 15`.
   - Before `return()`, calculate `reversedTasks`, `totalPages`, and `currentHistoryTasks`.
   - Reset `historyPage` to 1 if `activeTab` changes (e.g. by adding an effect or calling setHistoryPage in tab clicks).

3. **History Tab UI Update:**
   - Replace `{tasks.slice().reverse().map(task => (...))}` with `{currentHistoryTasks.map(task => (...))}` in the `historico` table.
   - Below the table, add pagination controls (Previous/Next buttons, page indicators) if `totalPages > 1`.
</plan>
