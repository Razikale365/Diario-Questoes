from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
import math
import sqlite3
from typing import Any

import pytest
from fastapi.testclient import TestClient

from study_os_service.app import create_app
from study_os_service.config import StudyOsSettings
from study_os_service.db.connection import connect_database
from study_os_service.services.sprint_evidence import SprintEvidenceService


TARGET = "sefaz_ce"
KEY = "p1_economia"
LTE_KEY = "p2_lte"
AS_OF = date(2026, 7, 14)


def _projection_service(connection: sqlite3.Connection):
    try:
        from study_os_service.services.sprint_projection import (
            SprintProjectionService,
        )
    except ModuleNotFoundError as exc:
        if exc.name != "study_os_service.services.sprint_projection":
            raise
        pytest.fail("SprintProjectionService is not implemented")
    return SprintProjectionService(connection)


@pytest.fixture
def client(tmp_path) -> TestClient:
    with TestClient(
        create_app(StudyOsSettings.from_environment(tmp_path))
    ) as test_client:
        seeded = test_client.post(
            "/api/v1/planner/targets/seed",
            json={"targetSlugs": [TARGET]},
        )
        assert seeded.status_code == 201
        bootstrapped = test_client.get(
            "/api/v1/sprints/config", params={"targetSlug": TARGET}
        )
        assert bootstrapped.status_code == 200
        yield test_client


@pytest.fixture
def connection(client: TestClient):
    database = connect_database(client.app.state.settings.database_path)
    try:
        yield database
    finally:
        database.close()


@pytest.fixture
def service(connection: sqlite3.Connection):
    return _projection_service(connection)


@dataclass
class EvidenceHarness:
    connection: sqlite3.Connection
    counter: int = 0

    @staticmethod
    def _discipline(subject_key: str) -> str:
        if subject_key == LTE_KEY:
            return "Legislacao Tributaria Estadual do Ceara"
        if subject_key == KEY:
            return "Economia"
        raise AssertionError(f"unsupported test subject: {subject_key}")

    def _store(
        self,
        *,
        measurement_type: str,
        subject_key: str,
        origin: str,
        observed_on: date,
        correct_count: int | None,
        wrong_count: int | None,
        doubt_count: int,
        percentage_bp: int | None,
        exam_board: str,
        transfer_scope: str,
        transferability_bp: int,
        source_record_id: str | None,
        source_revision: str,
        source_updated_at: datetime | None,
    ) -> None:
        self.counter += 1
        record_id = source_record_id or f"aggregate-{self.counter}"
        updated_at = source_updated_at or datetime(
            2026, 7, 14, 12, tzinfo=UTC
        ) + timedelta(minutes=self.counter)
        observation = {
            "discipline": self._discipline(subject_key),
            "topicHint": f"Aggregate {self.counter}",
            "observedOn": observed_on.isoformat(),
            "sourceRecordId": record_id,
            "sourceRevision": source_revision,
            "sourceUpdatedAt": updated_at.isoformat().replace("+00:00", "Z"),
            "measurementType": measurement_type,
            "examBoard": exam_board,
            "correctCount": correct_count,
            "wrongCount": wrong_count,
            "doubtCount": doubt_count,
            "percentageBp": percentage_bp,
            "transferScope": transfer_scope,
            "transferabilityBp": transferability_bp,
            "provenance": {
                "provider": "projection-test",
                "sourceTaskId": record_id,
            },
        }
        report = SprintEvidenceService(self.connection).import_batch(
            {
                "targetSlug": TARGET,
                "batchId": f"projection-test-{self.counter}",
                "origin": origin,
                "dryRun": False,
                "observations": [observation],
            }
        )
        assert report["insertedCount"] == 1
        assert report["conflictCount"] == 0

    def add_exact(
        self,
        *,
        measurement_type: str = "unseen_set",
        subject_key: str = KEY,
        origin: str = "diario_backup",
        observed_on: date = AS_OF,
        correct_count: int = 8,
        wrong_count: int = 2,
        doubt_count: int = 0,
        exam_board: str = "FCC",
        transfer_scope: str = "content",
        transferability_bp: int = 10000,
        source_record_id: str | None = None,
        source_revision: str = "v1",
        source_updated_at: datetime | None = None,
    ) -> None:
        self._store(
            measurement_type=measurement_type,
            subject_key=subject_key,
            origin=origin,
            observed_on=observed_on,
            correct_count=correct_count,
            wrong_count=wrong_count,
            doubt_count=doubt_count,
            percentage_bp=None,
            exam_board=exam_board,
            transfer_scope=transfer_scope,
            transferability_bp=transferability_bp,
            source_record_id=source_record_id,
            source_revision=source_revision,
            source_updated_at=source_updated_at,
        )

    def add_percentage(
        self,
        *,
        measurement_type: str = "ls_percentage",
        subject_key: str = KEY,
        origin: str = "ls_history",
        observed_on: date = AS_OF,
        percentage_bp: int = 8000,
        doubt_count: int = 0,
        exam_board: str = "FCC",
        transfer_scope: str = "content",
        transferability_bp: int = 10000,
        source_record_id: str | None = None,
        source_revision: str = "v1",
        source_updated_at: datetime | None = None,
    ) -> None:
        self._store(
            measurement_type=measurement_type,
            subject_key=subject_key,
            origin=origin,
            observed_on=observed_on,
            correct_count=None,
            wrong_count=None,
            doubt_count=doubt_count,
            percentage_bp=percentage_bp,
            exam_board=exam_board,
            transfer_scope=transfer_scope,
            transferability_bp=transferability_bp,
            source_record_id=source_record_id,
            source_revision=source_revision,
            source_updated_at=source_updated_at,
        )


