from __future__ import annotations

from datetime import UTC, date, datetime
import sqlite3
from typing import Any

from fastapi import APIRouter, Body, Header, Query, Request
from fastapi.responses import JSONResponse

from study_os_service.domain.sprint import (
    ExamSprintConfig,
    ExamSubjectProfile,
    SourcePlanTask,
)
from study_os_service.domain.sprint_evidence import SprintPerformanceObservation
from study_os_service.services.sprint import (
    IdempotencyConflictError,
    SourcePlanService,
    SprintProfileService,
    SprintTargetNotFoundError,
)
from study_os_service.repositories.sprint import SprintVersionConflictError
from study_os_service.repositories.task_execution import (
    TaskExecutionTerminalSourceConflict,
)
from study_os_service.services.sprint_day import (
    SprintActionNotFoundError,
    SprintConfigMutationService,
    SprintDayNotFoundError,
    SprintDayService,
)
from study_os_service.services.sprint_evidence import (
    EvidenceBatchConflictError,
    SprintEvidenceService,
)
from study_os_service.services.sprint_projection import (
    SprintProjectionService,
    projection_document,
)
from study_os_service.services.source_plan_cycles import (
    SourcePlanCycleConflictError,
    SourcePlanCycleService,
    backlog_document,
    cycle_document,
)


router = APIRouter()


class SprintApiError(Exception):
    def __init__(self, status_code: int, code: str, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message


async def sprint_api_error_handler(
    _request: Request, exc: SprintApiError
) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"code": exc.code, "message": exc.message},
    )


def _subject_payload(subject: ExamSubjectProfile) -> dict[str, Any]:
    return {
        "id": subject.id,
        "targetSlug": subject.target_slug,
        "subjectKey": subject.subject_key,
        "displayName": subject.display_name,
        "aliases": list(subject.aliases),
        "paper": subject.paper,
        "questionCount": subject.question_count,
        "questionWeight": subject.question_weight,
        "discursiveEligible": subject.discursive_eligible,
        "baselineAccuracyBp": subject.baseline_accuracy_bp,
        "targetLowBp": subject.target_low_bp,
        "targetHighBp": subject.target_high_bp,
        "baselineConfidenceBp": subject.baseline_confidence_bp,
        "focusBand": subject.focus_band,
        "baselineSource": subject.baseline_source,
        "notes": subject.notes,
        "active": subject.active,
        "version": subject.version,
    }


def _config_payload(
    config: ExamSprintConfig, subjects: tuple[ExamSubjectProfile, ...]
) -> dict[str, Any]:
    return {
        "targetSlug": config.target_slug,
        "startDate": config.start_date.isoformat(),
        "objectiveDate": config.objective_date.isoformat(),
        "examEndDate": config.exam_end_date.isoformat(),
        "lsBudgetMinutes": config.ls_budget_minutes,
        "extraBudgetMinutes": config.extra_budget_minutes,
        "triageMode": config.triage_mode,
        "state": config.state,
        "goals": {
            "p1Floor": config.p1_floor_questions,
            "p1Low": config.p1_goal_low,
            "p1High": config.p1_goal_high,
            "p2Low": config.p2_goal_low,
            "p2High": config.p2_goal_high,
            "discursiveLow": config.discursive_goal_low,
            "discursiveHigh": config.discursive_goal_high,
        },
        "subjects": [_subject_payload(subject) for subject in subjects],
        "version": config.version,
    }


