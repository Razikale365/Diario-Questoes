from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import sqlite3
from typing import Mapping
from urllib.parse import urlparse

from study_os_service.domain.strategy import (
    StrategyIngestionRun,
    StrategySource,
    validate_strategy_metadata,
)
from study_os_service.repositories.strategy import StrategyRepository
from study_os_service.services.course_mapping import (
    CourseLessonEvidence,
    CourseTopicMatch,
    MappingTopic,
    match_course_lesson,
)


ALGORITHM_VERSION = "m6-strategy-ingestion-v1"
_SOURCE_KINDS = {"passo", "trilha", "ls", "andrety", "tec", "manual"}
_CONTENT_ROLES = {
    "review_support",
    "question_practice",
    "schedule_advice",
    "incidence_signal",
}


def _text(value: object, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{label} is required")
    return value.strip()


def _optional_text(value: object, label: str) -> str | None:
    if value is None:
        return None
    return _text(value, label)


def _non_negative_int(value: object, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError(f"{label} must be a non-negative integer")
    return value


def _optional_positive_int(value: object, label: str) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise ValueError(f"{label} must be a positive integer")
    return value


def _basis_points(value: object, label: str) -> int:
    resolved = _non_negative_int(value, label)
    if resolved > 10000:
        raise ValueError(f"{label} must be basis points")
    return resolved


def _optional_url(value: object, label: str) -> str | None:
    resolved = _optional_text(value, label)
    if resolved is None:
        return None
    parsed = urlparse(resolved)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError(f"{label} must be an HTTP URL")
    return resolved


@dataclass(frozen=True, slots=True)
class StrategyInputRow:
    discipline: str
    topic_hint: str
    source_order: int
    content_role: str
    source_fingerprint: str
    target_topic_id: int | None = None
    lesson_id: int | None = None
    material_id: int | None = None
    external_url: str | None = None
    external_id: str | None = None
    incidence_bp: int = 0
    banca: str = ""
    provenance: Mapping[str, object] = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "discipline", _text(self.discipline, "discipline"))
        object.__setattr__(self, "topic_hint", _text(self.topic_hint, "topic hint"))
        _non_negative_int(self.source_order, "source order")
        if self.content_role not in _CONTENT_ROLES:
            raise ValueError("invalid strategy content role")
        object.__setattr__(
            self,
            "source_fingerprint",
            _text(self.source_fingerprint, "source fingerprint"),
        )
        _optional_positive_int(self.target_topic_id, "target topic id")
        _optional_positive_int(self.lesson_id, "lesson id")
        _optional_positive_int(self.material_id, "material id")
        if self.material_id is not None and self.lesson_id is None:
            raise ValueError("material requires a lesson")
        object.__setattr__(
            self, "external_url", _optional_url(self.external_url, "external URL")
        )
        object.__setattr__(
            self, "external_id", _optional_text(self.external_id, "external id")
        )
        _basis_points(self.incidence_bp, "incidence")
        if not isinstance(self.banca, str):
            raise ValueError("banca must be text")
        safe = validate_strategy_metadata(self.provenance or {}, "provenance")
        object.__setattr__(self, "provenance", safe)


@dataclass(frozen=True, slots=True)
class StrategyInputBatch:
    source_target_slug: str
    target_slug: str
    source_key: str
    source_kind: str
    display_name: str
    trust_tier: int
    edition: str
    notes: str
    rows: tuple[StrategyInputRow, ...]
    root_id: int | None = None
    material_id: int | None = None
    external_url: str | None = None
    external_id: str | None = None

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "source_target_slug",
            _text(self.source_target_slug, "source target"),
        )
        object.__setattr__(self, "target_slug", _text(self.target_slug, "target"))
        object.__setattr__(self, "source_key", _text(self.source_key, "source key"))
        if self.source_kind not in _SOURCE_KINDS:
            raise ValueError("invalid strategy source kind")
        object.__setattr__(
            self, "display_name", _text(self.display_name, "display name")
        )
        tier = _non_negative_int(self.trust_tier, "trust tier")
        if tier > 10:
            raise ValueError("trust tier must be between 0 and 10")
        if not isinstance(self.edition, str):
            raise ValueError("edition must be text")
        if not isinstance(self.notes, str):
            raise ValueError("notes must be text")
        if not isinstance(self.rows, tuple):
            raise ValueError("strategy rows must be a tuple")
        _optional_positive_int(self.root_id, "root id")
        _optional_positive_int(self.material_id, "material id")
        object.__setattr__(
            self, "external_url", _optional_url(self.external_url, "external URL")
        )
        object.__setattr__(
            self, "external_id", _optional_text(self.external_id, "external id")
        )


