from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
import sqlite3

from study_os_service.domain.sessions import (
    SessionOutcome,
    SkipReason,
    StudySession,
)


class SessionConflictError(RuntimeError):
    """Raised when an optimistic session update uses a stale version."""


class IdempotencyConflictError(RuntimeError):
    """Raised when an idempotency key is reused for another request."""


@dataclass(frozen=True, slots=True)
class MaterialExecutionContext:
    material_id: int
    lesson_id: int | None
    target_slug: str
    absolute_path: Path
    root_path: Path
    available: bool
    page_count: int | None
    page_offset: int


def _datetime(value: str | None) -> datetime | None:
    if value is None:
        return None
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _session(row: sqlite3.Row) -> StudySession:
    return StudySession(
        id=row["id"],
        idempotency_key=row["idempotency_key"],
        target_slug=row["target_slug"],
        lesson_id=row["lesson_id"],
        material_id=row["material_id"],
        state=row["state"],
        started_at=_datetime(row["started_at"]),
        ended_at=_datetime(row["ended_at"]),
        elapsed_seconds=row["elapsed_seconds"],
        start_page=row["start_page"],
        end_page=row["end_page"],
        questions_done=row["questions_done"],
        correct_count=row["correct_count"],
        wrong_count=row["wrong_count"],
        doubt_count=row["doubt_count"],
        favorite_count=row["favorite_count"],
        outcome=row["outcome"],
        skip_reason=row["skip_reason"],
        notes=row["notes"],
        version=row["version"],
    )


class SessionRepository:
    def __init__(self, connection: sqlite3.Connection):
        self.connection = connection

    def get(self, session_id: int) -> StudySession | None:
        row = self.connection.execute(
            "SELECT * FROM study_sessions WHERE id=?", (session_id,)
        ).fetchone()
        return _session(row) if row else None

    def get_by_idempotency_key(self, key: str) -> StudySession | None:
        row = self.connection.execute(
            "SELECT * FROM study_sessions WHERE idempotency_key=?", (key,)
        ).fetchone()
        return _session(row) if row else None

    def get_active(self, lesson_id: int, material_id: int) -> StudySession | None:
        row = self.connection.execute(
            """
            SELECT * FROM study_sessions
            WHERE lesson_id=? AND material_id=? AND state='active'
            ORDER BY id DESC LIMIT 1
            """,
            (lesson_id, material_id),
        ).fetchone()
        return _session(row) if row else None

    def get_material_context(self, material_id: int) -> MaterialExecutionContext | None:
        row = self.connection.execute(
            """
            SELECT materials.id, materials.lesson_id, materials.absolute_path,
                   materials.available, materials.page_count, materials.page_offset,
                   roots.target_slug, roots.root_path
            FROM materials
            JOIN courses ON courses.id=materials.course_id
            JOIN course_roots AS roots ON roots.id=courses.root_id
            WHERE materials.id=?
            """,
            (material_id,),
        ).fetchone()
        if row is None:
            return None
        return MaterialExecutionContext(
            material_id=row["id"],
            lesson_id=row["lesson_id"],
            target_slug=row["target_slug"],
            absolute_path=Path(row["absolute_path"]),
            root_path=Path(row["root_path"]),
            available=bool(row["available"]),
            page_count=row["page_count"],
            page_offset=row["page_offset"],
        )

    def create_active(
        self,
        *,
        idempotency_key: str,
        target_slug: str,
        lesson_id: int,
        material_id: int,
        start_page: int,
        started_at: datetime,
    ) -> StudySession:
        session_id = self.connection.execute(
            """
            INSERT INTO study_sessions (
              idempotency_key, target_slug, lesson_id, material_id,
              state, started_at, start_page
            ) VALUES (?, ?, ?, ?, 'active', ?, ?)
            """,
            (
                idempotency_key,
                target_slug,
                lesson_id,
                material_id,
                started_at.astimezone(UTC).isoformat(),
                start_page,
            ),
        ).lastrowid
        return self._required(session_id)

    def checkpoint(
        self,
        session_id: int,
        *,
        end_page: int,
        elapsed_seconds: int,
        expected_version: int,
    ) -> StudySession:
        current = self._active_with_version(session_id, expected_version)
        if end_page < current.start_page:
            raise ValueError("end page cannot precede start page")
        if current.end_page is not None and end_page < current.end_page:
            raise ValueError("end page cannot move backwards")
        if elapsed_seconds < current.elapsed_seconds:
            raise ValueError("elapsed seconds cannot move backwards")
        cursor = self.connection.execute(
            """
            UPDATE study_sessions
            SET end_page=?, elapsed_seconds=?, version=version+1,
                updated_at=CURRENT_TIMESTAMP
            WHERE id=? AND state='active' AND version=?
            """,
            (end_page, elapsed_seconds, session_id, expected_version),
        )
        if cursor.rowcount == 0:
            raise SessionConflictError("session changed before checkpoint")
        return self._required(session_id)

    def finish(
        self,
        session_id: int,
        *,
        outcome: SessionOutcome,
        ended_at: datetime,
        end_page: int | None,
        elapsed_seconds: int,
        questions_done: int,
        correct_count: int,
        wrong_count: int,
        doubt_count: int,
        favorite_count: int,
        skip_reason: SkipReason | None,
        notes: str,
        expected_version: int,
    ) -> StudySession:
        current = self._active_with_version(session_id, expected_version)
        if end_page is not None:
            if end_page < current.start_page:
                raise ValueError("end page cannot precede start page")
            if current.end_page is not None and end_page < current.end_page:
                raise ValueError("end page cannot move backwards")
        if elapsed_seconds < current.elapsed_seconds:
            raise ValueError("elapsed seconds cannot move backwards")
        cursor = self.connection.execute(
            """
            UPDATE study_sessions
            SET state='finished', ended_at=?, elapsed_seconds=?, end_page=?,
                questions_done=?, correct_count=?, wrong_count=?, doubt_count=?,
                favorite_count=?, outcome=?, skip_reason=?, notes=?,
                version=version+1, updated_at=CURRENT_TIMESTAMP
            WHERE id=? AND state='active' AND version=?
            """,
            (
                ended_at.astimezone(UTC).isoformat(),
                elapsed_seconds,
                end_page,
                questions_done,
                correct_count,
                wrong_count,
                doubt_count,
                favorite_count,
                outcome,
                skip_reason,
                notes,
                session_id,
                expected_version,
            ),
        )
        if cursor.rowcount == 0:
            raise SessionConflictError("session changed before finish")
        return self._required(session_id)

    def list_finished_for_material(self, material_id: int) -> list[StudySession]:
        rows = self.connection.execute(
            """
            SELECT * FROM study_sessions
            WHERE material_id=? AND state='finished'
            ORDER BY started_at, id
            """,
            (material_id,),
        ).fetchall()
        return [_session(row) for row in rows]

    def list_finished_for_target(self, target_slug: str) -> list[StudySession]:
        rows = self.connection.execute(
            """
            SELECT * FROM study_sessions
            WHERE target_slug=? AND state='finished'
            ORDER BY material_id, started_at, id
            """,
            (target_slug,),
        ).fetchall()
        return [_session(row) for row in rows]

    def _active_with_version(
        self, session_id: int, expected_version: int
    ) -> StudySession:
        current = self._required(session_id)
        if current.state != "active":
            raise ValueError("session is already finished")
        if current.version != expected_version:
            raise SessionConflictError("session changed before update")
        return current

    def _required(self, session_id: int) -> StudySession:
        session = self.get(session_id)
        if session is None:
            raise KeyError(f"session {session_id} does not exist")
        return session