def _source_task_payload(
    task: SourcePlanTask,
    *,
    cycle: object = None,
    backlog: object = None,
) -> dict[str, Any]:
    return {
        "id": task.id,
        "targetSlug": task.target_slug,
        "sourceKind": task.source_kind,
        "externalTaskId": task.external_task_id,
        "planLabel": task.plan_label,
        "metaNumber": task.meta_number,
        "scheduledDate": (
            task.scheduled_date.isoformat() if task.scheduled_date else None
        ),
        "sourceOrder": task.source_order,
        "discipline": task.discipline,
        "subjectKey": task.subject_key,
        "mappingStatus": task.mapping_status,
        "topicHint": task.topic_hint,
        "taskKind": task.task_kind,
        "description": task.description,
        "details": task.details,
        "materialHint": task.material_hint,
        "estimatedMinutes": task.estimated_minutes,
        "spentMinutes": task.spent_minutes,
        "relevance": task.relevance,
        "status": task.status,
        "performanceBp": task.performance_bp,
        "linkedStudyTaskId": task.linked_study_task_id,
        "provenance": task.provenance,
        "cycle": cycle_document(cycle),
        "backlog": backlog_document(backlog),
        "version": task.version,
    }


def _utc_timestamp(value: datetime) -> str:
    return value.astimezone(UTC).isoformat(timespec="microseconds").replace(
        "+00:00", "Z"
    )


def _observation_payload(
    observation: SprintPerformanceObservation,
) -> dict[str, Any]:
    return {
        "id": observation.id,
        "targetSlug": observation.target_slug,
        "batchId": observation.batch_id,
        "subjectProfileId": observation.subject_profile_id,
        "subjectKey": observation.subject_key,
        "discipline": observation.discipline,
        "topicHint": observation.topic_hint,
        "observedOn": observation.observed_on.isoformat(),
        "origin": observation.origin,
        "sourceRecordId": observation.source_record_id,
        "sourceRevision": observation.source_revision,
        "sourceUpdatedAt": _utc_timestamp(observation.source_updated_at),
        "measurementType": observation.measurement_type,
        "examBoard": observation.exam_board,
        "correctCount": observation.correct_count,
        "wrongCount": observation.wrong_count,
        "doubtCount": observation.doubt_count,
        "percentageBp": observation.percentage_bp,
        "sampleSize": observation.sample_size,
        "transferScope": observation.transfer_scope,
        "transferabilityBp": observation.transferability_bp,
        "contentHash": observation.content_hash,
        "provenance": dict(observation.provenance),
    }


def _not_found(exc: SprintTargetNotFoundError) -> SprintApiError:
    target_slug = str(exc.args[0])
    return SprintApiError(
        404,
        "sprint_target_not_found",
        f"target {target_slug} does not exist",
    )


@router.get("/sprints/config")
async def get_sprint_config(
    request: Request,
    target_slug: str = Query(alias="targetSlug", min_length=1),
) -> dict[str, Any]:
    try:
        config, subjects = SprintProfileService(
            request.app.state.connection
        ).bootstrap(target_slug.strip())
    except SprintTargetNotFoundError as exc:
        raise _not_found(exc) from exc
    except (TypeError, ValueError) as exc:
        raise SprintApiError(422, "invalid_sprint_config", str(exc)) from exc
    return _config_payload(config, subjects)


