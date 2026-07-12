from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import quote
import sqlite3

from study_os_service.domain.sessions import (
    ProgressState,
    SessionOutcome,
    SkipReason,
    StudySession,
)
from study_os_service.repositories.progress import ProgressRepository
from study_os_service.repositories.planner_runs import PlannerRunRepository
from study_os_service.repositories.sessions import (
    IdempotencyConflictError,
    MaterialExecutionContext,
    SessionRepository,
)


@dataclass(frozen=True, slots=True)
class SessionStart:
    session: StudySession
    progress: ProgressState
    open_url: str


@dataclass(frozen=True, slots=True)
class SessionResult:
    session: StudySession
    progress: ProgressState


class SessionService:
    def __init__(self, connection: sqlite3.Connection):
        self.connection = connection
        self.sessions = SessionRepository(connection)
        self.progress = ProgressRepository(connection)
        self.planner = PlannerRunRepository(connection)

    def start(
        self,
        target_slug: str,
        lesson_id: int,
        material_id: int,
        idempotency_key: str,
        planner_block_id: int | None = None,
    ) -> SessionStart:
        target = target_slug.strip()
        key = idempotency_key.strip()
        if not target:
            raise ValueError("target is required")
        if not key:
            raise ValueError("idempotency key is required")
        self.connection.execute("BEGIN IMMEDIATE")
        try:
            self._execution_context(target, lesson_id, material_id)
            existing = self.sessions.get_by_idempotency_key(key)
            if existing is not None:
                if (
                    existing.target_slug != target
                    or existing.lesson_id != lesson_id
                    or existing.material_id != material_id
                ):
                    raise IdempotencyConflictError(
                        "idempotency key already belongs to another request"
                    )
                linked = self.planner.get_block_by_execution_session(existing.id)
                linked_id = linked.id if linked is not None else None
                if linked_id != planner_block_id:
                    raise IdempotencyConflictError(
                        "idempotency key already belongs to another planner request"
                    )
                progress = self.progress.get_or_create(lesson_id, material_id)
                result = self._start_result(existing, progress)
                self.connection.commit()
                return result

            planner_block = (
                self._planner_block(
                    planner_block_id,
                    target,
                    lesson_id,
                    material_id,
                )
                if planner_block_id is not None
                else None
            )
            active = self.sessions.get_active(lesson_id, material_id)
            progress = self.progress.get_or_create(lesson_id, material_id)
            if active is not None:
                if planner_block is not None:
                    self._claim_planner_block(planner_block.id, active.id)
                result = self._start_result(active, progress)
                self.connection.commit()
                return result
            if progress.status == "unread":
                progress = self.progress.advance_cursor(
                    lesson_id,
                    material_id,
                    cursor_page=progress.cursor_page,
                    expected_version=progress.version,
                )
            session = self.sessions.create_active(
                idempotency_key=key,
                target_slug=target,
                lesson_id=lesson_id,
                material_id=material_id,
                start_page=progress.cursor_page,
                started_at=datetime.now(UTC),
            )
            if planner_block is not None:
                self._claim_planner_block(planner_block.id, session.id)
            result = self._start_result(session, progress)
            self.connection.commit()
            return result
        except Exception:
            self.connection.rollback()
            raise

    def checkpoint(
        self,
        session_id: int,
        *,
        end_page: int,
        elapsed_seconds: int,
        expected_version: int,
    ) -> SessionResult:
        self.connection.execute("BEGIN IMMEDIATE")
        try:
            session = self.sessions.checkpoint(
                session_id,
                end_page=end_page,
                elapsed_seconds=elapsed_seconds,
                expected_version=expected_version,
            )
            progress = self.progress.get_or_create(
                session.lesson_id, session.material_id
            )
            progress = self.progress.advance_cursor(
                session.lesson_id,
                session.material_id,
                cursor_page=end_page,
                expected_version=progress.version,
            )
            self.connection.commit()
            return SessionResult(session=session, progress=progress)
        except Exception:
            self.connection.rollback()
            raise

    def finish(
        self,
        session_id: int,
        *,
        outcome: SessionOutcome,
        end_page: int | None,
        elapsed_seconds: int,
        questions_done: int,
        correct_count: int,
        wrong_count: int,
        doubt_count: int,
        favorite_count: int,
        notes: str,
        expected_version: int,
    ) -> SessionResult:
        if outcome not in {"partial", "completed", "failed", "abandoned"}:
            raise ValueError("finish outcome must be partial, completed, failed, or abandoned")
        if outcome in {"partial", "completed"} and end_page is None:
            raise ValueError(f"{outcome} outcome requires an end page")
        self.connection.execute("BEGIN IMMEDIATE")
        try:
            session = self.sessions.finish(
                session_id,
                outcome=outcome,
                ended_at=datetime.now(UTC),
                end_page=end_page,
                elapsed_seconds=elapsed_seconds,
                questions_done=questions_done,
                correct_count=correct_count,
                wrong_count=wrong_count,
                doubt_count=doubt_count,
                favorite_count=favorite_count,
                skip_reason=None,
                notes=notes,
                expected_version=expected_version,
            )
            progress = self.progress.get_or_create(
                session.lesson_id, session.material_id
            )
            cursor_page = end_page or progress.cursor_page
            status = {
                "partial": "in_progress",
                "completed": "covered",
                "failed": "weak",
                "abandoned": "in_progress",
            }[outcome]
            progress = self.progress.record_session(
                session.lesson_id,
                session.material_id,
                cursor_page=cursor_page,
                elapsed_seconds=elapsed_seconds,
                status=status,
                expected_version=progress.version,
            )
            self.planner.transition_block_for_session(
                session.id,
                state={
                    "completed": "completed",
                    "failed": "failed",
                    "partial": "pending",
                    "abandoned": "pending",
                }[outcome],
            )
            self.connection.commit()
            return SessionResult(session=session, progress=progress)
        except Exception:
            self.connection.rollback()
            raise

    def skip(
        self,
        session_id: int,
        *,
        reason: SkipReason,
        notes: str,
        expected_version: int,
    ) -> SessionResult:
        self.connection.execute("BEGIN IMMEDIATE")
        try:
            current = self.sessions.get(session_id)
            if current is None:
                raise KeyError(f"session {session_id} does not exist")
            session = self.sessions.finish(
                session_id,
                outcome="skipped",
                ended_at=datetime.now(UTC),
                end_page=current.end_page,
                elapsed_seconds=current.elapsed_seconds,
                questions_done=current.questions_done,
                correct_count=current.correct_count,
                wrong_count=current.wrong_count,
                doubt_count=current.doubt_count,
                favorite_count=current.favorite_count,
                skip_reason=reason,
                notes=notes,
                expected_version=expected_version,
            )
            progress = self.progress.get_or_create(
                session.lesson_id, session.material_id
            )
            if reason == "too_difficult":
                progress = self.progress.set_status(
                    session.lesson_id,
                    session.material_id,
                    status="weak",
                    expected_version=progress.version,
                )
            self.planner.transition_block_for_session(
                session.id,
                state="skipped",
            )
            self.connection.commit()
            return SessionResult(session=session, progress=progress)
        except Exception:
            self.connection.rollback()
            raise

    def _execution_context(
        self, target_slug: str, lesson_id: int, material_id: int
    ) -> MaterialExecutionContext:
        context = self.sessions.get_material_context(material_id)
        if context is None:
            raise KeyError(f"material {material_id} does not exist")
        if context.lesson_id != lesson_id:
            raise ValueError("material does not belong to the requested lesson")
        if context.target_slug != target_slug:
            raise ValueError("material does not belong to the requested target")
        if not context.available:
            raise ValueError("material is unavailable")
        if context.absolute_path.suffix.casefold() != ".pdf":
            raise ValueError("material is not a PDF")
        if not context.absolute_path.resolve().is_file():
            raise ValueError("material file is unavailable")
        return context

    def _planner_block(
        self,
        planner_block_id: int,
        target_slug: str,
        lesson_id: int,
        material_id: int,
    ):
        if (
            isinstance(planner_block_id, bool)
            or not isinstance(planner_block_id, int)
            or planner_block_id < 1
        ):
            raise ValueError("planner block id must be a positive integer")
        context = self.planner.get_block_with_candidate(planner_block_id)
        if context is None:
            raise KeyError(f"planner block {planner_block_id} does not exist")
        block, candidate = context
        if block.target_slug != target_slug:
            raise ValueError("planner block belongs to another target")
        if block.block_kind != "theory":
            raise ValueError("planner block is not a theory block")
        if candidate.lesson_id != lesson_id or candidate.material_id != material_id:
            raise ValueError("planner block material does not match the session")
        if block.state not in {"pending", "active"}:
            raise ValueError("planner block is already finished")
        return block

    def _claim_planner_block(self, block_id: int, session_id: int) -> None:
        current = self.planner.get_block(block_id)
        if current is None:
            raise KeyError(f"planner block {block_id} does not exist")
        linked = self.planner.get_block_by_execution_session(session_id)
        if linked is not None and linked.id != block_id:
            raise ValueError("study session already belongs to another planner block")
        if current.execution_session_id == session_id and current.state == "active":
            return
        self.planner.claim_theory_block(
            block_id,
            session_id=session_id,
            expected_version=current.version,
        )

    @staticmethod
    def _start_result(
        session: StudySession, progress: ProgressState
    ) -> SessionStart:
        target = quote(session.target_slug, safe="")
        open_url = (
            f"/api/v1/materials/{session.material_id}/file"
            f"?targetSlug={target}#page={progress.cursor_page}"
        )
        return SessionStart(session=session, progress=progress, open_url=open_url)
