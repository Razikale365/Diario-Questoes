from __future__ import annotations

from dataclasses import dataclass
import hashlib
import math
import sqlite3
from types import MappingProxyType
from typing import Any, Literal, Mapping

from study_os_service.domain.planner import (
    PlannerBlockKind,
    PlannerSourceKind,
    TargetTopic,
)
from study_os_service.repositories.planner_profiles import PlannerProfileRepository


MaterialKind = Literal[
    "original",
    "simplified",
    "highlighted",
    "slides",
    "mind_map",
    "summary",
    "bizu",
    "track",
    "other",
]
CandidateStopReason = Literal[
    "inactive_topic",
    "target_not_transferable",
    "material_unmapped",
    "material_missing",
    "material_unavailable",
    "primary_material_missing",
    "low_trust_primary",
    "material_target_mismatch",
    "tec_source_missing",
    "review_evidence_missing",
]


STOP_REASONS: tuple[CandidateStopReason, ...] = (
    "inactive_topic",
    "target_not_transferable",
    "material_unmapped",
    "material_missing",
    "material_unavailable",
    "primary_material_missing",
    "low_trust_primary",
    "material_target_mismatch",
    "tec_source_missing",
    "review_evidence_missing",
)

_MATERIAL_KINDS = {
    "original",
    "simplified",
    "highlighted",
    "slides",
    "mind_map",
    "summary",
    "bizu",
    "track",
    "other",
}
_PROGRESS_STATUSES = {"unread", "in_progress", "covered", "stale", "weak", "strong"}
_BLOCK_ORDER: tuple[PlannerBlockKind, ...] = ("theory", "questions", "review")


