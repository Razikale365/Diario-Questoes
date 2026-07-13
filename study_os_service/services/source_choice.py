from __future__ import annotations

from dataclasses import dataclass
from datetime import date
import hashlib
import json
import re
import sqlite3
from types import MappingProxyType
from typing import Any, Literal, Mapping

from study_os_service.domain.planner import PlannerSourceSelection
from study_os_service.domain.strategy import SourceChoiceRow, SourceChoiceRun
from study_os_service.repositories.strategy import StrategyRepository


ALGORITHM_VERSION = "m6-source-choice-v1"
BlockKind = Literal["theory", "questions", "review"]

_BLOCK_ROLES = {
    "theory": {"primary_theory"},
    "questions": {"question_practice", "incidence_signal"},
    "review": {
        "review_support",
        "question_practice",
        "incidence_signal",
        "primary_theory",
    },
}


@dataclass(frozen=True, slots=True)
class _Candidate:
    source_item_id: int
    source_id: int
    source_kind: str
    display_name: str
    trust_tier: int
    source_target_slug: str
    source_version: int
    edition: str
    content_role: str
    source_order: int
    lesson_id: int | None
    material_id: int | None
    external_url: str | None
    external_id: str | None
    incidence_bp: int
    item_version: int
    mapping_status: str
    mapping_confidence_bp: int
    primary_eligible: bool
    manual_override: bool
    transfer_kind: str
    mapping_version: int
    material_available: bool | None
    material_kind: str | None
    lesson_status: str | None


@dataclass(frozen=True, slots=True)
class _Scored:
    candidate: _Candidate
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
    stop_reason: str | None
    evidence: Mapping[str, object]


@dataclass(frozen=True, slots=True)
class SourceChoiceResult:
    run: SourceChoiceRun
    rows: tuple[SourceChoiceRow, ...]
    selection: PlannerSourceSelection | None


def _canonical(value: object) -> str:
    return json.dumps(
        value, ensure_ascii=True, sort_keys=True, separators=(",", ":")
    )


def _hash(value: object) -> str:
    return hashlib.sha256(_canonical(value).encode("utf-8")).hexdigest()


def _edition_year(edition: str) -> int | None:
    years = [int(value) for value in re.findall(r"\b20\d{2}\b", edition)]
    return max(years) if years else None


