# Phase 4: JSON Export and Backup - Plan

**Goal:** Implement resilient application state exports and imports to mitigate client-side storage risks and allow historical migrations to new machines.

## Steps
1. Insert `Download, Upload` into the `lucide-react` imports statement inside `src/App.tsx`.
2. Define `const handleExportBackup = () => { ... }` that serializes `tasks`. It leverages basic blob creation and anchor elements to trigger the download prompt dynamically.
3. Define `const handleImportBackup = (e: React.ChangeEvent<HTMLInputElement>) => { ... }` that:
   - Reads the `.json` file from `e.target.files`.
   - Attaches `FileReader` mapping standard Text async evaluation.
   - Triggers `JSON.parse` securely inside a `try/catch`.
   - Identifies structural integrity implicitly (`Array.isArray(parsed)`).
   - Mutates `setTasks(parsed)` followed immediately by `showToast('Backup restaurado!')`.
4. Render UI toggles for these actions inside `<aside className="w-64..." ...>`. Below the core navigation blocks, create a fixed flex row or stack for "Importar Backup" and "Exportar Backup".
5. Run TypeScript checks natively and compile a bundled preview build.
