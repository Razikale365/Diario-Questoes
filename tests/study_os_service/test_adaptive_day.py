from datetime import UTC, date, datetime
from pathlib import Path

from study_os_service.db.connection import connect_database
from study_os_service.db.migrations import MigrationRunner
from study_os_service.services.learning_projection import LearningProjectionService
from study_os_service.services.planner_generation import PlannerGenerationService
from study_os_service.services.sessions import SessionService
from tests.study_os_service.test_planner_generation import prepare_target


def setup_adaptive_target(connection, root: Path):
    prepare_target(connection)
    pdf_path = root / "Aula 01.pdf"
    pdf_path.write_bytes(b"%PDF-1.7\nfixture")
    connection.execute("UPDATE materials SET absolute_path=?", (str(pdf_path),))
    connection.execute(
        """
        UPDATE target_topics
        SET coverage_status='unread', review_debt=0
        WHERE target_slug='bacen_economia_financas'
        """
    )


def question_block(day):
    return next(block for block in day.blocks if block.block_kind == "questions")


def candidate_for(day, block):
    return next(item for item in day.candidates if item.id == block.candidate_id)


def test_high_accuracy_cools_topic_on_independent_next_day(tmp_path: Path):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        MigrationRunner(connection).migrate()
        setup_adaptive_target(connection, tmp_path)
        planner = PlannerGenerationService(connection)
        first = planner.generate_day(
            "bacen_economia_financas",
            date(2026, 7, 13),
            idempotency_key="adaptive-high-first",
            time_budget_minutes=240,
        )
        block = question_block(first)
        topic_id = candidate_for(first, block).target_topic_id
        planner.record_block_result(
            block.id,
            state="completed",
            questions_done=20,
            correct_count=18,
            wrong_count=2,
            doubt_count=0,
            favorite_count=0,
            expected_version=block.version,
        )

        second = planner.generate_day(
            "bacen_economia_financas",
            date(2026, 7, 14),
            idempotency_key="adaptive-high-second",
            time_budget_minutes=240,
        )
        same_topic = [
            item for item in second.candidates if item.target_topic_id == topic_id
        ]

        assert all(item.chosen_position is None for item in same_topic)
        assert any(item.stop_reason == "adaptive_cooldown" for item in same_topic)
        assert all(
            item.adaptation_reason in {"cooldown_after_success", "profile_fallback"}
            for item in same_topic
        )
        assert all(item.score.weekly_alignment == 0 for item in same_topic)
    finally:
        connection.close()


def test_low_accuracy_uses_projected_debt_for_next_bounded_review(tmp_path: Path):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        MigrationRunner(connection).migrate()
        setup_adaptive_target(connection, tmp_path)
        planner = PlannerGenerationService(connection)
        first = planner.generate_day(
            "bacen_economia_financas",
            date(2026, 7, 13),
            idempotency_key="adaptive-low-first",
            time_budget_minutes=240,
        )
        block = question_block(first)
        topic_id = candidate_for(first, block).target_topic_id
        planner.record_block_result(
            block.id,
            state="completed",
            questions_done=20,
            correct_count=8,
            wrong_count=12,
            doubt_count=3,
            favorite_count=0,
            expected_version=block.version,
        )

        second = planner.generate_day(
            "bacen_economia_financas",
            date(2026, 7, 14),
            idempotency_key="adaptive-low-second",
            time_budget_minutes=240,
        )
        review = next(
            item
            for item in second.candidates
            if item.target_topic_id == topic_id and item.block_kind == "review"
        )
        evidence = review.evidence["candidateEvidence"]

        assert review.chosen_position is not None
        assert review.adaptation_reason == "bounded_review_due"
        assert evidence["projectedCoverageStatus"] == "weak"
        assert review.score.review_debt == evidence["projectedReviewDebtBp"]
        assert review.planned_questions == evidence["reviewProofQuestions"]
    finally:
        connection.close()


def test_partial_theory_is_selected_as_exact_cursor_resume(tmp_path: Path):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        MigrationRunner(connection).migrate()
        setup_adaptive_target(connection, tmp_path)
        planner = PlannerGenerationService(connection)
        first = planner.generate_day(
            "bacen_economia_financas",
            date(2026, 7, 13),
            idempotency_key="adaptive-partial-first",
            time_budget_minutes=240,
        )
        theory = next(block for block in first.blocks if block.block_kind == "theory")
        source = candidate_for(first, theory)
        sessions = SessionService(connection)
        started = sessions.start(
            "bacen_economia_financas",
            source.lesson_id,
            source.material_id,
            "adaptive-partial-session",
            planner_block_id=theory.id,
        )
        sessions.finish(
            started.session.id,
            outcome="partial",
            end_page=25,
            elapsed_seconds=1800,
            questions_done=0,
            correct_count=0,
            wrong_count=0,
            doubt_count=0,
            favorite_count=0,
            notes="intervalo",
            expected_version=started.session.version,
        )

        second = planner.generate_day(
            "bacen_economia_financas",
            date(2026, 7, 14),
            idempotency_key="adaptive-partial-second",
            time_budget_minutes=240,
        )
        resumed = next(
            item
            for item in second.candidates
            if item.target_topic_id == source.target_topic_id
            and item.block_kind == "theory"
        )
        evidence = resumed.evidence["candidateEvidence"]

        assert resumed.chosen_position == 1
        assert resumed.adaptation_reason == "resume_partial"
        assert evidence["cursorPage"] == 25
        assert evidence["projectedCoverageStatus"] == "in_progress"
    finally:
        connection.close()


def test_stale_topic_reenters_with_explicit_adaptation_reason(tmp_path: Path):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        MigrationRunner(connection).migrate()
        setup_adaptive_target(connection, tmp_path)
        topic_id = connection.execute(
            """
            SELECT id FROM target_topics
            WHERE target_slug='bacen_economia_financas' ORDER BY id LIMIT 1
            """
        ).fetchone()[0]
        LearningProjectionService(connection).append_event(
            idempotency_key="old-success",
            target_slug="bacen_economia_financas",
            topic_target_slug="bacen_economia_financas",
            target_topic_id=topic_id,
            source_kind="legacy_aggregate",
            source_id="old-success",
            event_kind="questions",
            outcome="imported",
            questions_done=20,
            correct_count=18,
            wrong_count=2,
            doubt_count=0,
            favorite_count=0,
            elapsed_seconds=0,
            start_page=None,
            end_page=None,
            occurred_at=datetime(2026, 7, 1, 12, tzinfo=UTC),
            evidence={"importBatchId": "old-success"},
        )

        day = PlannerGenerationService(connection).generate_day(
            "bacen_economia_financas",
            date(2026, 8, 1),
            idempotency_key="adaptive-stale-day",
            time_budget_minutes=240,
        )
        candidates = [item for item in day.candidates if item.target_topic_id == topic_id]

        assert any(item.chosen_position is not None for item in candidates)
        assert all(
            item.evidence["candidateEvidence"]["coverageStatus"] == "stale"
            for item in candidates
        )
        assert any(item.adaptation_reason == "stale_return" for item in candidates)
    finally:
        connection.close()
