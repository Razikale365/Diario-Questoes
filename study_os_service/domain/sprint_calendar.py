from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from types import MappingProxyType
from typing import Literal, Mapping

from study_os_service.domain.sprint import (
    ExamSprintConfig,
    ExamSubjectProfile,
    SourcePlanTask,
)
from study_os_service.domain.sprint_evidence import SourcePlanCycle, SprintProjection


CapacityOrigin = Literal[
    "manual_date", "manual_weekday", "manual_global", "learned", "default"
]
CapacityScope = Literal["date", "weekday", "global"]
CapacityAvailability = Literal["default", "available", "unavailable"]
CalendarPrecision = Literal["exact", "provisional", "protected"]
CalendarPriorityTier = Literal["critical", "high", "maintenance", "protected"]
CalendarItemOrigin = Literal["source", "manual", "system"]
CalendarItemKind = Literal[
    "source_task", "manual", "intervention", "future_cycle_capacity"
]
CalendarItemState = Literal[
    "pending", "active", "completed", "failed", "ignored", "archived"
]

_CAPACITY_ORIGINS = {
    "manual_date",
    "manual_weekday",
    "manual_global",
    "learned",
    "default",
}
_PRECISIONS = {"exact", "provisional", "protected"}
_PRIORITIES = {"critical", "high", "maintenance", "protected"}
_ITEM_ORIGINS = {"source", "manual", "system"}
_ITEM_KINDS = {"source_task", "manual", "intervention", "future_cycle_capacity"}
_ITEM_STATES = {"pending", "active", "completed", "failed", "ignored", "archived"}
_ASSIGNMENT_KINDS = {
    "ls_execute",
    "ls_compress",
    "ls_defer",
    "microblock",
    "review",
    "simulation",
    "discursive",
    "minimum_viable",
    "manual",
    "future_cycle_capacity",
}


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


def _calendar_date(value: date, label: str) -> date:
    if isinstance(value, datetime) or not isinstance(value, date):
        raise ValueError(f"{label} must be a date")
    return value


def _utc(value: datetime, label: str) -> datetime:
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{label} must be timezone-aware UTC")
    if value.utcoffset() != timedelta(0):
        raise ValueError(f"{label} must be timezone-aware UTC")
    return value.astimezone(UTC)


def _tuple(value: tuple[object, ...], label: str) -> tuple[object, ...]:
    if not isinstance(value, tuple):
        raise ValueError(f"{label} must be a tuple")
    return value


def _freeze(value: object) -> object:
    if isinstance(value, Mapping):
        return MappingProxyType({str(key): _freeze(item) for key, item in value.items()})
    if isinstance(value, (list, tuple)):
        return tuple(_freeze(item) for item in value)
    if isinstance(value, set):
        return frozenset(_freeze(item) for item in value)
    return value


def _frozen_mapping(value: Mapping[str, object], label: str) -> Mapping[str, object]:
    if not isinstance(value, Mapping):
        raise ValueError(f"{label} must be a mapping")
    frozen = _freeze(value)
    if not isinstance(frozen, Mapping):
        raise ValueError(f"{label} must be a mapping")
    return frozen


@dataclass(frozen=True, slots=True)
class CapacityObservation:
    plan_date: date
    planned_minutes: int
    actual_minutes: int
    scheduled_actions: int
    completed_actions: int
    energy_level: int
    result_bearing: bool
    available: bool

    def __post_init__(self) -> None:
        object.__setattr__(self, "plan_date", _calendar_date(self.plan_date, "plan date"))
        _integer(self.planned_minutes, "planned minutes", 0, 960)
        _integer(self.actual_minutes, "actual minutes", 0, 960)
        _integer(self.scheduled_actions, "scheduled actions", 0, 100)
        _integer(self.completed_actions, "completed actions", 0, 100)
        if self.completed_actions > self.scheduled_actions:
            raise ValueError("completed actions cannot exceed scheduled actions")
        _integer(self.energy_level, "energy level", 1, 5)
        if not isinstance(self.result_bearing, bool) or not isinstance(self.available, bool):
            raise ValueError("observation flags must be boolean")
        if not self.available and (
            self.planned_minutes or self.actual_minutes or self.scheduled_actions
        ):
            raise ValueError("unavailable observation must have zero work")


