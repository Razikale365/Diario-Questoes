from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from decimal import Decimal, ROUND_HALF_UP
import math
import re
from types import MappingProxyType
from typing import Literal, Mapping, TypeAlias


MeasurementType: TypeAlias = Literal[
    "full_exam",
    "sectional_mock",
    "unseen_set",
    "mixed_set",
    "error_review",
    "ls_percentage",
    "sprint_action",
    "baseline",
]
TransferScope: TypeAlias = Literal["content", "method", "trap_pattern"]
BacklogState: TypeAlias = Literal["candidate", "recovered", "dismissed"]
Scalar: TypeAlias = str | int | float | bool | None

MEASUREMENT_TYPES = frozenset(
    {
        "full_exam",
        "sectional_mock",
        "unseen_set",
        "mixed_set",
        "error_review",
        "ls_percentage",
        "sprint_action",
        "baseline",
    }
)
TRANSFER_SCOPES = frozenset({"content", "method", "trap_pattern"})
BACKLOG_STATES = frozenset({"candidate", "recovered", "dismissed"})
SCORE_KIND = "raw_weighted_equivalent_not_fcc_standardized"
_SHA256 = re.compile(r"[0-9a-f]{64}\Z")


def _require_int(value: object, label: str, *, minimum: int | None = None) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"{label} must be an integer")
    if minimum is not None and value < minimum:
        raise ValueError(f"{label} must be at least {minimum}")
    return value


def _optional_positive_int(value: object, label: str) -> int | None:
    if value is None:
        return None
    return _require_int(value, label, minimum=1)


def _basis_points(value: object, label: str) -> int:
    result = _require_int(value, label, minimum=0)
    if result > 10000:
        raise ValueError(f"{label} must be between 0 and 10000")
    return result


