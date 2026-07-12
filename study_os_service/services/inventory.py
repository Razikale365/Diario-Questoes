from __future__ import annotations

from collections.abc import Callable

from study_os_service.ingest.course_scanner import CourseScanSnapshot, scan_course_root
from study_os_service.repositories.inventory import ImportRunSummary, InventoryRepository


Scanner = Callable[[object, str, str], CourseScanSnapshot]


class InventoryService:
    def __init__(
        self,
        repository: InventoryRepository,
        scanner: Callable[..., CourseScanSnapshot] = scan_course_root,
    ):
        self.repository = repository
        self.scanner = scanner

    def scan_and_reconcile(
        self, root_id: int, *, run_id: int | None = None
    ) -> ImportRunSummary:
        root = self.repository.get_root(root_id)
        if root is None:
            raise KeyError(f"course root {root_id} does not exist")
        if run_id is None:
            run_id = self.repository.create_import_run(root_id)
        else:
            run = self.repository.get_import_run(run_id)
            if run is None:
                raise KeyError(f"import run {run_id} does not exist")
            if run.root_id != root_id:
                raise ValueError("import run does not belong to the course root")
            if run.state not in {"queued", "running"}:
                raise ValueError("import run is already finished")
        self.repository.mark_import_running(run_id)
        try:
            snapshot = self.scanner(root.root_path, root.target_slug, root.provider)
            self.repository.connection.execute("BEGIN IMMEDIATE")
            try:
                self.repository.reconcile_snapshot(root_id, snapshot, run_id)
                self.repository.connection.commit()
            except Exception:
                self.repository.connection.rollback()
                raise
        except Exception as exc:
            self.repository.fail_import_run(run_id, str(exc))
            raise
        summary = self.repository.get_import_run(run_id)
        if summary is None:
            raise RuntimeError(f"import run {run_id} disappeared")
        return summary