@dataclass(frozen=True, slots=True)
class CapacityDefaults:
    ls_minutes: int
    extra_minutes: int
    energy_level: int

    def __post_init__(self) -> None:
        _integer(self.ls_minutes, "default LS minutes", 15, 720)
        _integer(self.extra_minutes, "default extra minutes", 0, 240)
        _integer(self.energy_level, "default energy", 1, 5)

    @property
    def total_minutes(self) -> int:
        return self.ls_minutes + self.extra_minutes


@dataclass(frozen=True, slots=True)
class CapacityOverride:
    scope_kind: CapacityScope
    scope_value: date | int | None
    availability: CapacityAvailability
    ls_minutes: int | None
    extra_minutes: int | None
    energy_level: int | None
    version: int

    def __post_init__(self) -> None:
        if self.scope_kind not in {"date", "weekday", "global"}:
            raise ValueError("invalid capacity override scope")
        if self.scope_kind == "date":
            _calendar_date(self.scope_value, "scope value")  # type: ignore[arg-type]
        elif self.scope_kind == "weekday":
            _integer(self.scope_value, "scope value", 0, 6)  # type: ignore[arg-type]
        elif self.scope_value is not None:
            raise ValueError("global scope value must be empty")
        if self.availability not in {"default", "available", "unavailable"}:
            raise ValueError("invalid capacity availability")
        if self.availability == "unavailable":
            if self.ls_minutes != 0 or self.extra_minutes != 0:
                raise ValueError("unavailable override requires zero minutes")
        else:
            if self.ls_minutes is not None:
                _integer(self.ls_minutes, "override LS minutes", 1, 720)
            if self.extra_minutes is not None:
                _integer(self.extra_minutes, "override extra minutes", 0, 240)
        if self.energy_level is not None:
            _integer(self.energy_level, "override energy", 1, 5)
        _integer(self.version, "override version", 1, 2_147_483_647)

    @property
    def origin(self) -> CapacityOrigin:
        return {
            "date": "manual_date",
            "weekday": "manual_weekday",
            "global": "manual_global",
        }[self.scope_kind]  # type: ignore[return-value]

    def applies_to(self, target: date) -> bool:
        if self.scope_kind == "date":
            return self.scope_value == target
        if self.scope_kind == "weekday":
            return self.scope_value == target.weekday()
        return True


@dataclass(frozen=True, slots=True)
class HorizonDayCapacity:
    plan_date: date
    ls_minutes: int
    extra_minutes: int
    energy_level: int
    available: bool
    origin: CapacityOrigin
    confidence_bp: int

    def __post_init__(self) -> None:
        object.__setattr__(self, "plan_date", _calendar_date(self.plan_date, "plan date"))
        _integer(self.ls_minutes, "LS minutes", 0, 720)
        _integer(self.extra_minutes, "extra minutes", 0, 240)
        _integer(self.energy_level, "energy level", 1, 5)
        if not isinstance(self.available, bool):
            raise ValueError("available must be boolean")
        if self.origin not in _CAPACITY_ORIGINS:
            raise ValueError("invalid capacity origin")
        _integer(self.confidence_bp, "capacity confidence", 0, 10000)
        if not self.available and (self.ls_minutes or self.extra_minutes):
            raise ValueError("unavailable day must have zero capacity")
        if self.available and self.total_minutes == 0:
            raise ValueError("available day must have capacity")

    @property
    def total_minutes(self) -> int:
        return self.ls_minutes + self.extra_minutes


@dataclass(frozen=True, slots=True)
class FutureCycleEnvelope:
    item_key: str
    plan_date: date
    expected_meta_number: int
    duration_minutes: int

    def __post_init__(self) -> None:
        object.__setattr__(self, "item_key", _text(self.item_key, "item key"))
        object.__setattr__(self, "plan_date", _calendar_date(self.plan_date, "plan date"))
        _integer(self.expected_meta_number, "expected meta number", 0, 1_000_000)
        _integer(self.duration_minutes, "duration minutes", 1, 720)


