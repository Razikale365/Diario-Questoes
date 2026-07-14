from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Literal


Paper = Literal["P1", "P2"]
FocusBand = Literal["focus", "maintenance", "survival"]
SourcePlanKind = Literal["ls", "trilha", "manual"]
SourceTaskKind = Literal[
    "theory", "questions", "review", "simulation", "discursive", "mixed"
]
SourceTaskStatus = Literal[
    "pending", "started", "completed", "ignored", "archived"
]


def _text(value: str, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{label} is required")
    return value.strip()


def _integer(value: int, label: str, minimum: int, maximum: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"{label} must be an integer")
    if not minimum <= value <= maximum:
        raise ValueError(f"{label} must be between {minimum} and {maximum}")
    return value


@dataclass(frozen=True, slots=True)
class ExamSubjectProfile:
    id: int
    target_slug: str
    subject_key: str
    display_name: str
    aliases: tuple[str, ...]
    paper: Paper
    question_count: int
    question_weight: float
    discursive_eligible: bool
    baseline_accuracy_bp: int | None
    target_low_bp: int
    target_high_bp: int
    baseline_confidence_bp: int
    focus_band: FocusBand
    baseline_source: str
    notes: str
    active: bool
    version: int

    def __post_init__(self) -> None:
        _integer(self.id, "id", 1, 2_147_483_647)
        object.__setattr__(self, "target_slug", _text(self.target_slug, "target"))
        object.__setattr__(self, "subject_key", _text(self.subject_key, "subject key"))
        object.__setattr__(self, "display_name", _text(self.display_name, "display name"))
        if not isinstance(self.aliases, tuple):
            raise ValueError("aliases must be a tuple")
        object.__setattr__(self, "aliases", tuple(_text(alias, "alias") for alias in self.aliases))
        if self.paper not in {"P1", "P2"}:
            raise ValueError("paper must be P1 or P2")
        _integer(self.question_count, "question count", 1, 80)
        if isinstance(self.question_weight, bool) or not isinstance(
            self.question_weight, (int, float)
        ):
            raise ValueError("question weight must be numeric")
        if not 0.1 <= float(self.question_weight) <= 10:
            raise ValueError("question weight must be between 0.1 and 10")
        if self.baseline_accuracy_bp is not None:
            _integer(self.baseline_accuracy_bp, "baseline accuracy", 0, 10000)
        _integer(self.target_low_bp, "target low", 0, 10000)
        _integer(self.target_high_bp, "target high", 0, 10000)
        if self.target_low_bp > self.target_high_bp:
            raise ValueError("target low cannot exceed target high")
        _integer(self.baseline_confidence_bp, "baseline confidence", 0, 10000)
        if self.focus_band not in {"focus", "maintenance", "survival"}:
            raise ValueError("invalid focus band")
        object.__setattr__(
            self, "baseline_source", _text(self.baseline_source, "baseline source")
        )
        if not isinstance(self.notes, str):
            raise ValueError("notes must be text")
        if not isinstance(self.active, bool):
            raise ValueError("active must be boolean")
        _integer(self.version, "version", 1, 2_147_483_647)


@dataclass(frozen=True, slots=True)
class ExamSprintConfig:
    target_slug: str
    start_date: date
    objective_date: date
    exam_end_date: date
    ls_budget_minutes: int
    extra_budget_minutes: int
    p1_floor_questions: int
    p1_goal_low: int
    p1_goal_high: int
    p2_goal_low: int
    p2_goal_high: int
    discursive_goal_low: int
    discursive_goal_high: int
    triage_mode: str
    state: str
    version: int

    def __post_init__(self) -> None:
        object.__setattr__(self, "target_slug", _text(self.target_slug, "target"))
        if not self.start_date <= self.objective_date <= self.exam_end_date:
            raise ValueError("sprint dates are out of order")
        _integer(self.ls_budget_minutes, "LS budget", 15, 720)
        _integer(self.extra_budget_minutes, "extra budget", 0, 240)
        for value, label, maximum in (
            (self.p1_floor_questions, "P1 floor", 80),
            (self.p1_goal_low, "P1 low goal", 80),
            (self.p1_goal_high, "P1 high goal", 80),
            (self.p2_goal_low, "P2 low goal", 80),
            (self.p2_goal_high, "P2 high goal", 80),
            (self.discursive_goal_low, "discursive low goal", 100),
            (self.discursive_goal_high, "discursive high goal", 100),
        ):
            _integer(value, label, 0, maximum)
        if self.triage_mode != "suggest_only":
            raise ValueError("sprint triage must remain suggest only")
        if self.state not in {"active", "paused", "completed"}:
            raise ValueError("invalid sprint state")
        _integer(self.version, "version", 1, 2_147_483_647)


@dataclass(frozen=True, slots=True)
class SourcePlanTask:
    id: int
    target_slug: str
    source_kind: SourcePlanKind
    external_task_id: str
    plan_label: str
    meta_number: int | None
    scheduled_date: date | None
    source_order: int
    discipline: str
    subject_key: str | None
    topic_hint: str
    task_kind: SourceTaskKind
    description: str
    details: str
    material_hint: str
    estimated_minutes: int
    spent_minutes: int
    relevance: float
    status: SourceTaskStatus
    performance_bp: int | None
    linked_study_task_id: str | None
    provenance: dict[str, object]
    version: int
    source_cycle_id: int | None = None

    @property
    def mapping_status(self) -> str:
        if self.subject_key:
            return "matched"
        if self.task_kind in {"simulation", "discursive"}:
            return "transversal"
        return "unresolved"
