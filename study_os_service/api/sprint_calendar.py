from __future__ import annotations

from datetime import date
import sqlite3
from typing import Any

from fastapi import APIRouter, Body, Header, Query, Request
from fastapi.responses import JSONResponse

from study_os_service.repositories.sprint_calendar import (
    CalendarIdempotencyConflictError,
    CalendarItemConflictError,
    CalendarOverrideConflictError,
    CalendarRunStateError,
    CalendarSupersessionConflictError,
)
from study_os_service.services.sprint import SprintTargetNotFoundError
from study_os_service.services.sprint_calendar import SprintCalendarService


router = APIRouter()


class CalendarApiError(Exception):
    def __init__(self, status_code: int, code: str, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message


async def calendar_api_error_handler(
    _request: Request, exc: CalendarApiError
) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"code": exc.code, "message": exc.message},
    )


def _invalid(exc: Exception) -> CalendarApiError:
    message = str(exc)
    lowered = message.lower()
    if "window" in lowered or "day before p1" in lowered:
        code = "invalid_calendar_window"
    elif any(
        token in lowered
        for token in (
            "capacity",
            "availability",
            "energy",
            "minutes",
            "override scope",
        )
    ):
        code = "invalid_calendar_capacity"
    elif "placeholder" in lowered or "future cycle" in lowered:
        code = "invalid_calendar_placeholder"
    else:
        code = "invalid_calendar_assignment"
    return CalendarApiError(422, code, message)


def _translate_conflict(
    exc: Exception, *, stale_head_code: str = "calendar_supersession_conflict"
) -> CalendarApiError:
    if isinstance(exc, CalendarIdempotencyConflictError):
        return CalendarApiError(409, "calendar_idempotency_conflict", str(exc))
    if isinstance(exc, CalendarSupersessionConflictError):
        return CalendarApiError(409, stale_head_code, str(exc))
    if isinstance(exc, CalendarOverrideConflictError):
        return CalendarApiError(409, "stale_calendar_override", str(exc))
    if isinstance(exc, CalendarItemConflictError):
        return CalendarApiError(409, "calendar_item_conflict", str(exc))
    raise exc


@router.get("/sprints/calendar")
async def get_calendar_head(
    request: Request,
    target_slug: str = Query(alias="targetSlug", min_length=1),
    start_date: date | None = Query(default=None, alias="startDate"),
) -> dict[str, Any]:
    document = SprintCalendarService(request.app.state.connection).get_head(
        target_slug.strip(), start_date
    )
    if document is None:
        raise CalendarApiError(
            404,
            "calendar_not_found",
            f"calendar for {target_slug.strip()} does not exist",
        )
    return document


@router.get("/sprints/calendar/runs/{run_id}")
async def get_calendar_run(run_id: int, request: Request) -> dict[str, Any]:
    document = SprintCalendarService(request.app.state.connection).get_run(run_id)
    if document is None:
        raise CalendarApiError(
            404,
            "calendar_run_not_found",
            f"calendar run {run_id} does not exist",
        )
    return document


@router.post("/sprints/calendar/preview", status_code=201)
async def preview_calendar(
    request: Request,
    payload: dict[str, Any] = Body(...),
    idempotency_key: str | None = Header(
        default=None, alias="Idempotency-Key"
    ),
) -> dict[str, Any]:
    prepared = dict(payload)
    prepared.setdefault("mode", "reflow_open")
    try:
        return SprintCalendarService(request.app.state.connection).preview(
            prepared, idempotency_key=idempotency_key or ""
        )
    except SprintTargetNotFoundError as exc:
        raise CalendarApiError(
            404, "calendar_not_found", f"target {exc.args[0]} does not exist"
        ) from exc
    except (
        CalendarIdempotencyConflictError,
        CalendarSupersessionConflictError,
        CalendarOverrideConflictError,
        CalendarItemConflictError,
    ) as exc:
        raise _translate_conflict(exc, stale_head_code="stale_calendar_run") from exc
    except sqlite3.IntegrityError as exc:
        raise CalendarApiError(
            422,
            "invalid_calendar_assignment",
            "calendar preview violates a storage invariant",
        ) from exc
    except (TypeError, ValueError) as exc:
        raise _invalid(exc) from exc