@pytest.fixture
def evidence(connection: sqlite3.Connection) -> EvidenceHarness:
    return EvidenceHarness(connection)


def test_small_perfect_set_cannot_create_a_perfect_projection(
    evidence: EvidenceHarness, service
):
    evidence.add_exact(correct_count=3, wrong_count=0)

    projection = service.project(TARGET, AS_OF)

    assert projection.subject(KEY).estimate_bp < 9000
    assert projection.confidence_bp < 5000


def test_three_high_error_reviews_do_not_raise_direct_projection(
    evidence: EvidenceHarness, service
):
    before = service.project(TARGET, AS_OF).subject(LTE_KEY).estimate_bp
    for age in range(3):
        evidence.add_exact(
            measurement_type="error_review",
            subject_key=LTE_KEY,
            observed_on=AS_OF - timedelta(days=age),
            correct_count=10,
            wrong_count=0,
        )

    after = service.project(TARGET, AS_OF).subject(LTE_KEY)

    assert after.estimate_bp == before
    assert after.fragility_bp > 0


def test_representative_simulation_outweighs_unknown_sample_ls_percentage(
    evidence: EvidenceHarness, service
):
    evidence.add_percentage(percentage_bp=9900)
    evidence.add_exact(
        measurement_type="sectional_mock",
        correct_count=12,
        wrong_count=8,
    )

    subject = service.project(TARGET, AS_OF).subject(KEY)

    assert subject.estimate_bp < 8000


def test_doubts_raise_fragility_even_when_answers_are_correct(
    evidence: EvidenceHarness, service
):
    evidence.add_exact(
        correct_count=10,
        wrong_count=0,
        doubt_count=6,
    )

    subject = service.project(TARGET, AS_OF).subject(KEY)

    assert subject.fragility_bp >= 5000


def test_go_lte_content_has_zero_projection_transfer(
    evidence: EvidenceHarness, service
):
    before = service.project(TARGET, AS_OF).subject(LTE_KEY)
    evidence.add_exact(
        origin="sefaz_go",
        subject_key=LTE_KEY,
        correct_count=20,
        wrong_count=0,
        transferability_bp=0,
    )

    after = service.project(TARGET, AS_OF).subject(LTE_KEY)

    assert after.estimate_bp == before.estimate_bp
    assert after.effective_sample == 0
    assert after.dominant_origin != "sefaz_go"


def test_as_of_ignores_future_observations(
    evidence: EvidenceHarness, service
):
    evidence.add_exact(
        observed_on=date(2026, 7, 15),
        correct_count=20,
        wrong_count=0,
        source_updated_at=datetime(2026, 7, 15, 9, tzinfo=UTC),
    )

    projection = service.project(TARGET, AS_OF)

    assert projection.subject(KEY).effective_sample == 0


def test_demotion_requires_two_recent_representative_sets_of_ten(
    evidence: EvidenceHarness, service
):
    evidence.add_percentage(percentage_bp=10000)
    evidence.add_exact(correct_count=10, wrong_count=0)

    first = service.project(TARGET, AS_OF).subject(KEY)

    assert first.representative_set_count == 1
    assert first.demotion_eligible is False

    evidence.add_exact(
        measurement_type="sectional_mock",
        correct_count=10,
        wrong_count=0,
        source_record_id="second-representative-set",
    )

    second = service.project(TARGET, AS_OF).subject(KEY)
    assert second.representative_set_count == 2
    assert second.demotion_eligible is True


