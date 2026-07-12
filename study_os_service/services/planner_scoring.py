from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
import hashlib
import json
from types import MappingProxyType
from typing import Any, Mapping

from study_os_service.domain.planner import ExamTarget, ScoreBreakdown
from study_os_service.services.planner_candidates import CandidateDraft


ALGORITHM_VERSION = "m5-v1"

PRE_EDITAL_WEIGHTS = MappingProxyType(
    {
        "weakness": 3000,
        "incidence": 1500,
        "tier": 1500,
        "coverage_need": 2000,
        "review_debt": 1500,
        "ls_alignment": 500,
        "target_fit": 1500,
        "overlap_value": 1000,
        "deadline_pressure": 500,
        "banca_fit": 1000,
        "edital_weight": 1500,
        "weekly_alignment": 500,
    }
)
POS_EDITAL_WEIGHTS = MappingProxyType(
    {
        "weakness": 3500,
        "incidence": 2500,
        "tier": 1500,
        "coverage_need": 1000,
        "review_debt": 1000,
        "ls_alignment": 500,
        "target_fit": 1500,
        "overlap_value": 1000,
        "deadline_pressure": 2000,
        "banca_fit": 1000,
        "edital_weight": 1500,
        "weekly_alignment": 500,
    }
)
PENALTY_WEIGHTS = MappingProxyType(
    {"balance_penalty": 2000, "low_trust_penalty": 3000}
)

_COVERAGE_NEED = {
    "unread": 10000,
    "stale": 8500,
    "weak": 7000,
    "in_progress": 5500,
    "covered": 2500,
    "strong": 500,
}
_WEAKNESS = {
    "weak": 9000,
    "stale": 7000,
    "unread": 5500,
    "in_progress": 5000,
    "covered": 2500,
    "strong": 1000,
}


