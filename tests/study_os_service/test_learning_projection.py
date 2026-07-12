from datetime import UTC, datetime
from pathlib import Path

from study_os_service.db.connection import connect_database
from study_os_service.db.migrations import MigrationRunner
from study_os_service.services.learning_projection import (
    LearningProjectionService,
    project_topic_state,
)
from study_os_service.services.planner_profiles import PlannerProfileService


NOW = datetime(2026, 7, 13, 12, tzinfo=UTC)


def event_values(**overrides):
    values = {
        "idempotency_key": "event-1",
        "target_slug": "bacen_economia_financas",
        "topic_target_slug": "bacen_economia_financas",
        "target_topic_id": 1,
        "source_kind": "legacy_aggregate",
        "source_id": "batch-1",
        "event_kind": "questions",
        "outcome": "imported",
        "questions_done": 20,
        "correct_count": 16,
        "wrong_count": 4,
        "doubt_count": 1,
        "favorite_count": 0,
        "elapsed_seconds": 0,
        "start_page": None,
        "end_page": None,
        "occurred_at": NOW,
        "evidence": {"importBatchId": "batch-1"},
    }
    values.update(overrides)
    return values


def test_projection_is_deterministic_and_high_accuracy_cools_debt(tmp_path: Path):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        MigrationRunner(connection).migrate()
        PlannerProfileService(connection).seed(("bacen_economia_financas",))
        connection.execute(
            "UPDATE target_topics SET review_debt=60 WHERE target_slug=?",
            ("bacen_economia_financas",),
        )
        topic = connection.execute(
            "SELECT * FROM target_topics WHERE target_slug=? ORDER BY id LIMIT 1",
            ("bacen_economia_financas",),
        ).fetchone()
        service = LearningProjectionService(connection)
        result = service.append_event(**event_values(target_topic_id=topic["id"]))
        rebuilt = service.rebuild_topic_state(
            "bacen_economia_financas", topic["id"]
        )

        assert result.state == rebuilt
        assert rebuilt.coverage_status == "covered"
        assert rebuilt.mastery_bp >= 6000
        assert rebuilt.review_debt_bp < round(topic["review_debt"] * 100)
        assert rebuilt.success_streak == 1
        assert rebuilt.event_cursor == result.event.id
    finally:
        connection.close()


def test_low_accuracy_and_failed_review_raise_bounded_topic_debt(tmp_path: Path):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        MigrationRunner(connection).migrate()
        PlannerProfileService(connection).seed(("bacen_economia_financas",))
        topic_id = connection.execute(
            "SELECT id FROM target_topics WHERE target_slug=? ORDER BY id LIMIT 1",
            ("bacen_economia_financas",),
        ).fetchone()[0]
        service = LearningProjectionService(connection)
        first = service.append_event(**event_values(
            target_topic_id=topic_id,
            questions_done=20,
            correct_count=8,
            wrong_count=12,
            doubt_count=3,
        ))
        second = service.append_event(**event_values(
            idempotency_key="event-2",
            source_id="block-2",
            target_topic_id=topic_id,
            event_kind="review",
            outcome="failed",
            questions_done=5,
            correct_count=1,
            wrong_count=4,
            doubt_count=2,
            occurred_at=datetime(2026, 7, 14, 12, tzinfo=UTC),
        ))

        assert second.state.review_debt_bp > first.state.review_debt_bp
        assert second.state.coverage_status == "weak"
        assert second.state.failure_streak == 2
        assert second.state.next_review_date.isoformat() == "2026-07-21"
    finally:
        connection.close()


def test_partial_theory_preserves_in_progress_cursor_evidence(tmp_path: Path):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        MigrationRunner(connection).migrate()
        PlannerProfileService(connection).seed(("bacen_economia_financas",))
        topic_id = connection.execute(
            "SELECT id FROM target_topics WHERE target_slug=? ORDER BY id LIMIT 1",
            ("bacen_economia_financas",),
        ).fetchone()[0]
        result = LearningProjectionService(connection).append_event(**event_values(
            target_topic_id=topic_id,
            event_kind="theory",
            outcome="partial",
            questions_done=0,
            correct_count=0,
            wrong_count=0,
            doubt_count=0,
            start_page=1,
            end_page=25,
        ))

        assert result.state.coverage_status == "in_progress"
        assert result.state.last_success_at is None
        assert result.state.next_review_date.isoformat() == "2026-07-16"
        assert result.event.end_page == 25
    finally:
        connection.close()


def test_unmapped_event_is_preserved_without_inventing_topic_state(tmp_path: Path):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        MigrationRunner(connection).migrate()
        PlannerProfileService(connection).seed(("bacen_economia_financas",))
        result = LearningProjectionService(connection).append_event(**event_values(
            topic_target_slug=None,
            target_topic_id=None,
            event_kind="theory",
            outcome="abandoned",
            questions_done=0,
            correct_count=0,
            wrong_count=0,
            doubt_count=0,
        ))

        assert result.state is None
        assert connection.execute(
            "SELECT COUNT(*) FROM learning_events"
        ).fetchone()[0] == 1
        assert connection.execute(
            "SELECT COUNT(*) FROM topic_learning_states"
        ).fetchone()[0] == 0
    finally:
        connection.close()


def test_skipped_question_event_raises_less_debt_than_failure(tmp_path: Path):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        MigrationRunner(connection).migrate()
        PlannerProfileService(connection).seed(("bacen_economia_financas",))
        topic_id = connection.execute(
            "SELECT id FROM target_topics WHERE target_slug=? ORDER BY id LIMIT 1",
            ("bacen_economia_financas",),
        ).fetchone()[0]
        service = LearningProjectionService(connection)
        skipped = service.append_event(**event_values(
            target_topic_id=topic_id,
            outcome="skipped",
            questions_done=0,
            correct_count=0,
            wrong_count=0,
            doubt_count=0,
        ))
        failed = service.append_event(**event_values(
            idempotency_key="event-2",
            source_id="batch-2",
            target_topic_id=topic_id,
            outcome="failed",
            questions_done=0,
            correct_count=0,
            wrong_count=0,
            doubt_count=0,
            occurred_at=datetime(2026, 7, 14, 12, tzinfo=UTC),
        ))

        assert skipped.state.review_debt_bp == 500
        assert failed.state.review_debt_bp == 3000
        assert failed.state.failure_streak == 1
    finally:
        connection.close()


def test_pure_projection_sorts_events_by_time_and_identity(tmp_path: Path):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        MigrationRunner(connection).migrate()
        PlannerProfileService(connection).seed(("bacen_economia_financas",))
        topic = connection.execute(
            "SELECT * FROM target_topics WHERE target_slug=? ORDER BY id LIMIT 1",
            ("bacen_economia_financas",),
        ).fetchone()
        service = LearningProjectionService(connection)
        early = service.append_event(**event_values(target_topic_id=topic["id"])).event
        late = service.append_event(**event_values(
            idempotency_key="event-2",
            source_id="batch-2",
            target_topic_id=topic["id"],
            occurred_at=datetime(2026, 7, 14, 12, tzinfo=UTC),
        )).event

        forward = project_topic_state(
            "bacen_economia_financas", topic, (early, late)
        )
        reverse = project_topic_state(
            "bacen_economia_financas", topic, (late, early)
        )
        assert forward == reverse
    finally:
        connection.close()
