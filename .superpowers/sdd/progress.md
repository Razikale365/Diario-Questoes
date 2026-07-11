# Study OS SDD Progress

Plan: `docs/superpowers/plans/2026-07-10-study-os-m1-local-service-foundation.md`

| Task | Status | Base | Head | Verification | Review |
| --- | --- | --- | --- | --- | --- |
| 1. Preserve package ingestion experiment | complete | `414dda1` | `32eb809` | 40 tests, lint, build, diff-check | approved |
| 2. Python package and settings | complete | `88e66e4` | `9673a09` | 2 pytest, 126 frontend tests, lint, build | spec and quality approved |
| 3. SQLite connection and migrations | complete | `1ed5bf2` | `4562e0d` | 6 pytest | spec and quality approved |
| 4. Backup and retention | complete | `9a2b51f` | `7e201fc` | 6 focused, 14 full pytest | manual spec and quality review approved after ISO-window fix |
| 5. FastAPI health endpoint | complete | `052a008` | `0b25a4d` | 7 focused, 19 full pytest, compileall | manual spec and quality review approved |
| 6. Operational CLI | complete | `426dc73` | `b785a6d` | 4 focused, 23 full pytest, compileall | manual spec and quality review approved |
| 7. Frontend service health | complete | `12d1f21` | `817b47d` | 3 focused, 129 full tests, lint, build | manual spec and quality review approved |
| 8. Vite proxy and Windows launcher | complete | `48c8d1e` | `89b1e7b` | 23 pytest, 129 frontend tests, lint, build, direct/proxy smoke | manual spec and quality review approved |
| 9. M1 full gate and M2 plan | complete | `eb8fe1a` | `5c9ef66` | 23 pytest, 129 frontend tests, lint, build, direct/proxy/backup/browser smoke | approved; mobile defect fixed in `fd6d4cf` |

## Notes

- Work is intentionally continuing in the existing feature branch because Task 1 started there before the SDD ledger was introduced.
- Do not mark a task complete until its task-scoped review is clean.
- Task 2's low-priority frozen-dataclass and invalid-port test gap was closed in Task 5.

## M2: Current Package and Course Inventory

Plan: `docs/superpowers/plans/2026-07-11-study-os-m2-course-inventory.md`

| Task | Status | Base | Head | Verification | Review |
| --- | --- | --- | --- | --- | --- |
| 1. Decide and record current Estrategia package | in progress | `5c9ef66` | pending | pending | pending |
| 2. Inventory schema version 2 | pending | pending | pending | pending | pending |
| 3. Lesson parser and material classifier | pending | pending | pending | pending | pending |
| 4. Metadata-only filesystem scanner | pending | pending | pending | pending | pending |
| 5. Transactional scan reconciliation | pending | pending | pending | pending | pending |
| 6. Inventory and safe file APIs | pending | pending | pending | pending | pending |
| 7. Typed inventory client and setup UI | pending | pending | pending | pending | pending |
| 8. Newly downloaded real package verification | pending | pending | pending | pending | pending |
| 9. M2 gate and M3 plan | pending | pending | pending | pending | pending |
