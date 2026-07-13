from __future__ import annotations

from datetime import date
import sqlite3
from typing import Any, Mapping

from fastapi import APIRouter, Body, Header, Query, Request
from fastapi.responses import JSONResponse

from study_os_service.domain.planner import (
    PlannerBlock,
    PlannerCandidate,
    PlannerRun,
)
from study_os_service.repositories.planner_runs import PlannerBlockVersionConflictError
from study_os_service.services.planner_generation import (
    GeneratedDay,
    PlannerBlockNotFoundError,
    PlannerDayNotFoundError,
    PlannerGenerationService,
    PlannerIdempotencyConflictError,
    PlannerRefreshConflictError,
    PlannerRunNotFoundError,
)
from study_os_service.services.planner_profiles import TargetProfileNotFoundError
from study_os_service.services.weekly_planner import (
    GeneratedWeek,
    WeeklyIdempotencyConflictError,
    WeeklyPlanNotFoundError,
    WeeklyPlannerService,
    WeeklyRefreshConflictError,
    WeeklyRunNotFoundError,
)


router = APIRouter()


class PlannerApiError(Exception):
    def __init__(self, status_code: int, code: str, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message


async def planner_api_error_handler(
    _request: Request, exc: PlannerApiError
) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"code": exc.code, "message": exc.message},
    )


def _service(request: Request) -> PlannerGenerationService:
    return PlannerGenerationService(request.app.state.connection)


def _weekly_service(request: Request) -> WeeklyPlannerService:
    return WeeklyPlannerService(request.app.state.connection)


def _date(value: Any) -> date:
    if not isinstance(value, str):
        raise ValueError("date must use YYYY-MM-DD")
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError("date must use YYYY-MM-DD") from exc


def _integer(payload: dict[str, Any], key: str, *, default: int | None = None) -> int:
    value = payload.get(key, default)
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"{key} must be an integer")
    return value


def _date_map(value: Any, label: str) -> dict[date, int] | None:
    if value is None:
        return None
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object")
    result = {}
    for key, item in value.items():
        if isinstance(item, bool) or not isinstance(item, int):
            raise ValueError(f"{label} values must be integers")
        result[_date(key)] = item
    return result


def _run_payload(run: PlannerRun) -> dict[str, Any]:
    return {
        "id": run.id,
        "targetSlug": run.target_slug,
        "date": run.plan_date.isoformat(),
        "phase": run.phase,
        "dailyQuota": run.daily_quota,
        "timeBudgetMinutes": run.time_budget_minutes,
        "algorithmVersion": run.algorithm_version,
        "inputHash": run.input_hash,
        "supersedesRunId": run.supersedes_run_id,
        "status": run.status,
        "shortfallCount": run.shortfall_count,
        "shortfallReasons": list(run.shortfall_reasons),
        "generatedAt": run.generated_at.isoformat(),
    }


def _score_payload(candidate: PlannerCandidate) -> dict[str, int]:
    score = candidate.score
    return {
        "weakness": score.weakness,
        "incidence": score.incidence,
        "tier": score.tier,
        "coverageNeed": score.coverage_need,
        "reviewDebt": score.review_debt,
        "lsAlignment": score.ls_alignment,
        "targetFit": score.target_fit,
        "overlapValue": score.overlap_value,
        "deadlinePressure": score.deadline_pressure,
        "bancaFit": score.banca_fit,
        "editalWeight": score.edital_weight,
        "balancePenalty": score.balance_penalty,
        "lowTrustPenalty": score.low_trust_penalty,
        "weeklyAlignment": score.weekly_alignment,
        "finalScore": score.final_score,
    }


def _candidate_payload(candidate: PlannerCandidate) -> dict[str, Any]:
    return {
        "id": candidate.id,
        "runId": candidate.run_id,
        "candidateKey": candidate.candidate_key,
        "targetSlug": candidate.target_slug,
        "discipline": candidate.discipline,
        "topic": candidate.topic,
        "blockKind": candidate.block_kind,
        "sourceKind": candidate.source_kind,
        "targetTopicId": candidate.target_topic_id,
        "lessonId": candidate.lesson_id,
        "materialId": candidate.material_id,
        "durationMinutes": candidate.duration_minutes,
        "plannedQuestions": candidate.planned_questions,
        "scoreBreakdown": _score_payload(candidate),
        "chosenPosition": candidate.chosen_position,
        "displacedBy": candidate.displaced_by_candidate_key,
        "stopReason": candidate.stop_reason,
        "evidence": dict(candidate.evidence),
        "sourceChoice": _candidate_source_choice(candidate),
        "adaptationReason": candidate.adaptation_reason,
    }


