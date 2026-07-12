from pathlib import Path
import sqlite3

import pytest

from study_os_service.db.connection import connect_database
from study_os_service.db.migrations import (
    CURRENT_SCHEMA_VERSION,
    MIGRATIONS,
    MigrationRunner,
)
from tests.study_os_service.test_session_migration import seed_inventory


PLANNER_TABLES = {
    "exam_targets",
    "target_topics",
    "planner_runs",
    "planner_candidates",
    "planner_blocks",
}


def _install_version_four(connection: sqlite3.Connection) -> None:
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
        if version > 4:
            break
        for statement in statements:
            connection.execute(statement)
        connection.execute(
            "INSERT INTO schema_migrations (version) VALUES (?)", (version,)
        )
    connection.commit()


def _tables(connection: sqlite3.Connection) -> set[str]:
    return {
        row["name"]
        for row in connection.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        )
    }


def _seed_target(connection: sqlite3.Connection) -> None:
    connection.execute(
        """
        INSERT INTO exam_targets (
          target_slug, display_name, institution, role, banca, phase,
          daily_quota, priority_score, source_urls_json
        ) VALUES (
          'rfb_auditor', 'RFB Auditor', 'Receita Federal', 'Auditor',
          'FGV', 'pre_edital', 4, 80, '["https://www.gov.br/receitafederal"]'
        )
        """
    )


def test_version_four_upgrades_without_losing_progress_or_sessions(tmp_path: Path):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        _install_version_four(connection)
        lesson_id, material_id = seed_inventory(connection)
        progress_id = connection.execute(
            """
            INSERT INTO progress_states (
              lesson_id, material_id, status, cursor_page, furthest_page,
              total_seconds, session_count, version
            ) VALUES (?, ?, 'in_progress', 18, 18, 1200, 1, 3)
            """,
            (lesson_id, material_id),
        ).lastrowid
        session_id = connection.execute(
            """
            INSERT INTO study_sessions (
              idempotency_key, target_slug, lesson_id, material_id,
              state, started_at, ended_at, elapsed_seconds,
              start_page, end_page, outcome, version
            ) VALUES (
              'planner-migration-session', 'rfb_auditor', ?, ?, 'finished',
              '2026-07-12T12:00:00+00:00', '2026-07-12T12:20:00+00:00',
              1200, 1, 18, 'partial', 2
            )
            """,
            (lesson_id, material_id),
        ).lastrowid

        assert MigrationRunner(connection).migrate() == CURRENT_SCHEMA_VERSION

        assert PLANNER_TABLES <= _tables(connection)
        assert tuple(connection.execute(
            "SELECT cursor_page, version FROM progress_states WHERE id=?",
            (progress_id,),
        ).fetchone()) == (18, 3)
        assert tuple(connection.execute(
            "SELECT outcome, end_page, version FROM study_sessions WHERE id=?",
            (session_id,),
        ).fetchone()) == ("partial", 18, 2)
        assert [
            row["version"]
            for row in connection.execute(
                "SELECT version FROM schema_migrations ORDER BY version"
            )
        ] == list(range(1, CURRENT_SCHEMA_VERSION + 1))
    finally:
        connection.close()


def test_planner_schema_checks_json_enums_and_stable_identities(tmp_path: Path):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        MigrationRunner(connection).migrate()
        _seed_target(connection)
        topic_id = connection.execute(
            """
            INSERT INTO target_topics (
              target_slug, discipline, topic, coverage_status, edital_weight,
              incidence, tier, banca_fit, overlap_value, transfer_kind,
              source_kind, review_debt, notes
            ) VALUES (
              'rfb_auditor', 'Direito Tributario', 'Credito tributario',
              'weak', 2, 85, 1, 90, 100, 'target_specific', 'manual', 60,
              'Priorizar erros recentes'
            )
            """
        ).lastrowid
        assert connection.execute(
            "SELECT notes FROM target_topics WHERE id=?", (topic_id,)
        ).fetchone()[0] == "Priorizar erros recentes"
        run_id = connection.execute(
            """
            INSERT INTO planner_runs (
              idempotency_key, target_slug, plan_date, phase, daily_quota,
              time_budget_minutes, algorithm_version, input_hash, status
            ) VALUES (
              'run-1', 'rfb_auditor', '2026-07-13', 'pre_edital', 4,
              240, 'm4-v1', 'abc123', 'generated'
            )
            """
        ).lastrowid
        candidate_id = connection.execute(
            """
            INSERT INTO planner_candidates (
              run_id, candidate_key, target_slug, discipline, topic,
              block_kind, source_kind, target_topic_id, duration_minutes,
              planned_questions, weakness, incidence, tier, coverage_need,
              review_debt, ls_alignment, target_fit, overlap_value,
              deadline_pressure, banca_fit, edital_weight, balance_penalty,
              low_trust_penalty, final_score, chosen_position
            ) VALUES (
              ?, 'rfb|tributario|questions', 'rfb_auditor',
              'Direito Tributario', 'Credito tributario', 'questions',
              'tec', ?, 60, 20, 9000, 8500, 10000, 8000, 6000, 0,
              10000, 10000, 2000, 9000, 4000, 0, 0, 35000, 1
            )
            """,
            (run_id, topic_id),
        ).lastrowid
        connection.execute(
            """
            INSERT INTO planner_blocks (
              run_id, candidate_id, target_slug, scheduled_date, position,
              block_kind, title, duration_minutes, planned_questions
            ) VALUES (
              ?, ?, 'rfb_auditor', '2026-07-13', 1, 'questions',
              'TEC: Credito tributario', 60, 20
            )
            """,
            (run_id, candidate_id),
        )

        with pytest.raises(sqlite3.IntegrityError, match="UNIQUE"):
            connection.execute(
                """
                INSERT INTO target_topics (
                  target_slug, discipline, topic, coverage_status,
                  edital_weight, incidence, tier, banca_fit, overlap_value,
                  transfer_kind, source_kind, review_debt
                ) VALUES (
                  'rfb_auditor', 'Direito Tributario', 'Credito tributario',
                  'unread', 1, 10, 1, 10, 10, 'shared', 'manual', 0
                )
                """
            )
        with pytest.raises(sqlite3.IntegrityError, match="CHECK"):
            connection.execute(
                "UPDATE exam_targets SET source_urls_json='not-json'"
            )
        with pytest.raises(sqlite3.IntegrityError, match="CHECK"):
            connection.execute(
                "UPDATE planner_blocks SET state='invented'"
            )
        with pytest.raises(sqlite3.IntegrityError, match="CHECK"):
            connection.execute(
                "UPDATE planner_candidates SET chosen_position=0"
            )
    finally:
        connection.close()


def test_migration_five_rolls_back_all_planner_tables(tmp_path: Path):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        _install_version_four(connection)
        connection.executescript(
            """
            CREATE TRIGGER reject_version_five
            BEFORE INSERT ON schema_migrations
            WHEN NEW.version = 5
            BEGIN
              SELECT RAISE(ABORT, 'migration five rejected');
            END;
            """
        )

        with pytest.raises(sqlite3.IntegrityError, match="migration five rejected"):
            MigrationRunner(connection).migrate()

        assert not (PLANNER_TABLES & _tables(connection))
        assert connection.execute(
            "SELECT MAX(version) FROM schema_migrations"
        ).fetchone()[0] == 4
    finally:
        connection.close()
