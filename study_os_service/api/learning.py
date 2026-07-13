from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Header, Request
from fastapi.responses import JSONResponse

from study_os_service.services.learning_import import (
    LearningImportConflictError,
    LearningImportService,
    learning_import_payload,
)


router = APIRouter()


class LearningApiError(Exception):
    def __init__(self, status_code: int, code: str, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message


async def learning_api_error_handler(
    _request: Request, exc: LearningApiError
) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"code": exc.code, "message": exc.message},
    )


@router.post("/learning/import-aggregates")
async def import_aggregates(
    request: Request,
    payload: Any = Body(...),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
):
    try:
        if idempotency_key is None or not idempotency_key.strip():
            raise ValueError("Idempotency-Key header is required")
        if not isinstance(payload, dict):
            raise ValueError("body must be an object")
        unsupported = sorted(set(payload) - {"targetSlug", "batchId", "items"})
        if unsupported:
            raise ValueError("unsupported import fields: " + ", ".join(unsupported))
        target_slug = payload.get("targetSlug")
        if not isinstance(target_slug, str):
            raise ValueError("targetSlug is required")
        batch_id = payload.get("batchId")
        if batch_id is not None and not isinstance(batch_id, str):
            raise ValueError("batchId must be text")
        items = payload.get("items")
        result = LearningImportService(
            request.app.state.connection
        ).import_aggregates(
            target_slug=target_slug,
            batch_id=batch_id,
            items=items,
            idempotency_key=idempotency_key,
        )
        return learning_import_payload(result)
    except LearningImportConflictError as exc:
        raise LearningApiError(409, "learning_import_conflict", str(exc)) from exc
    except KeyError as exc:
        raise LearningApiError(404, "learning_target_not_found", str(exc)) from exc
    except (TypeError, ValueError) as exc:
        raise LearningApiError(400, "invalid_learning_import", str(exc)) from exc
