from __future__ import annotations

from collections import defaultdict
from datetime import date
import math
import sqlite3
from typing import Any, Iterable

from study_os_service.domain.sprint import ExamSubjectProfile
from study_os_service.domain.sprint_evidence import (
    PaperProjection,
    SprintPerformanceObservation,
    SprintProjection,
    SubjectProjection,
)
from study_os_service.repositories.sprint_evidence import SprintEvidenceRepository
from study_os_service.services.sprint import SprintProfileService


FORMULA_VERSION = "sefaz-ce-projection-v2"
MEASUREMENT_WEIGHT = {
    "full_exam": 1.00,
    "sectional_mock": 0.90,
    "unseen_set": 0.75,
    "mixed_set": 0.60,
    "sprint_action": 0.65,
    "ls_percentage": 0.15,
    "baseline": 0.20,
    "error_review": 0.00,
}
BOARD_WEIGHT = {"FCC": 1.00, "": 0.85}
RECENCY_HALF_LIFE_DAYS = 21
UNKNOWN_SAMPLE_EQUIVALENT_N = 2.0
PRIOR_EQUIVALENT_N = 12.0
INTERVAL_Z = 1.645
REPRESENTATIVE_TYPES = frozenset(
    {"full_exam", "sectional_mock", "unseen_set", "mixed_set"}
)
REPRESENTATIVE_RECENCY_DAYS = 21
INTERVAL_CONFIDENCE_BP = 9000


def _board_weight(exam_board: str) -> float:
    normalized = exam_board.strip().upper()
    return BOARD_WEIGHT.get(normalized, 0.70)


def _recency_weight(age_days: int) -> float:
    return 0.5 ** (max(0, age_days) / RECENCY_HALF_LIFE_DAYS)


def _effective_sample(
    observation: SprintPerformanceObservation,
    *,
    age_days: int,
) -> float:
    if observation.transfer_scope != "content":
        return 0.0
    measurement_weight = MEASUREMENT_WEIGHT[observation.measurement_type]
    if measurement_weight == 0:
        return 0.0
    raw_sample = (
        UNKNOWN_SAMPLE_EQUIVALENT_N
        if observation.sample_size is None
        else float(min(observation.sample_size, 80))
    )
    return (
        raw_sample
        * measurement_weight
        * _board_weight(observation.exam_board)
        * (observation.transferability_bp / 10000)
        * _recency_weight(age_days)
    )


def _fragility_signal(
    observation: SprintPerformanceObservation,
    *,
    age_days: int,
) -> float:
    transfer = observation.transferability_bp / 10000
    if transfer <= 0:
        return 0.0
    doubt_ratio = 0.0
    if observation.sample_size:
        doubt_ratio = observation.doubt_count / observation.sample_size
    miss_ratio = 1 - observation.percentage_bp / 10000
    if (
        observation.measurement_type == "error_review"
        or observation.transfer_scope in {"method", "trap_pattern"}
    ):
        raw_signal = max(0.25, doubt_ratio, miss_ratio)
    else:
        raw_signal = doubt_ratio
    return min(1.0, raw_signal * transfer * _recency_weight(age_days))


def _dominant_origin(weights: dict[str, float]) -> str:
    if not weights or max(weights.values(), default=0.0) <= 0:
        return "baseline"
    return max(weights.items(), key=lambda item: (item[1], item[0]))[0]


def _confidence(effective_sample: float) -> int:
    return round(9500 * (1 - math.exp(-effective_sample / 30)))