@dataclass(frozen=True, slots=True)
class StrategyIngestionResult:
    source: StrategySource
    run: StrategyIngestionRun

    @property
    def discovered_count(self) -> int:
        return self.run.discovered_count

    @property
    def mapped_count(self) -> int:
        return self.run.mapped_count

    @property
    def unresolved_count(self) -> int:
        return self.run.unresolved_count

    @property
    def unresolved(self) -> tuple[Mapping[str, object], ...]:
        return self.run.unresolved_report


class StrategyIngestionConflictError(RuntimeError):
    pass


def _canonical_payload(batch: StrategyInputBatch) -> dict[str, object]:
    return {
        "algorithmVersion": ALGORITHM_VERSION,
        "sourceTargetSlug": batch.source_target_slug,
        "targetSlug": batch.target_slug,
        "sourceKey": batch.source_key,
        "sourceKind": batch.source_kind,
        "displayName": batch.display_name,
        "trustTier": batch.trust_tier,
        "edition": batch.edition,
        "notes": batch.notes,
        "rootId": batch.root_id,
        "materialId": batch.material_id,
        "externalUrl": batch.external_url,
        "externalId": batch.external_id,
        "rows": [
            {
                "discipline": row.discipline,
                "topicHint": row.topic_hint,
                "sourceOrder": row.source_order,
                "contentRole": row.content_role,
                "sourceFingerprint": row.source_fingerprint,
                "targetTopicId": row.target_topic_id,
                "lessonId": row.lesson_id,
                "materialId": row.material_id,
                "externalUrl": row.external_url,
                "externalId": row.external_id,
                "incidenceBp": row.incidence_bp,
                "banca": row.banca,
                "provenance": dict(row.provenance),
            }
            for row in batch.rows
        ],
    }


