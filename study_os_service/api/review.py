from __future__ import annotations

from datetime import date
from typing import Any

from fastapi import APIRouter, Body, Header, Query, Request
from fastapi.responses import JSONResponse

from study_os_service.domain.learning import ReviewQueueItem
from study_os_service.repositories.review import ReviewQueueVersionConflictError
from study_os_service.services.review_queue import (
    ReviewIdempotencyConflictError,
    ReviewQueueNotFoundError,
    ReviewQueueService,
)


router = APIRouter()


class ReviewApiError(Exception):
    def __init__(self, status_code: int, code: str, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message


async def review_api_error_handler(
    _request: Request, exc: ReviewApiError
) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"code": exc.code, "message": exc.message},
    )


def _service(request: Request) -> ReviewQueueService:
    return ReviewQueueService(request.app.state.connection)


def _date(value: Any, label: str) -> date:
    if not isinstance(value, str):
        raise ValueError(f"{label} must use YYYY-MM-DD")
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError(f"{label} must use YYYY-MM-DD") from exc


def _key(value: str | None) -> str:
    if value is None or not value.strip():
        raise ValueError("Idempotency-Key header is required")
    return value.strip()


def _payload(item: ReviewQueueItem) -> dict[str, Any]:
    return {
        "id": item.id,
        "targetSlug": item.target_slug,
        "topicTargetSlug": item.topic_target_slug,
        "targetTopicId": item.target_topic_id,
        "dueDate": item.due_date.isoformat(),
        "state": item.state,
        "boundedQuestions": item.bounded_questions,
        "triggerEventIds": list(item.trigger_event_ids),
        "reason": item.reason,
        "debtBp": item.debt_bp,
        "attemptCount": item.attempt_count,
        "resolvedEventId": item.resolved_event_id,
        "version": item.version,
        "createdAt": item.created_at.isoformat(),
        "updatedAt": item.updated_at.isoformat(),
    }


@router.get("/review/queue")
async def get_queue(
    request: Request,
    target_slug: str = Query(alias="targetSlug"),
    as_of: str = Query(alias="asOf"),
):
    try:
        _date(as_of, "asOf")
        return {"items": [_payload(item) for item in _service(request).list_open(target_slug)]}
    except ValueError as exc:
        raise ReviewApiError(400, "invalid_review_request", str(exc)) from exc


@router.post("/review/rebuild")
async def rebuild_queue(
    request: Request,
    payload: Any = Body(...),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
):
    try:
        _key(idempotency_key)
        if not isinstance(payload, dict):
            raise ValueError("body must be an object")
        target_slug = payload.get("targetSlug")
        if not isinstance(target_slug, str) or not target_slug.strip():
            raise ValueError("targetSlug is required")
        items = _service(request).rebuild(
            target_slug.strip(), _date(payload.get("asOf"), "asOf")
        )
        return {"items": [_payload(item) for item in items]}
    except KeyError as exc:
        raise ReviewApiError(404, "review_target_not_found", str(exc)) from exc
    except ValueError as exc:
        raise ReviewApiError(400, "invalid_review_request", str(exc)) from exc


@router.post("/review/items/{item_id}/defer")
async def defer_review(
    item_id: int,
    request: Request,
    payload: Any = Body(...),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
):
    try:
        _key(idempotency_key)
        if not isinstance(payload, dict):
            raise ValueError("body must be an object")
        version = payload.get("expectedVersion")
        if isinstance(version, bool) or not isinstance(version, int) or version < 1:
            raise ValueError("expectedVersion must be a positive integer")
        return _payload(_service(request).defer(
            item_id,
            _date(payload.get("dueDate"), "dueDate"),
            expected_version=version,
            idempotency_key=_key(idempotency_key),
        ))
    except ReviewQueueNotFoundError as exc:
        raise ReviewApiError(404, "review_item_not_found", str(exc)) from exc
    except ReviewQueueVersionConflictError as exc:
        raise ReviewApiError(409, "stale_review_item", str(exc)) from exc
    except ReviewIdempotencyConflictError as exc:
        raise ReviewApiError(409, "review_idempotency_conflict", str(exc)) from exc
    except ValueError as exc:
        raise ReviewApiError(400, "invalid_review_request", str(exc)) from exc