def _non_empty(value: object, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{label} must be a non-empty string")
    return value.strip()


def _plain_string(value: object, label: str) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{label} must be a string")
    return value


def _calendar_date(value: object, label: str) -> date:
    if type(value) is not date:
        raise ValueError(f"{label} must be a date")
    return value


def _aware_utc(value: object, label: str) -> datetime:
    if not isinstance(value, datetime) or value.tzinfo is None:
        raise ValueError(f"{label} must be timezone-aware")
    try:
        offset = value.utcoffset()
    except (OverflowError, ValueError):
        offset = None
    if offset is None:
        raise ValueError(f"{label} must be timezone-aware")
    return value.astimezone(UTC)


def _finite_number(value: object, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{label} must be numeric")
    result = float(value)
    if not math.isfinite(result):
        raise ValueError(f"{label} must be finite")
    return result


def _freeze_provenance(value: object) -> Mapping[str, Scalar]:
    if not isinstance(value, Mapping):
        raise ValueError("provenance must be a mapping")
    copied: dict[str, Scalar] = {}
    for key, item in value.items():
        if not isinstance(key, str) or not key.strip():
            raise ValueError("provenance keys must be non-empty strings")
        if item is not None and not isinstance(item, (str, int, float, bool)):
            raise ValueError("provenance values must be scalar")
        if isinstance(item, float) and not math.isfinite(item):
            raise ValueError("provenance values must be finite")
        copied[key] = item
    return MappingProxyType(copied)


def _sqlite_half_up_percentage(correct_count: int, answered_count: int) -> int:
    return int(
        (Decimal(correct_count) * Decimal(10000) / Decimal(answered_count)).quantize(
            Decimal("1"), rounding=ROUND_HALF_UP
        )
    )


@dataclass(frozen=True, slots=True)
class SprintPerformanceObservation:
    id: int | None
    target_slug: str
    batch_id: str
    subject_profile_id: int | None
    subject_key: str | None
    discipline: str
    topic_hint: str
    observed_on: date
    origin: str
    source_record_id: str
    source_revision: str
    source_updated_at: datetime
    measurement_type: MeasurementType
    exam_board: str
    correct_count: int | None
    wrong_count: int | None
    doubt_count: int
    percentage_bp: int | None
    transfer_scope: TransferScope
    transferability_bp: int
    content_hash: str
    provenance: Mapping[str, Scalar] = field(hash=False)

    def __post_init__(self) -> None:
        object.__setattr__(self, "id", _optional_positive_int(self.id, "observation id"))
        object.__setattr__(self, "target_slug", _non_empty(self.target_slug, "target slug"))
        object.__setattr__(self, "batch_id", _non_empty(self.batch_id, "batch id"))
        object.__setattr__(
            self,
            "subject_profile_id",
            _optional_positive_int(self.subject_profile_id, "subject profile id"),
        )
        if self.subject_key is not None:
            object.__setattr__(self, "subject_key", _non_empty(self.subject_key, "subject key"))
        object.__setattr__(self, "discipline", _non_empty(self.discipline, "discipline"))
        object.__setattr__(self, "topic_hint", _plain_string(self.topic_hint, "topic hint"))
        object.__setattr__(self, "observed_on", _calendar_date(self.observed_on, "observed on"))
        object.__setattr__(self, "origin", _non_empty(self.origin, "origin"))
        object.__setattr__(
            self, "source_record_id", _non_empty(self.source_record_id, "source record id")
        )
        object.__setattr__(
            self, "source_revision", _non_empty(self.source_revision, "source revision")
        )
        object.__setattr__(
            self,
            "source_updated_at",
            _aware_utc(self.source_updated_at, "source updated at"),
        )
        if self.measurement_type not in MEASUREMENT_TYPES:
            raise ValueError("invalid measurement type")
        object.__setattr__(self, "exam_board", _plain_string(self.exam_board, "exam board"))

        if (self.correct_count is None) != (self.wrong_count is None):
            raise ValueError("correct and wrong counts must be supplied together")
        doubt_count = _require_int(self.doubt_count, "doubt count", minimum=0)
        object.__setattr__(self, "doubt_count", doubt_count)

        if self.correct_count is None:
            if self.percentage_bp is None:
                raise ValueError("percentage is required when sample size is unknown")
            percentage = _basis_points(self.percentage_bp, "percentage")
        else:
            correct_count = _require_int(self.correct_count, "correct count", minimum=0)
            wrong_count = _require_int(self.wrong_count, "wrong count", minimum=0)
            answered_count = correct_count + wrong_count
            if answered_count == 0:
                raise ValueError("at least one answered question is required")
            if doubt_count > answered_count:
                raise ValueError("doubt count cannot exceed answered questions")
            expected = _sqlite_half_up_percentage(correct_count, answered_count)
            if self.percentage_bp is None:
                percentage = expected
            else:
                percentage = _basis_points(self.percentage_bp, "percentage")
                if percentage != expected:
                    raise ValueError("percentage does not match aggregate counts")
            object.__setattr__(self, "correct_count", correct_count)
            object.__setattr__(self, "wrong_count", wrong_count)
        object.__setattr__(self, "percentage_bp", percentage)

        if self.transfer_scope not in TRANSFER_SCOPES:
            raise ValueError("invalid transfer scope")
        object.__setattr__(
            self,
            "transferability_bp",
            _basis_points(self.transferability_bp, "transferability"),
        )
        if not isinstance(self.content_hash, str) or _SHA256.fullmatch(self.content_hash) is None:
            raise ValueError("content hash must be a lowercase SHA-256 digest")
        object.__setattr__(self, "provenance", _freeze_provenance(self.provenance))

    @property
    def sample_size(self) -> int | None:
        if self.correct_count is None or self.wrong_count is None:
            return None
        return self.correct_count + self.wrong_count


@dataclass(frozen=True, slots=True)
class SourcePlanCycle:
    id: int | None
    target_slug: str
    source_kind: str
    plan_label: str
    meta_number: int | None
    released_at: datetime
    starts_on: date
    ends_on: date
    version: int

    def __post_init__(self) -> None:
        object.__setattr__(self, "id", _optional_positive_int(self.id, "cycle id"))
        object.__setattr__(self, "target_slug", _non_empty(self.target_slug, "target slug"))
        if self.source_kind not in {"ls", "trilha", "manual"}:
            raise ValueError("invalid source kind")
        object.__setattr__(self, "plan_label", _non_empty(self.plan_label, "plan label"))
        if self.meta_number is not None:
            object.__setattr__(
                self, "meta_number", _require_int(self.meta_number, "meta number", minimum=0)
            )
        released_at = _aware_utc(self.released_at, "released at")
        starts_on = _calendar_date(self.starts_on, "cycle start")
        ends_on = _calendar_date(self.ends_on, "cycle end")
        if starts_on > ends_on:
            raise ValueError("cycle dates must be ordered")
        if released_at.date() > ends_on:
            raise ValueError("release date cannot be after cycle end")
        object.__setattr__(self, "released_at", released_at)
        object.__setattr__(self, "starts_on", starts_on)
        object.__setattr__(self, "ends_on", ends_on)
        object.__setattr__(self, "version", _require_int(self.version, "version", minimum=1))


@dataclass(frozen=True, slots=True)
class SourcePlanBacklogCandidate:
    id: int | None
    target_slug: str
    source_cycle_id: int
    source_plan_task_id: int
    reason: str
    return_score_milli: int
    state: BacklogState
    discovered_on: date
    recovered_on: date | None

    def __post_init__(self) -> None:
        object.__setattr__(self, "id", _optional_positive_int(self.id, "backlog id"))
        object.__setattr__(self, "target_slug", _non_empty(self.target_slug, "target slug"))
        object.__setattr__(
            self, "source_cycle_id", _require_int(self.source_cycle_id, "cycle id", minimum=1)
        )
        object.__setattr__(
            self,
            "source_plan_task_id",
            _require_int(self.source_plan_task_id, "source plan task id", minimum=1),
        )
        if self.reason != "cycle_closed_pending":
            raise ValueError("invalid backlog reason")
        object.__setattr__(
            self,
            "return_score_milli",
            _require_int(self.return_score_milli, "return score", minimum=0),
        )
        if self.state not in BACKLOG_STATES:
            raise ValueError("invalid backlog state")
        discovered_on = _calendar_date(self.discovered_on, "discovered on")
        recovered_on = (
            None
            if self.recovered_on is None
            else _calendar_date(self.recovered_on, "recovered on")
        )
        if self.state == "recovered" and recovered_on is None:
            raise ValueError("recovery date is required for recovered backlog")
        if self.state != "recovered" and recovered_on is not None:
            raise ValueError("unrecovered backlog cannot have a recovery date")
        if recovered_on is not None and recovered_on < discovered_on:
            raise ValueError("recovery date cannot precede discovery")
        object.__setattr__(self, "discovered_on", discovered_on)
        object.__setattr__(self, "recovered_on", recovered_on)


@dataclass(frozen=True, slots=True)
class SubjectProjection:
    subject_profile_id: int
    subject_key: str
    display_name: str
    paper: Literal["P1", "P2"]
    question_count: int
    question_weight: float
    estimate_bp: int
    low_bp: int
    high_bp: int
    effective_sample: float
    confidence_bp: int
    fragility_bp: int
    representative_set_count: int
    demotion_eligible: bool
    dominant_origin: str
    warnings: tuple[str, ...]

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "subject_profile_id",
            _require_int(self.subject_profile_id, "subject profile id", minimum=1),
        )
        object.__setattr__(self, "subject_key", _non_empty(self.subject_key, "subject key"))
        object.__setattr__(self, "display_name", _non_empty(self.display_name, "display name"))
        if self.paper not in {"P1", "P2"}:
            raise ValueError("paper must be P1 or P2")
        object.__setattr__(
            self, "question_count", _require_int(self.question_count, "question count", minimum=1)
        )
        question_weight = _finite_number(self.question_weight, "question weight")
        if question_weight <= 0:
            raise ValueError("question weight must be positive")
        object.__setattr__(self, "question_weight", question_weight)
        low = _basis_points(self.low_bp, "low estimate")
        estimate = _basis_points(self.estimate_bp, "estimate")
        high = _basis_points(self.high_bp, "high estimate")
        if not low <= estimate <= high:
            raise ValueError("projection interval must contain the estimate")
        object.__setattr__(self, "low_bp", low)
        object.__setattr__(self, "estimate_bp", estimate)
        object.__setattr__(self, "high_bp", high)
        effective_sample = _finite_number(self.effective_sample, "effective sample")
        if effective_sample < 0:
            raise ValueError("effective sample cannot be negative")
        object.__setattr__(self, "effective_sample", effective_sample)
        object.__setattr__(self, "confidence_bp", _basis_points(self.confidence_bp, "confidence"))
        object.__setattr__(self, "fragility_bp", _basis_points(self.fragility_bp, "fragility"))
        object.__setattr__(
            self,
            "representative_set_count",
            _require_int(self.representative_set_count, "representative set count", minimum=0),
        )
        if type(self.demotion_eligible) is not bool:
            raise ValueError("demotion eligibility must be boolean")
        object.__setattr__(self, "dominant_origin", _non_empty(self.dominant_origin, "dominant origin"))
        if not isinstance(self.warnings, tuple):
            raise ValueError("warnings must be a tuple")
        if any(not isinstance(item, str) or not item for item in self.warnings):
            raise ValueError("warnings must contain non-empty strings")


@dataclass(frozen=True, slots=True)
class PaperProjection:
    projected: float
    low: float
    high: float
    floor: int
    stretch: int
    variance: float | None = None

    def __post_init__(self) -> None:
        low = _finite_number(self.low, "paper low")
        projected = _finite_number(self.projected, "paper projection")
        high = _finite_number(self.high, "paper high")
        if not (0 <= low <= projected <= high <= 80):
            raise ValueError("paper projection interval must be ordered within 0..80")
        floor = _require_int(self.floor, "paper floor", minimum=0)
        stretch = _require_int(self.stretch, "paper stretch", minimum=0)
        if floor > 80 or stretch > 80 or floor > stretch:
            raise ValueError("paper floor/stretch must be ordered within 0..80")
        object.__setattr__(self, "low", low)
        object.__setattr__(self, "projected", projected)
        object.__setattr__(self, "high", high)
        object.__setattr__(self, "floor", floor)
        object.__setattr__(self, "stretch", stretch)
        if self.variance is not None:
            variance = _finite_number(self.variance, "paper variance")
            if variance < 0:
                raise ValueError("paper variance cannot be negative")
            object.__setattr__(self, "variance", variance)


@dataclass(frozen=True, slots=True)
class SprintProjection:
    target_slug: str
    as_of: date
    formula_version: str
    score_kind: Literal["raw_weighted_equivalent_not_fcc_standardized"]
    p1: PaperProjection
    p2: PaperProjection
    confidence_bp: int
    dominant_origin: str
    subjects: tuple[SubjectProjection, ...]
    warnings: tuple[str, ...]

    def __post_init__(self) -> None:
        object.__setattr__(self, "target_slug", _non_empty(self.target_slug, "target slug"))
        object.__setattr__(self, "as_of", _calendar_date(self.as_of, "projection date"))
        object.__setattr__(
            self, "formula_version", _non_empty(self.formula_version, "formula version")
        )
        if self.score_kind != SCORE_KIND:
            raise ValueError("invalid projection score kind")
        if not isinstance(self.p1, PaperProjection) or not isinstance(self.p2, PaperProjection):
            raise ValueError("P1 and P2 projections are required")
        object.__setattr__(self, "confidence_bp", _basis_points(self.confidence_bp, "confidence"))
        object.__setattr__(self, "dominant_origin", _non_empty(self.dominant_origin, "dominant origin"))
        if not isinstance(self.subjects, tuple):
            raise ValueError("subjects must be a tuple")
        if any(not isinstance(item, SubjectProjection) for item in self.subjects):
            raise ValueError("subjects must contain SubjectProjection records")
        if len({item.subject_key for item in self.subjects}) != len(self.subjects):
            raise ValueError("subject projections must have unique keys")
        if not isinstance(self.warnings, tuple):
            raise ValueError("warnings must be a tuple")
        if any(not isinstance(item, str) or not item for item in self.warnings):
            raise ValueError("warnings must contain non-empty strings")

    @property
    def weighted_projected(self) -> float:
        return self.p1.projected + 2 * self.p2.projected

    @property
    def weighted_low(self) -> float:
        if self.p1.variance is not None and self.p2.variance is not None:
            standard_error = math.sqrt(self.p1.variance + 4 * self.p2.variance)
            return max(0.0, self.weighted_projected - 1.645 * standard_error)
        return self.p1.low + 2 * self.p2.low

    @property
    def weighted_high(self) -> float:
        if self.p1.variance is not None and self.p2.variance is not None:
            standard_error = math.sqrt(self.p1.variance + 4 * self.p2.variance)
            return min(240.0, self.weighted_projected + 1.645 * standard_error)
        return self.p1.high + 2 * self.p2.high

    @property
    def weighted_target(self) -> int:
        return 204

    @property
    def distance_to_target(self) -> float:
        return self.weighted_target - self.weighted_projected

    def subject(self, subject_key: str) -> SubjectProjection:
        for projection in self.subjects:
            if projection.subject_key == subject_key:
                return projection
        raise KeyError(subject_key)