def _block_payload(
    block: PlannerBlock,
    candidate: PlannerCandidate | None = None,
) -> dict[str, Any]:
    payload = {
        "id": block.id,
        "runId": block.run_id,
        "candidateId": block.candidate_id,
        "targetSlug": block.target_slug,
        "date": block.scheduled_date.isoformat(),
        "position": block.position,
        "blockKind": block.block_kind,
        "title": block.title,
        "durationMinutes": block.duration_minutes,
        "plannedQuestions": block.planned_questions,
        "state": block.state,
        "executionSessionId": block.execution_session_id,
        "questionsDone": block.questions_done,
        "correctCount": block.correct_count,
        "wrongCount": block.wrong_count,
        "doubtCount": block.doubt_count,
        "favoriteCount": block.favorite_count,
        "version": block.version,
    }
    if candidate is not None:
        payload.update(
            {
                "discipline": candidate.discipline,
                "topic": candidate.topic,
                "sourceKind": candidate.source_kind,
                "lessonId": candidate.lesson_id,
                "materialId": candidate.material_id,
                "scoreBreakdown": _score_payload(candidate),
                "evidence": dict(candidate.evidence),
                "sourceChoice": _candidate_source_choice(candidate),
                "adaptationReason": candidate.adaptation_reason,
            }
        )
    return payload


def _week_payload(week: GeneratedWeek) -> dict[str, Any]:
    run = week.run
    return {
        "run": {
            "id": run.id,
            "targetSlug": run.target_slug,
            "weekStart": run.week_start.isoformat(),
            "phase": run.phase,
            "algorithmVersion": run.algorithm_version,
            "requestHash": run.request_hash,
            "inputHash": run.input_hash,
            "supersedesWeekRunId": run.supersedes_week_run_id,
            "status": run.status,
            "shortfallCount": run.shortfall_count,
            "shortfallReasons": list(run.shortfall_reasons),
            "generatedAt": run.generated_at.isoformat(),
        },
        "slots": [
            {
                "id": slot.id,
                "weekRunId": slot.week_run_id,
                "targetSlug": slot.target_slug,
                "date": slot.scheduled_date.isoformat(),
                "position": slot.position,
                "candidateKey": slot.candidate_key,
                "topicTargetSlug": slot.topic_target_slug,
                "targetTopicId": slot.target_topic_id,
                "blockKind": slot.block_kind,
                "durationMinutes": slot.duration_minutes,
                "plannedQuestions": slot.planned_questions,
                "score": dict(slot.score),
                "evidence": dict(slot.evidence),
                "sourceChoice": _source_choice_from_evidence(slot.evidence),
                "state": slot.state,
                "dayRunId": slot.day_run_id,
                "dayBlockId": slot.day_block_id,
            }
            for slot in week.slots
        ],
    }


def _candidate_source_choice(
    candidate: PlannerCandidate,
) -> dict[str, Any] | None:
    return _source_choice_from_evidence(candidate.evidence)


def _source_choice_from_evidence(
    evidence: Mapping[str, object],
) -> dict[str, Any] | None:
    candidate_evidence = evidence.get("candidateEvidence")
    source = (
        candidate_evidence.get("sourceChoice")
        if isinstance(candidate_evidence, Mapping)
        else evidence.get("sourceChoice")
    )
    return dict(source) if isinstance(source, Mapping) else None


def _day_payload(day: GeneratedDay) -> dict[str, Any]:
    candidates = {item.id: item for item in day.candidates}
    return {
        "run": _run_payload(day.run),
        "blocks": [
            _block_payload(block, candidates.get(block.candidate_id))
            for block in day.blocks
        ],
        "scoreboard": [_candidate_payload(item) for item in day.candidates],
    }


def _translate(exc: Exception) -> PlannerApiError:
    if isinstance(exc, TargetProfileNotFoundError):
        target_slug = exc.args[0]
        return PlannerApiError(
            404,
            "target_profile_not_found",
            f"target profile {target_slug} does not exist",
        )
    if isinstance(exc, PlannerDayNotFoundError):
        return PlannerApiError(404, "planner_day_not_found", "planner day does not exist")
    if isinstance(exc, PlannerRunNotFoundError):
        return PlannerApiError(
            404, "planner_run_not_found", f"planner run {exc.args[0]} does not exist"
        )
    if isinstance(exc, PlannerBlockNotFoundError):
        return PlannerApiError(
            404,
            "planner_block_not_found",
            f"planner block {exc.args[0]} does not exist",
        )
    if isinstance(exc, PlannerIdempotencyConflictError):
        return PlannerApiError(409, "planner_idempotency_conflict", str(exc))
    if isinstance(exc, PlannerBlockVersionConflictError):
        return PlannerApiError(409, "stale_planner_block", str(exc))
    if isinstance(exc, PlannerRefreshConflictError):
        return PlannerApiError(409, "planner_refresh_conflict", str(exc))
    if isinstance(exc, WeeklyPlanNotFoundError):
        return PlannerApiError(404, "planner_week_not_found", "planner week does not exist")
    if isinstance(exc, WeeklyRunNotFoundError):
        return PlannerApiError(404, "planner_week_run_not_found", str(exc))
    if isinstance(exc, WeeklyIdempotencyConflictError):
        return PlannerApiError(409, "planner_idempotency_conflict", str(exc))
    if isinstance(exc, WeeklyRefreshConflictError):
        return PlannerApiError(409, "planner_refresh_conflict", str(exc))
    if isinstance(exc, sqlite3.IntegrityError):
        return PlannerApiError(409, "planner_write_conflict", str(exc))
    return PlannerApiError(422, "invalid_planner_request", str(exc))


