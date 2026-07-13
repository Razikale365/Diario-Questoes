from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime
from types import MappingProxyType
from typing import Literal, Mapping
from urllib.parse import urlparse


PlanPhase = Literal["pre_edital", "pos_edital"]
CoverageStatus = Literal[
    "unread", "in_progress", "covered", "stale", "weak", "strong"
]
TransferKind = Literal["target_specific", "shared", "partial"]
PlannerSourceKind = Literal["course", "tec", "ls", "trilha", "manual", "bizu"]
PlannerBlockKind = Literal["theory", "questions", "review"]
PlannerRunStatus = Literal["generated", "shortfall"]
PlannerBlockState = Literal["pending", "active", "completed", "skipped", "failed"]
StrategySelectionSourceKind = Literal[
    "course", "passo", "trilha", "ls", "andrety", "tec", "manual"
]

_PHASES = {"pre_edital", "pos_edital"}
_COVERAGE_STATUSES = {
    "unread",
    "in_progress",
    "covered",
    "stale",
    "weak",
    "strong",
}
_TRANSFER_KINDS = {"target_specific", "shared", "partial"}
_SOURCE_KINDS = {"course", "tec", "ls", "trilha", "manual", "bizu"}
_BLOCK_KINDS = {"theory", "questions", "review"}
_RUN_STATUSES = {"generated", "shortfall"}
_BLOCK_STATES = {"pending", "active", "completed", "skipped", "failed"}
_STRATEGY_SELECTION_SOURCE_KINDS = {
    "course",
    "passo",
    "trilha",
    "ls",
    "andrety",
    "tec",
    "manual",
}
_STRATEGY_CONTENT_ROLES = {
    "primary_theory",
    "review_support",
    "question_practice",
    "schedule_advice",
    "incidence_signal",
}


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