def _subject_projection(
    subject: ExamSubjectProfile,
    observations: Iterable[SprintPerformanceObservation],
    *,
    as_of: date,
) -> tuple[SubjectProjection, dict[str, float], float]:
    records = tuple(observations)
    explicit_baseline = any(
        item.measurement_type == "baseline" for item in records
    )
    prior_bp = (
        5000
        if explicit_baseline
        else (
            subject.baseline_accuracy_bp
            if subject.baseline_accuracy_bp is not None
            else 5000
        )
    )
    weighted_successes = PRIOR_EQUIVALENT_N * (prior_bp / 10000)
    effective_sample = 0.0
    representative_count = 0
    origin_weights: dict[str, float] = defaultdict(float)
    fragility = 0.0
    unknown_sample_seen = False
    nontransferable_seen = False

    for observation in records:
        age_days = (as_of - observation.observed_on).days
        if age_days < 0:
            continue
        sample = _effective_sample(observation, age_days=age_days)
        if sample > 0:
            effective_sample += sample
            weighted_successes += sample * (observation.percentage_bp / 10000)
            origin_weights[observation.origin] += sample
            unknown_sample_seen = unknown_sample_seen or observation.sample_size is None
        elif observation.transferability_bp == 0:
            nontransferable_seen = True

        fragility = max(
            fragility,
            _fragility_signal(observation, age_days=age_days),
        )
        if (
            observation.measurement_type in REPRESENTATIVE_TYPES
            and observation.transfer_scope == "content"
            and observation.transferability_bp > 0
            and observation.sample_size is not None
            and observation.sample_size >= 10
            and age_days <= REPRESENTATIVE_RECENCY_DAYS
        ):
            representative_count += 1

    posterior_n = PRIOR_EQUIVALENT_N + effective_sample
    posterior_mean = weighted_successes / posterior_n
    standard_error = math.sqrt(
        max(0.0, posterior_mean * (1 - posterior_mean) / posterior_n)
    )
    estimate_bp = round(10000 * posterior_mean)
    low_bp = max(0, round(10000 * (posterior_mean - INTERVAL_Z * standard_error)))
    high_bp = min(10000, round(10000 * (posterior_mean + INTERVAL_Z * standard_error)))
    warnings: list[str] = []
    if effective_sample < 10:
        warnings.append("sample_limited")
    if effective_sample == 0:
        warnings.append("baseline_only")
    if unknown_sample_seen:
        warnings.append("unknown_sample")
    if nontransferable_seen:
        warnings.append("nontransferable_evidence_excluded")
    if representative_count < 2:
        warnings.append("representative_sets_limited")

    projection = SubjectProjection(
        subject_profile_id=subject.id,
        subject_key=subject.subject_key,
        display_name=subject.display_name,
        paper=subject.paper,
        question_count=subject.question_count,
        question_weight=float(subject.question_weight),
        estimate_bp=estimate_bp,
        low_bp=min(low_bp, estimate_bp),
        high_bp=max(high_bp, estimate_bp),
        effective_sample=round(effective_sample, 6),
        confidence_bp=_confidence(effective_sample),
        fragility_bp=round(10000 * fragility),
        representative_set_count=representative_count,
        demotion_eligible=representative_count >= 2,
        dominant_origin=_dominant_origin(dict(origin_weights)),
        warnings=tuple(warnings),
    )
    return projection, dict(origin_weights), standard_error**2


def _paper_projection(
    subjects: Iterable[tuple[SubjectProjection, float]],
    *,
    floor: int,
    stretch: int,
) -> PaperProjection:
    rows = tuple(subjects)
    projected = sum(item.question_count * item.estimate_bp / 10000 for item, _ in rows)
    variance = sum((item.question_count**2) * item_variance for item, item_variance in rows)
    margin = INTERVAL_Z * math.sqrt(variance)
    return PaperProjection(
        projected=round(projected, 4),
        low=round(max(0.0, projected - margin), 4),
        high=round(min(80.0, projected + margin), 4),
        floor=floor,
        stretch=stretch,
        variance=variance,
    )


