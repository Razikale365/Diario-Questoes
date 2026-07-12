from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime
import re
from types import MappingProxyType
from typing import Literal, Mapping


LearningSourceKind = Literal[
    "planner_block", "study_session", "legacy_aggregate", "manual"
]
LearningEventKind = Literal[
    "theory", "questions", "review", "coverage_audit"
]
LearningOutcome = Literal[
    "completed", "partial", "skipped", "failed", "imported", "audited"
]
ReviewQueueState = Literal["pending", "deferred", "resolved"]
CoverageStatus = Literal[
    "unread", "in_progress", "covered", "stale", "weak", "strong"
]

_SOURCE_KINDS = {
    "planner_block", "study_session", "legacy_aggregate", "manual"
}
_EVENT_KINDS = {"theory", "questions", "review", "coverage_audit"}
_OUTCOMES = {"completed", "partial", "skipped", "failed", "imported", "audited"}
_REVIEW_STATES = {"pending", "deferred", "resolved"}
_COVERAGE_STATUSES = {
    "unread", "in_progress", "covered", "stale", "weak", "strong"
}
_PROPRIETARY_KEYS = {
    "question",
    "questiontext",
    "questionstatement",
    "questioncontent",
    "statement",
    "enunciado",
    "alternative",
    "alternatives",
    "option",
    "options",
    "answer",
    "correctanswer",
    "answerkey",
    "gabarito",
    "comment",
    "comments",
    "commenthtml",
    "comentario",
    "observation",
    "observations",
    "observacao",
    "html",
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


def _basis_points(value: int, label: str) -> int:
    resolved = _non_negative(value, label)
    if resolved > 10000:
        raise ValueError(f"{label} must be basis points")
    return resolved


def _aware(value: datetime | None, label: str) -> datetime | None:
    if value is None:
        return None
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{label} must be timezone-aware")
    return value.astimezone(UTC)


def _day(value: date | None, label: str) -> date | None:
    if value is None:
        return None
    if isinstance(value, datetime) or not isinstance(value, date):
        raise ValueError(f"{label} must be a date")
    return value


def _normalized_key(value: object) -> str:
    return re.sub(r"[^a-z0-9]", "", str(value).lower())


def _reject_proprietary_fields(value: object) -> None:
    if isinstance(value, Mapping):
        for key, nested in value.items():
            if _normalized_key(key) in _PROPRIETARY_KEYS:
                raise ValueError("proprietary question fields are not allowed")
            _reject_proprietary_fields(nested)
    elif isinstance(value, (tuple, list)):
        for nested in value:
            _reject_proprietary_fields(nested)


def _evidence(value: Mapping[str, object]) -> Mapping[str, object]:
    if not isinstance(value, Mapping):
        raise ValueError("evidence must be a mapping")
    resolved = dict(value)
    _reject_proprietary_fields(resolved)
    return MappingProxyType(resolved)


@dataclass(frozen=True, slots=True)
class LearningEvent:
    id: int
    idempotency_key: str
    target_slug: str
    topic_target_slug: str
    target_topic_id: int
    source_kind: LearningSourceKind
    source_id: str
    event_kind: LearningEventKind
    outcome: LearningOutcome
    questions_done: int
    correct_count: int
    wrong_count: int
    doubt_count: int
    favorite_count: int
    elapsed_seconds: int
    start_page: int | None
    end_page: int | None
    occurred_at: datetime
    evidence: Mapping[str, object]
    created_at: datetime

    def __post_init__(self) -> None:
        _positive(self.id, "id")
        object.__setattr__(
            self, "idempotency_key", _text(self.idempotency_key, "idempotency key")
        )
        object.__setattr__(self, "target_slug", _text(self.target_slug, "target"))
        object.__setattr__(
            self,
            "topic_target_slug",
            _text(self.topic_target_slug, "topic target"),
        )
        _positive(self.target_topic_id, "target topic id")
        if self.source_kind not in _SOURCE_KINDS:
            raise ValueError("invalid learning source kind")
        object.__setattr__(self, "source_id", _text(self.source_id, "source id"))
        if self.event_kind not in _EVENT_KINDS:
            raise ValueError("invalid learning event kind")
        if self.outcome not in _OUTCOMES:
            raise ValueError("invalid learning outcome")
        counts = {
            "questions done": _non_negative(self.questions_done, "questions done"),
            "correct count": _non_negative(self.correct_count, "correct count"),
            "wrong count": _non_negative(self.wrong_count, "wrong count"),
            "doubt count": _non_negative(self.doubt_count, "doubt count"),
            "favorite count": _non_negative(self.favorite_count, "favorite count"),
        }
        if counts["correct count"] + counts["wrong count"] > counts["questions done"]:
            raise ValueError("result counts exceed questions done")
        if self.event_kind in {"theory", "coverage_audit"} and any(counts.values()):
            raise ValueError("theory and coverage audit events cannot contain question counts")
        if (
            self.event_kind in {"questions", "review"}
            and self.outcome != "skipped"
            and counts["questions done"] < 1
        ):
            raise ValueError("question and review events require a result count")
        if self.outcome == "skipped" and any(counts.values()):
            raise ValueError("skipped event cannot contain result counts")
        if self.outcome == "partial" and self.event_kind != "theory":
            raise ValueError("partial outcome is only valid for theory")
        _non_negative(self.elapsed_seconds, "elapsed seconds")
        if self.event_kind != "theory" and (
            self.start_page is not None or self.end_page is not None
        ):
            raise ValueError("page evidence is only valid for theory")
        if (self.start_page is None) != (self.end_page is None):
            raise ValueError("start and end page must be provided together")
        if self.start_page is not None and self.end_page is not None:
            _positive(self.start_page, "start page")
            _positive(self.end_page, "end page")
            if self.end_page < self.start_page:
                raise ValueError("end page cannot precede start page")
        object.__setattr__(self, "occurred_at", _aware(self.occurred_at, "occurred at"))
        object.__setattr__(self, "evidence", _evidence(self.evidence))
        object.__setattr__(self, "created_at", _aware(self.created_at, "created at"))


@dataclass(frozen=True, slots=True)
class TopicLearningState:
    target_slug: str
    topic_target_slug: str
    target_topic_id: int
    mastery_bp: int
    confidence_bp: int
    coverage_status: CoverageStatus
    review_debt_bp: int
    last_activity_at: datetime | None
    last_success_at: datetime | None
    next_review_date: date | None
    stale_at: date | None
    success_streak: int
    failure_streak: int
    event_cursor: int
    version: int

    def __post_init__(self) -> None:
        object.__setattr__(self, "target_slug", _text(self.target_slug, "target"))
        object.__setattr__(
            self,
            "topic_target_slug",
            _text(self.topic_target_slug, "topic target"),
        )
        _positive(self.target_topic_id, "target topic id")
        _basis_points(self.mastery_bp, "mastery")
        _basis_points(self.confidence_bp, "confidence")
        if self.coverage_status not in _COVERAGE_STATUSES:
            raise ValueError("invalid coverage status")
        _basis_points(self.review_debt_bp, "review debt")
        activity = _aware(self.last_activity_at, "last activity")
        success = _aware(self.last_success_at, "last success")
        object.__setattr__(self, "last_activity_at", activity)
        object.__setattr__(self, "last_success_at", success)
        if success is not None and activity is None:
            raise ValueError("last success requires last activity")
        if success is not None and activity is not None and success > activity:
            raise ValueError("last success cannot follow last activity")
        object.__setattr__(
            self, "next_review_date", _day(self.next_review_date, "next review date")
        )
        object.__setattr__(self, "stale_at", _day(self.stale_at, "stale at"))
        _non_negative(self.success_streak, "success streak")
        _non_negative(self.failure_streak, "failure streak")
        _non_negative(self.event_cursor, "event cursor")
        _positive(self.version, "version")


@dataclass(frozen=True, slots=True)
class ReviewQueueItem:
    id: int
    target_slug: str
    topic_target_slug: str
    target_topic_id: int
    due_date: date
    state: ReviewQueueState
    bounded_questions: int
    trigger_event_ids: tuple[int, ...]
    reason: str
    debt_bp: int
    attempt_count: int
    resolved_event_id: int | None
    version: int
    created_at: datetime
    updated_at: datetime

    def __post_init__(self) -> None:
        _positive(self.id, "id")
        object.__setattr__(self, "target_slug", _text(self.target_slug, "target"))
        object.__setattr__(
            self,
            "topic_target_slug",
            _text(self.topic_target_slug, "topic target"),
        )
        _positive(self.target_topic_id, "target topic id")
        resolved_due = _day(self.due_date, "due date")
        if resolved_due is None:
            raise ValueError("due date is required")
        if self.state not in _REVIEW_STATES:
            raise ValueError("invalid review queue state")
        questions = _positive(self.bounded_questions, "bounded questions")
        if not 5 <= questions <= 10:
            raise ValueError("bounded questions must be between 5 and 10")
        if not isinstance(self.trigger_event_ids, tuple) or not self.trigger_event_ids:
            raise ValueError("trigger event ids must be a non-empty tuple")
        for event_id in self.trigger_event_ids:
            _positive(event_id, "trigger event id")
        if len(set(self.trigger_event_ids)) != len(self.trigger_event_ids):
            raise ValueError("trigger event ids must be unique")
        object.__setattr__(self, "reason", _text(self.reason, "review reason"))
        _basis_points(self.debt_bp, "review debt")
        _non_negative(self.attempt_count, "attempt count")
        if self.state == "resolved":
            if self.resolved_event_id is None:
                raise ValueError("resolved review requires a resolved event")
            _positive(self.resolved_event_id, "resolved event id")
        elif self.resolved_event_id is not None:
            raise ValueError("unresolved review cannot contain a resolved event")
        _positive(self.version, "version")
        created = _aware(self.created_at, "created at")
        updated = _aware(self.updated_at, "updated at")
        object.__setattr__(self, "created_at", created)
        object.__setattr__(self, "updated_at", updated)
        if updated < created:
            raise ValueError("updated at cannot precede created at")
