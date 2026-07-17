from __future__ import annotations

import sqlite3
from typing import Any

from fastapi import APIRouter, Body, Header, Request
from fastapi.responses import JSONResponse

from study_os_service.repositories.sprint import SprintVersionConflictError
from study_os_service.repositories.task_execution import TaskExecutionIdempotencyConflict
from study_os_service.services.task_execution import SourceTaskNotFoundError, TaskExecutionService


router = APIRouter()


class TaskExecutionApiError(Exception):
    def __init__(self, status_code: int, code: str, message: str):
        self.status_code, self.code, self.message = status_code, code, message


async def task_execution_api_error_handler(
    _request: Request, exc: TaskExecutionApiError
) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"code": exc.code, "message": exc.message},
    )


@router.post("/source-plans/tasks/{source_task_id}/executions", status_code=201)
async def record_task_execution(
    source_task_id: int,
    request: Request,
    payload: dict[str, Any] = Body(...),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> dict[str, Any]:
    try:
        return TaskExecutionService(request.app.state.connection).record(
            source_task_id, payload, idempotency_key=idempotency_key or ""
        )
    except SourceTaskNotFoundError as exc:
        raise TaskExecutionApiError(404, "source_task_not_found", "source task does not exist") from exc
    except TaskExecutionIdempotencyConflict as exc:
        raise TaskExecutionApiError(409, "task_execution_idempotency_conflict", str(exc)) from exc
    except SprintVersionConflictError as exc:
        raise TaskExecutionApiError(409, "stale_sprint_action", str(exc)) from exc
    except sqlite3.IntegrityError as exc:
        raise TaskExecutionApiError(409, "task_execution_conflict", "task execution conflicts with stored data") from exc
    except (TypeError, ValueError) as exc:
        raise TaskExecutionApiError(422, "invalid_task_execution", str(exc)) from exc
