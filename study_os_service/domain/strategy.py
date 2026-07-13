from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
import re
from types import MappingProxyType
from typing import Literal, Mapping
from urllib.parse import urlparse


StrategySourceKind = Literal[
    "course", "passo", "trilha", "ls", "andrety", "tec", "manual"
]
StrategyContentRole = Literal[
    "primary_theory",
    "review_support",
    "question_practice",
    "schedule_advice",
    "incidence_signal",
]
MappingStatus = Literal["proposed", "approved", "rejected"]
TransferKind = Literal["target_specific", "shared", "partial"]
IngestionStatus = Literal["completed", "failed"]
ChoiceStatus = Literal["chosen", "shortfall"]

_SOURCE_KINDS = {"course", "passo", "trilha", "ls", "andrety", "tec", "manual"}
_CONTENT_ROLES = {
    "primary_theory",
    "review_support",
    "question_practice",
    "schedule_advice",
    "incidence_signal",
}
_MAPPING_STATUSES = {"proposed", "approved", "rejected"}
_TRANSFER_KINDS = {"target_specific", "shared", "partial"}
_INGESTION_STATUSES = {"completed", "failed"}
_CHOICE_STATUSES = {"chosen", "shortfall"}
_BLOCK_KINDS = {"theory", "questions", "review"}
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


def _optional_text(value: str | None, label: str) -> str | None:
    return None if value is None else _text(value, label)


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


def _aware(value: datetime, label: str) -> datetime:
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{label} must be timezone-aware")
    return value.astimezone(UTC)


def _optional_url(value: str | None, label: str) -> str | None:
    if value is None:
        return None
    resolved = _text(value, label)
    parsed = urlparse(resolved)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError(f"{label} must be an HTTP URL")
    return resolved


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


def _metadata(value: Mapping[str, object], label: str) -> Mapping[str, object]:
    if not isinstance(value, Mapping):
        raise ValueError(f"{label} must be a mapping")
    resolved = dict(value)
    _reject_proprietary_fields(resolved)
    return MappingProxyType(resolved)


def validate_strategy_metadata(
    value: Mapping[str, object], label: str = "metadata"
) -> Mapping[str, object]:
    return _metadata(value, label)


@dataclass(frozen=True, slots=True)
class StrategySource:
    id: int
    target_slug: str
    source_key: str
    source_kind: StrategySourceKind
    display_name: str
    trust_tier: int
    root_id: int | None
    material_id: int | None
    external_url: str | None
    external_id: str | None
    edition: str
    active: bool
    notes: str
    version: int
    created_at: datetime
    updated_at: datetime

    def __post_init__(self) -> None:
        _positive(self.id, "id")
        object.__setattr__(self, "target_slug", _text(self.target_slug, "target"))
        object.__setattr__(self, "source_key", _text(self.source_key, "source key"))
        if self.source_kind not in _SOURCE_KINDS:
            raise ValueError("invalid strategy source kind")
        object.__setattr__(self, "display_name", _text(self.display_name, "display name"))
        tier = _non_negative(self.trust_tier, "trust tier")
        if tier > 10:
            raise ValueError("trust tier must be between 0 and 10")
        if self.root_id is not None:
            _positive(self.root_id, "root id")
        if self.material_id is not None:
            _positive(self.material_id, "material id")
        object.__setattr__(
            self, "external_url", _optional_url(self.external_url, "external URL")
        )
        object.__setattr__(
            self, "external_id", _optional_text(self.external_id, "external id")
        )
        if not isinstance(self.edition, str):
            raise ValueError("edition must be text")
        if not isinstance(self.active, bool):
            raise ValueError("active must be boolean")
        if not isinstance(self.notes, str):
            raise ValueError("notes must be text")
        _positive(self.version, "version")
        object.__setattr__(self, "created_at", _aware(self.created_at, "created at"))
        object.__setattr__(self, "updated_at", _aware(self.updated_at, "updated at"))


