from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime
from decimal import Decimal, ROUND_HALF_UP
from typing import Literal, TypeAlias


Outcome: TypeAlias = Literal["started", "completed", "failed", "skipped"]
OUTCOMES = frozenset({"started", "completed", "failed", "skipped"})


def _require_int(value: object, label: str, *, minimum: int = 0, maximum: int | None = None) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"{label} must be an integer")
    if value < minimum or (maximum is not None and value > maximum):
        maximum_label = "" if maximum is None else f" and at most {maximum}"
        raise ValueError(f"{label} must be at least {minimum}{maximum_label}")
    return value


def _positive_int(value: object, label: str) -> int:
    return _require_int(value, label, minimum=1)


def _non_empty(value: object, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{label} must be a non-empty string")
    return value.strip()


def _date(value: object, label: str) -> date:
    if type(value) is not date:
        raise ValueError(f"{label} must be a date")
    return value


def _basis_points(value: object, label: str) -> int:
    return _require_int(value, label, minimum=0, maximum=10000)


def _derived_performance_bp(correct_count: int, wrong_count: int) -> int | None:
    answered = correct_count + wrong_count
    if answered == 0:
        return None
    return int(
        (Decimal(10000) * Decimal(correct_count) / Decimal(answered)).quantize(
            Decimal("1"), rounding=ROUND_HALF_UP
        )
    )


@dataclass(frozen=True, slots=True)
class TaskExecutionInput:
    target_slug: str
    source_plan_task_id: int
    sprint_action_id: int | None
    outcome: Outcome
    performed_on: date
    task_minutes: int
    exercise_minutes: int
    questions_total: int
    correct_count: int
    wrong_count: int
    doubt_count: int
    supplied_performance_bp: int | None
    energy_after: int | None
    notes: str

    def __post_init__(self) -> None:
        object.__setattr__(self, "target_slug", _non_empty(self.target_slug, "target slug"))
        object.__setattr__(
            self, "source_plan_task_id", _positive_int(self.source_plan_task_id, "source plan task id")
        )
        if self.sprint_action_id is not None:
            object.__setattr__(
                self, "sprint_action_id", _positive_int(self.sprint_action_id, "sprint action id")
            )
        if self.outcome not in OUTCOMES:
            raise ValueError("invalid outcome")
        performed_on = _date(self.performed_on, "performed on")
        if performed_on > date.today():
            raise ValueError("performed on cannot be in the future")
        object.__setattr__(self, "performed_on", performed_on)

        task_minutes = _require_int(self.task_minutes, "task minutes", maximum=720)
        exercise_minutes = _require_int(self.exercise_minutes, "exercise minutes", maximum=720)
        if exercise_minutes > task_minutes:
            raise ValueError("exercise minutes cannot exceed task minutes")
        object.__setattr__(self, "task_minutes", task_minutes)
        object.__setattr__(self, "exercise_minutes", exercise_minutes)

        questions_total = _require_int(self.questions_total, "questions total", maximum=10000)
        correct_count = _require_int(self.correct_count, "correct count", maximum=questions_total)
        wrong_count = _require_int(self.wrong_count, "wrong count", maximum=questions_total)
        doubt_count = _require_int(self.doubt_count, "doubt count", maximum=questions_total)
        if correct_count + wrong_count > questions_total:
            raise ValueError("correct and wrong counts cannot exceed questions total")
        object.__setattr__(self, "questions_total", questions_total)
        object.__setattr__(self, "correct_count", correct_count)
        object.__setattr__(self, "wrong_count", wrong_count)
        object.__setattr__(self, "doubt_count", doubt_count)

        supplied = (
            None
            if self.supplied_performance_bp is None
            else _basis_points(self.supplied_performance_bp, "supplied performance")
        )
        expected = _derived_performance_bp(correct_count, wrong_count)
        if supplied is not None and expected is None:
            raise ValueError("supplied performance is not allowed with empty answers")
        if supplied is not None and expected is not None and supplied != expected:
            raise ValueError("supplied performance does not match aggregate counts")
        object.__setattr__(self, "supplied_performance_bp", supplied)

        if self.energy_after is not None:
            object.__setattr__(
                self, "energy_after", _require_int(self.energy_after, "energy after", minimum=1, maximum=5)
            )
        if not isinstance(self.notes, str):
            raise ValueError("notes must be a string")

    @property
    def performance_bp(self) -> int | None:
        derived = _derived_performance_bp(self.correct_count, self.wrong_count)
        return self.supplied_performance_bp if derived is None else derived


@dataclass(frozen=True, slots=True)
class TaskExecution:
    id: int
    idempotency_key: str
    request_hash: str
    target_slug: str
    source_plan_task_id: int
    sprint_action_id: int | None
    outcome: Outcome
    performed_on: date
    task_minutes: int
    exercise_minutes: int
    questions_total: int
    correct_count: int
    wrong_count: int
    doubt_count: int
    performance_bp: int | None
    energy_after: int | None
    notes: str
    recorded_at: datetime
    version: int

    def __post_init__(self) -> None:
        object.__setattr__(self, "id", _positive_int(self.id, "execution id"))
        object.__setattr__(self, "idempotency_key", _non_empty(self.idempotency_key, "idempotency key"))
        if not isinstance(self.request_hash, str) or len(self.request_hash) != 64:
            raise ValueError("request hash must have length 64")
        task_input = TaskExecutionInput(
            target_slug=self.target_slug,
            source_plan_task_id=self.source_plan_task_id,
            sprint_action_id=self.sprint_action_id,
            outcome=self.outcome,
            performed_on=self.performed_on,
            task_minutes=self.task_minutes,
            exercise_minutes=self.exercise_minutes,
            questions_total=self.questions_total,
            correct_count=self.correct_count,
            wrong_count=self.wrong_count,
            doubt_count=self.doubt_count,
            supplied_performance_bp=self.performance_bp,
            energy_after=self.energy_after,
            notes=self.notes,
        )
        object.__setattr__(self, "target_slug", task_input.target_slug)
        object.__setattr__(self, "source_plan_task_id", task_input.source_plan_task_id)
        object.__setattr__(self, "sprint_action_id", task_input.sprint_action_id)
        object.__setattr__(self, "performed_on", task_input.performed_on)
        object.__setattr__(self, "task_minutes", task_input.task_minutes)
        object.__setattr__(self, "exercise_minutes", task_input.exercise_minutes)
        object.__setattr__(self, "questions_total", task_input.questions_total)
        object.__setattr__(self, "correct_count", task_input.correct_count)
        object.__setattr__(self, "wrong_count", task_input.wrong_count)
        object.__setattr__(self, "doubt_count", task_input.doubt_count)
        object.__setattr__(self, "performance_bp", task_input.performance_bp)
        object.__setattr__(self, "energy_after", task_input.energy_after)
        object.__setattr__(self, "notes", task_input.notes)
        if not isinstance(self.recorded_at, datetime) or self.recorded_at.tzinfo is None:
            raise ValueError("recorded at must be timezone-aware")
        object.__setattr__(self, "recorded_at", self.recorded_at.astimezone(UTC))
        object.__setattr__(self, "version", _positive_int(self.version, "version"))