def _input_hash(batch: StrategyInputBatch) -> str:
    canonical = json.dumps(
        _canonical_payload(batch),
        ensure_ascii=True,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


class StrategyIngestionService:
    def __init__(self, connection: sqlite3.Connection):
        self.connection = connection
        self.repository = StrategyRepository(connection)

    def ingest(
        self, batch: StrategyInputBatch, *, idempotency_key: str
    ) -> StrategyIngestionResult:
        key = _text(idempotency_key, "idempotency key")
        input_hash = _input_hash(batch)
        existing = self.repository.get_ingestion_run_by_key(key)
        if existing is not None:
            if existing.input_hash != input_hash:
                raise StrategyIngestionConflictError(
                    "idempotency key was already used with a different payload"
                )
            source = self.repository.get_source(existing.source_id)
            if source is None:
                raise RuntimeError("strategy ingestion source disappeared")
            return StrategyIngestionResult(source, existing)

        self._require_target(batch.source_target_slug, "source target")
        self._require_target(batch.target_slug, "target")
        self.connection.execute("BEGIN IMMEDIATE")
        try:
            source = self._ensure_source(batch)
            topics = self._topics(batch.target_slug)
            mapped_count = 0
            unresolved: list[Mapping[str, object]] = []
            for row in batch.rows:
                item = self.repository.upsert_source_item(
                    source_id=source.id,
                    target_slug=source.target_slug,
                    discipline=row.discipline,
                    topic_hint=row.topic_hint,
                    source_order=row.source_order,
                    content_role=row.content_role,
                    lesson_id=row.lesson_id,
                    material_id=row.material_id,
                    external_url=row.external_url,
                    external_id=row.external_id,
                    incidence_bp=row.incidence_bp,
                    banca=row.banca,
                    provenance=row.provenance,
                    source_fingerprint=row.source_fingerprint,
                )
                matches = self._resolve_row(batch, row, topics)
                keep_ids = tuple(match.target_topic_id for match in matches)
                self.repository.reject_automatic_mappings_except(
                    source_item_id=item.id,
                    target_slug=batch.target_slug,
                    keep_topic_ids=keep_ids,
                )
                for match in matches:
                    self.repository.upsert_mapping(
                        target_slug=batch.target_slug,
                        target_topic_id=match.target_topic_id,
                        source_item_id=item.id,
                        source_target_slug=batch.source_target_slug,
                        transfer_kind=match.transfer_kind,
                        mapping_status=match.mapping_status,
                        confidence_bp=match.confidence_bp,
                        primary_eligible=False,
                        notes=(
                            "Explicit adapter topic mapping"
                            if row.target_topic_id is not None
                            else f"Deterministic {match.stage} metadata match"
                        ),
                    )
                approved = [
                    match for match in matches if match.mapping_status == "approved"
                ]
                if approved:
                    mapped_count += 1
                else:
                    unresolved.append(
                        {
                            "sourceFingerprint": row.source_fingerprint,
                            "discipline": row.discipline,
                            "topicHint": row.topic_hint,
                            "candidateTopicIds": [
                                match.target_topic_id for match in matches
                            ],
                            "reason": self._unresolved_reason(batch, row, matches),
                        }
                    )
            run = self.repository.insert_ingestion_run(
                idempotency_key=key,
                source_id=source.id,
                target_slug=source.target_slug,
                input_hash=input_hash,
                algorithm_version=ALGORITHM_VERSION,
                status="completed",
                discovered_count=len(batch.rows),
                mapped_count=mapped_count,
                unresolved_report=tuple(unresolved),
            )
            self.connection.commit()
            return StrategyIngestionResult(source, run)
        except Exception:
            self.connection.rollback()
            raise

    def _require_target(self, target_slug: str, label: str) -> None:
        if self.connection.execute(
            "SELECT 1 FROM exam_targets WHERE target_slug=?", (target_slug,)
        ).fetchone() is None:
            raise KeyError(f"{label} {target_slug} does not exist")

    def _ensure_source(self, batch: StrategyInputBatch) -> StrategySource:
        existing = self.repository.get_source_by_key(
            batch.source_target_slug, batch.source_key
        )
        if existing is None:
            return self.repository.create_source(
                target_slug=batch.source_target_slug,
                source_key=batch.source_key,
                source_kind=batch.source_kind,
                display_name=batch.display_name,
                trust_tier=batch.trust_tier,
                root_id=batch.root_id,
                material_id=batch.material_id,
                external_url=batch.external_url,
                external_id=batch.external_id,
                edition=batch.edition,
                notes=batch.notes,
            )
        if existing.source_kind != batch.source_kind:
            raise ValueError("source key already belongs to another source kind")
        values = (
            batch.display_name,
            batch.trust_tier,
            batch.root_id,
            batch.material_id,
            batch.external_url,
            batch.external_id,
            batch.edition,
            batch.notes,
        )
        current = (
            existing.display_name,
            existing.trust_tier,
            existing.root_id,
            existing.material_id,
            existing.external_url,
            existing.external_id,
            existing.edition,
            existing.notes,
        )
        if values != current:
            self.connection.execute(
                """
                UPDATE strategy_sources
                SET display_name=?, trust_tier=?, root_id=?, material_id=?,
                    external_url=?, external_id=?, edition=?, notes=?,
                    version=version+1,
                    updated_at=(STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW'))
                WHERE id=?
                """,
                (*values, existing.id),
            )
            refreshed = self.repository.get_source(existing.id)
            if refreshed is None:
                raise RuntimeError("strategy source update was not visible")
            return refreshed
        return existing

    def _topics(self, target_slug: str) -> tuple[MappingTopic, ...]:
        return tuple(
            MappingTopic(
                id=row["id"],
                target_slug=row["target_slug"],
                discipline=row["discipline"],
                topic=row["topic"],
                transfer_kind=row["transfer_kind"],
            )
            for row in self.connection.execute(
                """
                SELECT id, target_slug, discipline, topic, transfer_kind
                FROM target_topics
                WHERE target_slug=? AND active=1 ORDER BY id
                """,
                (target_slug,),
            )
        )

    @staticmethod
    def _resolve_row(
        batch: StrategyInputBatch,
        row: StrategyInputRow,
        topics: tuple[MappingTopic, ...],
    ) -> tuple[CourseTopicMatch, ...]:
        if row.target_topic_id is not None:
            topic = next(
                (topic for topic in topics if topic.id == row.target_topic_id),
                None,
            )
            if topic is None:
                raise ValueError(
                    f"target topic {row.target_topic_id} does not belong to {batch.target_slug}"
                )
            cross_target = batch.source_target_slug != batch.target_slug
            if cross_target and topic.transfer_kind == "target_specific":
                return ()
            confidence = 10000
            if cross_target:
                confidence = 7500 if topic.transfer_kind == "shared" else 5500
            return (
                CourseTopicMatch(
                    target_topic_id=topic.id,
                    target_slug=batch.target_slug,
                    stage="exact",
                    confidence_bp=confidence,
                    mapping_status="proposed" if cross_target else "approved",
                    transfer_kind=(
                        topic.transfer_kind if cross_target else "target_specific"
                    ),
                ),
            )
        return match_course_lesson(
            CourseLessonEvidence(
                source_target_slug=batch.source_target_slug,
                discipline=row.discipline,
                course_name=batch.display_name,
                lesson_id=row.lesson_id or 1,
                lesson_number=None,
                title=row.topic_hint,
                material_id=row.material_id,
                material_kind=None,
                trust_level=batch.trust_tier,
            ),
            topics,
            target_slug=batch.target_slug,
        )

    @staticmethod
    def _unresolved_reason(
        batch: StrategyInputBatch,
        row: StrategyInputRow,
        matches: tuple[CourseTopicMatch, ...],
    ) -> str:
        if batch.source_target_slug != batch.target_slug:
            return "target_mismatch_review" if matches else "target_mismatch"
        if not matches:
            return "no_match"
        if len(matches) > 1:
            return "ambiguous"
        if row.target_topic_id is None:
            return "low_confidence"
        return "manual_review"