@dataclass(frozen=True, slots=True)
class StrategySourceItem:
    id: int
    source_id: int
    target_slug: str
    discipline: str
    topic_hint: str
    source_order: int
    content_role: StrategyContentRole
    lesson_id: int | None
    material_id: int | None
    external_url: str | None
    external_id: str | None
    incidence_bp: int
    banca: str
    provenance: Mapping[str, object]
    source_fingerprint: str
    active: bool
    version: int
    created_at: datetime
    updated_at: datetime

    def __post_init__(self) -> None:
        _positive(self.id, "id")
        _positive(self.source_id, "source id")
        object.__setattr__(self, "target_slug", _text(self.target_slug, "target"))
        object.__setattr__(self, "discipline", _text(self.discipline, "discipline"))
        object.__setattr__(self, "topic_hint", _text(self.topic_hint, "topic hint"))
        _non_negative(self.source_order, "source order")
        if self.content_role not in _CONTENT_ROLES:
            raise ValueError("invalid strategy content role")
        if self.lesson_id is not None:
            _positive(self.lesson_id, "lesson id")
        if self.material_id is not None:
            _positive(self.material_id, "material id")
            if self.lesson_id is None:
                raise ValueError("material requires a lesson")
        if self.content_role == "primary_theory" and self.material_id is None:
            raise ValueError("primary theory requires a local material")
        object.__setattr__(
            self, "external_url", _optional_url(self.external_url, "external URL")
        )
        object.__setattr__(
            self, "external_id", _optional_text(self.external_id, "external id")
        )
        _basis_points(self.incidence_bp, "incidence")
        if not isinstance(self.banca, str):
            raise ValueError("banca must be text")
        object.__setattr__(self, "provenance", _metadata(self.provenance, "provenance"))
        object.__setattr__(
            self,
            "source_fingerprint",
            _text(self.source_fingerprint, "source fingerprint"),
        )
        if not isinstance(self.active, bool):
            raise ValueError("active must be boolean")
        _positive(self.version, "version")
        object.__setattr__(self, "created_at", _aware(self.created_at, "created at"))
        object.__setattr__(self, "updated_at", _aware(self.updated_at, "updated at"))


@dataclass(frozen=True, slots=True)
class TopicSourceMapping:
    id: int
    target_slug: str
    target_topic_id: int
    source_item_id: int
    source_target_slug: str
    transfer_kind: TransferKind
    mapping_status: MappingStatus
    confidence_bp: int
    primary_eligible: bool
    manual_override: bool
    notes: str
    version: int
    created_at: datetime
    updated_at: datetime

    def __post_init__(self) -> None:
        _positive(self.id, "id")
        object.__setattr__(self, "target_slug", _text(self.target_slug, "target"))
        _positive(self.target_topic_id, "target topic id")
        _positive(self.source_item_id, "source item id")
        object.__setattr__(
            self,
            "source_target_slug",
            _text(self.source_target_slug, "source target"),
        )
        if self.transfer_kind not in _TRANSFER_KINDS:
            raise ValueError("invalid transfer kind")
        if self.mapping_status not in _MAPPING_STATUSES:
            raise ValueError("invalid mapping status")
        _basis_points(self.confidence_bp, "mapping confidence")
        if not isinstance(self.primary_eligible, bool):
            raise ValueError("primary eligible must be boolean")
        if not isinstance(self.manual_override, bool):
            raise ValueError("manual override must be boolean")
        if self.transfer_kind == "target_specific" and self.source_target_slug != self.target_slug:
            raise ValueError("target-specific mapping requires the same source target")
        if self.primary_eligible and self.mapping_status != "approved":
            raise ValueError("primary source mapping must be approved")
        if not isinstance(self.notes, str):
            raise ValueError("notes must be text")
        _positive(self.version, "version")
        object.__setattr__(self, "created_at", _aware(self.created_at, "created at"))
        object.__setattr__(self, "updated_at", _aware(self.updated_at, "updated at"))


@dataclass(frozen=True, slots=True)
class StrategyIngestionRun:
    id: int
    idempotency_key: str
    source_id: int
    target_slug: str
    input_hash: str
    algorithm_version: str
    status: IngestionStatus
    discovered_count: int
    mapped_count: int
    unresolved_count: int
    unresolved_report: tuple[Mapping[str, object], ...]
    created_at: datetime

    def __post_init__(self) -> None:
        _positive(self.id, "id")
        object.__setattr__(
            self, "idempotency_key", _text(self.idempotency_key, "idempotency key")
        )
        _positive(self.source_id, "source id")
        object.__setattr__(self, "target_slug", _text(self.target_slug, "target"))
        object.__setattr__(self, "input_hash", _text(self.input_hash, "input hash"))
        object.__setattr__(
            self,
            "algorithm_version",
            _text(self.algorithm_version, "algorithm version"),
        )
        if self.status not in _INGESTION_STATUSES:
            raise ValueError("invalid ingestion status")
        _non_negative(self.discovered_count, "discovered count")
        _non_negative(self.mapped_count, "mapped count")
        _non_negative(self.unresolved_count, "unresolved count")
        if not isinstance(self.unresolved_report, tuple):
            raise ValueError("unresolved report must be a tuple")
        report = tuple(_metadata(item, "unresolved report item") for item in self.unresolved_report)
        object.__setattr__(self, "unresolved_report", report)
        if len(report) != self.unresolved_count:
            raise ValueError("unresolved report count must match")
        if self.mapped_count + self.unresolved_count > self.discovered_count:
            raise ValueError("ingestion totals exceed discovered count")
        object.__setattr__(self, "created_at", _aware(self.created_at, "created at"))