class SprintProjectionService:
    def __init__(self, connection: sqlite3.Connection):
        self.connection = connection
        self.repository = SprintEvidenceRepository(connection)

    def project(self, target_slug: str, as_of: date) -> SprintProjection:
        config, profiles = SprintProfileService(self.connection).bootstrap(
            target_slug
        )
        latest = self.repository.list_latest_observations(target_slug, as_of)
        by_subject: dict[str, list[SprintPerformanceObservation]] = defaultdict(list)
        for observation in latest:
            if observation.subject_key is not None:
                by_subject[observation.subject_key].append(observation)

        subject_rows: list[tuple[SubjectProjection, float]] = []
        overall_origins: dict[str, float] = defaultdict(float)
        for profile in profiles:
            projection, origins, variance = _subject_projection(
                profile,
                by_subject.get(profile.subject_key, ()),
                as_of=as_of,
            )
            subject_rows.append((projection, variance))
            for origin, weight in origins.items():
                overall_origins[origin] += weight

        p1 = _paper_projection(
            (row for row in subject_rows if row[0].paper == "P1"),
            floor=config.p1_floor_questions,
            stretch=config.p1_goal_high,
        )
        p2 = _paper_projection(
            (row for row in subject_rows if row[0].paper == "P2"),
            floor=config.p2_goal_low,
            stretch=config.p2_goal_high,
        )
        subjects = [row[0] for row in subject_rows]
        total_points = sum(item.question_count * item.question_weight for item in subjects)
        confidence_bp = round(
            sum(
                item.confidence_bp * item.question_count * item.question_weight
                for item in subjects
            )
            / total_points
        )
        warnings = tuple(
            sorted({warning for item in subjects for warning in item.warnings})
        )
        return SprintProjection(
            target_slug=target_slug,
            as_of=as_of,
            formula_version=FORMULA_VERSION,
            score_kind="raw_weighted_equivalent_not_fcc_standardized",
            p1=p1,
            p2=p2,
            confidence_bp=confidence_bp,
            dominant_origin=_dominant_origin(dict(overall_origins)),
            subjects=tuple(subjects),
            warnings=warnings,
        )


def projection_document(projection: SprintProjection) -> dict[str, Any]:
    return {
        "targetSlug": projection.target_slug,
        "asOf": projection.as_of.isoformat(),
        "formulaVersion": projection.formula_version,
        "scoreKind": projection.score_kind,
        "interval": {
            "confidenceBp": INTERVAL_CONFIDENCE_BP,
            "kind": "normal_approximation_raw_equivalent",
        },
        "p1": {
            "projected": projection.p1.projected,
            "low": projection.p1.low,
            "high": projection.p1.high,
            "floor": projection.p1.floor,
            "stretch": projection.p1.stretch,
            "variance": projection.p1.variance,
        },
        "p2": {
            "projected": projection.p2.projected,
            "low": projection.p2.low,
            "high": projection.p2.high,
            "floor": projection.p2.floor,
            "stretch": projection.p2.stretch,
            "variance": projection.p2.variance,
        },
        "weighted": {
            "projected": projection.weighted_projected,
            "low": projection.weighted_low,
            "high": projection.weighted_high,
            "target": projection.weighted_target,
            "distanceToTarget": projection.distance_to_target,
        },
        "confidenceBp": projection.confidence_bp,
        "dominantOrigin": projection.dominant_origin,
        "warnings": list(projection.warnings),
        "subjects": [
            {
                "subjectProfileId": item.subject_profile_id,
                "subjectKey": item.subject_key,
                "displayName": item.display_name,
                "paper": item.paper,
                "questionCount": item.question_count,
                "questionWeight": item.question_weight,
                "estimateBp": item.estimate_bp,
                "lowBp": item.low_bp,
                "highBp": item.high_bp,
                "effectiveSample": item.effective_sample,
                "confidenceBp": item.confidence_bp,
                "fragilityBp": item.fragility_bp,
                "representativeSetCount": item.representative_set_count,
                "demotionEligible": item.demotion_eligible,
                "dominantOrigin": item.dominant_origin,
                "warnings": list(item.warnings),
            }
            for item in projection.subjects
        ],
    }