def _positive(value: int, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise ValueError(f"{label} must be a positive integer")
    return value


def _non_negative(value: int, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError(f"{label} must be a non-negative integer")
    return value


@dataclass(frozen=True, slots=True)
class MaterialEvidence:
    lesson_id: int
    material_id: int
    target_slug: str
    kind: MaterialKind
    available: bool
    is_primary: bool
    trust_level: int
    progress_status: str
    cursor_page: int
    page_count: int | None

    def __post_init__(self) -> None:
        _positive(self.lesson_id, "lesson id")
        _positive(self.material_id, "material id")
        if not isinstance(self.target_slug, str) or not self.target_slug.strip():
            raise ValueError("material target is required")
        if self.kind not in _MATERIAL_KINDS:
            raise ValueError("invalid material kind")
        if not isinstance(self.available, bool) or not isinstance(self.is_primary, bool):
            raise ValueError("material state must be boolean")
        if (
            isinstance(self.trust_level, bool)
            or not isinstance(self.trust_level, int)
            or not 0 <= self.trust_level <= 10
        ):
            raise ValueError("trust level must be between 0 and 10")
        if self.progress_status not in _PROGRESS_STATUSES:
            raise ValueError("invalid material progress status")
        _positive(self.cursor_page, "cursor page")
        if self.page_count is not None:
            _positive(self.page_count, "page count")
            if self.cursor_page > self.page_count:
                raise ValueError("cursor page cannot exceed page count")


@dataclass(frozen=True, slots=True)
class ReviewEvidence:
    wrong_count: int = 0
    doubt_count: int = 0
    favorite_count: int = 0
    failed_sessions: int = 0
    weak_progress: bool = False

    def __post_init__(self) -> None:
        for name in (
            "wrong_count",
            "doubt_count",
            "favorite_count",
            "failed_sessions",
        ):
            _non_negative(getattr(self, name), name.replace("_", " "))
        if not isinstance(self.weak_progress, bool):
            raise ValueError("weak progress must be boolean")

    @property
    def has_error_evidence(self) -> bool:
        return (
            self.wrong_count
            + self.doubt_count
            + self.favorite_count
            + self.failed_sessions
            > 0
            or self.weak_progress
        )


@dataclass(frozen=True, slots=True)
class CandidateTopicEvidence:
    topic: TargetTopic
    material_mapping_present: bool
    materials: tuple[MaterialEvidence, ...]
    review: ReviewEvidence

    def __post_init__(self) -> None:
        if not isinstance(self.material_mapping_present, bool):
            raise ValueError("material mapping state must be boolean")
        if not isinstance(self.materials, tuple):
            raise ValueError("materials must be a tuple")
        if not isinstance(self.review, ReviewEvidence):
            raise ValueError("review evidence is required")


@dataclass(frozen=True, slots=True)
class CandidateDraft:
    candidate_key: str
    selected_target_slug: str
    source_target_slug: str
    target_topic_id: int
    discipline: str
    topic: str
    block_kind: PlannerBlockKind
    source_kind: PlannerSourceKind
    lesson_id: int | None
    material_id: int | None
    duration_minutes: int
    planned_questions: int
    stop_reason: CandidateStopReason | None
    evidence: Mapping[str, Any]

    @property
    def executable(self) -> bool:
        return self.stop_reason is None


@dataclass(frozen=True, slots=True)
class CandidatePool:
    all: tuple[CandidateDraft, ...]

    @property
    def executable(self) -> tuple[CandidateDraft, ...]:
        return tuple(item for item in self.all if item.executable)

    @property
    def rejected(self) -> tuple[CandidateDraft, ...]:
        return tuple(item for item in self.all if not item.executable)


def build_candidates(
    selected_target_slug: str,
    rows: tuple[CandidateTopicEvidence, ...],
) -> CandidatePool:
    target = selected_target_slug.strip()
    if not target:
        raise ValueError("selected target is required")
    if not isinstance(rows, tuple):
        raise ValueError("candidate topic evidence must be a tuple")
    candidates: list[CandidateDraft] = []
    for row in sorted(rows, key=lambda item: item.topic.id):
        transfer_confidence, target_stop = _transfer(row.topic, target)
        if not row.topic.active:
            target_stop = "inactive_topic"
        for block_kind in _BLOCK_ORDER:
            candidates.append(
                _candidate(
                    target,
                    row,
                    block_kind,
                    transfer_confidence,
                    target_stop,
                )
            )
    return CandidatePool(tuple(candidates))


def _candidate(
    selected_target: str,
    row: CandidateTopicEvidence,
    block_kind: PlannerBlockKind,
    transfer_confidence: int,
    target_stop: CandidateStopReason | None,
) -> CandidateDraft:
    material: MaterialEvidence | None = None
    stop_reason = target_stop
    source_kind: PlannerSourceKind = "tec" if block_kind != "theory" else "manual"
    if stop_reason is None and block_kind == "theory":
        material, stop_reason = _theory_material(row)
        if material is not None:
            source_kind = "bizu" if material.kind == "bizu" else "course"
    elif stop_reason is None and block_kind == "questions":
        if row.topic.tec_source_url is None:
            stop_reason = "tec_source_missing"
    elif stop_reason is None and block_kind == "review":
        if not (
            row.review.has_error_evidence
            or row.topic.review_debt > 0
            or row.topic.coverage_status == "weak"
        ):
            stop_reason = "review_evidence_missing"
        elif row.topic.tec_source_url is None:
            stop_reason = "tec_source_missing"

    planned_questions = 0
    duration_minutes = 60
    if block_kind == "questions":
        planned_questions = max(1, row.topic.planned_questions or 20)
    elif block_kind == "review":
        planned_questions = min(
            10, max(5, math.ceil((row.topic.planned_questions or 20) / 3))
        )
        duration_minutes = 45

    evidence = _evidence(
        selected_target,
        row,
        transfer_confidence,
        material,
        stop_reason,
    )
    return CandidateDraft(
        candidate_key=_candidate_key(selected_target, row.topic.id, block_kind),
        selected_target_slug=selected_target,
        source_target_slug=row.topic.target_slug,
        target_topic_id=row.topic.id,
        discipline=row.topic.discipline,
        topic=row.topic.topic,
        block_kind=block_kind,
        source_kind=source_kind,
        lesson_id=material.lesson_id if material else row.topic.lesson_id,
        material_id=material.material_id if material else row.topic.material_id,
        duration_minutes=duration_minutes,
        planned_questions=planned_questions,
        stop_reason=stop_reason,
        evidence=MappingProxyType(evidence),
    )


def _theory_material(
    row: CandidateTopicEvidence,
) -> tuple[MaterialEvidence | None, CandidateStopReason | None]:
    if not row.material_mapping_present:
        return None, "material_unmapped"
    if not row.materials:
        return None, "material_missing"
    available = tuple(item for item in row.materials if item.available)
    if not available:
        return None, "material_unavailable"
    primary = tuple(item for item in available if item.is_primary)
    if not primary:
        return None, "primary_material_missing"
    chosen = sorted(
        primary,
        key=lambda item: (-item.trust_level, item.kind, item.material_id),
    )[0]
    if chosen.kind in {"bizu", "track"} or chosen.trust_level < 5:
        return chosen, "low_trust_primary"
    if chosen.target_slug != row.topic.target_slug:
        return chosen, "material_target_mismatch"
    return chosen, None


def _transfer(
    topic: TargetTopic, selected_target: str
) -> tuple[int, CandidateStopReason | None]:
    if topic.target_slug == selected_target:
        return 100, None
    if topic.transfer_kind == "target_specific" or topic.overlap_value <= 0:
        return 0, "target_not_transferable"
    multiplier = 0.75 if topic.transfer_kind == "shared" else 0.5
    ceiling = 75 if topic.transfer_kind == "shared" else 50
    confidence = min(ceiling, max(1, round(topic.overlap_value * multiplier)))
    return confidence, None


def _evidence(
    selected_target: str,
    row: CandidateTopicEvidence,
    transfer_confidence: int,
    material: MaterialEvidence | None,
    stop_reason: CandidateStopReason | None,
) -> dict[str, Any]:
    topic = row.topic
    return {
        "targetTopicId": topic.id,
        "selectedTargetSlug": selected_target,
        "sourceTargetSlug": topic.target_slug,
        "transferKind": topic.transfer_kind,
        "transferConfidence": transfer_confidence,
        "coverageStatus": topic.coverage_status,
        "materialMappingPresent": row.material_mapping_present,
        "lessonId": material.lesson_id if material else topic.lesson_id,
        "materialId": material.material_id if material else topic.material_id,
        "materialKind": material.kind if material else None,
        "materialTrust": material.trust_level if material else None,
        "progressStatus": material.progress_status if material else None,
        "cursorPage": material.cursor_page if material else None,
        "pageCount": material.page_count if material else None,
        "tecSourceUrl": topic.tec_source_url,
        "tecSourceId": topic.tec_source_id,
        "wrongCount": row.review.wrong_count,
        "doubtCount": row.review.doubt_count,
        "favoriteCount": row.review.favorite_count,
        "failedSessions": row.review.failed_sessions,
        "weakProgress": row.review.weak_progress,
        "reviewDebt": topic.review_debt,
        "stopReason": stop_reason,
    }


def _candidate_key(
    selected_target: str, topic_id: int, block_kind: PlannerBlockKind
) -> str:
    identity = f"{selected_target}|{topic_id}|{block_kind}".encode("utf-8")
    return f"candidate-{hashlib.sha256(identity).hexdigest()[:20]}"


def collect_candidate_evidence(
    connection: sqlite3.Connection,
    selected_target_slug: str,
) -> tuple[CandidateTopicEvidence, ...]:
    target_slug = selected_target_slug.strip()
    repository = PlannerProfileRepository(connection)
    selected = repository.get_target(target_slug)
    if selected is None:
        raise KeyError(f"target profile {target_slug} does not exist")
    if not selected.active:
        raise ValueError(f"target profile {target_slug} is inactive")

    topics: list[TargetTopic] = []
    for target in repository.list_targets():
        if not target.active:
            continue
        for topic in repository.list_topics(target.target_slug):
            if topic.target_slug == target_slug or topic.transfer_kind in {
                "shared",
                "partial",
            }:
                topics.append(topic)
    return tuple(
        _collect_topic_evidence(connection, topic)
        for topic in sorted(topics, key=lambda item: item.id)
    )


def _collect_topic_evidence(
    connection: sqlite3.Connection,
    topic: TargetTopic,
) -> CandidateTopicEvidence:
    material_mapping_present = topic.lesson_id is not None or topic.material_id is not None
    materials = _collect_materials(connection, topic)
    review = _collect_review(connection, topic, materials)
    return CandidateTopicEvidence(
        topic=topic,
        material_mapping_present=material_mapping_present,
        materials=materials,
        review=review,
    )


def _collect_materials(
    connection: sqlite3.Connection,
    topic: TargetTopic,
) -> tuple[MaterialEvidence, ...]:
    if topic.material_id is not None:
        clause = "materials.id=?"
        parameter = topic.material_id
    elif topic.lesson_id is not None:
        clause = "materials.lesson_id=?"
        parameter = topic.lesson_id
    else:
        return ()
    rows = connection.execute(
        f"""
        SELECT materials.*, roots.target_slug AS material_target_slug,
               COALESCE(progress.status, 'unread') AS progress_status,
               COALESCE(progress.cursor_page, 1) AS cursor_page
        FROM materials
        JOIN courses ON courses.id=materials.course_id
        JOIN course_roots AS roots ON roots.id=courses.root_id
        LEFT JOIN progress_states AS progress
          ON progress.lesson_id=materials.lesson_id
         AND progress.material_id=materials.id
        WHERE {clause}
        ORDER BY materials.is_primary DESC, materials.trust_level DESC,
                 materials.id
        """,
        (parameter,),
    )
    return tuple(
        MaterialEvidence(
            lesson_id=row["lesson_id"],
            material_id=row["id"],
            target_slug=row["material_target_slug"],
            kind=row["kind"],
            available=bool(row["available"]),
            is_primary=bool(row["is_primary"]),
            trust_level=row["trust_level"],
            progress_status=row["progress_status"],
            cursor_page=row["cursor_page"],
            page_count=row["page_count"],
        )
        for row in rows
        if row["lesson_id"] is not None
    )


def _collect_review(
    connection: sqlite3.Connection,
    topic: TargetTopic,
    materials: tuple[MaterialEvidence, ...],
) -> ReviewEvidence:
    if topic.material_id is not None:
        clause = "material_id=?"
        parameter = topic.material_id
    elif topic.lesson_id is not None:
        clause = "lesson_id=?"
        parameter = topic.lesson_id
    else:
        return ReviewEvidence(weak_progress=topic.coverage_status == "weak")
    row = connection.execute(
        f"""
        SELECT COALESCE(SUM(wrong_count), 0) AS wrong_count,
               COALESCE(SUM(doubt_count), 0) AS doubt_count,
               COALESCE(SUM(favorite_count), 0) AS favorite_count,
               COALESCE(SUM(CASE WHEN outcome='failed' THEN 1 ELSE 0 END), 0)
                 AS failed_sessions
        FROM study_sessions WHERE {clause}
        """,
        (parameter,),
    ).fetchone()
    return ReviewEvidence(
        wrong_count=row["wrong_count"],
        doubt_count=row["doubt_count"],
        favorite_count=row["favorite_count"],
        failed_sessions=row["failed_sessions"],
        weak_progress=(
            topic.coverage_status == "weak"
            or any(material.progress_status == "weak" for material in materials)
        ),
    )