@dataclass(frozen=True, slots=True)
class LockedCalendarAssignment:
    item_key: str
    plan_date: date
    position: int
    duration_minutes: int
    precision: CalendarPrecision
    priority_tier: CalendarPriorityTier
    source_plan_task_id: int | None
    reason: str
    state: CalendarItemState = "pending"
    pinned: bool = True

    def __post_init__(self) -> None:
        object.__setattr__(self, "item_key", _text(self.item_key, "item key"))
        object.__setattr__(self, "plan_date", _calendar_date(self.plan_date, "plan date"))
        _integer(self.position, "position", 1, 10_000)
        _integer(self.duration_minutes, "duration minutes", 1, 720)
        if self.precision != "protected" or self.priority_tier != "protected":
            raise ValueError("locked assignment must be protected")
        if self.source_plan_task_id is not None:
            _integer(self.source_plan_task_id, "source plan task id", 1, 2_147_483_647)
        object.__setattr__(self, "reason", _text(self.reason, "lock reason"))
        if self.state not in _ITEM_STATES:
            raise ValueError("invalid locked item state")
        if self.pinned is not True:
            raise ValueError("locked assignment must be pinned")


@dataclass(frozen=True, slots=True)
class HorizonItemDraft:
    item_key: str
    origin: CalendarItemOrigin
    kind: CalendarItemKind
    source_plan_task_id: int | None
    subject_profile_id: int | None
    title: str
    expected_meta_number: int | None
    state: CalendarItemState = "pending"
    result: Mapping[str, object] = field(default_factory=dict)
    completed_at: datetime | None = None
    version: int = 1

    def __post_init__(self) -> None:
        object.__setattr__(self, "item_key", _text(self.item_key, "item key"))
        if self.origin not in _ITEM_ORIGINS or self.kind not in _ITEM_KINDS:
            raise ValueError("invalid calendar item origin or kind")
        if self.source_plan_task_id is not None:
            _integer(self.source_plan_task_id, "source plan task id", 1, 2_147_483_647)
        if self.subject_profile_id is not None:
            _integer(self.subject_profile_id, "subject profile id", 1, 2_147_483_647)
        object.__setattr__(self, "title", _text(self.title, "item title"))
        if self.expected_meta_number is not None:
            _integer(self.expected_meta_number, "expected meta number", 0, 1_000_000)
        if self.state not in _ITEM_STATES:
            raise ValueError("invalid calendar item state")
        object.__setattr__(self, "result", _frozen_mapping(self.result, "item result"))
        if self.completed_at is not None:
            object.__setattr__(self, "completed_at", _utc(self.completed_at, "completed at"))
        _integer(self.version, "item version", 1, 2_147_483_647)
        if self.kind == "source_task" and (
            self.origin != "source" or self.source_plan_task_id is None
        ):
            raise ValueError("source task item requires source task identity")
        if self.kind == "manual" and self.origin != "manual":
            raise ValueError("manual item requires manual origin")
        if self.kind == "future_cycle_capacity" and (
            self.origin != "system"
            or self.source_plan_task_id is not None
            or self.subject_profile_id is not None
            or self.state != "pending"
            or bool(self.result)
            or self.completed_at is not None
        ):
            raise ValueError("placeholder cannot claim source, subject, result, or completion")