@router.put("/sprints/config")
async def update_sprint_config(
    request: Request,
    payload: dict[str, Any] = Body(...),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> dict[str, Any]:
    try:
        return SprintConfigMutationService(request.app.state.connection).update(
            payload, idempotency_key=idempotency_key or ""
        )
    except SprintTargetNotFoundError as exc:
        raise _not_found(exc) from exc
    except IdempotencyConflictError as exc:
        raise SprintApiError(409, "idempotency_conflict", str(exc)) from exc
    except SprintVersionConflictError as exc:
        raise SprintApiError(409, "stale_sprint_config", str(exc)) from exc
    except (TypeError, ValueError) as exc:
        raise SprintApiError(422, "invalid_sprint_config", str(exc)) from exc


@router.post("/source-plans/import", status_code=201)
async def import_source_plan(
    request: Request,
    payload: dict[str, Any] = Body(...),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> dict[str, Any]:
    try:
        return SourcePlanService(request.app.state.connection).import_tasks(
            payload,
            idempotency_key=idempotency_key or "",
        )
    except SprintTargetNotFoundError as exc:
        raise _not_found(exc) from exc
    except IdempotencyConflictError as exc:
        raise SprintApiError(409, "idempotency_conflict", str(exc)) from exc
    except SourcePlanCycleConflictError as exc:
        raise SprintApiError(409, "source_plan_cycle_conflict", str(exc)) from exc
    except sqlite3.IntegrityError as exc:
        raise SprintApiError(
            409, "source_plan_conflict", "source plan conflicts with stored data"
        ) from exc
    except (TypeError, ValueError) as exc:
        raise SprintApiError(422, "invalid_source_plan", str(exc)) from exc


@router.post("/sprints/evidence/import", status_code=201)
async def import_sprint_evidence(
    request: Request,
    payload: Any = Body(default=None),
) -> dict[str, Any]:
    try:
        return SprintEvidenceService(request.app.state.connection).import_batch(
            payload
        )
    except SprintTargetNotFoundError as exc:
        raise _not_found(exc) from exc
    except EvidenceBatchConflictError as exc:
        raise SprintApiError(
            409, "evidence_batch_conflict", str(exc)
        ) from exc
    except sqlite3.IntegrityError as exc:
        raise SprintApiError(
            409,
            "evidence_storage_conflict",
            "evidence conflicts with stored data",
        ) from exc
    except (TypeError, ValueError) as exc:
        raise SprintApiError(
            422, "invalid_sprint_evidence", str(exc)
        ) from exc


@router.get("/sprints/evidence")
async def list_sprint_evidence(
    request: Request,
    target_slug: str = Query(alias="targetSlug", min_length=1),
) -> dict[str, Any]:
    try:
        items = SprintEvidenceService(
            request.app.state.connection
        ).list_observations(target_slug.strip())
    except SprintTargetNotFoundError as exc:
        raise _not_found(exc) from exc
    except (TypeError, ValueError) as exc:
        raise SprintApiError(
            422, "invalid_sprint_evidence", str(exc)
        ) from exc
    return {
        "targetSlug": target_slug.strip(),
        "items": [_observation_payload(item) for item in items],
        "unresolvedCount": sum(item.subject_key is None for item in items),
    }


@router.get("/sprints/projection")
async def get_sprint_projection(
    request: Request,
    target_slug: str = Query(alias="targetSlug", min_length=1),
    as_of: date | None = Query(default=None, alias="asOf"),
) -> dict[str, Any]:
    try:
        projection = SprintProjectionService(
            request.app.state.connection
        ).project(target_slug.strip(), as_of or date.today())
    except SprintTargetNotFoundError as exc:
        raise _not_found(exc) from exc
    except (TypeError, ValueError) as exc:
        raise SprintApiError(
            422, "invalid_sprint_projection", str(exc)
        ) from exc
    return projection_document(projection)


@router.get("/source-plans/tasks")
async def list_source_plan_tasks(
    request: Request,
    target_slug: str = Query(alias="targetSlug", min_length=1),
    scheduled_date: date | None = Query(default=None, alias="date"),
    include_inactive: bool = Query(default=False, alias="includeInactive"),
) -> dict[str, Any]:
    try:
        tasks = SourcePlanService(request.app.state.connection).list_tasks(
            target_slug.strip(),
            scheduled_date=scheduled_date,
            include_inactive=include_inactive,
        )
    except SprintTargetNotFoundError as exc:
        raise _not_found(exc) from exc
    cycle_service = SourcePlanCycleService(request.app.state.connection)
    items = []
    for task in tasks:
        cycle, backlog = cycle_service.context_for_task(task)
        items.append(_source_task_payload(task, cycle=cycle, backlog=backlog))
    return {
        "targetSlug": target_slug.strip(),
        "date": scheduled_date.isoformat() if scheduled_date else None,
        "items": items,
        "unresolvedCount": sum(
            task.mapping_status == "unresolved" for task in tasks
        ),
    }


@router.get("/source-plans/backlog")
async def list_source_plan_backlog(
    request: Request,
    target_slug: str = Query(alias="targetSlug", min_length=1),
    include_all: bool = Query(default=False, alias="includeAll"),
) -> dict[str, Any]:
    service = SourcePlanCycleService(request.app.state.connection)
    items = service.list_backlog(target_slug.strip(), include_all=include_all)
    return {
        "targetSlug": target_slug.strip(),
        "items": [backlog_document(item) for item in items],
    }


def _generate_day(
    request: Request,
    payload: dict[str, Any],
    idempotency_key: str | None,
    *,
    refresh: bool,
) -> dict[str, Any]:
    try:
        return SprintDayService(request.app.state.connection).generate(
            payload,
            idempotency_key=idempotency_key or "",
            refresh=refresh,
        )
    except SprintTargetNotFoundError as exc:
        raise _not_found(exc) from exc
    except IdempotencyConflictError as exc:
        raise SprintApiError(409, "idempotency_conflict", str(exc)) from exc
    except sqlite3.IntegrityError as exc:
        raise SprintApiError(
            409, "sprint_day_conflict", "sprint day conflicts with stored data"
        ) from exc
    except (TypeError, ValueError) as exc:
        raise SprintApiError(422, "invalid_sprint_day", str(exc)) from exc


@router.post("/sprints/generate-day", status_code=201)
async def generate_sprint_day(
    request: Request,
    payload: dict[str, Any] = Body(...),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> dict[str, Any]:
    return _generate_day(
        request, payload, idempotency_key, refresh=False
    )


@router.post("/sprints/refresh-day", status_code=201)
async def refresh_sprint_day(
    request: Request,
    payload: dict[str, Any] = Body(...),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> dict[str, Any]:
    return _generate_day(
        request, payload, idempotency_key, refresh=True
    )


@router.get("/sprints/day")
async def get_sprint_day(
    request: Request,
    target_slug: str = Query(alias="targetSlug", min_length=1),
    plan_date: date = Query(alias="date"),
) -> dict[str, Any]:
    try:
        return SprintDayService(request.app.state.connection).get_day(
            target_slug.strip(), plan_date
        )
    except SprintTargetNotFoundError as exc:
        raise _not_found(exc) from exc
    except SprintDayNotFoundError as exc:
        raise SprintApiError(
            404, "sprint_day_not_found", f"sprint day {exc.args[0]} does not exist"
        ) from exc


@router.put("/sprints/actions/{action_id}")
async def update_sprint_action(
    action_id: int,
    request: Request,
    payload: dict[str, Any] = Body(...),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> dict[str, Any]:
    try:
        return SprintDayService(request.app.state.connection).update_action(
            action_id,
            payload,
            idempotency_key=idempotency_key or "",
        )
    except SprintActionNotFoundError as exc:
        raise SprintApiError(
            404,
            "sprint_action_not_found",
            f"sprint action {exc.args[0]} does not exist",
        ) from exc
    except IdempotencyConflictError as exc:
        raise SprintApiError(409, "idempotency_conflict", str(exc)) from exc
    except TaskExecutionTerminalSourceConflict as exc:
        raise SprintApiError(409, "stale_sprint_action", str(exc)) from exc
    except SprintVersionConflictError as exc:
        raise SprintApiError(409, "stale_sprint_action", str(exc)) from exc
    except sqlite3.IntegrityError as exc:
        raise SprintApiError(
            409, "sprint_action_conflict", "sprint action conflicts with stored data"
        ) from exc
    except (TypeError, ValueError) as exc:
        raise SprintApiError(422, "invalid_sprint_action", str(exc)) from exc


@router.get("/sprints/trajectory")
async def get_sprint_trajectory(
    request: Request,
    target_slug: str = Query(alias="targetSlug", min_length=1),
) -> dict[str, Any]:
    try:
        return SprintDayService(request.app.state.connection).trajectory(
            target_slug.strip()
        )
    except SprintTargetNotFoundError as exc:
        raise _not_found(exc) from exc
