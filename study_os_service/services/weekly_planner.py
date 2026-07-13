from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, replace
from datetime import UTC, date, datetime, timedelta
import hashlib
import json
import sqlite3
from types import MappingProxyType

from study_os_service.domain.planner import PlannerBlock, PlannerCandidate
from study_os_service.domain.weekly import PlannerWeekRun, PlannerWeekSlot
from study_os_service.repositories.planner_profiles import PlannerProfileRepository
from study_os_service.repositories.weekly import WeeklyRepository
from study_os_service.services.planner_candidates import (
    CandidatePool,
    attach_source_choices,
    build_candidates,
    collect_candidate_evidence,
)
from study_os_service.services.planner_profiles import TargetProfileNotFoundError
from study_os_service.services.planner_scoring import ScoredCandidate, ScoringContext, score_candidates
from study_os_service.services.review_queue import ReviewQueueService


WEEKLY_ALGORITHM_VERSION = "m6-week-source-v1"


class WeeklyIdempotencyConflictError(RuntimeError):
    pass


class WeeklyRunNotFoundError(KeyError):
    pass


class WeeklyPlanNotFoundError(KeyError):
    pass


class WeeklyRefreshConflictError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class GeneratedWeek:
    run: PlannerWeekRun
    slots: tuple[PlannerWeekSlot, ...]


def align_pool_to_forecast(
    pool: CandidatePool,
    forecast_keys: set[str],
    forecast_source_rows: dict[str, int | None] | None = None,
) -> CandidatePool:
    if not forecast_keys:
        return pool
    aligned = []
    for candidate in pool.all:
        evidence = dict(candidate.evidence)
        follows = candidate.candidate_key in forecast_keys
        evidence["weeklyAlignment"] = 100 if follows else 0
        current_choice = evidence.get("sourceChoice")
        current_row = (
            current_choice.get("choiceRowId")
            if isinstance(current_choice, dict)
            else None
        )
        forecast_row = (forecast_source_rows or {}).get(candidate.candidate_key)
        if follows and forecast_row is not None and current_row != forecast_row:
            reason = "weekly_source_diverged"
        elif follows:
            reason = "weekly_forecast_follow"
        elif candidate.executable:
            reason = "weekly_diverged_current_evidence"
        else:
            reason = candidate.adaptation_reason
        evidence["adaptationReason"] = reason
        aligned.append(replace(
            candidate,
            evidence=MappingProxyType(evidence),
            adaptation_reason=reason,
        ))
    return CandidatePool(tuple(aligned))


