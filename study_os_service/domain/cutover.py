from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime
import hashlib
import json
import math
import re
from typing import Any
from urllib.parse import urlparse


BROWSER_MIGRATION_SCHEMA = "study-os.browser-migration.v1"
SUPPORTED_TARGETS = {
    "bacen_economia_financas",
    "rfb_auditor",
    "rfb_analista",
    "sefaz_ce",
}

_SENSITIVE_KEYS = {
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
    "cookie",
    "cookies",
    "credential",
    "credentials",
    "password",
    "senha",
    "token",
    "accesstoken",
    "refreshtoken",
    "authorization",
    "apikey",
}
_COVERAGE_STATUSES = {"unread", "in_progress", "covered", "stale", "weak", "strong"}
_TRANSFER_KINDS = {"target_specific", "shared", "partial"}
_PLANNER_SOURCE_KINDS = {"course", "tec", "ls", "trilha", "manual", "bizu"}
_STRATEGY_SOURCE_KINDS = {"trilha", "ls", "andrety", "tec", "manual"}
_CONTENT_ROLES = {
    "review_support",
    "question_practice",
    "schedule_advice",
    "incidence_signal",
}
_TASK_STATUSES = {"pending", "started", "completed", "ignored", "archived"}
_EVENT_KINDS = {"questions", "review"}


def _normalized_key(value: object) -> str:
    return re.sub(r"[^a-z0-9]", "", str(value).casefold())


def _reject_sensitive_fields(value: object) -> None:
    if isinstance(value, Mapping):
        for key, nested in value.items():
            if _normalized_key(key) in _SENSITIVE_KEYS:
                raise ValueError("proprietary or secret fields are not allowed")
            _reject_sensitive_fields(nested)
    elif isinstance(value, Sequence) and not isinstance(value, (str, bytes)):
        for nested in value:
            _reject_sensitive_fields(nested)


