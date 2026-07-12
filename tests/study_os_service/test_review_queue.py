from datetime import UTC, date, datetime
from pathlib import Path

from study_os_service.db.connection import connect_database
from study_os_service.db.migrations import MigrationRunner
from study_os_service.services.learning_projection import LearningProjectionService
from study_os_service.services.planner_candidates import (
    build_candidates,
    collect_candidate_evidence,
)
from study_os_service.services.planner_generation import PlannerGenerationService
from study_os_service.services.planner_profiles import PlannerProfileService
from study_os_service.services.review_queue import ReviewQueueService
from tests.study_os_service.test_planner_generation import prepare_target


def append_result(connection, topic_id: int, **overrides):
    values = {
        "idempotency_key": "review-source-1",
        "target_slug": "bacen_economia_financas",
        "topic_target_slug": "bacen_economia_financas",
        "target_topic_id": topic_id,
        "source_kind": "legacy_aggregate",
        "source_id": "review-source-1",
        "event_kind": "questions",
        "outcome": "imported",
        "questions_done": 20,
        "correct_count": 8,
        "wrong_count": 12,
        "doubt_count": 3,
        "favorite_count": 0,
        "elapsed_seconds": 0,
        "start_page": None,
        "end_page": None,
        "occurred_at": datetime(2026, 7, 13, 12, tzinfo=UTC),
        "evidence": {"importBatchId": "review-source-1"},
    }
    values.update(overrides)
    return LearningProjectionService(connection).append_event(**values)


def setup_target(connection, target_slug="bacen_economia_financas") -> int:
    PlannerProfileService(connection).seed((target_slug,))
    return connection.execute(
        "SELECT id FROM target_topics WHERE target_slug=? ORDER BY id LIMIT 1",
        (target_slug,),
    ).fetchone()[0]


def test_low_accuracy_creates_one_bounded_topic_review_idempotently(tmp_path: Path):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        MigrationRunner(connection).migrate()
        topic_id = setup_target(connection)
        event = append_result(connection, topic_id).event
        service = ReviewQueueService(connection)

        first = service.rebuild("bacen_economia_financas", date(2026, 7, 13))
        second = service.rebuild("bacen_economia_financas", date(2026, 7, 13))

        assert first == second
        assert len(first) == 1
        item = first[0]
        assert item.target_topic_id == topic_id
        assert item.bounded_questions == 8
        assert item.trigger_event_ids == (event.id,)
        assert item.reason == "recent_errors"
        assert connection.execute(
            "SELECT COUNT(*) FROM review_queue_items"
        ).fetchone()[0] == 1
    finally:
        connection.close()


def test_manual_weakness_creates_audit_event_not_broad_review(tmp_path: Path):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        MigrationRunner(connection).migrate()
        topic_id = setup_target(connection)
        connection.execute(
            "UPDATE target_topics SET coverage_status='weak' WHERE id=?",
            (topic_id,),
        )

        items = ReviewQueueService(connection).rebuild(
            "bacen_economia_financas", date(2026, 7, 13)
        )

        assert len(items) == 1
        assert items[0].target_topic_id == topic_id
        assert items[0].bounded_questions == 5
        assert items[0].reason == "manual_weakness"
        event = connection.execute("SELECT * FROM learning_events").fetchone()
        assert event["event_kind"] == "coverage_audit"
        assert "question" not in event["evidence_json"].lower()
    finally:
        connection.close()


def test_pre_and_post_edital_stale_detection_use_bounded_intervals(tmp_path: Path):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        MigrationRunner(connection).migrate()
        bacen_topic = setup_target(connection)
        sefaz_topic = setup_target(connection, "sefaz_ce")
        append_result(
            connection,
            bacen_topic,
            correct_count=18,
            wrong_count=2,
            doubt_count=0,
        )
        append_result(
            connection,
            sefaz_topic,
            idempotency_key="sefaz-success",
            source_id="sefaz-success",
            target_slug="sefaz_ce",
            topic_target_slug="sefaz_ce",
            correct_count=18,
            wrong_count=2,
            doubt_count=0,
        )
        service = ReviewQueueService(connection)

        assert service.rebuild("bacen_economia_financas", date(2026, 8, 11)) == ()
        assert service.rebuild("bacen_economia_financas", date(2026, 8, 12))[0].reason == "stale"
        assert service.rebuild("sefaz_ce", date(2026, 8, 2)) == ()
        post = service.rebuild("sefaz_ce", date(2026, 8, 3))
        assert post[0].reason == "stale"
        assert post[0].bounded_questions == 5
    finally:
        connection.close()


