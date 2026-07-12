import pytest

from study_os_service.db.connection import connect_database
from study_os_service.db.migrations import MigrationRunner
from study_os_service.domain.planner import TargetTopic
from study_os_service.services.planner_candidates import (
    CandidateTopicEvidence,
    MaterialEvidence,
    ReviewEvidence,
    build_candidates,
    collect_candidate_evidence,
)
from study_os_service.services.planner_profiles import PlannerProfileService
from tests.study_os_service.test_session_migration import seed_inventory


TEC_URL = "https://www.tecconcursos.com.br/questoes/cadernos"


def make_topic(**overrides) -> TargetTopic:
    values = {
        "id": 11,
        "target_slug": "bacen_economia_financas",
        "discipline": "Macroeconomia",
        "topic": "Politica monetaria",
        "coverage_status": "weak",
        "edital_weight": 2.0,
        "incidence": 92.0,
        "tier": 1,
        "banca_fit": 95.0,
        "overlap_value": 100.0,
        "transfer_kind": "target_specific",
        "source_kind": "manual",
        "lesson_id": 7,
        "material_id": 13,
        "tec_source_url": TEC_URL,
        "tec_source_id": "macro-bacen",
        "planned_questions": 20,
        "review_debt": 70.0,
        "notes": "",
        "active": True,
        "version": 1,
    }
    values.update(overrides)
    return TargetTopic(**values)


def make_material(**overrides) -> MaterialEvidence:
    values = {
        "lesson_id": 7,
        "material_id": 13,
        "target_slug": "bacen_economia_financas",
        "kind": "original",
        "available": True,
        "is_primary": True,
        "trust_level": 10,
        "progress_status": "in_progress",
        "cursor_page": 18,
        "page_count": 80,
    }
    values.update(overrides)
    return MaterialEvidence(**values)


def make_evidence(**overrides) -> CandidateTopicEvidence:
    values = {
        "topic": make_topic(),
        "material_mapping_present": True,
        "materials": (make_material(),),
        "review": ReviewEvidence(
            wrong_count=4,
            doubt_count=2,
            favorite_count=1,
            failed_sessions=0,
            weak_progress=True,
        ),
    }
    values.update(overrides)
    return CandidateTopicEvidence(**values)


def candidate(pool, kind: str):
    return next(item for item in pool.all if item.block_kind == kind)


def test_builder_emits_three_executable_blocks_with_exact_evidence():
    pool = build_candidates("bacen_economia_financas", (make_evidence(),))

    assert len(pool.executable) == 3
    assert not pool.rejected
    theory = candidate(pool, "theory")
    questions = candidate(pool, "questions")
    review = candidate(pool, "review")

    assert theory.lesson_id == 7
    assert theory.material_id == 13
    assert theory.source_kind == "course"
    assert theory.evidence["cursorPage"] == 18
    assert theory.evidence["pageCount"] == 80
    assert theory.evidence["materialKind"] == "original"
    assert questions.planned_questions == 20
    assert questions.evidence["tecSourceUrl"] == TEC_URL
    assert review.duration_minutes == 45
    assert 5 <= review.planned_questions <= 10
    assert review.evidence["wrongCount"] == 4
    assert review.evidence["reviewDebt"] == 70.0


@pytest.mark.parametrize(
    ("kind", "evidence", "selected_target", "expected_reason"),
    [
        (
            "questions",
            make_evidence(topic=make_topic(active=False)),
            "bacen_economia_financas",
            "inactive_topic",
        ),
        (
            "questions",
            make_evidence(
                topic=make_topic(
                    target_slug="rfb_auditor",
                    transfer_kind="target_specific",
                )
            ),
            "bacen_economia_financas",
            "target_not_transferable",
        ),
        (
            "theory",
            make_evidence(
                topic=make_topic(lesson_id=None, material_id=None),
                material_mapping_present=False,
                materials=(),
            ),
            "bacen_economia_financas",
            "material_unmapped",
        ),
        (
            "theory",
            make_evidence(materials=()),
            "bacen_economia_financas",
            "material_missing",
        ),
        (
            "theory",
            make_evidence(materials=(make_material(available=False),)),
            "bacen_economia_financas",
            "material_unavailable",
        ),
        (
            "theory",
            make_evidence(materials=(make_material(is_primary=False),)),
            "bacen_economia_financas",
            "primary_material_missing",
        ),
        (
            "theory",
            make_evidence(
                materials=(make_material(kind="bizu", trust_level=2),)
            ),
            "bacen_economia_financas",
            "low_trust_primary",
        ),
        (
            "theory",
            make_evidence(
                materials=(make_material(target_slug="rfb_auditor"),)
            ),
            "bacen_economia_financas",
            "material_target_mismatch",
        ),
        (
            "questions",
            make_evidence(
                topic=make_topic(tec_source_url=None, tec_source_id=None)
            ),
            "bacen_economia_financas",
            "tec_source_missing",
        ),
        (
            "review",
            make_evidence(
                topic=make_topic(coverage_status="covered", review_debt=0),
                review=ReviewEvidence(),
            ),
            "bacen_economia_financas",
            "review_evidence_missing",
        ),
    ],
)
def test_builder_persists_one_of_ten_canonical_stop_reasons(
    kind, evidence, selected_target, expected_reason
):
    pool = build_candidates(selected_target, (evidence,))
    stopped = candidate(pool, kind)

    assert stopped.stop_reason == expected_reason
    assert stopped in pool.rejected
    assert stopped not in pool.executable
    assert stopped.evidence["stopReason"] == expected_reason