@dataclass(frozen=True, slots=True)
class HorizonAssignmentDraft:
    item_key: str
    source_plan_task_id: int | None
    kind: str
    plan_date: date
    position: int
    duration_minutes: int
    precision: CalendarPrecision
    priority_tier: CalendarPriorityTier
    reasons: tuple[str, ...]
    pinned: bool
    action: object | None
    expected_gain_milli: int
    replaces_placeholder_item_key: str | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "item_key", _text(self.item_key, "item key"))
        if self.source_plan_task_id is not None:
            _integer(self.source_plan_task_id, "source plan task id", 1, 2_147_483_647)
        if self.kind not in _ASSIGNMENT_KINDS:
            raise ValueError("invalid assignment kind")
        object.__setattr__(self, "plan_date", _calendar_date(self.plan_date, "plan date"))
        _integer(self.position, "position", 1, 10_000)
        _integer(self.duration_minutes, "duration minutes", 1, 720)
        if self.precision not in _PRECISIONS or self.priority_tier not in _PRIORITIES:
            raise ValueError("invalid assignment precision or priority")
        _tuple(self.reasons, "assignment reasons")
        if any(not isinstance(reason, str) or not reason.strip() for reason in self.reasons):
            raise ValueError("assignment reasons must be non-empty strings")
        if not isinstance(self.pinned, bool):
            raise ValueError("pinned must be boolean")
        _integer(self.expected_gain_milli, "expected gain", 0, 2_147_483_647)
        if self.replaces_placeholder_item_key is not None:
            object.__setattr__(
                self,
                "replaces_placeholder_item_key",
                _text(self.replaces_placeholder_item_key, "replaced placeholder key"),
            )
        if self.kind == "future_cycle_capacity" and (
            self.source_plan_task_id is not None
            or self.action is not None
            or self.expected_gain_milli != 0
            or self.precision != "provisional"
        ):
            raise ValueError("placeholder assignment cannot be executable or claim gain")


@dataclass(frozen=True, slots=True)
class HorizonDayDraft:
    plan_date: date
    precision: CalendarPrecision
    capacity: HorizonDayCapacity
    assignments: tuple[HorizonAssignmentDraft, ...]
    warnings: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        object.__setattr__(self, "plan_date", _calendar_date(self.plan_date, "plan date"))
        if self.precision not in _PRECISIONS:
            raise ValueError("invalid day precision")
        if not isinstance(self.capacity, HorizonDayCapacity):
            raise ValueError("day capacity is required")
        if self.capacity.plan_date != self.plan_date:
            raise ValueError("capacity date must match day")
        _tuple(self.assignments, "day assignments")
        if any(not isinstance(item, HorizonAssignmentDraft) for item in self.assignments):
            raise ValueError("day assignments must contain assignment drafts")
        if any(item.plan_date != self.plan_date for item in self.assignments):
            raise ValueError("assignment date must match day")
        positions = tuple(item.position for item in self.assignments)
        if len(set(positions)) != len(positions):
            raise ValueError("day assignments require unique positions")
        keys = tuple(item.item_key for item in self.assignments)
        if len(set(keys)) != len(keys):
            raise ValueError("day assignments require unique item keys")
        _tuple(self.warnings, "day warnings")
        if any(not isinstance(item, str) or not item.strip() for item in self.warnings):
            raise ValueError("day warnings must be non-empty strings")

    @property
    def reserved_minutes(self) -> int:
        return sum(item.duration_minutes for item in self.assignments)

    @property
    def overage_minutes(self) -> int:
        return max(0, self.reserved_minutes - self.capacity.total_minutes)


@dataclass(frozen=True, slots=True)
class SprintHorizonRequest:
    target_slug: str
    starts_on: date
    ends_on: date
    capacities: tuple[HorizonDayCapacity, ...]
    max_tasks_per_day: int = 4

    def __post_init__(self) -> None:
        object.__setattr__(self, "target_slug", _text(self.target_slug, "target"))
        starts_on = _calendar_date(self.starts_on, "horizon start")
        ends_on = _calendar_date(self.ends_on, "horizon end")
        expected = tuple(
            starts_on + timedelta(days=offset)
            for offset in range((ends_on - starts_on).days + 1)
        )
        if not 1 <= len(expected) <= 15:
            raise ValueError("horizon must contain between 1 and 15 days")
        _tuple(self.capacities, "horizon capacities")
        if tuple(item.plan_date for item in self.capacities) != expected:
            raise ValueError("horizon capacities must be contiguous")
        _integer(self.max_tasks_per_day, "tasks per day", 1, 12)