def _positive_count(value: Any, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError(f"{label} must be a non-negative integer")
    return value


@dataclass(frozen=True, slots=True)
class ScoringContext:
    target: ExamTarget
    plan_date: date
    ls_target_slug: str | None
    discipline_counts: Mapping[str, int]

    def __post_init__(self) -> None:
        if isinstance(self.plan_date, datetime) or not isinstance(self.plan_date, date):
            raise ValueError("plan date must be a date")
        if self.ls_target_slug is not None and (
            not isinstance(self.ls_target_slug, str) or not self.ls_target_slug.strip()
        ):
            raise ValueError("LS target must be non-empty when supplied")
        if not isinstance(self.discipline_counts, Mapping):
            raise ValueError("discipline counts must be a mapping")
        normalized: dict[str, int] = {}
        for discipline, count in self.discipline_counts.items():
            if not isinstance(discipline, str) or not discipline.strip():
                raise ValueError("discipline count key is required")
            normalized[discipline.strip()] = _positive_count(count, "discipline count")
        object.__setattr__(self, "discipline_counts", MappingProxyType(normalized))


@dataclass(frozen=True, slots=True)
class ScoredCandidate:
    candidate: CandidateDraft
    breakdown: ScoreBreakdown
    input_hash: str
    evidence_json: str


def score_candidates(
    candidates: tuple[CandidateDraft, ...],
    context: ScoringContext,
) -> tuple[ScoredCandidate, ...]:
    if not isinstance(candidates, tuple):
        raise ValueError("candidates must be a tuple")
    input_hash = canonical_input_hash(candidates, context)
    scored = tuple(_score(candidate, context, input_hash) for candidate in candidates)
    return tuple(
        sorted(
            scored,
            key=lambda item: (
                not item.candidate.executable,
                -item.breakdown.final_score,
                -item.breakdown.weakness,
                -item.breakdown.edital_weight,
                -item.breakdown.incidence,
                item.candidate.candidate_key,
            ),
        )
    )


def canonical_input_hash(
    candidates: tuple[CandidateDraft, ...],
    context: ScoringContext,
) -> str:
    document = {
        "algorithmVersion": ALGORITHM_VERSION,
        "context": {
            "targetSlug": context.target.target_slug,
            "targetVersion": context.target.version,
            "phase": context.target.phase,
            "deadline": (
                context.target.deadline.isoformat() if context.target.deadline else None
            ),
            "planDate": context.plan_date.isoformat(),
            "lsTargetSlug": context.ls_target_slug,
            "disciplineCounts": dict(sorted(context.discipline_counts.items())),
        },
        "candidates": [
            {
                "candidateKey": candidate.candidate_key,
                "blockKind": candidate.block_kind,
                "sourceKind": candidate.source_kind,
                "stopReason": candidate.stop_reason,
                "evidence": dict(candidate.evidence),
            }
            for candidate in sorted(candidates, key=lambda item: item.candidate_key)
        ],
    }
    encoded = _canonical_json(document).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _score(
    candidate: CandidateDraft,
    context: ScoringContext,
    input_hash: str,
) -> ScoredCandidate:
    evidence = candidate.evidence
    status = str(evidence["coverageStatus"])
    weakness = _weakness(evidence, status)
    incidence = _percent_bp(evidence["incidence"])
    tier = _tier_bp(evidence["tier"])
    coverage_need = _COVERAGE_NEED[status]
    review_debt = _review_debt(evidence)
    ls_alignment = _ls_alignment(candidate, context)
    target_fit = _target_fit(candidate)
    overlap_value = _percent_bp(evidence["overlapValue"])
    deadline_pressure = _deadline_pressure(context)
    banca_fit = _percent_bp(evidence["bancaFit"])
    edital_weight = _edital_weight_bp(evidence["editalWeight"])
    weekly_alignment = _percent_bp(evidence.get("weeklyAlignment", 0))
    balance_penalty = _balance_penalty(candidate, context)
    low_trust_penalty = _low_trust_penalty(candidate)
    values = {
        "weakness": weakness,
        "incidence": incidence,
        "tier": tier,
        "coverage_need": coverage_need,
        "review_debt": review_debt,
        "ls_alignment": ls_alignment,
        "target_fit": target_fit,
        "overlap_value": overlap_value,
        "deadline_pressure": deadline_pressure,
        "banca_fit": banca_fit,
        "edital_weight": edital_weight,
        "weekly_alignment": weekly_alignment,
        "balance_penalty": balance_penalty,
        "low_trust_penalty": low_trust_penalty,
    }
    weights = (
        POS_EDITAL_WEIGHTS
        if context.target.phase == "pos_edital"
        else PRE_EDITAL_WEIGHTS
    )
    final_score = sum(
        values[name] * coefficient // 1000
        for name, coefficient in weights.items()
    ) - sum(
        values[name] * coefficient // 1000
        for name, coefficient in PENALTY_WEIGHTS.items()
    )
    breakdown = ScoreBreakdown(final_score=final_score, **values)
    score_document = {
        "algorithmVersion": ALGORITHM_VERSION,
        "inputHash": input_hash,
        "candidateKey": candidate.candidate_key,
        "targetSlug": context.target.target_slug,
        "phase": context.target.phase,
        "components": {
            "weakness": weakness,
            "incidence": incidence,
            "tier": tier,
            "coverageNeed": coverage_need,
            "reviewDebt": review_debt,
            "lsAlignment": ls_alignment,
            "targetFit": target_fit,
            "overlapValue": overlap_value,
            "deadlinePressure": deadline_pressure,
            "bancaFit": banca_fit,
            "editalWeight": edital_weight,
            "weeklyAlignment": weekly_alignment,
            "balancePenalty": balance_penalty,
            "lowTrustPenalty": low_trust_penalty,
            "finalScore": final_score,
        },
        "weightsMilli": dict(weights),
        "penaltyWeightsMilli": dict(PENALTY_WEIGHTS),
    }
    return ScoredCandidate(
        candidate=candidate,
        breakdown=breakdown,
        input_hash=input_hash,
        evidence_json=_canonical_json(score_document),
    )


def _weakness(evidence: Mapping[str, Any], status: str) -> int:
    projected_mastery = evidence.get("projectedMasteryBp")
    if projected_mastery is not None:
        return max(_WEAKNESS[status], 10000 - int(projected_mastery))
    error_signal = min(
        2500,
        int(evidence["wrongCount"]) * 250
        + int(evidence["doubtCount"]) * 125
        + int(evidence["failedSessions"]) * 750
        + int(evidence["skippedBlocks"]) * 500,
    )
    if evidence["weakProgress"]:
        error_signal = max(error_signal, 1500)
    return min(10000, _WEAKNESS[status] + error_signal)


def _review_debt(evidence: Mapping[str, Any]) -> int:
    projected = evidence.get("projectedReviewDebtBp")
    if projected is not None:
        return max(0, min(10000, int(projected)))
    explicit = _percent_bp(evidence["reviewDebt"])
    observed = min(
        10000,
        int(evidence["wrongCount"]) * 800
        + int(evidence["doubtCount"]) * 400
        + int(evidence["favoriteCount"]) * 200
        + int(evidence["failedSessions"]) * 2000
        + int(evidence["skippedBlocks"]) * 1500
        + (2000 if evidence["weakProgress"] else 0),
    )
    return max(explicit, observed)


def _ls_alignment(candidate: CandidateDraft, context: ScoringContext) -> int:
    if candidate.evidence["profileSourceKind"] not in {"ls", "trilha"}:
        return 0
    source_target = candidate.source_target_slug
    if context.ls_target_slug == context.target.target_slug == source_target:
        return 10000
    if source_target != context.target.target_slug:
        return int(candidate.evidence["transferConfidence"]) * 50
    return 0


def _target_fit(candidate: CandidateDraft) -> int:
    if candidate.source_target_slug == candidate.selected_target_slug:
        return 10000
    return int(candidate.evidence["transferConfidence"]) * 100


def _deadline_pressure(context: ScoringContext) -> int:
    if context.target.phase != "pos_edital":
        return 0
    if context.target.deadline is None:
        return 5000
    days = (context.target.deadline - context.plan_date).days
    if days <= 7:
        return 10000
    if days <= 30:
        return 8500
    if days <= 90:
        return 6500
    if days <= 180:
        return 4000
    return 2000


def _balance_penalty(
    candidate: CandidateDraft, context: ScoringContext
) -> int:
    count = context.discipline_counts.get(candidate.discipline, 0)
    if count >= 2:
        return 10000
    if count == 1:
        return 2500
    return 0


def _low_trust_penalty(candidate: CandidateDraft) -> int:
    trust = candidate.evidence["materialTrust"]
    if (
        candidate.source_kind == "bizu"
        or candidate.evidence["profileSourceKind"] == "bizu"
        or (trust is not None and int(trust) < 5)
    ):
        return 10000
    return 0


def _percent_bp(value: Any) -> int:
    return max(0, min(10000, round(float(value) * 100)))


def _edital_weight_bp(value: Any) -> int:
    return max(0, min(10000, round(float(value) * 1000)))


def _tier_bp(value: Any) -> int:
    tier = int(value)
    return {1: 10000, 2: 7500, 3: 5000, 4: 2500, 5: 0}[tier]


def _canonical_json(value: Any) -> str:
    return json.dumps(
        value,
        ensure_ascii=True,
        sort_keys=True,
        separators=(",", ":"),
    )