def test_old_representative_set_does_not_count_for_demotion(
    evidence: EvidenceHarness, service
):
    evidence.add_exact(
        observed_on=date(2026, 6, 1),
        correct_count=10,
        wrong_count=0,
    )
    evidence.add_exact(
        measurement_type="sectional_mock",
        correct_count=10,
        wrong_count=0,
        source_record_id="recent-representative-set",
    )

    subject = service.project(TARGET, AS_OF).subject(KEY)

    assert subject.representative_set_count == 1
    assert subject.demotion_eligible is False


def test_latest_source_updated_at_wins_even_if_stale_revision_arrives_later(
    evidence: EvidenceHarness, service
):
    evidence.add_exact(
        correct_count=0,
        wrong_count=10,
        source_record_id="revisioned-aggregate",
        source_revision="newer-source-time",
        source_updated_at=datetime(2026, 7, 14, 12, tzinfo=UTC),
    )
    evidence.add_exact(
        correct_count=10,
        wrong_count=0,
        source_record_id="revisioned-aggregate",
        source_revision="stale-imported-later",
        source_updated_at=datetime(2026, 7, 14, 8, tzinfo=UTC),
    )

    subject = service.project(TARGET, AS_OF).subject(KEY)

    assert subject.effective_sample == pytest.approx(7.5)
    assert subject.estimate_bp < 4000


def test_as_of_excludes_a_revision_learned_after_the_cutoff(
    evidence: EvidenceHarness,
    service,
):
    evidence.add_exact(
        correct_count=10,
        wrong_count=0,
        source_record_id="time-travel-aggregate",
        source_revision="known-on-cutoff",
        source_updated_at=datetime(2026, 7, 14, 12, tzinfo=UTC),
    )
    evidence.add_exact(
        correct_count=0,
        wrong_count=10,
        source_record_id="time-travel-aggregate",
        source_revision="learned-later",
        source_updated_at=datetime(2026, 7, 20, 12, tzinfo=UTC),
    )

    subject = service.project(TARGET, AS_OF).subject(KEY)

    assert subject.effective_sample == pytest.approx(7.5)
    assert subject.estimate_bp > 7000


def test_profile_prior_is_replaced_not_double_counted_by_explicit_baseline(
    evidence: EvidenceHarness, service
):
    profile_only = service.project(TARGET, AS_OF).subject(KEY)

    assert profile_only.estimate_bp == 5250
    assert profile_only.effective_sample == 0
    assert profile_only.confidence_bp == 0
    assert profile_only.dominant_origin == "baseline"

    evidence.add_exact(
        measurement_type="baseline",
        origin="manual_baseline",
        correct_count=12,
        wrong_count=0,
    )
    explicit = service.project(TARGET, AS_OF).subject(KEY)

    # Neutral smoothing prior: (12 * .50 + 2.4 * 1.00) / 14.4.
    assert explicit.estimate_bp == 5833
    assert explicit.effective_sample == pytest.approx(2.4)
    assert explicit.dominant_origin == "manual_baseline"


def test_effective_sample_applies_cap_measurement_board_transfer_and_recency(
    evidence: EvidenceHarness, service
):
    evidence.add_exact(
        measurement_type="full_exam",
        correct_count=100,
        wrong_count=0,
    )
    evidence.add_exact(
        measurement_type="mixed_set",
        observed_on=AS_OF - timedelta(days=21),
        correct_count=6,
        wrong_count=4,
        exam_board="Cebraspe",
        transferability_bp=5000,
    )
    evidence.add_percentage(percentage_bp=8000)

    subject = service.project(TARGET, AS_OF).subject(KEY)

    # 80 cap + (10 * .60 * .70 * .50 transfer * .50 recency) + (2 * .15).
    assert subject.effective_sample == pytest.approx(81.35)


