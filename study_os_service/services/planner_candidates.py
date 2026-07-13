from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import date, datetime
import hashlib
import json
import math
import sqlite3
from types import MappingProxyType
from typing import Any, Literal, Mapping

from study_os_service.domain.planner import (
    PlannerBlockKind,
    PlannerSourceSelection,
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
    "adaptive_cooldown",
    "source_mapping_missing",
    "source_mapping_ambiguous",
    "source_current_material_missing",
    "source_choice_shortfall",
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
    "adaptive_cooldown",
    "source_mapping_missing",
    "source_mapping_ambiguous",
    "source_current_material_missing",
    "source_choice_shortfall",
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
    skipped_blocks: int = 0
    weak_progress: bool = False
    queue_item_id: int | None = None
    proof_questions: int = 0
    trigger_event_ids: tuple[int, ...] = ()
    queue_reason: str | None = None
    deferred_until: str | None = None

    def __post_init__(self) -> None:
        for name in (
            "wrong_count",
            "doubt_count",
            "favorite_count",
            "failed_sessions",
            "skipped_blocks",
        ):
            _non_negative(getattr(self, name), name.replace("_", " "))
        if not isinstance(self.weak_progress, bool):
            raise ValueError("weak progress must be boolean")
        if self.queue_item_id is not None:
            _positive(self.queue_item_id, "queue item id")
            if not 5 <= _positive(self.proof_questions, "proof questions") <= 10:
                raise ValueError("proof questions must be between 5 and 10")
            if not self.trigger_event_ids:
                raise ValueError("queue evidence requires trigger events")
        else:
            _non_negative(self.proof_questions, "proof questions")
        for event_id in self.trigger_event_ids:
            _positive(event_id, "trigger event id")
        if self.queue_reason is not None and not self.queue_reason.strip():
            raise ValueError("queue reason cannot be blank")
        if self.deferred_until is not None and not self.deferred_until.strip():
            raise ValueError("deferred until cannot be blank")

    @property
    def has_error_evidence(self) -> bool:
        return (
            self.wrong_count
            + self.doubt_count
            + self.favorite_count
            + self.failed_sessions
            + self.skipped_blocks
            > 0
            or self.weak_progress
            or self.queue_item_id is not None
        )


@dataclass(frozen=True, slots=True)
class ProjectedLearningEvidence:
    coverage_status: str
    mastery_bp: int
    confidence_bp: int
    review_debt_bp: int
    last_activity_at: datetime | None
    next_review_date: date | None
    stale_at: date | None
    event_cursor: int

    def __post_init__(self) -> None:
        if self.coverage_status not in _PROGRESS_STATUSES:
            raise ValueError("invalid projected coverage status")
        for value, label in (
            (self.mastery_bp, "projected mastery"),
            (self.confidence_bp, "projected confidence"),
            (self.review_debt_bp, "projected review debt"),
        ):
            if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= 10000:
                raise ValueError(f"{label} must be basis points")
        if self.last_activity_at is not None and (
            not isinstance(self.last_activity_at, datetime)
            or self.last_activity_at.tzinfo is None
        ):
            raise ValueError("last activity must be timezone-aware")
        for value, label in (
            (self.next_review_date, "next review date"),
            (self.stale_at, "stale at"),
        ):
            if value is not None and (
                isinstance(value, datetime) or not isinstance(value, date)
            ):
                raise ValueError(f"{label} must be a date")
        _non_negative(self.event_cursor, "event cursor")


@dataclass(frozen=True, slots=True)
class CandidateTopicEvidence:
    topic: TargetTopic
    material_mapping_present: bool
    materials: tuple[MaterialEvidence, ...]
    review: ReviewEvidence
    projected: ProjectedLearningEvidence | None = None
    as_of: date | None = None

    def __post_init__(self) -> None:
        if not isinstance(self.material_mapping_present, bool):
            raise ValueError("material mapping state must be boolean")
        if not isinstance(self.materials, tuple):
            raise ValueError("materials must be a tuple")
        if not isinstance(self.review, ReviewEvidence):
            raise ValueError("review evidence is required")
        if self.projected is not None and not isinstance(
            self.projected, ProjectedLearningEvidence
        ):
            raise ValueError("projected learning evidence is invalid")
        if self.as_of is not None and (
            isinstance(self.as_of, datetime) or not isinstance(self.as_of, date)
        ):
            raise ValueError("candidate as-of must be a date")


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
    adaptation_reason: str
    source_choice: PlannerSourceSelection | None = None

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


def attach_source_choices(
    connection: sqlite3.Connection,
    selected_target_slug: str,
    plan_date: date,
    pool: CandidatePool,
) -> CandidatePool:
    strategy_active = connection.execute(
        """
        SELECT 1
        FROM topic_source_mappings
        WHERE target_slug=?
        UNION ALL
        SELECT 1
        FROM strategy_sources
        WHERE target_slug=? AND active=1
        LIMIT 1
        """,
        (selected_target_slug, selected_target_slug),
    ).fetchone()
    if strategy_active is None:
        return pool

    from study_os_service.services.source_choice import SourceChoiceService

    service = SourceChoiceService(connection)
    attached = []
    for candidate in pool.all:
        result = service.choose(
            target_slug=selected_target_slug,
            target_topic_id=candidate.target_topic_id,
            block_kind=candidate.block_kind,
            as_of=plan_date,
            context={
                "coverageStatus": candidate.evidence.get("coverageStatus"),
                "reviewQueueReason": candidate.evidence.get("reviewQueueReason"),
                "adaptationReason": candidate.adaptation_reason,
            },
        )
        evidence = dict(candidate.evidence)
        alternatives = [
            {
                "choiceRowId": row.id,
                "sourceItemId": row.source_item_id,
                "chosen": row.chosen,
                "displacedByRowId": row.displaced_by_row_id,
                "stopReason": row.stop_reason,
                "finalScore": row.final_score,
                "evidence": dict(row.evidence),
            }
            for row in result.rows
        ]
        if result.selection is None:
            evidence["sourceChoice"] = {
                "status": "shortfall",
                "choiceRunId": result.run.id,
                "shortfallReason": result.run.shortfall_reason,
                "alternatives": alternatives,
            }
            stop_reason = candidate.stop_reason
            if stop_reason is None or stop_reason in _SOURCE_STOP_REASONS:
                stop_reason = _choice_stop_reason(result.run.shortfall_reason)
            attached.append(
                replace(
                    candidate,
                    stop_reason=stop_reason,
                    evidence=MappingProxyType(evidence),
                    adaptation_reason="strategy_source_shortfall",
                    source_choice=None,
                )
            )
            continue

        selection = result.selection
        choice_evidence = dict(selection.evidence)
        evidence["sourceChoice"] = {
            "status": "chosen",
            "choiceRunId": selection.choice_run_id,
            "choiceRowId": selection.choice_row_id,
            "sourceItemId": selection.source_item_id,
            "sourceKind": selection.source_kind,
            "displayName": selection.display_name,
            "contentRole": selection.content_role,
            "sourceTargetSlug": selection.source_target_slug,
            "lessonId": selection.lesson_id,
            "materialId": selection.material_id,
            "externalUrl": selection.external_url,
            "externalId": selection.external_id,
            "finalScore": selection.final_score,
            "evidence": choice_evidence,
            "alternatives": alternatives,
        }
        evidence.update(
            {
                "sourceTargetSlug": selection.source_target_slug,
                "transferConfidence": choice_evidence[
                    "transferConfidenceBp"
                ]
                // 100,
                "profileSourceKind": _planner_source_kind(selection.source_kind),
                "lessonId": selection.lesson_id,
                "materialId": selection.material_id,
                "materialKind": choice_evidence.get("materialKind"),
                "materialTrust": choice_evidence["trustBp"] // 1000,
            }
        )
        proof = _tec_proof_source(result.rows)
        if selection.source_kind == "tec":
            evidence["tecSourceUrl"] = selection.external_url
            evidence["tecSourceId"] = selection.external_id
        elif proof is not None:
            evidence["tecSourceUrl"] = proof.get("externalUrl")
            evidence["tecSourceId"] = proof.get("externalId")
            evidence["reviewProofSource"] = proof

        stop_reason = candidate.stop_reason
        if stop_reason in _SOURCE_STOP_REASONS:
            if candidate.block_kind == "review" and evidence.get("tecSourceUrl") is None:
                stop_reason = "tec_source_missing"
            else:
                stop_reason = None
        attached.append(
            replace(
                candidate,
                source_target_slug=selection.source_target_slug,
                source_kind=_planner_source_kind(selection.source_kind),
                lesson_id=selection.lesson_id,
                material_id=selection.material_id,
                stop_reason=stop_reason,
                evidence=MappingProxyType(evidence),
                adaptation_reason="strategy_source_choice",
                source_choice=selection,
            )
        )
    return CandidatePool(tuple(attached))


_SOURCE_STOP_REASONS = {
    "material_unmapped",
    "material_missing",
    "material_unavailable",
    "primary_material_missing",
    "low_trust_primary",
    "material_target_mismatch",
    "tec_source_missing",
    "source_mapping_missing",
    "source_mapping_ambiguous",
    "source_current_material_missing",
    "source_choice_shortfall",
}


def _choice_stop_reason(reason: str | None) -> CandidateStopReason:
    if reason == "no_source_mapping":
        return "source_mapping_missing"
    if reason == "no_approved_source_mapping":
        return "source_mapping_ambiguous"
    if reason == "missing_current_material":
        return "source_current_material_missing"
    return "source_choice_shortfall"


def _planner_source_kind(source_kind: str) -> PlannerSourceKind:
    if source_kind == "passo":
        return "trilha"
    if source_kind == "andrety":
        return "manual"
    return source_kind


def _tec_proof_source(rows) -> dict[str, Any] | None:
    for row in rows:
        evidence = dict(row.evidence)
        if (
            evidence.get("sourceKind") == "tec"
            and evidence.get("externalUrl")
            and evidence.get("mappingStatus") == "approved"
            and evidence.get("stopReason") is None
        ):
            return {
                "sourceItemId": row.source_item_id,
                "externalUrl": evidence["externalUrl"],
                "externalId": evidence.get("externalId"),
            }
    return None


def _candidate(
    selected_target: str,
    row: CandidateTopicEvidence,
    block_kind: PlannerBlockKind,
    transfer_confidence: int,
    target_stop: CandidateStopReason | None,
) -> CandidateDraft:
    material: MaterialEvidence | None = None
    stop_reason = target_stop
    projected = row.projected
    stale_due = bool(
        projected is not None
        and row.as_of is not None
        and projected.stale_at is not None
        and row.as_of >= projected.stale_at
    )
    effective_status = (
        "stale"
        if stale_due
        else projected.coverage_status
        if projected is not None
        else row.topic.coverage_status
    )
    adaptation_reason = _adaptation_reason(row, stale_due)
    source_kind: PlannerSourceKind = "tec" if block_kind != "theory" else "manual"
    if (
        stop_reason is None
        and projected is not None
        and not stale_due
        and effective_status in {"covered", "strong"}
        and block_kind in {"theory", "questions"}
    ):
        stop_reason = "adaptive_cooldown"
    if stop_reason is None and block_kind == "theory":
        material, stop_reason = _theory_material(row)
        if material is not None:
            source_kind = "bizu" if material.kind == "bizu" else "course"
    elif stop_reason is None and block_kind == "questions":
        if row.topic.tec_source_url is None:
            stop_reason = "tec_source_missing"
    elif stop_reason is None and block_kind == "review":
        if row.review.deferred_until is not None:
            stop_reason = "review_evidence_missing"
        elif projected is not None and row.review.queue_item_id is None:
            stop_reason = "review_evidence_missing"
        elif not (
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
        planned_questions = row.review.proof_questions or min(
            10, max(5, math.ceil((row.topic.planned_questions or 20) / 3))
        )
        duration_minutes = 45

    evidence = _evidence(
        selected_target,
        row,
        transfer_confidence,
        material,
        stop_reason,
        effective_status,
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
        adaptation_reason=adaptation_reason,
        source_choice=None,
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
    effective_status: str,
) -> dict[str, Any]:
    topic = row.topic
    return {
        "targetTopicId": topic.id,
        "selectedTargetSlug": selected_target,
        "sourceTargetSlug": topic.target_slug,
        "transferKind": topic.transfer_kind,
        "transferConfidence": transfer_confidence,
        "coverageStatus": effective_status,
        "profileCoverageStatus": topic.coverage_status,
        "incidence": topic.incidence,
        "tier": topic.tier,
        "bancaFit": topic.banca_fit,
        "overlapValue": topic.overlap_value,
        "editalWeight": topic.edital_weight,
        "profileSourceKind": topic.source_kind,
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
        "skippedBlocks": row.review.skipped_blocks,
        "weakProgress": row.review.weak_progress,
        "reviewDebt": topic.review_debt,
        "reviewQueueItemId": row.review.queue_item_id,
        "reviewProofQuestions": row.review.proof_questions,
        "reviewTriggerEventIds": list(row.review.trigger_event_ids),
        "reviewQueueReason": row.review.queue_reason,
        "reviewDeferredUntil": row.review.deferred_until,
        "projectedCoverageStatus": (
            row.projected.coverage_status if row.projected else None
        ),
        "projectedMasteryBp": row.projected.mastery_bp if row.projected else None,
        "projectedConfidenceBp": (
            row.projected.confidence_bp if row.projected else None
        ),
        "projectedReviewDebtBp": (
            row.projected.review_debt_bp if row.projected else None
        ),
        "nextReviewDate": (
            row.projected.next_review_date.isoformat()
            if row.projected and row.projected.next_review_date
            else None
        ),
        "staleAt": (
            row.projected.stale_at.isoformat()
            if row.projected and row.projected.stale_at
            else None
        ),
        "learningEventCursor": row.projected.event_cursor if row.projected else None,
        "weeklyAlignment": 0,
        "adaptationReason": _adaptation_reason(
            row,
            bool(
                row.projected
                and row.as_of
                and row.projected.stale_at
                and row.as_of >= row.projected.stale_at
            ),
        ),
        "stopReason": stop_reason,
    }


def _adaptation_reason(
    row: CandidateTopicEvidence, stale_due: bool
) -> str:
    if row.projected is None:
        return "profile_fallback"
    if stale_due:
        return "stale_return"
    if row.review.queue_item_id is not None and row.review.deferred_until is None:
        return "bounded_review_due"
    if row.projected.coverage_status == "in_progress":
        return "resume_partial"
    if row.projected.coverage_status in {"covered", "strong"}:
        return "cooldown_after_success"
    if row.projected.coverage_status == "weak":
        return "projected_weakness"
    return "projected_state"


def _candidate_key(
    selected_target: str, topic_id: int, block_kind: PlannerBlockKind
) -> str:
    identity = f"{selected_target}|{topic_id}|{block_kind}".encode("utf-8")
    return f"candidate-{hashlib.sha256(identity).hexdigest()[:20]}"


def collect_candidate_evidence(
    connection: sqlite3.Connection,
    selected_target_slug: str,
    as_of: date | None = None,
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
        _collect_topic_evidence(connection, topic, target_slug, as_of)
        for topic in sorted(topics, key=lambda item: item.id)
    )


def _collect_topic_evidence(
    connection: sqlite3.Connection,
    topic: TargetTopic,
    selected_target_slug: str,
    as_of: date | None,
) -> CandidateTopicEvidence:
    material_mapping_present = topic.lesson_id is not None or topic.material_id is not None
    materials = _collect_materials(connection, topic)
    review = _collect_review(
        connection, topic, materials, selected_target_slug, as_of
    )
    state = connection.execute(
        """
        SELECT * FROM topic_learning_states
        WHERE target_slug=? AND target_topic_id=?
        """,
        (selected_target_slug, topic.id),
    ).fetchone()
    projected = (
        ProjectedLearningEvidence(
            coverage_status=state["coverage_status"],
            mastery_bp=state["mastery_bp"],
            confidence_bp=state["confidence_bp"],
            review_debt_bp=state["review_debt_bp"],
            last_activity_at=(
                datetime.fromisoformat(state["last_activity_at"].replace("Z", "+00:00"))
                if state["last_activity_at"]
                else None
            ),
            next_review_date=(
                date.fromisoformat(state["next_review_date"])
                if state["next_review_date"]
                else None
            ),
            stale_at=(
                date.fromisoformat(state["stale_at"])
                if state["stale_at"]
                else None
            ),
            event_cursor=state["event_cursor"],
        )
        if state
        else None
    )
    return CandidateTopicEvidence(
        topic=topic,
        material_mapping_present=material_mapping_present,
        materials=materials,
        review=review,
        projected=projected,
        as_of=as_of,
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
    selected_target_slug: str,
    as_of: date | None,
) -> ReviewEvidence:
    session_counts = {
        "wrong_count": 0,
        "doubt_count": 0,
        "favorite_count": 0,
        "failed_sessions": 0,
    }
    if topic.material_id is not None:
        clause = "material_id=?"
        parameter = topic.material_id
    elif topic.lesson_id is not None:
        clause = "lesson_id=?"
        parameter = topic.lesson_id
    else:
        clause = None
        parameter = None
    if clause is not None:
        session_row = connection.execute(
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
        session_counts = dict(session_row)
    block_row = connection.execute(
        """
        SELECT COALESCE(SUM(blocks.wrong_count), 0) AS wrong_count,
               COALESCE(SUM(blocks.doubt_count), 0) AS doubt_count,
               COALESCE(SUM(blocks.favorite_count), 0) AS favorite_count,
               COALESCE(SUM(CASE WHEN blocks.state='failed' THEN 1 ELSE 0 END), 0)
                 AS failed_blocks,
               COALESCE(SUM(CASE WHEN blocks.state='skipped' THEN 1 ELSE 0 END), 0)
                 AS skipped_blocks
        FROM planner_blocks AS blocks
        JOIN planner_candidates AS candidates
          ON candidates.id=blocks.candidate_id
        WHERE candidates.target_topic_id=?
        """,
        (topic.id,),
    ).fetchone()
    queue_row = connection.execute(
        """
        SELECT * FROM review_queue_items
        WHERE target_slug=? AND target_topic_id=?
          AND state IN ('pending','deferred')
          AND (state='deferred' OR ? IS NULL OR due_date<=?)
        ORDER BY due_date, id LIMIT 1
        """,
        (
            selected_target_slug,
            topic.id,
            as_of.isoformat() if as_of else None,
            as_of.isoformat() if as_of else None,
        ),
    ).fetchone()
    return ReviewEvidence(
        wrong_count=session_counts["wrong_count"] + block_row["wrong_count"],
        doubt_count=session_counts["doubt_count"] + block_row["doubt_count"],
        favorite_count=(
            session_counts["favorite_count"] + block_row["favorite_count"]
        ),
        failed_sessions=(
            session_counts["failed_sessions"] + block_row["failed_blocks"]
        ),
        skipped_blocks=block_row["skipped_blocks"],
        weak_progress=(
            topic.coverage_status == "weak"
            or any(material.progress_status == "weak" for material in materials)
        ),
        queue_item_id=queue_row["id"] if queue_row else None,
        proof_questions=queue_row["bounded_questions"] if queue_row else 0,
        trigger_event_ids=(
            tuple(json.loads(queue_row["trigger_event_ids_json"]))
            if queue_row
            else ()
        ),
        queue_reason=queue_row["reason"] if queue_row else None,
        deferred_until=(
            queue_row["due_date"]
            if queue_row and queue_row["state"] == "deferred"
            else None
        ),
    )
