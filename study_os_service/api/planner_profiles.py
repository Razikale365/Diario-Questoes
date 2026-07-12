from __future__ import annotations

import sqlite3
from typing import Any

from fastapi import APIRouter, Body, Query, Request
from fastapi.responses import JSONResponse

from study_os_service.domain.planner import ExamTarget, TargetTopic
from study_os_service.repositories.planner_profiles import (
    PlannerProfileVersionConflictError,
    TargetTopicMismatchError,
)
from study_os_service.services.planner_profiles import (
    PlannerProfileService,
    TargetProfileNotFoundError,
    TargetTopicNotFoundError,
)


router = APIRouter()


class PlannerProfileApiError(Exception):
    def __init__(self, status_code: int, code: str, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message


async def planner_profile_api_error_handler(
    _request: Request, exc: PlannerProfileApiError
) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"code": exc.code, "message": exc.message},
    )


def _service(request: Request) -> PlannerProfileService:
    return PlannerProfileService(request.app.state.connection)


def _target_payload(target: ExamTarget) -> dict[str, Any]:
    return {
        "targetSlug": target.target_slug,
        "displayName": target.display_name,
        "institution": target.institution,
        "role": target.role,
        "banca": target.banca,
        "phase": target.phase,
        "deadline": target.deadline.isoformat() if target.deadline else None,
        "dailyQuota": target.daily_quota,
        "priorityScore": target.priority_score,
        "sourceUrls": list(target.source_urls),
        "notes": target.notes,
        "active": target.active,
        "version": target.version,
    }


def _topic_payload(topic: TargetTopic) -> dict[str, Any]:
    return {
        "id": topic.id,
        "targetSlug": topic.target_slug,
        "discipline": topic.discipline,
        "topic": topic.topic,
        "coverageStatus": topic.coverage_status,
        "editalWeight": topic.edital_weight,
        "incidence": topic.incidence,
        "tier": topic.tier,
        "bancaFit": topic.banca_fit,
        "overlapValue": topic.overlap_value,
        "transferKind": topic.transfer_kind,
        "sourceKind": topic.source_kind,
        "lessonId": topic.lesson_id,
        "materialId": topic.material_id,
        "tecSourceUrl": topic.tec_source_url,
        "tecSourceId": topic.tec_source_id,
        "plannedQuestions": topic.planned_questions,
        "reviewDebt": topic.review_debt,
        "notes": topic.notes,
        "active": topic.active,
        "version": topic.version,
    }


def _not_found(exc: TargetProfileNotFoundError) -> PlannerProfileApiError:
    target_slug = str(exc.args[0])
    return PlannerProfileApiError(
        404,
        "target_profile_not_found",
        f"target profile {target_slug} does not exist",
    )


@router.get("/planner/targets")
async def list_targets(request: Request) -> dict[str, Any]:
    targets = _service(request).list_targets()
    return {"items": [_target_payload(target) for target in targets]}


@router.put("/planner/targets")
async def update_target(
    request: Request,
    payload: dict[str, Any] = Body(...),
) -> dict[str, Any]:
    try:
        target = _service(request).update_target(payload)
    except TargetProfileNotFoundError as exc:
        raise _not_found(exc) from exc
    except PlannerProfileVersionConflictError as exc:
        raise PlannerProfileApiError(
            409, "stale_target_profile", str(exc)
        ) from exc
    except (TypeError, ValueError) as exc:
        raise PlannerProfileApiError(
            422, "invalid_target_profile", str(exc)
        ) from exc
    return _target_payload(target)


@router.post("/planner/targets/seed", status_code=201)
async def seed_targets(
    request: Request,
    payload: dict[str, Any] = Body(default={}),
) -> dict[str, Any]:
    target_slugs = payload.get("targetSlugs")
    if target_slugs is not None and (
        not isinstance(target_slugs, list)
        or not target_slugs
        or not all(isinstance(value, str) and value.strip() for value in target_slugs)
    ):
        raise PlannerProfileApiError(
            422,
            "invalid_target_seed",
            "targetSlugs must be an array of target names",
        )
    try:
        result = _service(request).seed(
            tuple(value.strip() for value in target_slugs)
            if target_slugs is not None
            else None
        )
    except (TypeError, ValueError) as exc:
        raise PlannerProfileApiError(422, "invalid_target_seed", str(exc)) from exc
    return {
        "targetsSeeded": result.targets_seeded,
        "topicsSeeded": result.topics_seeded,
        "targetSlugs": list(result.target_slugs),
    }


@router.get("/planner/topics")
async def list_topics(
    request: Request,
    target_slug: str = Query(alias="targetSlug", min_length=1),
) -> dict[str, Any]:
    try:
        topics = _service(request).list_topics(target_slug.strip())
    except TargetProfileNotFoundError as exc:
        raise _not_found(exc) from exc
    return {"items": [_topic_payload(topic) for topic in topics]}


@router.put("/planner/topics")
async def update_topics(
    request: Request,
    target_slug: str = Query(alias="targetSlug", min_length=1),
    payload: dict[str, Any] = Body(...),
) -> dict[str, Any]:
    items = payload.get("items")
    if not isinstance(items, list):
        raise PlannerProfileApiError(
            422, "invalid_target_topic", "items must be an array"
        )
    try:
        topics = _service(request).update_topics(target_slug.strip(), items)
    except TargetProfileNotFoundError as exc:
        raise _not_found(exc) from exc
    except TargetTopicNotFoundError as exc:
        topic_id = exc.args[0]
        raise PlannerProfileApiError(
            404,
            "target_topic_not_found",
            f"target topic {topic_id} does not exist",
        ) from exc
    except TargetTopicMismatchError as exc:
        raise PlannerProfileApiError(409, "target_topic_mismatch", str(exc)) from exc
    except PlannerProfileVersionConflictError as exc:
        raise PlannerProfileApiError(409, "stale_target_topic", str(exc)) from exc
    except sqlite3.IntegrityError as exc:
        raise PlannerProfileApiError(
            409,
            "target_topic_conflict",
            "target topic identity conflicts with an existing row",
        ) from exc
    except (TypeError, ValueError) as exc:
        raise PlannerProfileApiError(
            422, "invalid_target_topic", str(exc)
        ) from exc
    return {"items": [_topic_payload(topic) for topic in topics]}
