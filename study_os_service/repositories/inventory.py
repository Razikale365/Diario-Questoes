from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
import json
from pathlib import Path
import sqlite3
from typing import TYPE_CHECKING

from study_os_service.domain.inventory import CoursePackageChoice

if TYPE_CHECKING:
    from study_os_service.ingest.course_scanner import CourseScanSnapshot


class RootTargetConflictError(ValueError):
    """Raised when a registered filesystem root is reused for another target."""


@dataclass(frozen=True, slots=True)
class CourseRootRecord:
    id: int
    target_slug: str
    provider: str
    package_name: str
    package_id: str | None
    package_url: str
    edition_note: str
    root_path: Path
    source_kind: str
    acquisition_method: str
    download_status: str
    downloader_name: str | None
    downloader_version: str | None
    acquisition_id: str | None
    catalog_checked_at: datetime
    download_started_at: datetime | None
    downloaded_at: datetime | None
    acquisition_manifest_path: Path | None
    expected_file_count: int | None
    observed_file_count: int | None
    failed_item_count: int | None
    active: bool
    last_scanned_at: datetime | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class CourseRecord:
    id: int
    root_id: int
    target_slug: str
    display_name: str
    provider: str
    relative_path: str
    active: bool
    scan_state: str
    last_scanned_at: datetime | None


@dataclass(frozen=True, slots=True)
class LessonRecord:
    id: int
    course_id: int
    discipline_id: int | None
    lesson_number: int | None
    title: str
    sequence_index: int
    status: str
    estimated_minutes: int | None
    available: bool
    mapping_source: str


@dataclass(frozen=True, slots=True)
class ImportRunSummary:
    id: int
    root_id: int
    state: str
    discovered_count: int
    reconciled_count: int
    issue_count: int
    started_at: datetime
    completed_at: datetime | None
    error_message: str | None


def _datetime(value: str | None) -> datetime | None:
    if value is None:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _record(row: sqlite3.Row) -> CourseRootRecord:
    return CourseRootRecord(
        id=row["id"],
        target_slug=row["target_slug"],
        provider=row["provider"],
        package_name=row["package_name"],
        package_id=row["package_id"],
        package_url=row["package_url"],
        edition_note=row["edition_note"],
        root_path=Path(row["root_path"]),
        source_kind=row["source_kind"],
        acquisition_method=row["acquisition_method"],
        download_status=row["download_status"],
        downloader_name=row["downloader_name"],
        downloader_version=row["downloader_version"],
        acquisition_id=row["acquisition_id"],
        catalog_checked_at=_datetime(row["catalog_checked_at"]),
        download_started_at=_datetime(row["download_started_at"]),
        downloaded_at=_datetime(row["downloaded_at"]),
        acquisition_manifest_path=(
            Path(row["acquisition_manifest_path"])
            if row["acquisition_manifest_path"]
            else None
        ),
        expected_file_count=row["expected_file_count"],
        observed_file_count=row["observed_file_count"],
        failed_item_count=row["failed_item_count"],
        active=bool(row["active"]),
        last_scanned_at=_datetime(row["last_scanned_at"]),
        created_at=_datetime(row["created_at"]),
        updated_at=_datetime(row["updated_at"]),
    )


def _run_summary(row: sqlite3.Row) -> ImportRunSummary:
    return ImportRunSummary(
        id=row["id"],
        root_id=row["root_id"],
        state=row["state"],
        discovered_count=row["discovered_count"],
        reconciled_count=row["reconciled_count"],
        issue_count=row["issue_count"],
        started_at=_datetime(row["started_at"]),
        completed_at=_datetime(row["completed_at"]),
        error_message=row["error_message"],
    )