@dataclass(frozen=True, slots=True)
class SprintHorizonSnapshot:
    target_slug: str
    planning_cutoff: datetime
    config: ExamSprintConfig
    subjects: tuple[ExamSubjectProfile, ...]
    projection: SprintProjection
    source_tasks: tuple[SourcePlanTask, ...]
    cycles: tuple[SourcePlanCycle, ...]
    stable_items: tuple[HorizonItemDraft, ...]
    locked_assignments: tuple[LockedCalendarAssignment, ...]
    capacity_observations: tuple[CapacityObservation, ...]
    override_versions: Mapping[str, int]

    def __post_init__(self) -> None:
        object.__setattr__(self, "target_slug", _text(self.target_slug, "target"))
        object.__setattr__(
            self, "planning_cutoff", _utc(self.planning_cutoff, "planning cutoff")
        )
        if not isinstance(self.config, ExamSprintConfig):
            raise ValueError("sprint config is required")
        if not isinstance(self.projection, SprintProjection):
            raise ValueError("sprint projection is required")
        for value, expected_type, label in (
            (self.subjects, ExamSubjectProfile, "subjects"),
            (self.source_tasks, SourcePlanTask, "source tasks"),
            (self.cycles, SourcePlanCycle, "cycles"),
            (self.stable_items, HorizonItemDraft, "stable items"),
            (self.locked_assignments, LockedCalendarAssignment, "locked assignments"),
            (self.capacity_observations, CapacityObservation, "capacity observations"),
        ):
            _tuple(value, label)
            if any(not isinstance(item, expected_type) for item in value):
                raise ValueError(f"{label} contain invalid records")
        if self.config.target_slug != self.target_slug or self.projection.target_slug != self.target_slug:
            raise ValueError("snapshot target must match config and projection")
        target_records = (*self.subjects, *self.source_tasks, *self.cycles)
        if any(item.target_slug != self.target_slug for item in target_records):
            raise ValueError("snapshot records cannot cross targets")
        if not isinstance(self.override_versions, Mapping):
            raise ValueError("override versions must be a mapping")
        versions: dict[str, object] = {}
        for key, version in self.override_versions.items():
            versions[_text(key, "override key")] = _integer(
                version, "override version", 1, 2_147_483_647
            )
        object.__setattr__(self, "override_versions", _frozen_mapping(versions, "override versions"))


@dataclass(frozen=True, slots=True)
class SprintHorizonDraft:
    target_slug: str
    starts_on: date
    ends_on: date
    exact_through: date
    planning_cutoff: datetime
    algorithm_version: str
    days: tuple[HorizonDayDraft, ...]
    items: tuple[HorizonItemDraft, ...]
    warnings: tuple[str, ...] = ()
    shortfalls: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        object.__setattr__(self, "target_slug", _text(self.target_slug, "target"))
        object.__setattr__(self, "starts_on", _calendar_date(self.starts_on, "horizon start"))
        object.__setattr__(self, "ends_on", _calendar_date(self.ends_on, "horizon end"))
        object.__setattr__(self, "exact_through", _calendar_date(self.exact_through, "exact through"))
        object.__setattr__(
            self, "planning_cutoff", _utc(self.planning_cutoff, "planning cutoff")
        )
        object.__setattr__(
            self, "algorithm_version", _text(self.algorithm_version, "algorithm version")
        )
        _tuple(self.days, "horizon days")
        _tuple(self.items, "horizon items")
        if any(not isinstance(item, HorizonDayDraft) for item in self.days):
            raise ValueError("horizon days contain invalid records")
        if any(not isinstance(item, HorizonItemDraft) for item in self.items):
            raise ValueError("horizon items contain invalid records")
        expected_dates = tuple(
            self.starts_on + timedelta(days=offset)
            for offset in range((self.ends_on - self.starts_on).days + 1)
        )
        if tuple(day.plan_date for day in self.days) != expected_dates:
            raise ValueError("horizon days must be contiguous")
        item_keys = tuple(item.item_key for item in self.items)
        if len(set(item_keys)) != len(item_keys):
            raise ValueError("horizon items require unique keys")
        for value, label in ((self.warnings, "warnings"), (self.shortfalls, "shortfalls")):
            _tuple(value, label)
            if any(not isinstance(item, str) or not item.strip() for item in value):
                raise ValueError(f"{label} must contain non-empty strings")