class SourceChoiceService:
    def __init__(self, connection: sqlite3.Connection):
        self.connection = connection
        self.repository = StrategyRepository(connection)

    def choose(
        self,
        *,
        target_slug: str,
        target_topic_id: int,
        block_kind: BlockKind,
        as_of: date,
    ) -> SourceChoiceResult:
        target = target_slug.strip()
        if not target:
            raise ValueError("target is required")
        if block_kind not in _BLOCK_ROLES:
            raise ValueError("invalid source choice block kind")
        if not isinstance(as_of, date):
            raise ValueError("source choice as-of must be a date")
        topic = self.connection.execute(
            """
            SELECT * FROM target_topics
            WHERE id=? AND target_slug=? AND active=1
            """,
            (target_topic_id, target),
        ).fetchone()
        if topic is None:
            raise KeyError(
                f"target topic {target_topic_id} does not belong to {target}"
            )
        candidates = self._candidates(target, target_topic_id)
        input_hash = self._input_hash(
            target=target,
            target_topic_id=target_topic_id,
            block_kind=block_kind,
            as_of=as_of,
            candidates=candidates,
        )
        key = f"source-choice:{target}:{target_topic_id}:{block_kind}:{input_hash}"
        existing = self.repository.get_choice_run_by_key(key)
        if existing is not None:
            return self._result(existing)

        scored = self._score_all(candidates, target, block_kind, as_of)
        viable = tuple(item for item in scored if item.stop_reason is None)
        chosen = (
            sorted(
                viable,
                key=lambda item: (
                    -item.final_score,
                    -item.strategy_alignment_bp,
                    -item.freshness_bp,
                    item.candidate.source_item_id,
                ),
            )[0]
            if viable
            else None
        )
        shortfall_reason = self._shortfall_reason(
            candidates, scored, block_kind, as_of
        )
        self.connection.execute("BEGIN IMMEDIATE")
        try:
            run = self.repository.insert_choice_run(
                idempotency_key=key,
                target_slug=target,
                target_topic_id=target_topic_id,
                block_kind=block_kind,
                algorithm_version=ALGORITHM_VERSION,
                input_hash=input_hash,
                status="chosen" if chosen is not None else "shortfall",
                shortfall_reason=None if chosen is not None else shortfall_reason,
            )
            chosen_row = None
            if chosen is not None:
                chosen_row = self._insert_row(
                    run, chosen, chosen=True, displaced_by_row_id=None
                )
            for item in scored:
                if chosen is not None and item.candidate.source_item_id == chosen.candidate.source_item_id:
                    continue
                self._insert_row(
                    run,
                    item,
                    chosen=False,
                    displaced_by_row_id=(
                        chosen_row.id
                        if chosen_row is not None and item.stop_reason is None
                        else None
                    ),
                )
            self.connection.commit()
            return self._result(run)
        except Exception:
            self.connection.rollback()
            raise

    def _candidates(
        self, target_slug: str, target_topic_id: int
    ) -> tuple[_Candidate, ...]:
        rows = self.connection.execute(
            """
            SELECT items.id AS source_item_id, items.source_id,
                   items.content_role, items.source_order, items.lesson_id,
                   items.material_id,
                   COALESCE(items.external_url, sources.external_url) AS external_url,
                   COALESCE(items.external_id, sources.external_id) AS external_id,
                   items.incidence_bp, items.version AS item_version,
                   sources.source_kind, sources.display_name,
                   sources.trust_tier, sources.target_slug AS source_target_slug,
                   sources.version AS source_version, sources.edition,
                   mappings.mapping_status, mappings.confidence_bp,
                   mappings.primary_eligible, mappings.manual_override,
                   mappings.transfer_kind, mappings.version AS mapping_version,
                   materials.available AS material_available,
                   materials.kind AS material_kind,
                   lessons.status AS lesson_status
            FROM topic_source_mappings AS mappings
            JOIN strategy_source_items AS items
              ON items.id=mappings.source_item_id AND items.active=1
            JOIN strategy_sources AS sources
              ON sources.id=items.source_id AND sources.active=1
            LEFT JOIN materials ON materials.id=items.material_id
            LEFT JOIN lessons ON lessons.id=items.lesson_id
            WHERE mappings.target_slug=? AND mappings.target_topic_id=?
              AND mappings.mapping_status!='rejected'
            ORDER BY items.id
            """,
            (target_slug, target_topic_id),
        ).fetchall()
        return tuple(
            _Candidate(
                source_item_id=row["source_item_id"],
                source_id=row["source_id"],
                source_kind=row["source_kind"],
                display_name=row["display_name"],
                trust_tier=row["trust_tier"],
                source_target_slug=row["source_target_slug"],
                source_version=row["source_version"],
                edition=row["edition"],
                content_role=row["content_role"],
                source_order=row["source_order"],
                lesson_id=row["lesson_id"],
                material_id=row["material_id"],
                external_url=row["external_url"],
                external_id=row["external_id"],
                incidence_bp=row["incidence_bp"],
                item_version=row["item_version"],
                mapping_status=row["mapping_status"],
                mapping_confidence_bp=row["confidence_bp"],
                primary_eligible=bool(row["primary_eligible"]),
                manual_override=bool(row["manual_override"]),
                transfer_kind=row["transfer_kind"],
                mapping_version=row["mapping_version"],
                material_available=(
                    bool(row["material_available"])
                    if row["material_available"] is not None
                    else None
                ),
                material_kind=row["material_kind"],
                lesson_status=row["lesson_status"],
            )
            for row in rows
        )

    @staticmethod
    def _input_hash(
        *,
        target: str,
        target_topic_id: int,
        block_kind: str,
        as_of: date,
        candidates: tuple[_Candidate, ...],
    ) -> str:
        return _hash(
            {
                "algorithmVersion": ALGORITHM_VERSION,
                "targetSlug": target,
                "targetTopicId": target_topic_id,
                "blockKind": block_kind,
                "asOf": as_of.isoformat(),
                "candidates": [
                    {
                        "sourceItemId": item.source_item_id,
                        "sourceKind": item.source_kind,
                        "sourceTargetSlug": item.source_target_slug,
                        "sourceVersion": item.source_version,
                        "edition": item.edition,
                        "contentRole": item.content_role,
                        "sourceOrder": item.source_order,
                        "lessonId": item.lesson_id,
                        "materialId": item.material_id,
                        "externalUrl": item.external_url,
                        "incidenceBp": item.incidence_bp,
                        "itemVersion": item.item_version,
                        "mappingStatus": item.mapping_status,
                        "mappingConfidenceBp": item.mapping_confidence_bp,
                        "primaryEligible": item.primary_eligible,
                        "manualOverride": item.manual_override,
                        "transferKind": item.transfer_kind,
                        "mappingVersion": item.mapping_version,
                        "materialAvailable": item.material_available,
                        "lessonStatus": item.lesson_status,
                    }
                    for item in candidates
                ],
            }
        )

    def _score_all(
        self,
        candidates: tuple[_Candidate, ...],
        target_slug: str,
        block_kind: str,
        as_of: date,
    ) -> tuple[_Scored, ...]:
        newest_year = max(
            (_edition_year(item.edition) or 0 for item in candidates),
            default=0,
        )
        return tuple(
            self._score(item, target_slug, block_kind, as_of, newest_year)
            for item in candidates
        )

    @staticmethod
    def _score(
        item: _Candidate,
        target_slug: str,
        block_kind: str,
        as_of: date,
        newest_year: int,
    ) -> _Scored:
        same_target = item.source_target_slug == target_slug
        target_fit = (
            10000
            if same_target
            else 7500
            if item.transfer_kind == "shared"
            else 5500
        )
        transfer_confidence = item.mapping_confidence_bp
        trust = item.trust_tier * 1000
        year = _edition_year(item.edition)
        if year is None:
            freshness = 5000
        else:
            age = max(0, as_of.year - year)
            freshness = {0: 10000, 1: 8000, 2: 5500}.get(age, 2500)
        order_readiness = {
            "completed": 10000,
            "in_progress": 9000,
            "unread": 7500,
            "skipped": 5000,
        }.get(item.lesson_status, 8000)
        strategy_alignment = SourceChoiceService._strategy_alignment(
            item, block_kind
        )
        availability = SourceChoiceService._availability(item)
        low_trust_penalty = max(0, 5000 - trust)
        mismatch_penalty = (
            0
            if same_target
            else 2500
            if item.transfer_kind == "shared"
            else 5000
        )
        stop_reason = SourceChoiceService._stop_reason(
            item, block_kind, newest_year
        )
        final_score = (
            target_fit * 2
            + transfer_confidence
            + trust
            + freshness
            + order_readiness
            + strategy_alignment * 3
            + availability * 2
            + min(2000, item.incidence_bp // 5)
            - low_trust_penalty * 2
            - mismatch_penalty * 2
        )
        evidence = MappingProxyType(
            {
                "algorithmVersion": ALGORITHM_VERSION,
                "sourceId": item.source_id,
                "sourceItemId": item.source_item_id,
                "sourceKind": item.source_kind,
                "displayName": item.display_name,
                "contentRole": item.content_role,
                "sourceTargetSlug": item.source_target_slug,
                "targetFitBp": target_fit,
                "transferConfidenceBp": transfer_confidence,
                "trustBp": trust,
                "freshnessBp": freshness,
                "orderReadinessBp": order_readiness,
                "strategyAlignmentBp": strategy_alignment,
                "materialAvailabilityBp": availability,
                "lowTrustPenaltyBp": low_trust_penalty,
                "mismatchPenaltyBp": mismatch_penalty,
                "incidenceBp": item.incidence_bp,
                "edition": item.edition,
                "lessonId": item.lesson_id,
                "materialId": item.material_id,
                "externalUrl": item.external_url,
                "externalId": item.external_id,
                "mappingStatus": item.mapping_status,
                "mappingConfidenceBp": item.mapping_confidence_bp,
                "primaryEligible": item.primary_eligible,
                "manualOverride": item.manual_override,
                "transferKind": item.transfer_kind,
                "stopReason": stop_reason,
                "finalScore": final_score,
            }
        )
        return _Scored(
            candidate=item,
            target_fit_bp=target_fit,
            transfer_confidence_bp=transfer_confidence,
            trust_bp=trust,
            freshness_bp=freshness,
            order_readiness_bp=order_readiness,
            strategy_alignment_bp=strategy_alignment,
            material_availability_bp=availability,
            low_trust_penalty_bp=low_trust_penalty,
            mismatch_penalty_bp=mismatch_penalty,
            final_score=final_score,
            stop_reason=stop_reason,
            evidence=evidence,
        )

    @staticmethod
    def _strategy_alignment(item: _Candidate, block_kind: str) -> int:
        role_scores = {
            "theory": {"primary_theory": 10000},
            "questions": {
                "question_practice": 10000,
                "incidence_signal": 9500,
            },
            "review": {
                "review_support": 10000,
                "question_practice": 9000,
                "incidence_signal": 7500,
                "primary_theory": 5000,
            },
        }
        score = role_scores[block_kind].get(item.content_role, 0)
        if block_kind == "review" and item.source_kind in {"passo", "trilha"}:
            score = min(10000, score + 500)
        if item.manual_override:
            score = min(10000, score + 500)
        return score

    @staticmethod
    def _availability(item: _Candidate) -> int:
        if item.material_id is not None:
            return 10000 if item.material_available else 0
        if item.external_url is not None:
            return 10000
        if item.content_role == "schedule_advice":
            return 7500
        return 0

    @staticmethod
    def _stop_reason(
        item: _Candidate, block_kind: str, newest_year: int
    ) -> str | None:
        if item.mapping_status != "approved":
            return "mapping_not_approved"
        if block_kind == "theory":
            if not item.primary_eligible and not item.manual_override:
                return "not_primary_theory"
            if item.content_role not in _BLOCK_ROLES[block_kind] and not item.manual_override:
                return "incompatible_source_role"
            if item.material_id is None:
                return "material_missing"
            if not item.material_available:
                return "material_unavailable"
            year = _edition_year(item.edition)
            if newest_year and year and newest_year - year >= 2:
                return "stale_superseded"
        elif item.content_role not in _BLOCK_ROLES[block_kind]:
            return "incompatible_source_role"
        elif item.material_id is not None and not item.material_available:
            return "material_unavailable"
        elif item.material_id is None and item.external_url is None:
            return "source_unavailable"
        return None

    @staticmethod
    def _shortfall_reason(
        candidates: tuple[_Candidate, ...],
        scored: tuple[_Scored, ...],
        block_kind: str,
        as_of: date,
    ) -> str:
        if not candidates:
            return "no_source_mapping"
        if not any(item.mapping_status == "approved" for item in candidates):
            return "no_approved_source_mapping"
        if block_kind == "theory":
            newest_year = max(
                (_edition_year(item.edition) or 0 for item in candidates),
                default=0,
            )
            newest = [
                item
                for item in candidates
                if (_edition_year(item.edition) or 0) == newest_year
            ]
            if newest and any(
                item.material_id is not None and not item.material_available
                for item in newest
            ):
                return "missing_current_material"
        reasons = {item.stop_reason for item in scored}
        if reasons == {"mapping_not_approved"}:
            return "no_approved_source_mapping"
        return "no_compatible_source"

    def _insert_row(
        self,
        run: SourceChoiceRun,
        item: _Scored,
        *,
        chosen: bool,
        displaced_by_row_id: int | None,
    ) -> SourceChoiceRow:
        return self.repository.insert_choice_row(
            run_id=run.id,
            target_slug=run.target_slug,
            source_item_id=item.candidate.source_item_id,
            target_fit_bp=item.target_fit_bp,
            transfer_confidence_bp=item.transfer_confidence_bp,
            trust_bp=item.trust_bp,
            freshness_bp=item.freshness_bp,
            order_readiness_bp=item.order_readiness_bp,
            strategy_alignment_bp=item.strategy_alignment_bp,
            material_availability_bp=item.material_availability_bp,
            low_trust_penalty_bp=item.low_trust_penalty_bp,
            mismatch_penalty_bp=item.mismatch_penalty_bp,
            final_score=item.final_score,
            chosen=chosen,
            displaced_by_row_id=displaced_by_row_id,
            stop_reason=(None if chosen or displaced_by_row_id else item.stop_reason),
            evidence=item.evidence,
        )

    def _result(self, run: SourceChoiceRun) -> SourceChoiceResult:
        rows = self.repository.list_choice_rows(run.id)
        chosen = next((row for row in rows if row.chosen), None)
        selection = self._selection(run, chosen) if chosen is not None else None
        return SourceChoiceResult(run=run, rows=rows, selection=selection)

    def _selection(
        self, run: SourceChoiceRun, row: SourceChoiceRow
    ) -> PlannerSourceSelection:
        item = self.repository.get_source_item(row.source_item_id)
        if item is None:
            raise RuntimeError("chosen strategy source item disappeared")
        source = self.repository.get_source(item.source_id)
        if source is None:
            raise RuntimeError("chosen strategy source disappeared")
        return PlannerSourceSelection(
            choice_run_id=run.id,
            choice_row_id=row.id,
            source_item_id=item.id,
            source_kind=source.source_kind,
            display_name=source.display_name,
            content_role=item.content_role,
            source_target_slug=source.target_slug,
            lesson_id=item.lesson_id,
            material_id=item.material_id,
            external_url=item.external_url or source.external_url,
            external_id=item.external_id or source.external_id,
            final_score=row.final_score,
            evidence=row.evidence,
        )
