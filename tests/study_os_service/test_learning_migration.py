from pathlib import Path
import sqlite3

import pytest

from study_os_service.db.connection import connect_database
from study_os_service.db.migrations import (
    CURRENT_SCHEMA_VERSION,
    MIGRATIONS,
    MigrationRunner,
)
from study_os_service.services.planner_profiles import PlannerProfileService


ADAPTIVE_TABLES = {
    "learning_events",
    "topic_learning_states",
    "review_queue_items",
    "review_queue_mutations",
    "planner_week_runs",
    "planner_week_slots",
    "learning_import_runs",
}


def install_version_six(connection: sqlite3.Connection) -> None:
    connection.execute("BEGIN IMMEDIATE")
    connection.execute(
        """
        CREATE TABLE schema_migrations (
          version INTEGER PRIMARY KEY,
          applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    for version, statements in MIGRATIONS:
        if version > 6:
            break
        for statement in statements:
            connection.execute(statement)
        connection.execute(
            "INSERT INTO schema_migrations (version) VALUES (?)", (version,)
        )
    connection.commit()


def table_names(connection: sqlite3.Connection) -> set[str]:
    return {
        row["name"]
        for row in connection.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        )
    }


def test_version_six_upgrades_without_losing_planner_evidence(tmp_path: Path):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        install_version_six(connection)
        PlannerProfileService(connection).seed(("bacen_economia_financas",))
        topic_count = connection.execute(
            "SELECT COUNT(*) FROM target_topics"
        ).fetchone()[0]
        run_id = connection.execute(
            """
            INSERT INTO planner_runs (
              idempotency_key, target_slug, plan_date, phase, daily_quota,
              time_budget_minutes, algorithm_version, input_hash, status
            ) VALUES (
              'v6-run', 'bacen_economia_financas', '2026-07-13',
              'pre_edital', 4, 240, 'm4-v1', 'v6-hash', 'generated'
            )
            """
        ).lastrowid

        assert MigrationRunner(connection).migrate() == 7
        assert CURRENT_SCHEMA_VERSION == 7
        assert ADAPTIVE_TABLES <= table_names(connection)
        assert connection.execute(
            "SELECT COUNT(*) FROM target_topics"
        ).fetchone()[0] == topic_count
        assert connection.execute(
            "SELECT input_hash FROM planner_runs WHERE id=?", (run_id,)
        ).fetchone()[0] == "v6-hash"
    finally:
        connection.close()


def test_schema_enforces_aggregate_review_and_week_contracts(tmp_path: Path):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        MigrationRunner(connection).migrate()
        PlannerProfileService(connection).seed(("bacen_economia_financas",))
        topic_id = connection.execute(
            "SELECT id FROM target_topics WHERE target_slug=? ORDER BY id LIMIT 1",
            ("bacen_economia_financas",),
        ).fetchone()[0]
        event_id = connection.execute(
            """
            INSERT INTO learning_events (
              idempotency_key, target_slug, topic_target_slug, target_topic_id,
              source_kind, source_id, event_kind, outcome, questions_done,
              correct_count, wrong_count, occurred_at, evidence_json
            ) VALUES (
              'event-1', 'bacen_economia_financas',
              'bacen_economia_financas', ?, 'planner_block', '1',
              'questions', 'completed', 20, 16, 4,
              '2026-07-13T12:00:00+00:00', '{"plannerBlockId":1}'
            )
            """,
            (topic_id,),
        ).lastrowid
        connection.execute(
            """
            INSERT INTO topic_learning_states (
              target_slug, topic_target_slug, target_topic_id, mastery_bp,
              confidence_bp, coverage_status, review_debt_bp, event_cursor
            ) VALUES (
              'bacen_economia_financas', 'bacen_economia_financas', ?,
              7200, 6500, 'covered', 1800, ?
            )
            """,
            (topic_id, event_id),
        )
        connection.execute(
            """
            INSERT INTO review_queue_items (
              target_slug, topic_target_slug, target_topic_id, due_date,
              state, bounded_questions, trigger_event_ids_json, reason,
              debt_bp
            ) VALUES (
              'bacen_economia_financas', 'bacen_economia_financas', ?,
              '2026-07-14', 'pending', 8, '[1]', 'wrong_count', 3200
            )
            """,
            (topic_id,),
        )
        week_id = connection.execute(
            """
            INSERT INTO planner_week_runs (
              idempotency_key, target_slug, week_start, phase,
              algorithm_version, input_hash, status
            ) VALUES (
              'week-1', 'bacen_economia_financas', '2026-07-13',
              'pre_edital', 'm5-v1', 'week-hash', 'generated'
            )
            """
        ).lastrowid
        connection.execute(
            """
            INSERT INTO planner_week_slots (
              week_run_id, target_slug, scheduled_date, position,
              candidate_key, topic_target_slug, target_topic_id, block_kind,
              duration_minutes, planned_questions
            ) VALUES (
              ?, 'bacen_economia_financas', '2026-07-13', 1,
              'candidate-1', 'bacen_economia_financas', ?, 'questions',
              60, 20
            )
            """,
            (week_id, topic_id),
        )

        with pytest.raises(sqlite3.IntegrityError, match="CHECK"):
            connection.execute(
                "UPDATE review_queue_items SET bounded_questions=11"
            )
        with pytest.raises(sqlite3.IntegrityError, match="CHECK"):
            connection.execute(
                "UPDATE learning_events SET correct_count=21"
            )
        with pytest.raises(sqlite3.IntegrityError, match="CHECK"):
            connection.execute(
                "UPDATE planner_week_runs SET week_start='2026-07-14'"
            )
        with pytest.raises(sqlite3.IntegrityError, match="CHECK"):
            connection.execute(
                "UPDATE planner_week_slots SET state='materialized', day_run_id=1"
            )
    finally:
        connection.close()


def test_migration_seven_rolls_back_all_adaptive_tables(tmp_path: Path):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        install_version_six(connection)
        connection.executescript(
            """
            CREATE TRIGGER reject_version_seven
            BEFORE INSERT ON schema_migrations
            WHEN NEW.version = 7
            BEGIN
              SELECT RAISE(ABORT, 'migration seven rejected');
            END;
            """
        )

        with pytest.raises(sqlite3.IntegrityError, match="migration seven rejected"):
            MigrationRunner(connection).migrate()

        assert not (ADAPTIVE_TABLES & table_names(connection))
        assert connection.execute(
            "SELECT MAX(version) FROM schema_migrations"
        ).fetchone()[0] == 6
    finally:
        connection.close()
