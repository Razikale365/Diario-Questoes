from __future__ import annotations

import asyncio
from collections import defaultdict
from datetime import datetime
from pathlib import Path
import sqlite3
from typing import Any

from fastapi import APIRouter, Body, Header, Query, Request

from study_os_service.api.inventory import InventoryApiError
from study_os_service.db.connection import connect_database
from study_os_service.db.migrations import MigrationRunner
from study_os_service.domain.sessions import ProgressState, StudySession
from study_os_service.ingest.pdf_metadata import inspect_pdf
from study_os_service.repositories.inventory import InventoryRepository
from study_os_service.repositories.progress import (
    ProgressConflictError,
    ProgressRepository,
)
from study_os_service.repositories.sessions import (
    IdempotencyConflictError,
    MaterialExecutionContext,
    SessionConflictError,
    SessionRepository,
)
from study_os_service.services.reading_rate import calculate_reading_rate
from study_os_service.services.sessions import SessionResult, SessionService, SessionStart


router = APIRouter()

_FINISH_OUTCOMES = {"partial", "completed", "failed", "abandoned"}
_SKIP_REASONS = {
    "lack_of_time",
    "fatigue",
    "wrong_material",
    "blocked_prerequisite",
    "too_difficult",
    "other",
}


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _positive_integer(payload: dict[str, Any], key: str) -> int:
    value = payload.get(key)
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise InventoryApiError(
            422, "invalid_session", f"{key} must be a positive integer"
        )
    return value


def _non_negative_integer(
    payload: dict[str, Any], key: str, *, default: int | None = None
) -> int:
    value = payload.get(key, default)
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise InventoryApiError(
            422, "invalid_session", f"{key} must be a non-negative integer"
        )
    return value