def _range(value: float, label: str, minimum: float, maximum: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{label} must be numeric")
    resolved = float(value)
    if not minimum <= resolved <= maximum:
        raise ValueError(f"{label} must be between {minimum:g} and {maximum:g}")
    return resolved


def _aware(value: datetime, label: str) -> datetime:
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{label} must be timezone-aware")
    return value.astimezone(UTC)


def _date(value: date | None, label: str) -> date | None:
    if value is None:
        return None
    if isinstance(value, datetime) or not isinstance(value, date):
        raise ValueError(f"{label} must be a date")
    return value


def _url(value: str, label: str) -> str:
    resolved = _text(value, label)
    parsed = urlparse(resolved)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError(f"{label} must be an HTTP source URL")
    return resolved


@dataclass(frozen=True, slots=True)
class ExamTarget:
    target_slug: str
    display_name: str
    institution: str
    role: str
    banca: str
    phase: PlanPhase
    deadline: date | None
    daily_quota: int
    priority_score: float
    source_urls: tuple[str, ...]
    notes: str
    active: bool
    version: int

    def __post_init__(self) -> None:
        object.__setattr__(self, "target_slug", _text(self.target_slug, "target"))
        object.__setattr__(self, "display_name", _text(self.display_name, "display name"))
        object.__setattr__(self, "institution", _text(self.institution, "institution"))
        object.__setattr__(self, "role", _text(self.role, "role"))
        object.__setattr__(self, "banca", _text(self.banca, "banca"))
        if self.phase not in _PHASES:
            raise ValueError("invalid plan phase")
        object.__setattr__(self, "deadline", _date(self.deadline, "deadline"))
        quota = _positive(self.daily_quota, "daily quota")
        if quota > 8:
            raise ValueError("daily quota must be at most 8")
        object.__setattr__(
            self,
            "priority_score",
            _range(self.priority_score, "priority score", 0, 100),
        )
        if not isinstance(self.source_urls, tuple):
            raise ValueError("source URLs must be a tuple")
        object.__setattr__(
            self,
            "source_urls",
            tuple(_url(value, "source URL") for value in self.source_urls),
        )
        if not isinstance(self.notes, str):
            raise ValueError("notes must be text")
        if not isinstance(self.active, bool):
            raise ValueError("active must be boolean")
        _positive(self.version, "version")


@dataclass(frozen=True, slots=True)
class TargetTopic:
    id: int
    target_slug: str
    discipline: str
    topic: str
    coverage_status: CoverageStatus
    edital_weight: float
    incidence: float
    tier: int
    banca_fit: float
    overlap_value: float
    transfer_kind: TransferKind
    source_kind: PlannerSourceKind
    lesson_id: int | None
    material_id: int | None
    tec_source_url: str | None
    tec_source_id: str | None
    planned_questions: int
    review_debt: float
    notes: str
    active: bool
    version: int

    def __post_init__(self) -> None:
        _positive(self.id, "id")
        object.__setattr__(self, "target_slug", _text(self.target_slug, "target"))
        object.__setattr__(self, "discipline", _text(self.discipline, "discipline"))
        object.__setattr__(self, "topic", _text(self.topic, "topic"))
        if self.coverage_status not in _COVERAGE_STATUSES:
            raise ValueError("invalid coverage status")
        object.__setattr__(
            self, "edital_weight", _range(self.edital_weight, "edital weight", 0, 10)
        )
        object.__setattr__(self, "incidence", _range(self.incidence, "incidence", 0, 100))
        tier = _positive(self.tier, "tier")
        if tier > 5:
            raise ValueError("tier must be at most 5")
        object.__setattr__(self, "banca_fit", _range(self.banca_fit, "banca fit", 0, 100))
        object.__setattr__(
            self,
            "overlap_value",
            _range(self.overlap_value, "overlap value", 0, 100),
        )
        if self.transfer_kind not in _TRANSFER_KINDS:
            raise ValueError("invalid transfer kind")
        if self.source_kind not in _SOURCE_KINDS:
            raise ValueError("invalid source kind")
        if self.lesson_id is not None:
            _positive(self.lesson_id, "lesson id")
        if self.material_id is not None:
            _positive(self.material_id, "material id")
            if self.lesson_id is None:
                raise ValueError("material requires a lesson")
        if self.tec_source_url is not None:
            object.__setattr__(
                self, "tec_source_url", _url(self.tec_source_url, "TEC source URL")
            )
        if self.tec_source_id is not None:
            object.__setattr__(
                self, "tec_source_id", _text(self.tec_source_id, "TEC source id")
            )
        _non_negative(self.planned_questions, "planned questions")
        object.__setattr__(
            self, "review_debt", _range(self.review_debt, "review debt", 0, 100)
        )
        if not isinstance(self.notes, str):
            raise ValueError("notes must be text")
        if not isinstance(self.active, bool):
            raise ValueError("active must be boolean")
        _positive(self.version, "version")


@dataclass(frozen=True, slots=True)
class PlannerRun:
    id: int
    idempotency_key: str
    target_slug: str
    plan_date: date
    phase: PlanPhase
    daily_quota: int
    time_budget_minutes: int
    algorithm_version: str
    input_hash: str
    supersedes_run_id: int | None
    status: PlannerRunStatus
    shortfall_count: int
    shortfall_reasons: tuple[str, ...]
    generated_at: datetime

    def __post_init__(self) -> None:
        _positive(self.id, "id")
        object.__setattr__(
            self, "idempotency_key", _text(self.idempotency_key, "idempotency key")
        )
        object.__setattr__(self, "target_slug", _text(self.target_slug, "target"))
        resolved_date = _date(self.plan_date, "plan date")
        if resolved_date is None:
            raise ValueError("plan date is required")
        if self.phase not in _PHASES:
            raise ValueError("invalid plan phase")
        quota = _positive(self.daily_quota, "daily quota")
        if quota > 8:
            raise ValueError("daily quota must be at most 8")
        budget = _positive(self.time_budget_minutes, "time budget minutes")
        if budget > 720:
            raise ValueError("time budget minutes must be at most 720")
        object.__setattr__(
            self, "algorithm_version", _text(self.algorithm_version, "algorithm version")
        )
        object.__setattr__(self, "input_hash", _text(self.input_hash, "input hash"))
        if self.supersedes_run_id is not None:
            _positive(self.supersedes_run_id, "supersedes run id")
            if self.supersedes_run_id == self.id:
                raise ValueError("run cannot supersede itself")
        if self.status not in _RUN_STATUSES:
            raise ValueError("invalid planner run status")
        count = _non_negative(self.shortfall_count, "shortfall count")
        if not isinstance(self.shortfall_reasons, tuple):
            raise ValueError("shortfall reasons must be a tuple")
        reasons = tuple(_text(value, "shortfall reason") for value in self.shortfall_reasons)
        object.__setattr__(self, "shortfall_reasons", reasons)
        if self.status == "generated" and (count != 0 or reasons):
            raise ValueError("generated run cannot contain a shortfall")
        if self.status == "shortfall" and (count < 1 or count != len(reasons)):
            raise ValueError("shortfall run requires matching reasons")
        object.__setattr__(self, "generated_at", _aware(self.generated_at, "generated at"))


@dataclass(frozen=True, slots=True)
class ScoreBreakdown:
    weakness: int
    incidence: int
    tier: int
    coverage_need: int
    review_debt: int
    ls_alignment: int
    target_fit: int
    overlap_value: int
    deadline_pressure: int
    banca_fit: int
    edital_weight: int
    balance_penalty: int
    low_trust_penalty: int
    final_score: int
    weekly_alignment: int = 0

    def __post_init__(self) -> None:
        for field_name in (
            "weakness",
            "incidence",
            "tier",
            "coverage_need",
            "review_debt",
            "ls_alignment",
            "target_fit",
            "overlap_value",
            "deadline_pressure",
            "banca_fit",
            "edital_weight",
            "balance_penalty",
            "low_trust_penalty",
            "weekly_alignment",
        ):
            value = getattr(self, field_name)
            if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= 10000:
                raise ValueError(f"{field_name.replace('_', ' ')} must be basis points")
        if isinstance(self.final_score, bool) or not isinstance(self.final_score, int):
            raise ValueError("final score must be an integer")
        if not -1_000_000_000 <= self.final_score <= 1_000_000_000:
            raise ValueError("final score is outside supported bounds")


@dataclass(frozen=True, slots=True)
class PlannerSourceSelection:
    choice_run_id: int
    choice_row_id: int
    source_item_id: int
    source_kind: StrategySelectionSourceKind
    display_name: str
    content_role: str
    source_target_slug: str
    lesson_id: int | None
    material_id: int | None
    external_url: str | None
    external_id: str | None
    final_score: int
    evidence: Mapping[str, object]

    def __post_init__(self) -> None:
        _positive(self.choice_run_id, "source choice run id")
        _positive(self.choice_row_id, "source choice row id")
        _positive(self.source_item_id, "source item id")
        if self.source_kind not in _STRATEGY_SELECTION_SOURCE_KINDS:
            raise ValueError("invalid strategy selection source kind")
        object.__setattr__(
            self, "display_name", _text(self.display_name, "source display name")
        )
        if self.content_role not in _STRATEGY_CONTENT_ROLES:
            raise ValueError("invalid strategy content role")
        object.__setattr__(
            self,
            "source_target_slug",
            _text(self.source_target_slug, "source target"),
        )
        for value, label in (
            (self.lesson_id, "lesson id"),
            (self.material_id, "material id"),
        ):
            if value is not None:
                _positive(value, label)
        if self.material_id is not None and self.lesson_id is None:
            raise ValueError("source material requires a lesson")
        if self.external_url is not None:
            object.__setattr__(
                self,
                "external_url",
                _url(self.external_url, "source external URL"),
            )
        if self.external_id is not None:
            object.__setattr__(
                self,
                "external_id",
                _text(self.external_id, "source external id"),
            )
        if isinstance(self.final_score, bool) or not isinstance(self.final_score, int):
            raise ValueError("source final score must be an integer")
        if not isinstance(self.evidence, Mapping):
            raise ValueError("source evidence must be a mapping")
        object.__setattr__(self, "evidence", MappingProxyType(dict(self.evidence)))


@dataclass(frozen=True, slots=True)
class PlannerCandidate:
    id: int
    run_id: int
    candidate_key: str
    target_slug: str
    discipline: str
    topic: str
    block_kind: PlannerBlockKind
    source_kind: PlannerSourceKind
    target_topic_id: int | None
    lesson_id: int | None
    material_id: int | None
    duration_minutes: int
    planned_questions: int
    score: ScoreBreakdown
    chosen_position: int | None
    displaced_by_candidate_key: str | None
    stop_reason: str | None
    evidence: Mapping[str, object]
    adaptation_reason: str | None = None

    def __post_init__(self) -> None:
        _positive(self.id, "id")
        _positive(self.run_id, "run id")
        object.__setattr__(
            self, "candidate_key", _text(self.candidate_key, "candidate key")
        )
        object.__setattr__(self, "target_slug", _text(self.target_slug, "target"))
        object.__setattr__(self, "discipline", _text(self.discipline, "discipline"))
        object.__setattr__(self, "topic", _text(self.topic, "topic"))
        if self.block_kind not in _BLOCK_KINDS:
            raise ValueError("invalid block kind")
        if self.source_kind not in _SOURCE_KINDS:
            raise ValueError("invalid source kind")
        for value, label in (
            (self.target_topic_id, "target topic id"),
            (self.lesson_id, "lesson id"),
            (self.material_id, "material id"),
        ):
            if value is not None:
                _positive(value, label)
        if self.material_id is not None and self.lesson_id is None:
            raise ValueError("material requires a lesson")
        if not 45 <= _positive(self.duration_minutes, "duration minutes") <= 75:
            raise ValueError("duration minutes must be between 45 and 75")
        questions = _non_negative(self.planned_questions, "planned questions")
        if self.block_kind == "theory" and questions != 0:
            raise ValueError("theory candidate planned questions must be zero")
        if self.block_kind in {"questions", "review"} and questions < 1:
            raise ValueError("planned questions must be positive for this block")
        if not isinstance(self.score, ScoreBreakdown):
            raise ValueError("score breakdown is required")
        if self.chosen_position is not None:
            _positive(self.chosen_position, "chosen position")
            if self.stop_reason is not None:
                raise ValueError("chosen candidate cannot have a stop reason")
            if self.displaced_by_candidate_key is not None:
                raise ValueError("chosen candidate cannot be displaced")
        if self.displaced_by_candidate_key is not None:
            object.__setattr__(
                self,
                "displaced_by_candidate_key",
                _text(self.displaced_by_candidate_key, "displaced candidate key"),
            )
        if self.stop_reason is not None:
            object.__setattr__(self, "stop_reason", _text(self.stop_reason, "stop reason"))
            if self.displaced_by_candidate_key is not None:
                raise ValueError("stopped candidate cannot also be displaced")
        if not isinstance(self.evidence, Mapping):
            raise ValueError("evidence must be a mapping")
        object.__setattr__(self, "evidence", MappingProxyType(dict(self.evidence)))
        if self.adaptation_reason is not None:
            object.__setattr__(
                self,
                "adaptation_reason",
                _text(self.adaptation_reason, "adaptation reason"),
            )


@dataclass(frozen=True, slots=True)
class PlannerBlock:
    id: int
    run_id: int
    candidate_id: int
    target_slug: str
    scheduled_date: date
    position: int
    block_kind: PlannerBlockKind
    title: str
    duration_minutes: int
    planned_questions: int
    state: PlannerBlockState
    execution_session_id: int | None
    questions_done: int
    correct_count: int
    wrong_count: int
    doubt_count: int
    favorite_count: int
    version: int

    def __post_init__(self) -> None:
        for value, label in (
            (self.id, "id"),
            (self.run_id, "run id"),
            (self.candidate_id, "candidate id"),
            (self.position, "position"),
        ):
            _positive(value, label)
        object.__setattr__(self, "target_slug", _text(self.target_slug, "target"))
        resolved_date = _date(self.scheduled_date, "scheduled date")
        if resolved_date is None:
            raise ValueError("scheduled date is required")
        if self.block_kind not in _BLOCK_KINDS:
            raise ValueError("invalid block kind")
        object.__setattr__(self, "title", _text(self.title, "title"))
        if not 45 <= _positive(self.duration_minutes, "duration minutes") <= 75:
            raise ValueError("duration minutes must be between 45 and 75")
        planned = _non_negative(self.planned_questions, "planned questions")
        if self.block_kind == "theory" and planned != 0:
            raise ValueError("theory block planned questions must be zero")
        if self.block_kind in {"questions", "review"} and planned < 1:
            raise ValueError("planned questions must be positive for this block")
        if self.state not in _BLOCK_STATES:
            raise ValueError("invalid planner block state")
        if self.execution_session_id is not None:
            _positive(self.execution_session_id, "execution session id")
        counts = {
            "questions done": _non_negative(self.questions_done, "questions done"),
            "correct count": _non_negative(self.correct_count, "correct count"),
            "wrong count": _non_negative(self.wrong_count, "wrong count"),
            "doubt count": _non_negative(self.doubt_count, "doubt count"),
            "favorite count": _non_negative(self.favorite_count, "favorite count"),
        }
        if counts["correct count"] + counts["wrong count"] > counts["questions done"]:
            raise ValueError("result counts exceed questions done")
        if self.block_kind == "theory" and any(counts.values()):
            raise ValueError("theory block cannot contain question result counts")
        if self.state in {"pending", "active"} and any(counts.values()):
            raise ValueError("pending block cannot contain result counts")
        _positive(self.version, "version")
