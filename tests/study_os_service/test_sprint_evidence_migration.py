from pathlib import Path
import sqlite3

from study_os_service.db.connection import connect_database
from study_os_service.db.migrations import CURRENT_SCHEMA_VERSION, MIGRATIONS, MigrationRunner


EVIDENCE_TABLES = {
    "sprint_evidence_import_batches",
    "sprint_performance_observations",
    "source_plan_cycles",
    "source_plan_backlog_candidates",
}


def _install_version_ten(connection: sqlite3.Connection) -> None:
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
        if version > 10:
            break
        for statement in statements:
            connection.execute(statement)
        connection.execute("INSERT INTO schema_migrations (version) VALUES (?)", (version,))
    connection.commit()


def _seed_target(connection: sqlite3.Connection, slug: str = "sefaz_ce") -> None:
    connection.execute(
        """
        INSERT INTO exam_targets (
          target_slug, display_name, institution, role, banca, phase,
          deadline, daily_quota, priority_score, source_urls_json
        ) VALUES (?, ?, 'SEFAZ CE', 'Auditor Fiscal', 'FCC', 'pos_edital',
                  '2026-08-01', 4, 100, '["https://example.test/edital"]')
        """,
        (slug, slug),
    )


def _seed_config(connection: sqlite3.Connection, slug: str, *, p1_high: int = 52, p2_high: int = 67) -> None:
    connection.execute(
        """
        INSERT INTO exam_sprint_configs (
          target_slug, start_date, objective_date, exam_end_date,
          ls_budget_minutes, extra_budget_minutes, p1_floor_questions,
          p1_goal_low, p1_goal_high, p2_goal_low, p2_goal_high,
          discursive_goal_low, discursive_goal_high, triage_mode, state
        ) VALUES (?, '2026-07-13', '2026-08-01', '2026-08-02',
                  240, 60, 48, 48, ?, 63, ?, 75, 82, 'suggest_only', 'active')
        """,
        (slug, p1_high, p2_high),
    )


def test_version_ten_upgrades_additively_and_preserves_source_plan_state(tmp_path: Path):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        _install_version_ten(connection)
        _seed_target(connection)
        task_id = connection.execute(
            """
            INSERT INTO source_plan_tasks (
              target_slug, source_kind, external_task_id, plan_label, meta_number,
              scheduled_date, source_order, discipline, task_kind, description,
              estimated_minutes, status, provenance_json
            ) VALUES (
              'sefaz_ce', 'ls', 'meta-47-task-1', 'Meta 47', 47,
              '2026-07-14', 1, 'Economia', 'questions', 'Conjunto FCC',
              60, 'completed', '{"origin":"ls-visible-history"}'
            )
            """
        ).lastrowid
        before = tuple(
            connection.execute(
                """
                SELECT external_task_id, meta_number, scheduled_date, status,
                       provenance_json, version
                FROM source_plan_tasks WHERE id=?
                """,
                (task_id,),
            ).fetchone()
        )

        assert MigrationRunner(connection).migrate() == 11
        tables = {
            row["name"]
            for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
        assert EVIDENCE_TABLES <= tables
        columns = {
            row["name"] for row in connection.execute("PRAGMA table_info(source_plan_tasks)")
        }
        assert "source_cycle_id" in columns
        after = tuple(
            connection.execute(
                """
                SELECT external_task_id, meta_number, scheduled_date, status,
                       provenance_json, version
                FROM source_plan_tasks WHERE id=?
                """,
                (task_id,),
            ).fetchone()
        )
        assert after == before
        assert connection.execute(
            "SELECT source_cycle_id FROM source_plan_tasks WHERE id=?", (task_id,)
        ).fetchone()[0] is None
    finally:
        connection.close()


def test_version_eleven_updates_only_untouched_sefaz_default_goals(tmp_path: Path):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        _install_version_ten(connection)
        _seed_target(connection, "sefaz_ce")
        _seed_target(connection, "user_edited")
        _seed_config(connection, "sefaz_ce")
        _seed_config(connection, "user_edited", p1_high=61, p2_high=69)
        connection.commit()

        MigrationRunner(connection).migrate()

        default = tuple(
            connection.execute(
                """
                SELECT p1_floor_questions, p1_goal_low, p1_goal_high,
                       p2_goal_low, p2_goal_high, version
                FROM exam_sprint_configs WHERE target_slug='sefaz_ce'
                """
            ).fetchone()
        )
        edited = tuple(
            connection.execute(
                """
                SELECT p1_floor_questions, p1_goal_low, p1_goal_high,
                       p2_goal_low, p2_goal_high, version
                FROM exam_sprint_configs WHERE target_slug='user_edited'
                """
            ).fetchone()
        )
        assert default == (48, 48, 64, 63, 70, 2)
        assert edited == (48, 48, 61, 63, 69, 1)
    finally:
        connection.close()


def test_current_schema_version_is_eleven():
    assert CURRENT_SCHEMA_VERSION == 11
