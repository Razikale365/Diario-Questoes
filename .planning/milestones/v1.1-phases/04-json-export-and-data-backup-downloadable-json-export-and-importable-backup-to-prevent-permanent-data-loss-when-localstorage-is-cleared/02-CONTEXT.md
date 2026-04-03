# Phase 4: JSON Export and Data Backup - Context

**Gathered:** 2026-03-30
**Status:** Ready for planning
**Mode:** Auto-generated (autonomous)

<domain>
## Phase Boundary
1. Develop a mechanism to serialize the application state (specifically the `tasks` state list) into a `.json` file and trigger a browser-native download prompt.
2. Develop a mechanism to read a user-provided `.json` file, validate the structure asynchronously, and parse its contents back into the `tasks` state array (which automatically syncs to localStorage).
3. The interface elements for these backup verbs should be seamlessly integrated into the navigation layout (e.g. at the bottom of the sidebar or inline).
</domain>

<decisions>
## Implementation Decisions

### Data Schema Integrity
- Using standard `JSON.stringify(tasks, null, 2)` for export to ensure readability.
- Validating the parsed payload during import using a simplistic structural check (`Array.isArray(parsed)` and elements containing `.blocks` or `.id`).

### UI Actions
- We will add `Download` and `Upload` icons from `lucide-react`.
- We can add a "Data Management" area at the bottom of the Sidebar (under the `nav`), separated by a purple border.
- The `Upload` action uses a hidden `<input type="file" onChange={handleImport} />` masked by a `<label>` button.
- Both actions utilize the existing `showToast` component for success/error feedback.
</decisions>
