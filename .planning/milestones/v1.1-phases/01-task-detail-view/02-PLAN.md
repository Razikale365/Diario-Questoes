# Phase 1: Task Detail View — PLAN

**Status:** COMPLETE ✅
**Generated:** 2026-03-30
**Executed:** 2026-03-30

## Changes Delivered

### src/App.tsx
- Added `ArrowLeft` to lucide-react imports
- Added `viewingTaskId: string | null` state (default: null)
- Added `viewingTask` useMemo derived from tasks + viewingTaskId
- Refactored `startEditingTask` → uses `viewingTask ?? activeTask`
- Refactored `saveTaskEdits` → uses `viewingTaskId ?? activeTaskId` as targetId
- Refactored `updateQuestion` → uses `viewingTaskId ?? activeTaskId` as targetId
- Refactored `handleDeleteBlock` → uses `viewingTaskId ?? activeTaskId` as targetId
- Refactored `toggleLock` → uses `viewingTaskId ?? activeTaskId` as targetId
- Refactored `saveBlockEdit` → uses `viewingTaskId ?? activeTaskId` as targetId
- Refactored `handleImportGabarito` → uses `viewingTaskId ?? activeTaskId` as targetId
- Added `openHistoryTask(taskId)` handler: locks all blocks, sets viewingTaskId
- HISTÓRICO tab: conditional on `viewingTask` — detail view OR table list
  - Detail view: back button, status badge, task info card, edit form, blocks, add block
  - All existing controls (toggle lock, gabarito, edit block, delete block) work
  - List view: rows now have `onClick={() => openHistoryTask(task.id)}` + cursor-pointer
  - Delete button uses `e.stopPropagation()` to prevent row click conflict

## Requirements Coverage
- HIST-01 ✅ View full task details from history (click any row)
- HIST-02 ✅ Edit responses using lock/unlock mechanism (all blocks locked by default)
- HIST-03 ✅ Import gabarito into historical blocks
- HIST-04 ✅ Edit task metadados (discipline, subject, planejamento, etc.)
- HIST-05 ✅ Add/Edit/Delete blocks in historical tasks
- HIST-06 ✅ Navigate back to history list ("← Voltar ao Histórico" button)
