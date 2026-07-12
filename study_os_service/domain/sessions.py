from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal


ProgressStatus = Literal["unread", "in_progress", "covered", "stale", "weak", "strong"]
SessionState = Literal["active", "finished"]
SessionOutcome = Literal["partial", "completed", "failed", "skipped", "abandoned"]
SkipReason = Literal[
    "lack_of_time",
    "fatigue",
    "wrong_material",
    "blocked_prerequisite",
    "too_difficult",
    "other",
]

_PROGRESS_STATUSES = {"unread", "in_progress", "covered", "stale", "weak", "strong"}
_SESSION_STATES = {"active", "finished"}
_SESSION_OUTCOMES = {"partial", "completed", "failed", "skipped", "abandoned"}
_SKIP_REASONS = {
    "lack_of_time",
    "fatigue",
    "wrong_material",
    "blocked_prerequisite",
    "too_difficult",
    "other",
}


def _positive_integer(value: int, label: str) -> None:
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise ValueError(f"{label} must be a positive integer")


def _non_negative_integer(value: int, label: str) -> None:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError(f"{label} must be a non-negative integer")


def _datetime(value: datetime | None, label: str) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{label} must be timezone-aware")
    return value.astimezone(UTC)


@dataclass(frozen=True, slots=True)
class ProgressState:
    id: int
    lesson_id: int
    material_id: int
    status: ProgressStatus
    cursor_page: int
    furthest_page: int
    completed_at: datetime | None
    last_seen_at: datetime | None
    confidence: float
    total_seconds: int
    session_count: int
    version: int

    def __post_init__(self) -> None:
        _positive_integer(self.id, "id")
        _positive_integer(self.lesson_id, "lesson id")
        _positive_integer(self.material_id, "material id")
        if self.status not in _PROGRESS_STATUSES:
            raise ValueError("invalid progress status")
        _positive_integer(self.cursor_page, "cursor page")
        _positive_integer(self.furthest_page, "furthest page")
        if self.furthest_page < self.cursor_page:
            raise ValueError("furthest page cannot precede cursor page")
        if isinstance(self.confidence, bool) or not isinstance(
            self.confidence, (int, float)
        ):
            raise ValueError("confidence must be numeric")
        if not 0 <= float(self.confidence) <= 1:
            raise ValueError("confidence must be between 0 and 1")
        _non_negative_integer(self.total_seconds, "total seconds")
        _non_negative_integer(self.session_count, "session count")
        _positive_integer(self.version, "version")
        object.__setattr__(
            self, "completed_at", _datetime(self.completed_at, "completed at")
        )
        object.__setattr__(
            self, "last_seen_at", _datetime(self.last_seen_at, "last seen at")
        )
        object.__setattr__(self, "confidence", float(self.confidence))


@dataclass(frozen=True, slots=True)
class StudySession:
    id: int
    idempotency_key: str
    target_slug: str
    lesson_id: int
    material_id: int
    state: SessionState
    started_at: datetime
    ended_at: datetime | None
    elapsed_seconds: int
    start_page: int
    end_page: int | None
    questions_done: int
    correct_count: int
    wrong_count: int
    doubt_count: int
    favorite_count: int
    outcome: SessionOutcome | None
    skip_reason: SkipReason | None
    notes: str
    version: int

    def __post_init__(self) -> None:
        _positive_integer(self.id, "id")
        key = self.idempotency_key.strip()
        target = self.target_slug.strip()
        if not key:
            raise ValueError("idempotency key is required")
        if not target:
            raise ValueError("target is required")
        object.__setattr__(self, "idempotency_key", key)
        object.__setattr__(self, "target_slug", target)
        _positive_integer(self.lesson_id, "lesson id")
        _positive_integer(self.material_id, "material id")
        if self.state not in _SESSION_STATES:
            raise ValueError("invalid session state")
        if self.outcome is not None and self.outcome not in _SESSION_OUTCOMES:
            raise ValueError("invalid session outcome")
        if self.skip_reason is not None and self.skip_reason not in _SKIP_REASONS:
            raise ValueError("invalid skip reason")

        started_at = _datetime(self.started_at, "started at")
        ended_at = _datetime(self.ended_at, "ended at")
        object.__setattr__(self, "started_at", started_at)
        object.__setattr__(self, "ended_at", ended_at)
        if ended_at is not None and ended_at < started_at:
            raise ValueError("ended at cannot precede started at")

        _non_negative_integer(self.elapsed_seconds, "elapsed seconds")
        _positive_integer(self.start_page, "start page")
        if self.end_page is not None:
            _positive_integer(self.end_page, "end page")
            if self.end_page < self.start_page:
                raise ValueError("end page cannot precede start page")
        for value, label in (
            (self.questions_done, "questions done"),
            (self.correct_count, "correct count"),
            (self.wrong_count, "wrong count"),
            (self.doubt_count, "doubt count"),
            (self.favorite_count, "favorite count"),
        ):
            _non_negative_integer(value, label)
        _positive_integer(self.version, "version")

        if self.state == "active":
            if self.outcome is not None or ended_at is not None:
                raise ValueError("active session cannot have an outcome or end time")
            if self.skip_reason is not None:
                raise ValueError("active session cannot have a skip reason")
        else:
            if self.outcome is None or ended_at is None:
                raise ValueError("finished session requires an outcome and end time")

        if self.outcome == "skipped":
            if self.skip_reason is None:
                raise ValueError("skipped session requires a skip reason")
        elif self.skip_reason is not None:
            raise ValueError("only skipped sessions may have a skip reason")
        if self.outcome in {"partial", "completed"} and self.end_page is None:
            raise ValueError(f"{self.outcome} session requires an end page")