def test_deferral_survives_rebuild_until_due_date(tmp_path: Path):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        MigrationRunner(connection).migrate()
        topic_id = setup_target(connection)
        append_result(connection, topic_id)
        service = ReviewQueueService(connection)
        item = service.rebuild("bacen_economia_financas", date(2026, 7, 13))[0]
        deferred = service.defer(
            item.id,
            date(2026, 7, 16),
            expected_version=item.version,
            idempotency_key="defer-review-item",
        )

        before_due = service.rebuild("bacen_economia_financas", date(2026, 7, 15))[0]
        assert deferred.state == "deferred"
        assert before_due.state == "deferred"
        assert before_due.due_date == date(2026, 7, 16)
        evidence = collect_candidate_evidence(
            connection, "bacen_economia_financas"
        )
        deferred_topic = next(row for row in evidence if row.topic.id == topic_id)
        stopped = next(
            candidate
            for candidate in build_candidates(
                "bacen_economia_financas", (deferred_topic,)
            ).all
            if candidate.block_kind == "review"
        )
        assert stopped.stop_reason == "review_evidence_missing"
        assert stopped.evidence["reviewDeferredUntil"] == "2026-07-16"
        on_due = service.rebuild("bacen_economia_financas", date(2026, 7, 16))[0]
        assert on_due.state == "pending"
    finally:
        connection.close()


def test_successful_review_resolves_only_linked_item(tmp_path: Path):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        MigrationRunner(connection).migrate()
        topic_id = setup_target(connection)
        append_result(connection, topic_id)
        service = ReviewQueueService(connection)
        item = service.rebuild("bacen_economia_financas", date(2026, 7, 13))[0]
        result = LearningProjectionService(connection).append_event(
            idempotency_key="review-proof",
            target_slug="bacen_economia_financas",
            topic_target_slug="bacen_economia_financas",
            target_topic_id=topic_id,
            source_kind="planner_block",
            source_id="review-proof",
            event_kind="review",
            outcome="completed",
            questions_done=8,
            correct_count=7,
            wrong_count=1,
            doubt_count=0,
            favorite_count=0,
            elapsed_seconds=0,
            start_page=None,
            end_page=None,
            occurred_at=datetime(2026, 7, 14, 12, tzinfo=UTC),
            evidence={"reviewQueueItemId": item.id},
        )
        resolved = service.consume_event(result.event, result.state)

        assert resolved.state == "resolved"
        assert resolved.resolved_event_id == result.event.id
        assert service.list_open("bacen_economia_financas") == ()
    finally:
        connection.close()


def test_generated_review_uses_queue_proof_count_and_evidence(tmp_path: Path):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        MigrationRunner(connection).migrate()
        prepare_target(connection)
        day = PlannerGenerationService(connection).generate_day(
            "bacen_economia_financas",
            date(2026, 7, 13),
            idempotency_key="queue-backed-day",
            time_budget_minutes=240,
        )
        review = next(block for block in day.blocks if block.block_kind == "review")
        candidate = next(item for item in day.candidates if item.id == review.candidate_id)
        evidence = candidate.evidence["candidateEvidence"]

        assert 5 <= review.planned_questions <= 10
        assert review.planned_questions == evidence["reviewProofQuestions"]
        assert evidence["reviewQueueItemId"] > 0
        assert evidence["reviewTriggerEventIds"]
        saved = PlannerGenerationService(connection).record_block_result(
            review.id,
            state="completed",
            questions_done=review.planned_questions,
            correct_count=review.planned_questions - 1,
            wrong_count=1,
            doubt_count=0,
            favorite_count=0,
            expected_version=review.version,
        )
        event = connection.execute(
            """
            SELECT * FROM learning_events
            WHERE source_kind='planner_block' AND source_id=?
            """,
            (str(saved.id),),
        ).fetchone()
        queue_item = connection.execute(
            "SELECT * FROM review_queue_items WHERE id=?",
            (evidence["reviewQueueItemId"],),
        ).fetchone()
        assert str(evidence["reviewQueueItemId"]) in event["evidence_json"]
        assert queue_item["state"] == "resolved"
        assert queue_item["resolved_event_id"] == event["id"]
    finally:
        connection.close()