class InventoryRepository:
    def __init__(self, connection: sqlite3.Connection):
        self.connection = connection

    def register_root(
        self,
        choice: CoursePackageChoice,
        *,
        source_kind: str = "course_package",
        active: bool = True,
    ) -> int:
        if choice.download_status not in {"downloaded", "validated"}:
            raise ValueError("course root registration requires a downloaded or validated package")
        if choice.root_path is None:
            raise ValueError("course root registration requires a root path")

        root_path = str(choice.root_path)
        existing = self.connection.execute(
            "SELECT id, target_slug FROM course_roots WHERE root_path = ? COLLATE NOCASE",
            (root_path,),
        ).fetchone()
        if existing is not None and existing["target_slug"] != choice.target_slug:
            raise RootTargetConflictError(
                f"root already belongs to target {existing['target_slug']}; "
                f"cannot reassign it to {choice.target_slug}"
            )

        values = {
            "target_slug": choice.target_slug,
            "provider": choice.provider,
            "package_name": choice.package_name,
            "package_id": choice.package_id,
            "package_url": choice.package_url,
            "edition_note": choice.edition_note,
            "root_path": root_path,
            "source_kind": source_kind,
            "acquisition_method": choice.acquisition_method,
            "download_status": choice.download_status,
            "downloader_name": choice.downloader_name,
            "downloader_version": choice.downloader_version,
            "acquisition_id": choice.acquisition_id,
            "catalog_checked_at": choice.catalog_checked_at.isoformat(),
            "download_started_at": (
                choice.download_started_at.isoformat()
                if choice.download_started_at
                else None
            ),
            "downloaded_at": (
                choice.downloaded_at.isoformat() if choice.downloaded_at else None
            ),
            "acquisition_manifest_path": (
                str(choice.acquisition_manifest_path)
                if choice.acquisition_manifest_path
                else None
            ),
            "expected_file_count": choice.expected_file_count,
            "observed_file_count": choice.observed_file_count,
            "failed_item_count": choice.failed_item_count,
            "active": int(active),
        }
        if existing is None:
            cursor = self.connection.execute(
                """
                INSERT INTO course_roots (
                  target_slug, provider, package_name, package_id, package_url,
                  edition_note, root_path, source_kind, acquisition_method,
                  download_status, downloader_name, downloader_version,
                  acquisition_id, catalog_checked_at, download_started_at,
                  downloaded_at, acquisition_manifest_path, expected_file_count,
                  observed_file_count, failed_item_count, active
                ) VALUES (
                  :target_slug, :provider, :package_name, :package_id, :package_url,
                  :edition_note, :root_path, :source_kind, :acquisition_method,
                  :download_status, :downloader_name, :downloader_version,
                  :acquisition_id, :catalog_checked_at, :download_started_at,
                  :downloaded_at, :acquisition_manifest_path, :expected_file_count,
                  :observed_file_count, :failed_item_count, :active
                )
                """,
                values,
            )
            return cursor.lastrowid

        values["id"] = existing["id"]
        self.connection.execute(
            """
            UPDATE course_roots SET
              provider=:provider,
              package_name=:package_name,
              package_id=:package_id,
              package_url=:package_url,
              edition_note=:edition_note,
              source_kind=:source_kind,
              acquisition_method=:acquisition_method,
              download_status=:download_status,
              downloader_name=:downloader_name,
              downloader_version=:downloader_version,
              acquisition_id=:acquisition_id,
              catalog_checked_at=:catalog_checked_at,
              download_started_at=:download_started_at,
              downloaded_at=:downloaded_at,
              acquisition_manifest_path=:acquisition_manifest_path,
              expected_file_count=:expected_file_count,
              observed_file_count=:observed_file_count,
              failed_item_count=:failed_item_count,
              active=:active,
              updated_at=CURRENT_TIMESTAMP
            WHERE id=:id
            """,
            values,
        )
        return existing["id"]

    def get_root(self, root_id: int) -> CourseRootRecord | None:
        row = self.connection.execute(
            "SELECT * FROM course_roots WHERE id = ?", (root_id,)
        ).fetchone()
        return _record(row) if row else None

    def list_roots(
        self, *, target_slug: str | None = None, active_only: bool = False
    ) -> list[CourseRootRecord]:
        clauses = []
        parameters: list[object] = []
        if target_slug is not None:
            clauses.append("target_slug = ?")
            parameters.append(target_slug)
        if active_only:
            clauses.append("active = 1")
        where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
        rows = self.connection.execute(
            f"SELECT * FROM course_roots{where} ORDER BY id", parameters
        ).fetchall()
        return [_record(row) for row in rows]

    def set_root_active(self, root_id: int, active: bool) -> None:
        cursor = self.connection.execute(
            """
            UPDATE course_roots
            SET active = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (int(active), root_id),
        )
        if cursor.rowcount == 0:
            raise KeyError(f"course root {root_id} does not exist")

    def count_roots(self) -> int:
        return self.connection.execute("SELECT COUNT(*) FROM course_roots").fetchone()[0]

    def update_material_page_metadata(
        self, material_id: int, *, page_count: int, page_offset: int
    ) -> None:
        if isinstance(page_count, bool) or not isinstance(page_count, int) or page_count < 1:
            raise ValueError("page count must be a positive integer")
        if isinstance(page_offset, bool) or not isinstance(page_offset, int) or page_offset < 0:
            raise ValueError("page offset must be a non-negative integer")
        cursor = self.connection.execute(
            """
            UPDATE materials
            SET page_count=?, page_offset=?, updated_at=CURRENT_TIMESTAMP
            WHERE id=?
            """,
            (page_count, page_offset, material_id),
        )
        if cursor.rowcount == 0:
            raise KeyError(f"material {material_id} does not exist")

    def list_courses(
        self,
        *,
        target_slug: str | None = None,
        root_id: int | None = None,
        active_only: bool = False,
    ) -> list[CourseRecord]:
        clauses = []
        parameters: list[object] = []
        if target_slug is not None:
            clauses.append("roots.target_slug = ?")
            parameters.append(target_slug)
        if root_id is not None:
            clauses.append("courses.root_id = ?")
            parameters.append(root_id)
        if active_only:
            clauses.append("courses.active = 1")
        where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
        rows = self.connection.execute(
            f"""
            SELECT courses.*, roots.target_slug
            FROM courses
            JOIN course_roots AS roots ON roots.id = courses.root_id
            {where}
            ORDER BY courses.id
            """,
            parameters,
        ).fetchall()
        return [
            CourseRecord(
                id=row["id"],
                root_id=row["root_id"],
                target_slug=row["target_slug"],
                display_name=row["display_name"],
                provider=row["provider"],
                relative_path=row["relative_path"],
                active=bool(row["active"]),
                scan_state=row["scan_state"],
                last_scanned_at=_datetime(row["last_scanned_at"]),
            )
            for row in rows
        ]

    def list_lessons(
        self,
        course_id: int,
        *,
        available_only: bool = False,
        limit: int | None = None,
        offset: int = 0,
    ) -> list[LessonRecord]:
        if limit is not None and limit < 1:
            raise ValueError("lesson limit must be positive")
        if offset < 0:
            raise ValueError("lesson offset must be non-negative")
        available_clause = " AND available = 1" if available_only else ""
        pagination_clause = ""
        parameters: list[object] = [course_id]
        if limit is not None:
            pagination_clause = " LIMIT ? OFFSET ?"
            parameters.extend((limit, offset))
        rows = self.connection.execute(
            f"""
            SELECT * FROM lessons
            WHERE course_id = ?{available_clause}
            ORDER BY sequence_index, id
            {pagination_clause}
            """,
            parameters,
        ).fetchall()
        return [
            LessonRecord(
                id=row["id"],
                course_id=row["course_id"],
                discipline_id=row["discipline_id"],
                lesson_number=row["lesson_number"],
                title=row["title"],
                sequence_index=row["sequence_index"],
                status=row["status"],
                estimated_minutes=row["estimated_minutes"],
                available=bool(row["available"]),
                mapping_source=row["mapping_source"],
            )
            for row in rows
        ]

    def get_active_import_run(self, root_id: int) -> ImportRunSummary | None:
        row = self.connection.execute(
            """
            SELECT * FROM import_runs
            WHERE root_id=? AND state IN ('queued','running')
            ORDER BY id DESC LIMIT 1
            """,
            (root_id,),
        ).fetchone()
        return _run_summary(row) if row else None

    def create_import_run(self, root_id: int) -> int:
        cursor = self.connection.execute(
            """
            INSERT INTO import_runs (root_id, state)
            VALUES (?, 'queued')
            """,
            (root_id,),
        )
        return cursor.lastrowid

    def mark_import_running(self, run_id: int) -> None:
        self.connection.execute(
            """
            UPDATE import_runs
            SET state='running', started_at=CURRENT_TIMESTAMP,
                completed_at=NULL, error_message=NULL
            WHERE id=?
            """,
            (run_id,),
        )

    def get_import_run(self, run_id: int) -> ImportRunSummary | None:
        row = self.connection.execute(
            "SELECT * FROM import_runs WHERE id=?", (run_id,)
        ).fetchone()
        return _run_summary(row) if row else None

    def fail_import_run(self, run_id: int, error_message: str) -> None:
        self.connection.execute(
            """
            UPDATE import_runs
            SET state='failed', completed_at=CURRENT_TIMESTAMP,
                error_message=?
            WHERE id=?
            """,
            (error_message[:4000], run_id),
        )

    def reconcile_snapshot(
        self,
        root_id: int,
        snapshot: "CourseScanSnapshot",
        run_id: int,
    ) -> tuple[int, int]:
        root = self.get_root(root_id)
        if root is None:
            raise KeyError(f"course root {root_id} does not exist")
        if snapshot.root != root.root_path.resolve():
            raise ValueError("scan snapshot root does not match registered root")
        if snapshot.target_slug != root.target_slug:
            raise ValueError("scan snapshot target does not match registered root")

        now = datetime.now(UTC).isoformat()
        manual_primary_ids = {
            row["lesson_id"]: row["id"]
            for row in self.connection.execute(
                """
                SELECT materials.id, materials.lesson_id
                FROM materials
                JOIN courses ON courses.id = materials.course_id
                WHERE courses.root_id=?
                  AND materials.is_primary=1
                  AND materials.primary_selection='manual'
                  AND materials.lesson_id IS NOT NULL
                """,
                (root_id,),
            )
        }
        self.connection.execute(
            """
            UPDATE materials
            SET available=0, is_primary=0, primary_selection=NULL,
                updated_at=CURRENT_TIMESTAMP
            WHERE course_id IN (SELECT id FROM courses WHERE root_id=?)
            """,
            (root_id,),
        )
        self.connection.execute(
            """
            UPDATE lessons
            SET available=0,
                sequence_index=1000000000 + id,
                updated_at=CURRENT_TIMESTAMP
            WHERE course_id IN (SELECT id FROM courses WHERE root_id=?)
            """,
            (root_id,),
        )
        self.connection.execute(
            """
            UPDATE course_disciplines SET active=0
            WHERE course_id IN (SELECT id FROM courses WHERE root_id=?)
            """,
            (root_id,),
        )
        self.connection.execute(
            """
            UPDATE courses
            SET active=0, scan_state='missing', last_scanned_at=?,
                updated_at=CURRENT_TIMESTAMP
            WHERE root_id=?
            """,
            (now, root_id),
        )

        issue_count = 0
        for issue in snapshot.issues:
            self._insert_issue(
                run_id,
                root_id,
                issue.issue_kind,
                issue.severity,
                issue.relative_path,
                {"message": issue.message},
            )
            issue_count += 1

        for scanned_course in snapshot.courses:
            course_row = self.connection.execute(
                """
                SELECT id FROM courses
                WHERE root_id=? AND relative_path=? COLLATE NOCASE
                """,
                (root_id, scanned_course.relative_path),
            ).fetchone()
            if course_row is None:
                course_id = self.connection.execute(
                    """
                    INSERT INTO courses (
                      root_id, display_name, provider, relative_path,
                      active, scan_state, last_scanned_at
                    ) VALUES (?, ?, ?, ?, 1, 'available', ?)
                    """,
                    (
                        root_id,
                        scanned_course.display_name,
                        snapshot.provider,
                        scanned_course.relative_path,
                        now,
                    ),
                ).lastrowid
            else:
                course_id = course_row["id"]
                self.connection.execute(
                    """
                    UPDATE courses
                    SET display_name=?, provider=?, active=1,
                        scan_state='available', last_scanned_at=?,
                        updated_at=CURRENT_TIMESTAMP
                    WHERE id=?
                    """,
                    (
                        scanned_course.display_name,
                        snapshot.provider,
                        now,
                        course_id,
                    ),
                )

            discipline_id = self.ensure_discipline(scanned_course.discipline_candidate)
            if discipline_id is not None:
                self.connection.execute(
                    """
                    INSERT INTO course_disciplines (
                      course_id, discipline_id, display_order, active
                    ) VALUES (?, ?, 0, 1)
                    ON CONFLICT(course_id, discipline_id)
                    DO UPDATE SET active=1
                    """,
                    (course_id, discipline_id),
                )

            lesson_ids: dict[int, int] = {}
            for scanned_lesson in scanned_course.lessons:
                lesson_row = self.connection.execute(
                    """
                    SELECT id, discipline_id, mapping_source FROM lessons
                    WHERE course_id=? AND lesson_number=?
                    ORDER BY id LIMIT 1
                    """,
                    (course_id, scanned_lesson.lesson_number),
                ).fetchone()
                if lesson_row is None:
                    lesson_id = self.connection.execute(
                        """
                        INSERT INTO lessons (
                          course_id, discipline_id, lesson_number, title,
                          sequence_index, status, available
                        ) VALUES (?, ?, ?, ?, ?, 'unread', 1)
                        """,
                        (
                            course_id,
                            discipline_id,
                            scanned_lesson.lesson_number,
                            scanned_lesson.title,
                            scanned_lesson.sequence_index,
                        ),
                    ).lastrowid
                else:
                    lesson_id = lesson_row["id"]
                    if lesson_row["mapping_source"] == "manual":
                        self.connection.execute(
                            """
                            UPDATE lessons
                            SET sequence_index=?, available=1,
                                updated_at=CURRENT_TIMESTAMP
                            WHERE id=?
                            """,
                            (scanned_lesson.sequence_index, lesson_id),
                        )
                        manual_discipline_id = lesson_row["discipline_id"]
                        if manual_discipline_id is not None:
                            self.connection.execute(
                                """
                                INSERT INTO course_disciplines (
                                  course_id, discipline_id, display_order, active
                                ) VALUES (?, ?, 0, 1)
                                ON CONFLICT(course_id, discipline_id)
                                DO UPDATE SET active=1
                                """,
                                (course_id, manual_discipline_id),
                            )
                    else:
                        self.connection.execute(
                            """
                            UPDATE lessons
                            SET discipline_id=?, sequence_index=?, available=1,
                                updated_at=CURRENT_TIMESTAMP
                            WHERE id=?
                            """,
                            (discipline_id, scanned_lesson.sequence_index, lesson_id),
                        )
                lesson_ids[scanned_lesson.lesson_number] = lesson_id

            current_material_ids: dict[str, int] = {}
            for scanned_material in scanned_course.materials:
                lesson_id = (
                    lesson_ids.get(scanned_material.lesson_number)
                    if scanned_material.lesson_number is not None
                    else None
                )
                material_row = self.connection.execute(
                    """
                    SELECT id FROM materials
                    WHERE course_id=? AND normalized_relative_path=? COLLATE NOCASE
                    """,
                    (course_id, scanned_material.normalized_relative_path),
                ).fetchone()
                if material_row is None:
                    rename_row = self.connection.execute(
                        """
                        SELECT id, relative_path FROM materials
                        WHERE course_id=?
                          AND available=0
                          AND size_bytes=?
                          AND modified_at=?
                          AND kind=?
                          AND lesson_id IS ?
                        ORDER BY id LIMIT 1
                        """,
                        (
                            course_id,
                            scanned_material.size_bytes,
                            str(scanned_material.modified_at_ns),
                            scanned_material.kind,
                            lesson_id,
                        ),
                    ).fetchone()
                    material_id = self.connection.execute(
                        """
                        INSERT INTO materials (
                          course_id, lesson_id, absolute_path, relative_path,
                          normalized_relative_path, kind, size_bytes, modified_at,
                          available, is_primary, primary_selection, trust_level
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0, NULL, ?)
                        """,
                        (
                            course_id,
                            lesson_id,
                            str(scanned_material.absolute_path),
                            scanned_material.relative_path,
                            scanned_material.normalized_relative_path,
                            scanned_material.kind,
                            scanned_material.size_bytes,
                            str(scanned_material.modified_at_ns),
                            scanned_material.trust_level,
                        ),
                    ).lastrowid
                    if rename_row is not None:
                        self._insert_issue(
                            run_id,
                            root_id,
                            "possible_rename",
                            "warning",
                            scanned_material.relative_path,
                            {
                                "oldRelativePath": rename_row["relative_path"],
                                "newRelativePath": scanned_material.relative_path,
                                "oldMaterialId": rename_row["id"],
                                "newMaterialId": material_id,
                            },
                        )
                        issue_count += 1
                else:
                    material_id = material_row["id"]
                    self.connection.execute(
                        """
                        UPDATE materials
                        SET lesson_id=?, absolute_path=?, relative_path=?,
                            kind=?, size_bytes=?, modified_at=?, available=1,
                            trust_level=?, updated_at=CURRENT_TIMESTAMP
                        WHERE id=?
                        """,
                        (
                            lesson_id,
                            str(scanned_material.absolute_path),
                            scanned_material.relative_path,
                            scanned_material.kind,
                            scanned_material.size_bytes,
                            str(scanned_material.modified_at_ns),
                            scanned_material.trust_level,
                            material_id,
                        ),
                    )
                current_material_ids[scanned_material.relative_path] = material_id

            for scanned_lesson in scanned_course.lessons:
                lesson_id = lesson_ids[scanned_lesson.lesson_number]
                selected_id = None
                manual_id = manual_primary_ids.get(lesson_id)
                if manual_id is not None:
                    eligible = self.connection.execute(
                        """
                        SELECT id FROM materials
                        WHERE id=? AND lesson_id=? AND available=1
                          AND kind IN ('original','simplified','highlighted','other')
                        """,
                        (manual_id, lesson_id),
                    ).fetchone()
                    if eligible is not None:
                        selected_id = manual_id
                selection = "manual" if selected_id is not None else "automatic"
                if selected_id is None and scanned_lesson.primary_material_relative_path:
                    selected_id = current_material_ids.get(
                        scanned_lesson.primary_material_relative_path
                    )
                if selected_id is not None:
                    self.connection.execute(
                        """
                        UPDATE materials
                        SET is_primary=1, primary_selection=?,
                            updated_at=CURRENT_TIMESTAMP
                        WHERE id=?
                        """,
                        (selection, selected_id),
                    )

        self.connection.execute(
            """
            UPDATE course_roots
            SET last_scanned_at=?, updated_at=CURRENT_TIMESTAMP
            WHERE id=?
            """,
            (now, root_id),
        )
        discovered_count = snapshot.material_count
        self.connection.execute(
            """
            UPDATE import_runs
            SET state='completed', discovered_count=?, reconciled_count=?,
                issue_count=?, completed_at=CURRENT_TIMESTAMP,
                error_message=NULL
            WHERE id=?
            """,
            (discovered_count, discovered_count, issue_count, run_id),
        )
        return discovered_count, issue_count

    def ensure_discipline(self, canonical_name: str) -> int | None:
        name = canonical_name.strip()
        if not name:
            return None
        self.connection.execute(
            """
            INSERT INTO disciplines (canonical_name)
            VALUES (?)
            ON CONFLICT(canonical_name) DO NOTHING
            """,
            (name,),
        )
        return self.connection.execute(
            "SELECT id FROM disciplines WHERE canonical_name=? COLLATE NOCASE",
            (name,),
        ).fetchone()[0]

    def _insert_issue(
        self,
        run_id: int,
        root_id: int,
        issue_kind: str,
        severity: str,
        relative_path: str | None,
        context: dict[str, object],
    ) -> None:
        self.connection.execute(
            """
            INSERT INTO import_issues (
              import_run_id, root_id, issue_kind, severity,
              relative_path, context_json, state
            ) VALUES (?, ?, ?, ?, ?, ?, 'open')
            """,
            (
                run_id,
                root_id,
                issue_kind,
                severity,
                relative_path,
                json.dumps(context, ensure_ascii=True, sort_keys=True),
            ),
        )