@router.post("/sprints/calendar/runs/{run_id}/apply")
async def apply_calendar(
    run_id: int,
    request: Request,
    payload: dict[str, Any] = Body(...),
    idempotency_key: str | None = Header(
        default=None, alias="Idempotency-Key"
    ),
) -> dict[str, Any]:
    try:
        return SprintCalendarService(request.app.state.connection).apply(
            run_id, payload, idempotency_key=idempotency_key or ""
        )
    except CalendarRunStateError as exc:
        if "not found" in str(exc):
            raise CalendarApiError(
                404, "calendar_run_not_found", str(exc)
            ) from exc
        raise CalendarApiError(409, "stale_calendar_run", str(exc)) from exc
    except (
        CalendarIdempotencyConflictError,
        CalendarSupersessionConflictError,
        CalendarOverrideConflictError,
        CalendarItemConflictError,
    ) as exc:
        raise _translate_conflict(exc) from exc
    except sqlite3.IntegrityError as exc:
        raise CalendarApiError(
            409,
            "calendar_supersession_conflict",
            "calendar apply conflicts with stored state",
        ) from exc
    except (TypeError, ValueError) as exc:
        raise _invalid(exc) from exc


@router.put("/sprints/calendar/days/{plan_date}")
async def update_calendar_day(
    plan_date: date,
    request: Request,
    payload: dict[str, Any] = Body(...),
) -> dict[str, Any]:
    prepared = dict(payload) | {
        "scopeKind": "date",
        "scopeValue": plan_date.isoformat(),
    }
    try:
        return SprintCalendarService(
            request.app.state.connection
        ).update_day_override(prepared)
    except CalendarOverrideConflictError as exc:
        raise CalendarApiError(
            409, "stale_calendar_override", str(exc)
        ) from exc
    except sqlite3.IntegrityError as exc:
        raise CalendarApiError(
            422,
            "invalid_calendar_capacity",
            "calendar capacity violates a storage invariant",
        ) from exc
    except (TypeError, ValueError) as exc:
        raise _invalid(exc) from exc


@router.put("/sprints/calendar/items/{item_id}/override")
async def update_calendar_item_override(
    item_id: int,
    request: Request,
    payload: dict[str, Any] = Body(...),
) -> dict[str, Any]:
    prepared = dict(payload) | {"itemId": item_id}
    try:
        return SprintCalendarService(
            request.app.state.connection
        ).update_item_override(prepared)
    except CalendarRunStateError as exc:
        raise CalendarApiError(
            404, "calendar_item_not_found", str(exc)
        ) from exc
    except CalendarOverrideConflictError as exc:
        raise CalendarApiError(
            409, "stale_calendar_override", str(exc)
        ) from exc
    except sqlite3.IntegrityError as exc:
        raise CalendarApiError(
            422,
            "invalid_calendar_assignment",
            "calendar item override violates a storage invariant",
        ) from exc
    except (TypeError, ValueError) as exc:
        raise _invalid(exc) from exc


@router.post("/sprints/calendar/items", status_code=201)
async def create_calendar_item(
    request: Request,
    payload: dict[str, Any] = Body(...),
    idempotency_key: str | None = Header(
        default=None, alias="Idempotency-Key"
    ),
) -> dict[str, Any]:
    try:
        return SprintCalendarService(
            request.app.state.connection
        ).create_manual_item(
            payload, idempotency_key=idempotency_key or ""
        )
    except CalendarRunStateError as exc:
        raise CalendarApiError(404, "calendar_not_found", str(exc)) from exc
    except CalendarIdempotencyConflictError as exc:
        raise CalendarApiError(
            409, "calendar_idempotency_conflict", str(exc)
        ) from exc
    except sqlite3.IntegrityError as exc:
        raise CalendarApiError(
            422,
            "invalid_calendar_assignment",
            "manual calendar item violates a storage invariant",
        ) from exc
    except (TypeError, ValueError) as exc:
        raise _invalid(exc) from exc
