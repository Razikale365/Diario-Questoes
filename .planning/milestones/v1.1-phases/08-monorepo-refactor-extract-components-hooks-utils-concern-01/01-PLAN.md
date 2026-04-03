---
wave: 1
depends_on: []
files_modified:
  - "src/App.tsx"
  - "src/types/index.ts"
  - "src/utils/parser.ts"
  - "src/hooks/useTasks.ts"
  - "src/hooks/useActiveTask.ts"
  - "src/components/QuestionBlock.tsx"
  - "src/components/HistoryTaskDetail.tsx"
  - "src/components/HistoryList.tsx"
  - "src/components/ImportArea.tsx"
  - "src/components/CreateTaskModal.tsx"
  - "src/components/ConfirmModal.tsx"
autonomous: true
---

<objective>
Refactor `src/App.tsx` by extracting components, custom hooks, utils, and types into separate files to resolve CONCERN-01.
</objective>

<task>
<read_first>
- "src/App.tsx"
</read_first>
<action>
1. Create `src/types/index.ts` and move `Question`, `ActivityBlock`, `StudyTask`, `CreateTaskData`, `ConfirmDialogState` interfaces into it.
2. Create `src/utils/parser.ts` and move `parseLSTask`, `formatQuestionList`, `generateRevisionTask` functions there. Export them. Update `import`s in App.tsx.
3. Create `src/hooks/useTasks.ts` to manage `tasks` array, `saveTasks`, delete, toggle lock, history pagination. Or just keep state in App for now and pass as props to components. Wait, actually, let's create components first.
4. Create `src/components/ConfirmModal.tsx` and move the `ConfirmDialog` rendering logic there.
5. Create `src/components/CreateTaskModal.tsx` for the "Gerar Tarefa de Revisão" modal.
6. Create `src/components/ImportArea.tsx` for the "Nova Tarefa" paste area and "Criar Nova Tarefa" handlers.
7. Create `src/components/QuestionBlock.tsx` to render each block of questions inside the Active Task view.
8. Create `src/components/HistoryList.tsx` for the "Histórico" tab list and Pagination.
9. Create `src/components/HistoryTaskDetail.tsx` for viewing a single history task inside the "Histórico" tab.
10. Update `src/App.tsx` to import and use all these components, drastically reducing its line count.
</action>
<acceptance_criteria>
- `cat src/components/QuestionBlock.tsx` outputs a valid React component.
- `cat src/types/index.ts` outputs the TS interfaces.
- `src/utils/parser.ts` contains `export const parseLSTask`.
- `src/App.tsx` is successfully refactored and runs `npm run build` without type errors.
</acceptance_criteria>
</task>
