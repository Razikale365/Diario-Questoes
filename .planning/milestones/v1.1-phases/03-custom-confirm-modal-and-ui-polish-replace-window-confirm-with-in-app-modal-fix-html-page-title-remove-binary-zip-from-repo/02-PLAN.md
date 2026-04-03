# Phase 3: Custom Confirm Modal & UI Polish - Plan

**Goal:** Provide professional confirmation dialogues avoiding basic browser popups and sanitize the repository structure.

## UI Polish Steps
- [x] Update `<title>` tag inside `index.html` to be exactly `Diário de Revisão LS`.
- [x] Unlink / remove any existing `diário-de-revisão-ls.zip` archive off the root.

## Technical Modal Steps
- [x] Add a state variable `taskToDelete` defined `useState<string | null>(null)` to `src/App.tsx`.
- [x] Re-map `deleteTask` to simply queue `setTaskToDelete(id)` instead of triggering blocking `confirm`.
- [x] Provide a handler `confirmDeleteTask` which executes the actual set mutation and drops the id from state.
- [x] Render a clean, Tailwind-styled Absolute modal positioned fixed at z-50 center screen that prompts: "Tem certeza que deseja excluir esta tarefa?". 
- [x] Integrate standard Action UI inside the modal (Red for Delete, Gray for Cancel).
- [x] Validate build pipeline once done.