@dataclass(frozen=True, slots=True)
class SourceChoiceRun:
    id: int
    idempotency_key: str
    target_slug: str
    target_topic_id: int
    block_kind: str
    algorithm_version: str
    input_hash: str
    status: ChoiceStatus
    shortfall_reason: str | None
    created_at: datetime

    def __post_init__(self) -> None:
        _positive(self.id, "id")
        object.__setattr__(
            self, "idempotency_key", _text(self.idempotency_key, "idempotency key")
        )
        object.__setattr__(self, "target_slug", _text(self.target_slug, "target"))
        _positive(self.target_topic_id, "target topic id")
        if self.block_kind not in _BLOCK_KINDS:
            raise ValueError("invalid block kind")
        object.__setattr__(
            self,
            "algorithm_version",
            _text(self.algorithm_version, "algorithm version"),
        )
        object.__setattr__(self, "input_hash", _text(self.input_hash, "input hash"))
        if self.status not in _CHOICE_STATUSES:
            raise ValueError("invalid source choice status")
        reason = _optional_text(self.shortfall_reason, "shortfall reason")
        object.__setattr__(self, "shortfall_reason", reason)
        if (self.status == "shortfall") != (reason is not None):
            raise ValueError("shortfall status and reason must match")
        object.__setattr__(self, "created_at", _aware(self.created_at, "created at"))


@dataclass(frozen=True, slots=True)
class SourceChoiceRow:
    id: int
    run_id: int
    target_slug: str
    source_item_id: int
    target_fit_bp: int
    transfer_confidence_bp: int
    trust_bp: int
    freshness_bp: int
    order_readiness_bp: int
    strategy_alignment_bp: int
    material_availability_bp: int
    low_trust_penalty_bp: int
    mismatch_penalty_bp: int
    final_score: int
    chosen: bool
    displaced_by_row_id: int | None
    stop_reason: str | None
    evidence: Mapping[str, object]

    def __post_init__(self) -> None:
        _positive(self.id, "id")
        _positive(self.run_id, "run id")
        object.__setattr__(self, "target_slug", _text(self.target_slug, "target"))
        _positive(self.source_item_id, "source item id")
        for value, label in (
            (self.target_fit_bp, "target fit"),
            (self.transfer_confidence_bp, "transfer confidence"),
            (self.trust_bp, "trust"),
            (self.freshness_bp, "freshness"),
            (self.order_readiness_bp, "order readiness"),
            (self.strategy_alignment_bp, "strategy alignment"),
            (self.material_availability_bp, "material availability"),
            (self.low_trust_penalty_bp, "low trust penalty"),
            (self.mismatch_penalty_bp, "mismatch penalty"),
        ):
            _basis_points(value, label)
        if isinstance(self.final_score, bool) or not isinstance(self.final_score, int):
            raise ValueError("final score must be an integer")
        if not isinstance(self.chosen, bool):
            raise ValueError("chosen must be boolean")
        if self.displaced_by_row_id is not None:
            _positive(self.displaced_by_row_id, "displaced by row id")
            if self.displaced_by_row_id == self.id:
                raise ValueError("source choice cannot displace itself")
        reason = _optional_text(self.stop_reason, "stop reason")
        object.__setattr__(self, "stop_reason", reason)
        if self.chosen:
            if self.displaced_by_row_id is not None or reason is not None:
                raise ValueError("chosen source cannot be displaced or stopped")
        elif (self.displaced_by_row_id is None) == (reason is None):
            raise ValueError("unchosen source must be displaced or have one stop reason")
        object.__setattr__(self, "evidence", _metadata(self.evidence, "choice evidence"))
