from __future__ import annotations

from datetime import UTC, datetime
import sqlite3

from study_os_service.domain.sessions import ProgressState, ProgressStatus


class ProgressConflictError(RuntimeError):
    """Raised when optimistic progress state changed before an update."""


def _datetime(value: str | None) -> datetime | None:
    if value is None:
        return None
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _progress(row: sqlite3.Row) -> ProgressState:
    return ProgressState(
        id=row["id"],
        lesson_id=row["lesson_id"],
        material_id=row["material_id"],
        status=row["status"],
        cursor_page=row["cursor_page"],
        furthest_page=row["furthest_page"],
        completed_at=_datetime(row["completed_at"]),
        last_seen_at=_datetime(row["last_seen_at"]),
        confidence=row["confidence"],
        total_seconds=row["total_seconds"],
        session_count=row["session_count"],
        version=row["version"],
    )


class ProgressRepository:
    def __init__(self, connection: sqlite3.Connection):
        self.connection = connection

    def get(self, lesson_id: int, material_id: int) -> ProgressState | None:
        row = self.connection.execute(
            """
            SELECT * FROM progress_states
            WHERE lesson_id=? AND material_id=?
            """,
            (lesson_id, material_id),
        ).fetchone()
        return _progress(row) if row else None

    def get_or_create(self, lesson_id: int, material_id: int) -> ProgressState:
        self._material_metadata(lesson_id, material_id)
        self.connection.execute(
            """
            INSERT INTO progress_states (lesson_id, material_id)
            VALUES (?, ?)
            ON CONFLICT(lesson_id, material_id) DO NOTHING
            """,
            (lesson_id, material_id),
        )
        progress = self.get(lesson_id, material_id)
        if progress is None:
            raise RuntimeError("progress state disappeared after creation")
        return progress

    def advance_cursor(
        self,
        lesson_id: int,
        material_id: int,
        *,
        cursor_page: int,
        expected_version: int,
    ) -> ProgressState:
        self._validate_positive(cursor_page, "cursor page")
        self._validate_positive(expected_version, "expected version")
        current = self.get_or_create(lesson_id, material_id)
        self._validate_version(current, expected_version)
        self._validate_cursor(current, cursor_page)
        status = "in_progress" if current.status == "unread" else current.status
        now = datetime.now(UTC).isoformat()
        cursor = self.connection.execute(
            """
            UPDATE progress_states
            SET status=?, cursor_page=?, furthest_page=?, last_seen_at=?,
                version=version+1, updated_at=CURRENT_TIMESTAMP
            WHERE id=? AND version=?
            """,
            (
                status,
                cursor_page,
                max(current.furthest_page, cursor_page),
                now,
                current.id,
                expected_version,
            ),
        )
        if cursor.rowcount == 0:
            raise ProgressConflictError("progress changed before cursor update")
        return self._required(lesson_id, material_id)

    def record_session(
        self,
        lesson_id: int,
        material_id: int,
        *,
        cursor_page: int,
        elapsed_seconds: int,
        status: ProgressStatus,
        expected_version: int,
    ) -> ProgressState:
        self._validate_positive(cursor_page, "cursor page")
        self._validate_non_negative(elapsed_seconds, "elapsed seconds")
        self._validate_positive(expected_version, "expected version")
        if status not in {"in_progress", "covered", "weak", "strong"}:
            raise ValueError("invalid recorded progress status")
        current = self.get_or_create(lesson_id, material_id)
        self._validate_version(current, expected_version)
        self._validate_cursor(current, cursor_page)
        now = datetime.now(UTC).isoformat()
        completed_at = now if status in {"covered", "strong"} else current.completed_at
        confidence = current.confidence
        if status == "covered":
            confidence = max(confidence, 0.7)
        elif status == "strong":
            confidence = max(confidence, 0.9)
        elif status == "weak":
            confidence = min(confidence, 0.3)
        cursor = self.connection.execute(
            """
            UPDATE progress_states
            SET status=?, cursor_page=?, furthest_page=?, completed_at=?,
                last_seen_at=?, confidence=?, total_seconds=total_seconds+?,
                session_count=session_count+1, version=version+1,
                updated_at=CURRENT_TIMESTAMP
            WHERE id=? AND version=?
            """,
            (
                status,
                cursor_page,
                max(current.furthest_page, cursor_page),
                completed_at.isoformat()
                if isinstance(completed_at, datetime)
                else completed_at,
                now,
                confidence,
                elapsed_seconds,
                current.id,
                expected_version,
            ),
        )
        if cursor.rowcount == 0:
            raise ProgressConflictError("progress changed before session update")
        return self._required(lesson_id, material_id)

    def set_status(
        self,
        lesson_id: int,
        material_id: int,
        *,
        status: ProgressStatus,
        expected_version: int,
    ) -> ProgressState:
        if status not in {"unread", "in_progress", "covered", "stale", "weak", "strong"}:
            raise ValueError("invalid progress status")
        self._validate_positive(expected_version, "expected version")
        current = self.get_or_create(lesson_id, material_id)
        self._validate_version(current, expected_version)
        confidence = current.confidence
        if status == "weak":
            confidence = min(confidence, 0.3)
        elif status == "strong":
            confidence = max(confidence, 0.9)
        now = datetime.now(UTC).isoformat()
        cursor = self.connection.execute(
            """
            UPDATE progress_states
            SET status=?, confidence=?, last_seen_at=?, version=version+1,
                updated_at=CURRENT_TIMESTAMP
            WHERE id=? AND version=?
            """,
            (status, confidence, now, current.id, expected_version),
        )
        if cursor.rowcount == 0:
            raise ProgressConflictError("progress changed before status update")
        return self._required(lesson_id, material_id)

    def list_for_target(self, target_slug: str) -> list[ProgressState]:
        rows = self.connection.execute(
            """
            SELECT progress_states.*
            FROM progress_states
            JOIN materials ON materials.id=progress_states.material_id
            JOIN courses ON courses.id=materials.course_id
            JOIN course_roots AS roots ON roots.id=courses.root_id
            WHERE roots.target_slug=?
            ORDER BY progress_states.id
            """,
            (target_slug,),
        ).fetchall()
        return [_progress(row) for row in rows]

    def _required(self, lesson_id: int, material_id: int) -> ProgressState:
        progress = self.get(lesson_id, material_id)
        if progress is None:
            raise RuntimeError("progress state disappeared")
        return progress

    def _material_metadata(self, lesson_id: int, material_id: int) -> sqlite3.Row:
        row = self.connection.execute(
            """
            SELECT lesson_id, page_count
            FROM materials
            WHERE id=?
            """,
            (material_id,),
        ).fetchone()
        if row is None:
            raise KeyError(f"material {material_id} does not exist")
        if row["lesson_id"] != lesson_id:
            raise ValueError(
                f"material {material_id} does not belong to lesson {lesson_id}"
            )
        return row

    def _validate_cursor(self, current: ProgressState, cursor_page: int) -> None:
        metadata = self._material_metadata(current.lesson_id, current.material_id)
        if cursor_page < current.cursor_page:
            raise ValueError("cursor cannot move backwards")
        page_count = metadata["page_count"]
        if page_count is not None and cursor_page > page_count:
            raise ValueError("cursor page cannot exceed material page count")

    @staticmethod
    def _validate_version(current: ProgressState, expected_version: int) -> None:
        if current.version != expected_version:
            raise ProgressConflictError("progress changed before update")

    @staticmethod
    def _validate_positive(value: int, label: str) -> None:
        if isinstance(value, bool) or not isinstance(value, int) or value < 1:
            raise ValueError(f"{label} must be a positive integer")

    @staticmethod
    def _validate_non_negative(value: int, label: str) -> None:
        if isinstance(value, bool) or not isinstance(value, int) or value < 0:
            raise ValueError(f"{label} must be a non-negative integer")