def _required_text(payload: dict[str, Any], key: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value.strip():
        raise InventoryApiError(422, "invalid_session", f"{key} is required")
    return value.strip()


def _notes(payload: dict[str, Any]) -> str:
    value = payload.get("notes", "")
    if not isinstance(value, str):
        raise InventoryApiError(422, "invalid_session", "notes must be text")
    return value.strip()


def _query_target(value: str | None) -> str:
    if not isinstance(value, str) or not value.strip():
        raise InventoryApiError(422, "invalid_session", "targetSlug is required")
    return value.strip()


def _session_payload(session: StudySession) -> dict[str, Any]:
    return {
        "id": session.id,
        "idempotencyKey": session.idempotency_key,
        "targetSlug": session.target_slug,
        "lessonId": session.lesson_id,
        "materialId": session.material_id,
        "state": session.state,
        "startedAt": _iso(session.started_at),
        "endedAt": _iso(session.ended_at),
        "elapsedSeconds": session.elapsed_seconds,
        "startPage": session.start_page,
        "endPage": session.end_page,
        "questionsDone": session.questions_done,
        "correctCount": session.correct_count,
        "wrongCount": session.wrong_count,
        "doubtCount": session.doubt_count,
        "favoriteCount": session.favorite_count,
        "outcome": session.outcome,
        "skipReason": session.skip_reason,
        "notes": session.notes,
        "version": session.version,
    }


def _progress_payload(progress: ProgressState) -> dict[str, Any]:
    return {
        "id": progress.id,
        "lessonId": progress.lesson_id,
        "materialId": progress.material_id,
        "status": progress.status,
        "cursorPage": progress.cursor_page,
        "furthestPage": progress.furthest_page,
        "completedAt": _iso(progress.completed_at),
        "lastSeenAt": _iso(progress.last_seen_at),
        "confidence": progress.confidence,
        "totalSeconds": progress.total_seconds,
        "sessionCount": progress.session_count,
        "version": progress.version,
    }


def _start_payload(result: SessionStart) -> dict[str, Any]:
    return {
        "session": _session_payload(result.session),
        "progress": _progress_payload(result.progress),
        "openUrl": result.open_url,
    }


def _result_payload(result: SessionResult) -> dict[str, Any]:
    return {
        "session": _session_payload(result.session),
        "progress": _progress_payload(result.progress),
    }


def _material_context(
    connection: sqlite3.Connection,
    material_id: int,
    target_slug: str,
    lesson_id: int | None = None,
) -> MaterialExecutionContext:
    context = SessionRepository(connection).get_material_context(material_id)
    if (
        context is None
        or context.target_slug != target_slug
        or not context.available
    ):
        raise InventoryApiError(
            404, "material_not_found", f"Material {material_id} was not found"
        )
    if lesson_id is not None and context.lesson_id != lesson_id:
        raise InventoryApiError(
            422,
            "invalid_session",
            f"Material {material_id} does not belong to lesson {lesson_id}",
        )
    if context.lesson_id is None:
        raise InventoryApiError(
            422, "invalid_session", "Material must be mapped to a lesson"
        )
    return context


def _validated_pdf_path(context: MaterialExecutionContext) -> Path:
    root_path = context.root_path.expanduser().resolve()
    file_path = context.absolute_path.expanduser().resolve()
    try:
        file_path.relative_to(root_path)
    except ValueError as exc:
        raise InventoryApiError(
            409,
            "material_path_invalid",
            "Material path is outside its registered course root",
        ) from exc
    if file_path.suffix.casefold() != ".pdf":
        raise InventoryApiError(409, "material_path_invalid", "Material is not a PDF")
    if not file_path.is_file():
        raise InventoryApiError(
            404, "material_file_not_found", "Material file is no longer available"
        )
    return file_path


def _inspect_material_worker(
    database_path: Path,
    material_id: int,
    file_path: Path,
    page_offset: int,
) -> int:
    metadata = inspect_pdf(file_path)
    connection = connect_database(database_path)
    try:
        MigrationRunner(connection).migrate()
        InventoryRepository(connection).update_material_page_metadata(
            material_id,
            page_count=metadata.page_count,
            page_offset=page_offset,
        )
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()
    return metadata.page_count


def _translate_session_error(exc: Exception) -> InventoryApiError:
    if isinstance(exc, IdempotencyConflictError):
        return InventoryApiError(409, "idempotency_conflict", str(exc))
    if isinstance(exc, SessionConflictError):
        return InventoryApiError(409, "session_conflict", str(exc))
    if isinstance(exc, ProgressConflictError):
        return InventoryApiError(409, "progress_conflict", str(exc))
    if isinstance(exc, KeyError):
        return InventoryApiError(404, "session_not_found", str(exc).strip("'"))
    if isinstance(exc, sqlite3.IntegrityError):
        return InventoryApiError(409, "session_conflict", str(exc))
    return InventoryApiError(422, "invalid_session", str(exc))


@router.post("/materials/{material_id}/inspect")
async def inspect_material(
    request: Request,
    material_id: int,
    target_slug: str | None = Query(None, alias="targetSlug"),
) -> dict[str, int]:
    if material_id < 1:
        raise InventoryApiError(422, "invalid_session", "materialId must be positive")
    target = _query_target(target_slug)
    context = _material_context(request.app.state.connection, material_id, target)
    if context.page_count is None:
        file_path = _validated_pdf_path(context)
        try:
            page_count = await asyncio.to_thread(
                _inspect_material_worker,
                request.app.state.settings.database_path,
                material_id,
                file_path,
                context.page_offset,
            )
        except InventoryApiError:
            raise
        except (KeyError, OSError, ValueError) as exc:
            raise InventoryApiError(422, "invalid_material", str(exc)) from exc
        except sqlite3.Error as exc:
            raise InventoryApiError(
                500, "material_inspection_failed", "Material metadata could not be saved"
            ) from exc
    else:
        page_count = context.page_count
    return {
        "materialId": material_id,
        "pageCount": page_count,
        "pageOffset": context.page_offset,
    }


@router.get("/progress")
async def get_progress(
    request: Request,
    target_slug: str | None = Query(None, alias="targetSlug"),
    lesson_id: int = Query(..., alias="lessonId", ge=1),
    material_id: int = Query(..., alias="materialId", ge=1),
) -> dict[str, Any]:
    target = _query_target(target_slug)
    _material_context(request.app.state.connection, material_id, target, lesson_id)
    try:
        progress = ProgressRepository(request.app.state.connection).get_or_create(
            lesson_id, material_id
        )
        request.app.state.connection.commit()
    except (KeyError, ValueError) as exc:
        request.app.state.connection.rollback()
        raise _translate_session_error(exc) from exc
    return _progress_payload(progress)


@router.get("/reading-rates")
async def get_reading_rates(
    request: Request,
    target_slug: str | None = Query(None, alias="targetSlug"),
) -> dict[str, Any]:
    target = _query_target(target_slug)
    sessions = SessionRepository(
        request.app.state.connection
    ).list_finished_for_target(target)
    by_material: dict[int, list[StudySession]] = defaultdict(list)
    for session in sessions:
        by_material[session.material_id].append(session)
    items = []
    for material_id in sorted(by_material):
        rate = calculate_reading_rate(by_material[material_id])
        items.append(
            {
                "materialId": material_id,
                "pagesPerHour": rate.pages_per_hour,
                "sampleCount": rate.sample_count,
                "totalSeconds": rate.total_seconds,
                "source": rate.source,
            }
        )
    return {"items": items}


@router.post("/sessions", status_code=201)
async def start_session(
    request: Request,
    payload: dict[str, Any] = Body(...),
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
) -> dict[str, Any]:
    if not isinstance(idempotency_key, str) or not idempotency_key.strip():
        raise InventoryApiError(
            422, "idempotency_key_required", "Idempotency-Key header is required"
        )
    target = _required_text(payload, "targetSlug")
    lesson_id = _positive_integer(payload, "lessonId")
    material_id = _positive_integer(payload, "materialId")
    context = _material_context(
        request.app.state.connection, material_id, target, lesson_id
    )
    _validated_pdf_path(context)
    try:
        result = SessionService(request.app.state.connection).start(
            target, lesson_id, material_id, idempotency_key
        )
    except (RuntimeError, KeyError, ValueError, sqlite3.IntegrityError) as exc:
        raise _translate_session_error(exc) from exc
    return _start_payload(result)


@router.get("/sessions/active")
async def get_active_session(
    request: Request,
    target_slug: str | None = Query(None, alias="targetSlug"),
    lesson_id: int = Query(..., alias="lessonId", ge=1),
    material_id: int = Query(..., alias="materialId", ge=1),
) -> dict[str, Any]:
    target = _query_target(target_slug)
    _material_context(request.app.state.connection, material_id, target, lesson_id)
    session = SessionRepository(request.app.state.connection).get_active(
        lesson_id, material_id
    )
    if session is None or session.target_slug != target:
        raise InventoryApiError(404, "session_not_found", "Active session was not found")
    return _session_payload(session)


@router.get("/sessions/{session_id}")
async def get_session(
    request: Request,
    session_id: int,
    target_slug: str | None = Query(None, alias="targetSlug"),
) -> dict[str, Any]:
    target = _query_target(target_slug)
    session = SessionRepository(request.app.state.connection).get(session_id)
    if session is None or session.target_slug != target:
        raise InventoryApiError(
            404, "session_not_found", f"Session {session_id} was not found"
        )
    return _session_payload(session)


@router.patch("/sessions/{session_id}")
async def checkpoint_session(
    request: Request,
    session_id: int,
    payload: dict[str, Any] = Body(...),
) -> dict[str, Any]:
    end_page = _positive_integer(payload, "endPage")
    elapsed_seconds = _non_negative_integer(payload, "elapsedSeconds")
    expected_version = _positive_integer(payload, "expectedVersion")
    try:
        result = SessionService(request.app.state.connection).checkpoint(
            session_id,
            end_page=end_page,
            elapsed_seconds=elapsed_seconds,
            expected_version=expected_version,
        )
    except (RuntimeError, KeyError, ValueError, sqlite3.IntegrityError) as exc:
        raise _translate_session_error(exc) from exc
    return _result_payload(result)


@router.post("/sessions/{session_id}/finish")
async def finish_session(
    request: Request,
    session_id: int,
    payload: dict[str, Any] = Body(...),
) -> dict[str, Any]:
    outcome = _required_text(payload, "outcome")
    if outcome not in _FINISH_OUTCOMES:
        raise InventoryApiError(422, "invalid_session", "outcome is invalid")
    end_page_value = payload.get("endPage")
    if end_page_value is None:
        end_page = None
    else:
        end_page = _positive_integer(payload, "endPage")
    elapsed_seconds = _non_negative_integer(payload, "elapsedSeconds")
    expected_version = _positive_integer(payload, "expectedVersion")
    try:
        result = SessionService(request.app.state.connection).finish(
            session_id,
            outcome=outcome,
            end_page=end_page,
            elapsed_seconds=elapsed_seconds,
            questions_done=_non_negative_integer(payload, "questionsDone", default=0),
            correct_count=_non_negative_integer(payload, "correctCount", default=0),
            wrong_count=_non_negative_integer(payload, "wrongCount", default=0),
            doubt_count=_non_negative_integer(payload, "doubtCount", default=0),
            favorite_count=_non_negative_integer(payload, "favoriteCount", default=0),
            notes=_notes(payload),
            expected_version=expected_version,
        )
    except (RuntimeError, KeyError, ValueError, sqlite3.IntegrityError) as exc:
        raise _translate_session_error(exc) from exc
    return _result_payload(result)


@router.post("/sessions/{session_id}/skip")
async def skip_session(
    request: Request,
    session_id: int,
    payload: dict[str, Any] = Body(...),
) -> dict[str, Any]:
    reason = _required_text(payload, "reason")
    if reason not in _SKIP_REASONS:
        raise InventoryApiError(422, "invalid_session", "reason is invalid")
    expected_version = _positive_integer(payload, "expectedVersion")
    try:
        result = SessionService(request.app.state.connection).skip(
            session_id,
            reason=reason,
            notes=_notes(payload),
            expected_version=expected_version,
        )
    except (RuntimeError, KeyError, ValueError, sqlite3.IntegrityError) as exc:
        raise _translate_session_error(exc) from exc
    return _result_payload(result)
