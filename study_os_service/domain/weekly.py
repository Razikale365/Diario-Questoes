from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime
from types import MappingProxyType
from typing import Literal, Mapping


PlanPhase = Literal["pre_edital", "pos_edital"]
PlannerWeekStatus = Literal["generated", "shortfall"]
PlannerWeekSlotState = Literal["forecast", "materialized", "skipped"]
PlannerBlockKind = Literal["theory", "questions", "review"]

_PHASES = {"pre_edital", "pos_edital"}
_WEEK_STATUSES = {"generated", "shortfall"}
_SLOT_STATES = {"forecast", "materialized", "skipped"}
_BLOCK_KINDS = {"theory", "questions", "review"}


def _text(value: str, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{label} is required")
    return value.strip()


def _positive(value: int, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise ValueError(f"{label} must be a positive integer")
    return value


def _non_negative(value: int, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError(f"{label} must be a non-negative integer")
    return value


def _day(value: date, label: str) -> date:
    if isinstance(value, datetime) or not isinstance(value, date):
        raise ValueError(f"{label} must be a date")
    return value


def _aware(value: datetime, label: str) -> datetime:
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{label} must be timezone-aware")
    return value.astimezone(UTC)


def _mapping(value: Mapping[str, object], label: str) -> Mapping[str, object]:
    if not isinstance(value, Mapping):
        raise ValueError(f"{label} must be a mapping")
    return MappingProxyType(dict(value))


@dataclass(frozen=True, slots=True)
class PlannerWeekRun:
    id: int
    idempotency_key: str
    target_slug: str
    week_start: date
    phase: PlanPhase
    algorithm_version: str
    input_hash: str
    supersedes_week_run_id: int | None
    status: PlannerWeekStatus
    shortfall_count: int
    shortfall_reasons: tuple[str, ...]
    generated_at: datetime

    def __post_init__(self) -> None:
        _positive(self.id, "id")
        object.__setattr__(
            self, "idempotency_key", _text(self.idempotency_key, "idempotency key")
        )
        object.__setattr__(self, "target_slug", _text(self.target_slug, "target"))
        resolved_start = _day(self.week_start, "week start")
        if resolved_start.weekday() != 0:
            raise ValueError("week start must be a Monday")
        if self.phase not in _PHASES:
            raise ValueError("invalid plan phase")
        object.__setattr__(
            self, "algorithm_version", _text(self.algorithm_version, "algorithm version")
        )
        object.__setattr__(self, "input_hash", _text(self.input_hash, "input hash"))
        if self.supersedes_week_run_id is not None:
            _positive(self.supersedes_week_run_id, "supersedes week run id")
            if self.supersedes_week_run_id == self.id:
                raise ValueError("week run cannot supersede itself")
        if self.status not in _WEEK_STATUSES:
            raise ValueError("invalid planner week status")
        count = _non_negative(self.shortfall_count, "shortfall count")
        if not isinstance(self.shortfall_reasons, tuple):
            raise ValueError("shortfall reasons must be a tuple")
        reasons = tuple(_text(reason, "shortfall reason") for reason in self.shortfall_reasons)
        object.__setattr__(self, "shortfall_reasons", reasons)
        if self.status == "generated" and (count or reasons):
            raise ValueError("generated week cannot contain a shortfall")
        if self.status == "shortfall" and (count < 1 or count != len(reasons)):
            raise ValueError("shortfall week requires matching reasons")
        object.__setattr__(self, "generated_at", _aware(self.generated_at, "generated at"))


@dataclass(frozen=True, slots=True)
class PlannerWeekSlot:
    id: int
    week_run_id: int
    target_slug: str
    scheduled_date: date
    position: int
    candidate_key: str
    topic_target_slug: str
    target_topic_id: int
    block_kind: PlannerBlockKind
    duration_minutes: int
    planned_questions: int
    score: Mapping[str, object]
    evidence: Mapping[str, object]
    state: PlannerWeekSlotState
    day_run_id: int | None
    day_block_id: int | None

    def __post_init__(self) -> None:
        _positive(self.id, "id")
        _positive(self.week_run_id, "week run id")
        object.__setattr__(self, "target_slug", _text(self.target_slug, "target"))
        _day(self.scheduled_date, "scheduled date")
        _positive(self.position, "position")
        object.__setattr__(
            self, "candidate_key", _text(self.candidate_key, "candidate key")
        )
        object.__setattr__(
            self,
            "topic_target_slug",
            _text(self.topic_target_slug, "topic target"),
        )
        _positive(self.target_topic_id, "target topic id")
        if self.block_kind not in _BLOCK_KINDS:
            raise ValueError("invalid block kind")
        duration = _positive(self.duration_minutes, "duration minutes")
        if not 45 <= duration <= 75:
            raise ValueError("duration minutes must be between 45 and 75")
        questions = _non_negative(self.planned_questions, "planned questions")
        if self.block_kind == "theory" and questions:
            raise ValueError("theory slot planned questions must be zero")
        if self.block_kind in {"questions", "review"} and questions < 1:
            raise ValueError("planned questions must be positive for this slot")
        object.__setattr__(self, "score", _mapping(self.score, "score"))
        object.__setattr__(self, "evidence", _mapping(self.evidence, "evidence"))
        if self.state not in _SLOT_STATES:
            raise ValueError("invalid planner week slot state")
        if self.state == "materialized":
            if self.day_run_id is None or self.day_block_id is None:
                raise ValueError("materialized slot requires day run and block")
            _positive(self.day_run_id, "day run id")
            _positive(self.day_block_id, "day block id")
        elif self.day_run_id is not None or self.day_block_id is not None:
            raise ValueError("forecast or skipped slot cannot contain materialization")