def _object(value: object, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object")
    return value


def _strict(value: Mapping[str, object], allowed: set[str], label: str) -> None:
    unsupported = sorted(set(value) - allowed)
    if unsupported:
        raise ValueError(
            f"unsupported {label} fields: {', '.join(unsupported)}"
        )


def _array(value: object, label: str) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        raise ValueError(f"{label} must be an array")
    return [_object(item, f"{label} item") for item in value]


def _text(value: object, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{label} is required")
    return value.strip()


def _optional_text(value: object, label: str) -> str | None:
    return None if value is None else _text(value, label)


def _integer(
    value: object,
    label: str,
    minimum: int = 0,
    maximum: int | None = None,
) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise ValueError(f"{label} must be an integer of at least {minimum}")
    if maximum is not None and value > maximum:
        raise ValueError(f"{label} must be at most {maximum}")
    return value


def _optional_integer(value: object, label: str, minimum: int = 1) -> int | None:
    return None if value is None else _integer(value, label, minimum)


def _number(value: object, label: str, minimum: float, maximum: float) -> float:
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(value)
        or value < minimum
        or value > maximum
    ):
        raise ValueError(f"{label} must be between {minimum:g} and {maximum:g}")
    return value


def _boolean(value: object, label: str) -> bool:
    if not isinstance(value, bool):
        raise ValueError(f"{label} must be boolean")
    return value


def _target(value: object, label: str) -> str:
    resolved = _text(value, label)
    if resolved not in SUPPORTED_TARGETS:
        raise ValueError(f"unsupported target: {resolved}")
    return resolved


def _timestamp(value: object, label: str) -> datetime:
    if not isinstance(value, str):
        raise ValueError(f"{label} must be an ISO timestamp")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(f"{label} must be an ISO timestamp") from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError(f"{label} must include a timezone")
    return parsed.astimezone(UTC)


def _optional_date(value: object, label: str) -> date | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError(f"{label} must use YYYY-MM-DD")
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError(f"{label} must use YYYY-MM-DD") from exc


def _url(value: object, label: str) -> str:
    resolved = _text(value, label)
    parsed = urlparse(resolved)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError(f"{label} must be an HTTP URL")
    return resolved


def _optional_url(value: object, label: str) -> str | None:
    return None if value is None else _url(value, label)


def _text_list(value: object, label: str, *, urls: bool = False) -> tuple[str, ...]:
    if not isinstance(value, list):
        raise ValueError(f"{label} must be an array")
    resolved = tuple(
        _url(item, f"{label} item") if urls else _text(item, f"{label} item")
        for item in value
    )
    if len(set(resolved)) != len(resolved):
        raise ValueError(f"{label} must not contain duplicates")
    return resolved


def _metadata(value: object, label: str) -> dict[str, Any]:
    resolved = _object(value, label)
    _reject_sensitive_fields(resolved)
    try:
        encoded = json.dumps(
            resolved,
            ensure_ascii=True,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        )
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{label} must contain JSON values") from exc
    return dict(json.loads(encoded))


def _iso(value: datetime) -> str:
    return value.astimezone(UTC).isoformat()


@dataclass(frozen=True, slots=True)
class LegacyTargetProfile:
    legacy_id: str
    target_slug: str
    display_name: str
    institution: str
    role: str
    banca: str
    phase: str
    deadline: date | None
    daily_quota: int
    priority_score: int
    source_urls: tuple[str, ...]
    notes: str
    active: bool

    def to_payload(self) -> dict[str, Any]:
        return {
            "legacyId": self.legacy_id,
            "targetSlug": self.target_slug,
            "displayName": self.display_name,
            "institution": self.institution,
            "role": self.role,
            "banca": self.banca,
            "phase": self.phase,
            "deadline": self.deadline.isoformat() if self.deadline else None,
            "dailyQuota": self.daily_quota,
            "priorityScore": self.priority_score,
            "sourceUrls": list(self.source_urls),
            "notes": self.notes,
            "active": self.active,
        }


@dataclass(frozen=True, slots=True)
class LegacyCoverageRow:
    legacy_id: str
    target_slug: str
    discipline: str
    topic: str
    coverage_status: str
    edital_weight: float
    incidence: float
    tier: int
    banca_fit: float
    overlap_value: float
    transfer_kind: str
    source_kind: str
    planned_questions: int
    review_debt: float
    notes: str
    active: bool

    def to_payload(self) -> dict[str, Any]:
        return {
            "legacyId": self.legacy_id,
            "targetSlug": self.target_slug,
            "discipline": self.discipline,
            "topic": self.topic,
            "coverageStatus": self.coverage_status,
            "editalWeight": self.edital_weight,
            "incidence": self.incidence,
            "tier": self.tier,
            "bancaFit": self.banca_fit,
            "overlapValue": self.overlap_value,
            "transferKind": self.transfer_kind,
            "sourceKind": self.source_kind,
            "plannedQuestions": self.planned_questions,
            "reviewDebt": self.review_debt,
            "notes": self.notes,
            "active": self.active,
        }


@dataclass(frozen=True, slots=True)
class LegacyLsTask:
    legacy_id: str
    source_target_slug: str
    target_slug: str
    discipline: str
    topic_hint: str
    order: int
    task_kind: str
    status: str
    scheduled_date: date | None
    metadata: dict[str, Any]

    def to_payload(self) -> dict[str, Any]:
        return {
            "legacyId": self.legacy_id,
            "sourceTargetSlug": self.source_target_slug,
            "targetSlug": self.target_slug,
            "discipline": self.discipline,
            "topicHint": self.topic_hint,
            "order": self.order,
            "taskKind": self.task_kind,
            "status": self.status,
            "scheduledDate": (
                self.scheduled_date.isoformat() if self.scheduled_date else None
            ),
            "metadata": self.metadata,
        }


@dataclass(frozen=True, slots=True)
class LegacySourceSignal:
    legacy_id: str
    source_target_slug: str
    target_slug: str
    source_key: str
    source_kind: str
    display_name: str
    trust_tier: int
    discipline: str
    topic_hint: str
    order: int
    content_role: str
    target_topic_id: int | None
    transfer_kind: str
    incidence_bp: int
    banca: str
    edition: str
    notes: str
    external_url: str | None
    external_id: str | None
    metadata: dict[str, Any]

    def to_payload(self) -> dict[str, Any]:
        return {
            "legacyId": self.legacy_id,
            "sourceTargetSlug": self.source_target_slug,
            "targetSlug": self.target_slug,
            "sourceKey": self.source_key,
            "sourceKind": self.source_kind,
            "displayName": self.display_name,
            "trustTier": self.trust_tier,
            "discipline": self.discipline,
            "topicHint": self.topic_hint,
            "order": self.order,
            "contentRole": self.content_role,
            "targetTopicId": self.target_topic_id,
            "transferKind": self.transfer_kind,
            "incidenceBp": self.incidence_bp,
            "banca": self.banca,
            "edition": self.edition,
            "notes": self.notes,
            "externalUrl": self.external_url,
            "externalId": self.external_id,
            "metadata": self.metadata,
        }


@dataclass(frozen=True, slots=True)
class LegacyLearningItem:
    legacy_id: str
    target_slug: str
    target_topic_id: int | None
    discipline: str
    topic: str
    event_kind: str
    occurred_at: datetime
    source_date: date | None
    questions_done: int
    correct_count: int
    wrong_count: int
    doubt_count: int
    favorite_count: int
    source_label: str
    banca: str
    tags: tuple[str, ...]

    def to_payload(self) -> dict[str, Any]:
        return {
            "legacyId": self.legacy_id,
            "targetSlug": self.target_slug,
            "targetTopicId": self.target_topic_id,
            "discipline": self.discipline,
            "topic": self.topic,
            "eventKind": self.event_kind,
            "occurredAt": _iso(self.occurred_at),
            "sourceDate": self.source_date.isoformat() if self.source_date else None,
            "questionsDone": self.questions_done,
            "correctCount": self.correct_count,
            "wrongCount": self.wrong_count,
            "doubtCount": self.doubt_count,
            "favoriteCount": self.favorite_count,
            "sourceLabel": self.source_label,
            "banca": self.banca,
            "tags": list(self.tags),
        }


@dataclass(frozen=True, slots=True)
class LegacyBrowserBundle:
    schema: str
    migration_id: str
    exported_at: datetime
    active_target_slug: str
    target_profiles: tuple[LegacyTargetProfile, ...]
    coverage_rows: tuple[LegacyCoverageRow, ...]
    ls_tasks: tuple[LegacyLsTask, ...]
    source_signals: tuple[LegacySourceSignal, ...]
    learning_items: tuple[LegacyLearningItem, ...]

    @classmethod
    def from_payload(cls, payload: object) -> "LegacyBrowserBundle":
        _reject_sensitive_fields(payload)
        value = _object(payload, "browser bundle")
        _strict(
            value,
            {
                "schema",
                "migrationId",
                "exportedAt",
                "activeTargetSlug",
                "targetProfiles",
                "coverageRows",
                "lsTasks",
                "sourceSignals",
                "learningItems",
            },
            "browser bundle",
        )
        schema = _text(value.get("schema"), "schema")
        if schema != BROWSER_MIGRATION_SCHEMA:
            raise ValueError("unsupported browser migration schema")
        bundle = cls(
            schema=schema,
            migration_id=_text(value.get("migrationId"), "migrationId"),
            exported_at=_timestamp(value.get("exportedAt"), "exportedAt"),
            active_target_slug=_target(
                value.get("activeTargetSlug"), "activeTargetSlug"
            ),
            target_profiles=tuple(
                _target_profile(item)
                for item in _array(value.get("targetProfiles"), "targetProfiles")
            ),
            coverage_rows=tuple(
                _coverage_row(item)
                for item in _array(value.get("coverageRows"), "coverageRows")
            ),
            ls_tasks=tuple(
                _ls_task(item) for item in _array(value.get("lsTasks"), "lsTasks")
            ),
            source_signals=tuple(
                _source_signal(item)
                for item in _array(value.get("sourceSignals"), "sourceSignals")
            ),
            learning_items=tuple(
                _learning_item(item)
                for item in _array(value.get("learningItems"), "learningItems")
            ),
        )
        for label, records in (
            ("targetProfiles", bundle.target_profiles),
            ("coverageRows", bundle.coverage_rows),
            ("lsTasks", bundle.ls_tasks),
            ("sourceSignals", bundle.source_signals),
            ("learningItems", bundle.learning_items),
        ):
            ids = [item.legacy_id for item in records]
            if len(ids) != len(set(ids)):
                raise ValueError(f"duplicate {label} legacyId")
        referenced_targets = {
            bundle.active_target_slug,
            *(item.target_slug for item in bundle.target_profiles),
            *(item.target_slug for item in bundle.coverage_rows),
            *(item.target_slug for item in bundle.ls_tasks),
            *(item.source_target_slug for item in bundle.ls_tasks),
            *(item.target_slug for item in bundle.source_signals),
            *(item.source_target_slug for item in bundle.source_signals),
            *(item.target_slug for item in bundle.learning_items),
        }
        unknown = sorted(referenced_targets - SUPPORTED_TARGETS)
        if unknown:
            raise ValueError(f"unsupported target: {unknown[0]}")
        return bundle

    @property
    def payload_hash(self) -> str:
        encoded = json.dumps(
            self.to_payload(),
            ensure_ascii=True,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
        return hashlib.sha256(encoded).hexdigest()

    def to_payload(self) -> dict[str, Any]:
        return {
            "schema": self.schema,
            "migrationId": self.migration_id,
            "exportedAt": _iso(self.exported_at),
            "activeTargetSlug": self.active_target_slug,
            "targetProfiles": [item.to_payload() for item in self.target_profiles],
            "coverageRows": [item.to_payload() for item in self.coverage_rows],
            "lsTasks": [item.to_payload() for item in self.ls_tasks],
            "sourceSignals": [item.to_payload() for item in self.source_signals],
            "learningItems": [item.to_payload() for item in self.learning_items],
        }


def _target_profile(value: dict[str, Any]) -> LegacyTargetProfile:
    _strict(
        value,
        {
            "legacyId", "targetSlug", "displayName", "institution", "role",
            "banca", "phase", "deadline", "dailyQuota", "priorityScore",
            "sourceUrls", "notes", "active",
        },
        "target profile",
    )
    phase = _text(value.get("phase"), "phase")
    if phase not in {"pre_edital", "pos_edital"}:
        raise ValueError("invalid target phase")
    return LegacyTargetProfile(
        legacy_id=_text(value.get("legacyId"), "legacyId"),
        target_slug=_target(value.get("targetSlug"), "targetSlug"),
        display_name=_text(value.get("displayName"), "displayName"),
        institution=_text(value.get("institution"), "institution"),
        role=_text(value.get("role"), "role"),
        banca=_text(value.get("banca"), "banca"),
        phase=phase,
        deadline=_optional_date(value.get("deadline"), "deadline"),
        daily_quota=_integer(value.get("dailyQuota"), "dailyQuota", 1, 8),
        priority_score=_integer(value.get("priorityScore"), "priorityScore", 0, 100),
        source_urls=_text_list(value.get("sourceUrls"), "sourceUrls", urls=True),
        notes=_optional_text(value.get("notes"), "notes") or "",
        active=_boolean(value.get("active"), "active"),
    )


def _coverage_row(value: dict[str, Any]) -> LegacyCoverageRow:
    _strict(
        value,
        {
            "legacyId", "targetSlug", "discipline", "topic", "coverageStatus",
            "editalWeight", "incidence", "tier", "bancaFit", "overlapValue",
            "transferKind", "sourceKind", "plannedQuestions", "reviewDebt",
            "notes", "active",
        },
        "coverage row",
    )
    coverage_status = _text(value.get("coverageStatus"), "coverageStatus")
    transfer_kind = _text(value.get("transferKind"), "transferKind")
    source_kind = _text(value.get("sourceKind"), "sourceKind")
    if coverage_status not in _COVERAGE_STATUSES:
        raise ValueError("invalid coverage status")
    if transfer_kind not in _TRANSFER_KINDS:
        raise ValueError("invalid transfer kind")
    if source_kind not in _PLANNER_SOURCE_KINDS:
        raise ValueError("invalid planner source kind")
    tier = _integer(value.get("tier"), "tier", 1)
    if tier > 5:
        raise ValueError("tier must be at most 5")
    return LegacyCoverageRow(
        legacy_id=_text(value.get("legacyId"), "legacyId"),
        target_slug=_target(value.get("targetSlug"), "targetSlug"),
        discipline=_text(value.get("discipline"), "discipline"),
        topic=_text(value.get("topic"), "topic"),
        coverage_status=coverage_status,
        edital_weight=_number(value.get("editalWeight"), "editalWeight", 0, 10),
        incidence=_number(value.get("incidence"), "incidence", 0, 100),
        tier=tier,
        banca_fit=_number(value.get("bancaFit"), "bancaFit", 0, 100),
        overlap_value=_number(value.get("overlapValue"), "overlapValue", 0, 100),
        transfer_kind=transfer_kind,
        source_kind=source_kind,
        planned_questions=_integer(
            value.get("plannedQuestions"), "plannedQuestions", 0
        ),
        review_debt=_number(value.get("reviewDebt"), "reviewDebt", 0, 100),
        notes=_optional_text(value.get("notes"), "notes") or "",
        active=_boolean(value.get("active"), "active"),
    )


def _ls_task(value: dict[str, Any]) -> LegacyLsTask:
    _strict(
        value,
        {
            "legacyId", "sourceTargetSlug", "targetSlug", "discipline",
            "topicHint", "order", "taskKind", "status", "scheduledDate",
            "metadata",
        },
        "LS task",
    )
    status = _text(value.get("status"), "status")
    if status not in _TASK_STATUSES:
        raise ValueError("invalid LS task status")
    return LegacyLsTask(
        legacy_id=_text(value.get("legacyId"), "legacyId"),
        source_target_slug=_target(
            value.get("sourceTargetSlug"), "sourceTargetSlug"
        ),
        target_slug=_target(value.get("targetSlug"), "targetSlug"),
        discipline=_text(value.get("discipline"), "discipline"),
        topic_hint=_text(value.get("topicHint"), "topicHint"),
        order=_integer(value.get("order"), "order", 0),
        task_kind=_text(value.get("taskKind"), "taskKind"),
        status=status,
        scheduled_date=_optional_date(value.get("scheduledDate"), "scheduledDate"),
        metadata=_metadata(value.get("metadata"), "metadata"),
    )


def _source_signal(value: dict[str, Any]) -> LegacySourceSignal:
    _strict(
        value,
        {
            "legacyId", "sourceTargetSlug", "targetSlug", "sourceKey",
            "sourceKind", "displayName", "trustTier", "discipline",
            "topicHint", "order", "contentRole", "targetTopicId",
            "transferKind", "incidenceBp", "banca", "edition", "notes",
            "externalUrl", "externalId", "metadata",
        },
        "source signal",
    )
    source_target = _target(value.get("sourceTargetSlug"), "sourceTargetSlug")
    target = _target(value.get("targetSlug"), "targetSlug")
    transfer_kind = _text(value.get("transferKind"), "transferKind")
    if transfer_kind not in _TRANSFER_KINDS:
        raise ValueError("invalid transfer kind")
    if source_target != target and transfer_kind == "target_specific":
        raise ValueError("cross-target source signal requires shared or partial transfer")
    source_kind = _text(value.get("sourceKind"), "sourceKind")
    if source_kind not in _STRATEGY_SOURCE_KINDS:
        raise ValueError("invalid strategy source kind")
    content_role = _text(value.get("contentRole"), "contentRole")
    if content_role not in _CONTENT_ROLES:
        raise ValueError("invalid strategy content role")
    trust_tier = _integer(value.get("trustTier"), "trustTier", 0)
    incidence_bp = _integer(value.get("incidenceBp"), "incidenceBp", 0)
    if trust_tier > 10:
        raise ValueError("trustTier must be at most 10")
    if incidence_bp > 10000:
        raise ValueError("incidenceBp must be at most 10000")
    return LegacySourceSignal(
        legacy_id=_text(value.get("legacyId"), "legacyId"),
        source_target_slug=source_target,
        target_slug=target,
        source_key=_text(value.get("sourceKey"), "sourceKey"),
        source_kind=source_kind,
        display_name=_text(value.get("displayName"), "displayName"),
        trust_tier=trust_tier,
        discipline=_text(value.get("discipline"), "discipline"),
        topic_hint=_text(value.get("topicHint"), "topicHint"),
        order=_integer(value.get("order"), "order", 0),
        content_role=content_role,
        target_topic_id=_optional_integer(
            value.get("targetTopicId"), "targetTopicId", 1
        ),
        transfer_kind=transfer_kind,
        incidence_bp=incidence_bp,
        banca=_optional_text(value.get("banca"), "banca") or "",
        edition=_optional_text(value.get("edition"), "edition") or "",
        notes=_optional_text(value.get("notes"), "notes") or "",
        external_url=_optional_url(value.get("externalUrl"), "externalUrl"),
        external_id=_optional_text(value.get("externalId"), "externalId"),
        metadata=_metadata(value.get("metadata"), "metadata"),
    )


def _learning_item(value: dict[str, Any]) -> LegacyLearningItem:
    _strict(
        value,
        {
            "legacyId", "targetSlug", "targetTopicId", "discipline", "topic",
            "eventKind", "occurredAt", "sourceDate", "questionsDone",
            "correctCount", "wrongCount", "doubtCount", "favoriteCount",
            "sourceLabel", "banca", "tags",
        },
        "learning item",
    )
    event_kind = _text(value.get("eventKind"), "eventKind")
    if event_kind not in _EVENT_KINDS:
        raise ValueError("invalid learning event kind")
    questions_done = _integer(value.get("questionsDone"), "questionsDone", 0)
    correct_count = _integer(value.get("correctCount"), "correctCount", 0)
    wrong_count = _integer(value.get("wrongCount"), "wrongCount", 0)
    if correct_count + wrong_count > questions_done:
        raise ValueError("correct and wrong counts exceed questionsDone")
    return LegacyLearningItem(
        legacy_id=_text(value.get("legacyId"), "legacyId"),
        target_slug=_target(value.get("targetSlug"), "targetSlug"),
        target_topic_id=_optional_integer(
            value.get("targetTopicId"), "targetTopicId", 1
        ),
        discipline=_text(value.get("discipline"), "discipline"),
        topic=_text(value.get("topic"), "topic"),
        event_kind=event_kind,
        occurred_at=_timestamp(value.get("occurredAt"), "occurredAt"),
        source_date=_optional_date(value.get("sourceDate"), "sourceDate"),
        questions_done=questions_done,
        correct_count=correct_count,
        wrong_count=wrong_count,
        doubt_count=_integer(value.get("doubtCount"), "doubtCount", 0),
        favorite_count=_integer(value.get("favoriteCount"), "favoriteCount", 0),
        source_label=_optional_text(value.get("sourceLabel"), "sourceLabel") or "",
        banca=_optional_text(value.get("banca"), "banca") or "",
        tags=_text_list(value.get("tags"), "tags"),
    )
