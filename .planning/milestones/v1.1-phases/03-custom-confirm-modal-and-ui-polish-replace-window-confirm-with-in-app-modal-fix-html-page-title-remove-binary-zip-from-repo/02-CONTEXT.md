# Phase 3: Custom Confirm Modal & UI Polish - Context

**Gathered:** 2026-03-30
**Status:** Ready for planning
**Mode:** Auto-generated (autonomous)

<domain>
## Phase Boundary

1. Replace `window.confirm()` calls (specifically at line 514 in `src/App.tsx` during task deletion) with a custom React modal to avoid deprecation/blocking issues in some environments.
2. Update the `<title>` tag in `index.html` from `Vite + React + TS` (or other scaffold defaults) to the actual app name `Diário de Revisão LS`.
3. Clean the repository by deleting the committed binary `diário-de-revisão-ls.zip`.
</domain>

<decisions>
## Implementation Decisions

### Custom Confirm Modal Design
- Create an inner component or inline state `<ConfirmModal />` mechanism. 
- Use standard modal aesthetic (overlay with `bg-black/50`, centered white dialog box).
- Buttons: "Cancelar" (secondary) and "Excluir" (danger red).
- Add state variables to `App.tsx` to track the pending deletion action: `const [pendingDeleteTask, setPendingDeleteTask] = useState<string | null>(null);`

### UI Polish
- Standardize the HTML `<title>` tag for better UX and SEO in `index.html`.
- Run a quick clean up removing `diário-de-revisão-ls.zip` and preventing future inclusions.
</decisions>