def test_papers_intervals_and_weighted_distance_are_derived_from_subjects(
    service,
):
    projection = service.project(TARGET, AS_OF)
    p1_subjects = [row for row in projection.subjects if row.paper == "P1"]
    p2_subjects = [row for row in projection.subjects if row.paper == "P2"]

    assert sum(row.question_count for row in p1_subjects) == 80
    assert sum(row.question_count for row in p2_subjects) == 80
    assert projection.p1.projected == pytest.approx(
        sum(row.question_count * row.estimate_bp / 10000 for row in p1_subjects),
        abs=0.02,
    )
    assert projection.p2.projected == pytest.approx(
        sum(row.question_count * row.estimate_bp / 10000 for row in p2_subjects),
        abs=0.02,
    )
    assert projection.p1.variance is not None
    assert projection.p2.variance is not None
    assert projection.p1.low == pytest.approx(
        max(
            0,
            projection.p1.projected
            - 1.645 * math.sqrt(projection.p1.variance),
        ),
        abs=0.02,
    )
    assert projection.p2.high == pytest.approx(
        min(
            80,
            projection.p2.projected
            + 1.645 * math.sqrt(projection.p2.variance),
        ),
        abs=0.02,
    )
    assert projection.p1.low > sum(
        row.question_count * row.low_bp / 10000 for row in p1_subjects
    )
    assert projection.p2.high < sum(
        row.question_count * row.high_bp / 10000 for row in p2_subjects
    )
    assert projection.p1.floor == 48
    assert projection.p1.stretch == 64
    assert projection.p2.floor == 63
    assert projection.p2.stretch == 70
    assert projection.weighted_projected == pytest.approx(
        projection.p1.projected + 2 * projection.p2.projected
    )
    weighted_standard_error = math.sqrt(
        projection.p1.variance + 4 * projection.p2.variance
    )
    assert projection.weighted_low == pytest.approx(
        max(
            0,
            projection.weighted_projected
            - 1.645 * weighted_standard_error,
        )
    )
    assert projection.weighted_high == pytest.approx(
        min(
            240,
            projection.weighted_projected
            + 1.645 * weighted_standard_error,
        )
    )
    assert projection.weighted_target == 204
    assert projection.distance_to_target == pytest.approx(
        204 - projection.weighted_projected
    )
    assert projection.score_kind == "raw_weighted_equivalent_not_fcc_standardized"


def test_confidence_uses_only_effective_evidence_and_reports_auditable_origin(
    evidence: EvidenceHarness, service
):
    evidence.add_percentage(percentage_bp=9900, origin="ls_history")
    evidence.add_exact(
        correct_count=6,
        wrong_count=4,
        origin="diario_backup",
    )

    subject = service.project(TARGET, AS_OF).subject(KEY)
    expected_confidence = round(
        9500 * (1 - math.exp(-subject.effective_sample / 30))
    )

    assert subject.effective_sample == pytest.approx(7.8)
    assert subject.confidence_bp == expected_confidence
    assert subject.dominant_origin == "diario_backup"
    assert "sample_limited" in subject.warnings


def test_global_confidence_is_coverage_weighted_across_the_whole_exam(
    evidence: EvidenceHarness,
    service,
):
    evidence.add_exact(
        measurement_type="full_exam",
        correct_count=80,
        wrong_count=0,
    )

    projection = service.project(TARGET, AS_OF)

    assert projection.subject(KEY).confidence_bp > 8000
    assert projection.confidence_bp < 2000


def test_projection_route_honors_as_of_and_serializes_the_audit_contract(
    client: TestClient,
):
    response = client.get(
        "/api/v1/sprints/projection",
        params={"targetSlug": TARGET, "asOf": "2026-07-13"},
    )

    assert response.status_code == 200, response.text
    document = response.json()
    assert document["targetSlug"] == TARGET
    assert document["asOf"] == "2026-07-13"
    assert document["formulaVersion"] == "sefaz-ce-projection-v2"
    assert document["scoreKind"] == "raw_weighted_equivalent_not_fcc_standardized"
    assert document["p1"]["floor"] == 48
    assert document["p1"]["stretch"] == 64
    assert document["p2"]["floor"] == 63
    assert document["p2"]["stretch"] == 70
    assert document["weighted"]["target"] == 204
    assert document["weighted"]["distanceToTarget"] == pytest.approx(
        204 - document["weighted"]["projected"]
    )
    assert document["confidenceBp"] == 0
    assert document["dominantOrigin"] == "baseline"
    assert isinstance(document["warnings"], list)
    economy = next(
        item for item in document["subjects"] if item["subjectKey"] == KEY
    )
    assert economy.keys() >= {
        "subjectProfileId",
        "displayName",
        "paper",
        "questionCount",
        "questionWeight",
        "estimateBp",
        "lowBp",
        "highBp",
        "effectiveSample",
        "confidenceBp",
        "fragilityBp",
        "representativeSetCount",
        "demotionEligible",
        "dominantOrigin",
        "warnings",
    }


def test_projection_route_returns_structured_404_for_unknown_target(
    client: TestClient,
):
    response = client.get(
        "/api/v1/sprints/projection",
        params={"targetSlug": "missing-target", "asOf": AS_OF.isoformat()},
    )

    assert response.status_code == 404
    assert response.json() == {
        "code": "sprint_target_not_found",
        "message": "target missing-target does not exist",
    }