@router.post("/planner/generate-day", status_code=201)
async def generate_day(
    request: Request,
    payload: dict[str, Any] = Body(...),
    idempotency_key: str = Header(alias="Idempotency-Key"),
) -> dict[str, Any]:
    try:
        target_slug = payload.get("targetSlug")
        day = _service(request).generate_day(
            target_slug,
            _date(payload.get("date")),
            idempotency_key=idempotency_key,
            time_budget_minutes=payload.get("timeBudgetMinutes"),
            ls_target_slug=payload.get("lsTargetSlug"),
        )
    except Exception as exc:
        raise _translate(exc) from exc
    return _day_payload(day)


@router.post("/planner/generate-week", status_code=201)
async def generate_week(
    request: Request,
    payload: dict[str, Any] = Body(...),
    idempotency_key: str = Header(alias="Idempotency-Key"),
) -> dict[str, Any]:
    try:
        week = _weekly_service(request).generate_week(
            payload.get("targetSlug"),
            _date(payload.get("weekStart")),
            idempotency_key=idempotency_key,
            daily_quotas=_date_map(payload.get("dailyQuotas"), "dailyQuotas"),
            daily_time_budgets=_date_map(
                payload.get("dailyTimeBudgets"), "dailyTimeBudgets"
            ),
        )
    except Exception as exc:
        raise _translate(exc) from exc
    return _week_payload(week)


@router.post("/planner/refresh-week", status_code=201)
async def refresh_week(
    request: Request,
    payload: dict[str, Any] = Body(...),
    idempotency_key: str = Header(alias="Idempotency-Key"),
) -> dict[str, Any]:
    try:
        week = _weekly_service(request).refresh_week(
            _integer(payload, "previousWeekRunId"),
            payload.get("targetSlug"),
            _date(payload.get("weekStart")),
            idempotency_key=idempotency_key,
            daily_quotas=_date_map(payload.get("dailyQuotas"), "dailyQuotas"),
            daily_time_budgets=_date_map(
                payload.get("dailyTimeBudgets"), "dailyTimeBudgets"
            ),
        )
    except Exception as exc:
        raise _translate(exc) from exc
    return _week_payload(week)


@router.get("/planner/week")
async def get_week(
    request: Request,
    target_slug: str = Query(alias="targetSlug", min_length=1),
    week_start: str = Query(alias="weekStart", min_length=1),
    allow_missing: bool = Query(False, alias="allowMissing"),
) -> dict[str, Any] | None:
    try:
        week = _weekly_service(request).get_week(target_slug, _date(week_start))
    except WeeklyPlanNotFoundError as exc:
        if allow_missing:
            return None
        raise _translate(exc) from exc
    except Exception as exc:
        raise _translate(exc) from exc
    return _week_payload(week)


@router.post("/planner/refresh-day", status_code=201)
async def refresh_day(
    request: Request,
    payload: dict[str, Any] = Body(...),
    idempotency_key: str = Header(alias="Idempotency-Key"),
) -> dict[str, Any]:
    try:
        day = _service(request).refresh_day(
            _integer(payload, "previousRunId"),
            payload.get("targetSlug"),
            _date(payload.get("date")),
            idempotency_key=idempotency_key,
            time_budget_minutes=payload.get("timeBudgetMinutes"),
            ls_target_slug=payload.get("lsTargetSlug"),
        )
    except Exception as exc:
        raise _translate(exc) from exc
    return _day_payload(day)


@router.get("/planner/day")
async def get_day(
    request: Request,
    target_slug: str = Query(alias="targetSlug", min_length=1),
    day_value: str = Query(alias="date", min_length=1),
    allow_missing: bool = Query(False, alias="allowMissing"),
) -> dict[str, Any] | None:
    try:
        day = _service(request).get_day(target_slug, _date(day_value))
    except PlannerDayNotFoundError as exc:
        if allow_missing:
            return None
        raise _translate(exc) from exc
    except Exception as exc:
        raise _translate(exc) from exc
    return _day_payload(day)


@router.get("/planner/scoreboard")
async def get_scoreboard(
    request: Request,
    run_id: int = Query(alias="runId", gt=0),
) -> dict[str, Any]:
    try:
        candidates = _service(request).get_scoreboard(run_id)
    except Exception as exc:
        raise _translate(exc) from exc
    return {"items": [_candidate_payload(item) for item in candidates]}


@router.post("/planner/blocks/{block_id}/result")
async def record_block_result(
    request: Request,
    block_id: int,
    payload: dict[str, Any] = Body(...),
) -> dict[str, Any]:
    try:
        block = _service(request).record_block_result(
            block_id,
            state=payload.get("state"),
            questions_done=_integer(payload, "questionsDone", default=0),
            correct_count=_integer(payload, "correctCount", default=0),
            wrong_count=_integer(payload, "wrongCount", default=0),
            doubt_count=_integer(payload, "doubtCount", default=0),
            favorite_count=_integer(payload, "favoriteCount", default=0),
            expected_version=_integer(payload, "expectedVersion"),
        )
    except Exception as exc:
        raise _translate(exc) from exc
    return _block_payload(block)