class WeeklyPlannerService:
    def __init__(self, connection: sqlite3.Connection):
        self.connection = connection
        self.profiles = PlannerProfileRepository(connection)
        self.repository = WeeklyRepository(connection)
        self.review_queue = ReviewQueueService(connection)

    def generate_week(
        self,
        target_slug: str,
        week_start: date,
        *,
        idempotency_key: str,
        daily_quotas: dict[date, int] | None = None,
        daily_time_budgets: dict[date, int] | None = None,
    ) -> GeneratedWeek:
        return self._generate(
            target_slug,
            week_start,
            idempotency_key=idempotency_key,
            daily_quotas=daily_quotas,
            daily_time_budgets=daily_time_budgets,
            supersedes_week_run_id=None,
        )

    def refresh_week(
        self,
        previous_week_run_id: int,
        target_slug: str,
        week_start: date,
        *,
        idempotency_key: str,
        daily_quotas: dict[date, int] | None = None,
        daily_time_budgets: dict[date, int] | None = None,
    ) -> GeneratedWeek:
        return self._generate(
            target_slug,
            week_start,
            idempotency_key=idempotency_key,
            daily_quotas=daily_quotas,
            daily_time_budgets=daily_time_budgets,
            supersedes_week_run_id=previous_week_run_id,
        )

    def _generate(
        self,
        target_slug: str,
        week_start: date,
        *,
        idempotency_key: str,
        daily_quotas: dict[date, int] | None,
        daily_time_budgets: dict[date, int] | None,
        supersedes_week_run_id: int | None,
    ) -> GeneratedWeek:
        target_name = target_slug.strip()
        key = idempotency_key.strip()
        if not target_name or not key:
            raise ValueError("target and idempotency key are required")
        if isinstance(week_start, datetime) or not isinstance(week_start, date):
            raise ValueError("week start must be a date")
        if week_start.weekday() != 0:
            raise ValueError("week start must be a Monday")
        self.connection.execute("BEGIN IMMEDIATE")
        try:
            target = self.profiles.get_target(target_name)
            if target is None:
                raise TargetProfileNotFoundError(target_name)
            quotas, budgets = self._schedule(
                week_start, target.daily_quota, daily_quotas, daily_time_budgets
            )
            request_hash = self._request_hash(
                target_name,
                week_start,
                quotas,
                budgets,
                supersedes_week_run_id,
            )
            existing = self.repository.get_run_by_idempotency_key(key)
            if existing is not None:
                if existing.request_hash != request_hash:
                    raise WeeklyIdempotencyConflictError(
                        "idempotency key already belongs to another request"
                    )
                result = self.get_week_by_run(existing.id)
                self.connection.commit()
                return result
            if supersedes_week_run_id is not None:
                previous = self.repository.get_run(supersedes_week_run_id)
                if previous is None:
                    raise WeeklyRunNotFoundError(supersedes_week_run_id)
                if previous.target_slug != target_name or previous.week_start != week_start:
                    raise WeeklyRefreshConflictError(
                        "previous week belongs to another target or date"
                    )

            selected: list[tuple[date, int, ScoredCandidate]] = []
            shortfalls: list[str] = []
            used_keys: set[str] = set()
            input_days: list[dict[str, object]] = []
            for offset in range(7):
                plan_date = week_start + timedelta(days=offset)
                self.review_queue.rebuild_in_transaction(target_name, plan_date)
                evidence = collect_candidate_evidence(
                    self.connection, target_name, plan_date
                )
                pool = build_candidates(target_name, evidence)
                pool = attach_source_choices(
                    self.connection, target_name, plan_date, pool
                )
                context = ScoringContext(
                    target=target,
                    plan_date=plan_date,
                    ls_target_slug=None,
                    discipline_counts={},
                )
                scored = score_candidates(pool.all, context)
                input_days.append({
                    "date": plan_date.isoformat(),
                    "candidateKeys": [item.candidate.candidate_key for item in scored],
                    "inputHashes": sorted({item.input_hash for item in scored}),
                })
                quota = min(quotas[plan_date], max(1, budgets[plan_date] // 60))
                required = self._required_kinds(quota)
                day_topics: set[int] = set()
                discipline_counts: Counter[str] = Counter()
                position = 0
                for block_kind in required:
                    ranked = [
                        item
                        for item in scored
                        if item.candidate.executable
                        and item.candidate.block_kind == block_kind
                        and item.candidate.candidate_key not in used_keys
                        and item.candidate.target_topic_id not in day_topics
                        and discipline_counts[item.candidate.discipline] < 2
                    ]
                    if not ranked:
                        shortfalls.append(
                            f"{plan_date.isoformat()}: no unique executable {block_kind} candidate"
                        )
                        continue
                    chosen = ranked[0]
                    position += 1
                    selected.append((plan_date, position, chosen))
                    used_keys.add(chosen.candidate.candidate_key)
                    day_topics.add(chosen.candidate.target_topic_id)
                    discipline_counts[chosen.candidate.discipline] += 1

            input_hash = hashlib.sha256(json.dumps(
                {
                    "requestHash": request_hash,
                    "algorithmVersion": WEEKLY_ALGORITHM_VERSION,
                    "days": input_days,
                    "selected": [
                        [day.isoformat(), item.candidate.candidate_key]
                        for day, _position, item in selected
                    ],
                    "shortfalls": shortfalls,
                },
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8")).hexdigest()
            run = self.repository.create_run(
                idempotency_key=key,
                target_slug=target_name,
                week_start=week_start,
                phase=target.phase,
                algorithm_version=WEEKLY_ALGORITHM_VERSION,
                request_hash=request_hash,
                input_hash=input_hash,
                supersedes_week_run_id=supersedes_week_run_id,
                status="shortfall" if shortfalls else "generated",
                shortfall_reasons=tuple(shortfalls),
                generated_at=datetime.now(UTC),
            )
            for plan_date, position, item in selected:
                candidate = item.candidate
                score = item.breakdown
                self.repository.insert_slot(
                    week_run_id=run.id,
                    target_slug=target_name,
                    scheduled_date=plan_date,
                    position=position,
                    candidate_key=candidate.candidate_key,
                    topic_target_slug=candidate.source_target_slug,
                    target_topic_id=candidate.target_topic_id,
                    block_kind=candidate.block_kind,
                    duration_minutes=candidate.duration_minutes,
                    planned_questions=candidate.planned_questions,
                    score={
                        "finalScore": score.final_score,
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
                    },
                    evidence={
                        "discipline": candidate.discipline,
                        "topic": candidate.topic,
                        "adaptationReason": candidate.adaptation_reason,
                        "candidateEvidence": dict(candidate.evidence),
                    },
                )
            result = self.get_week_by_run(run.id)
            self.connection.commit()
            return result
        except Exception:
            self.connection.rollback()
            raise

    def get_week(self, target_slug: str, week_start: date) -> GeneratedWeek:
        run = self.repository.get_latest_run(target_slug.strip(), week_start)
        if run is None:
            raise WeeklyPlanNotFoundError((target_slug, week_start))
        return self.get_week_by_run(run.id)

    def get_week_by_run(self, run_id: int) -> GeneratedWeek:
        run = self.repository.get_run(run_id)
        if run is None:
            raise WeeklyRunNotFoundError(run_id)
        return GeneratedWeek(run, self.repository.list_slots(run.id))

    def link_day(
        self,
        target_slug: str,
        plan_date: date,
        run_id: int,
        blocks: tuple[PlannerBlock, ...],
        candidates: tuple[PlannerCandidate, ...],
    ) -> None:
        slots = self.repository.latest_slots_for_date(target_slug, plan_date)
        by_id = {candidate.id: candidate for candidate in candidates}
        for block in blocks:
            candidate = by_id.get(block.candidate_id)
            if candidate is None:
                continue
            slot = next(
                (
                    item for item in slots
                    if item.candidate_key == candidate.candidate_key
                    and item.state == "forecast"
                ),
                None,
            )
            if slot is not None:
                self.repository.link_slot(
                    slot.id, day_run_id=run_id, day_block_id=block.id
                )

    @staticmethod
    def _schedule(week_start, default_quota, daily_quotas, daily_budgets):
        dates = tuple(week_start + timedelta(days=offset) for offset in range(7))
        quotas = {day: default_quota for day in dates}
        budgets = {day: default_quota * 60 for day in dates}
        WeeklyPlannerService._apply_schedule_values(
            quotas, daily_quotas or {}, "daily quota", 1, 8
        )
        WeeklyPlannerService._apply_schedule_values(
            budgets, daily_budgets or {}, "daily time budget", 45, 720
        )
        return quotas, budgets

    @staticmethod
    def _apply_schedule_values(target, supplied, label, minimum, maximum):
        for day, value in supplied.items():
            if day not in target:
                raise ValueError(f"{label} date is outside the requested week")
            if (
                isinstance(value, bool)
                or not isinstance(value, int)
                or not minimum <= value <= maximum
            ):
                raise ValueError(f"{label} is outside supported bounds")
            target[day] = value

    @staticmethod
    def _request_hash(target_slug, week_start, quotas, budgets, supersedes):
        return hashlib.sha256(json.dumps(
            {
                "targetSlug": target_slug,
                "weekStart": week_start.isoformat(),
                "dailyQuotas": {day.isoformat(): value for day, value in quotas.items()},
                "dailyTimeBudgets": {day.isoformat(): value for day, value in budgets.items()},
                "supersedesWeekRunId": supersedes,
            },
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")).hexdigest()

    @staticmethod
    def _required_kinds(quota: int) -> tuple[str, ...]:
        return (
            "theory", "questions", "questions", "review",
            "questions", "theory", "review", "questions",
        )[:quota]