def test_explicit_shared_transfer_is_allowed_with_reduced_confidence():
    shared = make_evidence(
        topic=make_topic(
            target_slug="rfb_auditor",
            discipline="Estatistica",
            topic="Inferencia",
            transfer_kind="shared",
            overlap_value=80,
        ),
        materials=(make_material(target_slug="rfb_auditor"),),
    )
    pool = build_candidates("bacen_economia_financas", (shared,))

    assert len(pool.executable) == 3
    assert all(item.evidence["sourceTargetSlug"] == "rfb_auditor" for item in pool.all)
    assert all(0 < item.evidence["transferConfidence"] < 100 for item in pool.all)


def test_partial_transfer_requires_positive_overlap_evidence():
    partial = make_evidence(
        topic=make_topic(
            target_slug="rfb_auditor",
            transfer_kind="partial",
            overlap_value=0,
        )
    )
    pool = build_candidates("bacen_economia_financas", (partial,))

    assert not pool.executable
    assert {item.stop_reason for item in pool.rejected} == {
        "target_not_transferable"
    }


def test_candidate_keys_and_evidence_order_are_stable():
    inputs = (make_evidence(),)

    first = build_candidates("bacen_economia_financas", inputs)
    second = build_candidates("bacen_economia_financas", inputs)

    assert [item.candidate_key for item in first.all] == [
        item.candidate_key for item in second.all
    ]
    assert [dict(item.evidence) for item in first.all] == [
        dict(item.evidence) for item in second.all
    ]
    assert [item.block_kind for item in first.all] == [
        "theory",
        "questions",
        "review",
    ]


def test_collector_reads_exact_progress_and_review_aggregates_without_pdf_access(
    tmp_path,
):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        MigrationRunner(connection).migrate()
        PlannerProfileService(connection).seed(("rfb_auditor",))
        lesson_id, material_id = seed_inventory(connection)
        topic_id = connection.execute(
            "SELECT id FROM target_topics WHERE target_slug='rfb_auditor' ORDER BY id LIMIT 1"
        ).fetchone()[0]
        connection.execute(
            """
            UPDATE target_topics SET lesson_id=?, material_id=?, review_debt=45
            WHERE id=?
            """,
            (lesson_id, material_id, topic_id),
        )
        connection.execute(
            """
            INSERT INTO progress_states (
              lesson_id, material_id, status, cursor_page, furthest_page
            ) VALUES (?, ?, 'weak', 23, 28)
            """,
            (lesson_id, material_id),
        )
        connection.execute(
            """
            INSERT INTO study_sessions (
              idempotency_key, target_slug, lesson_id, material_id, state,
              started_at, ended_at, elapsed_seconds, start_page, end_page,
              questions_done, correct_count, wrong_count, doubt_count,
              favorite_count, outcome
            ) VALUES (
              'candidate-evidence', 'rfb_auditor', ?, ?, 'finished',
              '2026-07-12T12:00:00+00:00', '2026-07-12T13:00:00+00:00',
              3600, 1, 23, 20, 12, 8, 3, 2, 'failed'
            )
            """,
            (lesson_id, material_id),
        )

        rows = collect_candidate_evidence(connection, "rfb_auditor")
    finally:
        connection.close()

    row = next(item for item in rows if item.topic.id == topic_id)
    assert row.material_mapping_present is True
    assert len(row.materials) == 1
    assert row.materials[0].lesson_id == lesson_id
    assert row.materials[0].material_id == material_id
    assert row.materials[0].progress_status == "weak"
    assert row.materials[0].cursor_page == 23
    assert row.review == ReviewEvidence(
        wrong_count=8,
        doubt_count=3,
        favorite_count=2,
        failed_sessions=1,
        weak_progress=True,
    )
