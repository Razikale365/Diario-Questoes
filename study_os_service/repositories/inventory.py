from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
import sqlite3

from study_os_service.domain.inventory import CoursePackageChoice


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
        self, course_id: int, *, available_only: bool = False
    ) -> list[LessonRecord]:
        available_clause = " AND available = 1" if available_only else ""
        rows = self.connection.execute(
            f"""
            SELECT * FROM lessons
            WHERE course_id = ?{available_clause}
            ORDER BY sequence_index, id
            """,
            (course_id,),
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
            )
            for row in rows
        ]
