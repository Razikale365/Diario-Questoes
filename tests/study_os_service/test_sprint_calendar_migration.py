from pathlib import Path
import sqlite3

import pytest

from study_os_service.db.connection import connect_database
from study_os_service.db.migrations import MIGRATIONS, MigrationRunner


CALENDAR_TABLES = {
    "sprint_calendar_runs",
    "sprint_calendar_days",
    "sprint_calendar_items",
    "sprint_calendar_assignments",
    "sprint_calendar_materializations",
    "sprint_calendar_day_overrides",
    "sprint_calendar_item_overrides",
}


def install_version_eleven(connection: sqlite3.Connection) -> None:
    connection.execute(
        "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"
    )
    for version, statements in MIGRATIONS:
        if version > 11:
            break
        for statement in statements:
            connection.execute(statement)
        connection.execute("INSERT INTO schema_migrations(version) VALUES (?)", (version,))


def seed_target(connection: sqlite3.Connection, slug: str = "sefaz_ce") -> None:
    connection.execute(
        """
        INSERT INTO exam_targets (
          target_slug, display_name, institution, role, banca, phase,
          deadline, daily_quota, priority_score, source_urls_json
        ) VALUES (?, ?, 'SEFAZ CE', 'Auditor', 'FCC', 'pos_edital',
                  '2026-08-01', 4, 100, '[]')
        """,
        (slug, slug),
    )


def seed_source_task(connection: sqlite3.Connection) -> int:
    return connection.execute(
        """
        INSERT INTO source_plan_tasks (
          target_slug, source_kind, external_task_id, plan_label,
          meta_number, source_order, discipline, task_kind, description,
          estimated_minutes, relevance, status
        ) VALUES ('sefaz_ce','ls','meta-47-1','Meta 47',47,1,
                  'LTE','questions','ICMS',60,10,'pending')
        """
    ).lastrowid


def seed_draft_run(connection: sqlite3.Connection) -> int:
    return connection.execute(
        """
        INSERT INTO sprint_calendar_runs (
          idempotency_key, target_slug, window_start, window_end,
          planning_cutoff, exact_through, algorithm_version,
          request_hash, input_hash, decision, status, warnings_json,
          shortfalls_json, projection_snapshot_json, capacity_snapshot_json
        ) VALUES (
          'preview-1','sefaz_ce','2026-07-15','2026-07-15',
          '2026-07-15T08:00:00.000000Z','2026-07-17','calendar-v1',
          ?,?,'draft','generated','[]','[]','{}','{}'
        )
        """,
        ("a" * 64, "b" * 64),
    ).lastrowid


def test_v12_adds_calendar_tables_without_changing_v11_state(tmp_path: Path):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        install_version_eleven(connection)
        seed_target(connection)
        before = tuple(
            connection.execute(
                "SELECT target_slug, display_name, version FROM exam_targets ORDER BY target_slug"
            ).fetchall()
        )

        assert MigrationRunner(connection).migrate() == 12
        after = tuple(
            connection.execute(
                "SELECT target_slug, display_name, version FROM exam_targets ORDER BY target_slug"
            ).fetchall()
        )
        tables = {
            row["name"]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'sprint_calendar_%'"
            )
        }
        assert before == after
        assert tables == CALENDAR_TABLES
        assert connection.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
    finally:
        connection.close()


def test_calendar_rejects_placeholder_with_source_or_action(tmp_path: Path):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        MigrationRunner(connection).migrate()
        seed_target(connection)
        source_task_id = seed_source_task(connection)
        with pytest.raises(sqlite3.IntegrityError, match="CHECK"):
            connection.execute(
                """
                INSERT INTO sprint_calendar_items (
                  target_slug,item_key,origin,kind,source_plan_task_id,title,
                  expected_meta_number,state
                ) VALUES ('sefaz_ce','future-cycle:48:2026-07-18','system',
                          'future_cycle_capacity',?,'Capacidade',48,'pending')
                """,
                (source_task_id,),
            )

        run_id = seed_draft_run(connection)
        connection.execute(
            """
            INSERT INTO sprint_calendar_days (
              run_id,target_slug,plan_date,precision,availability_source,
              available,available_minutes,ls_minutes,extra_minutes,
              reserved_minutes,overage_minutes,energy_level,confidence_bp
            ) VALUES (?,'sefaz_ce','2026-07-15','provisional','default',
                      1,180,180,0,180,0,3,0)
            """,
            (run_id,),
        )
        item_id = connection.execute(
            """
            INSERT INTO sprint_calendar_items (
              target_slug,item_key,origin,kind,title,expected_meta_number,state
            ) VALUES ('sefaz_ce','future-cycle:48:2026-07-15','system',
                      'future_cycle_capacity','Capacidade',48,'pending')
            """
        ).lastrowid
        with pytest.raises(sqlite3.IntegrityError, match="cannot be executable"):
            connection.execute(
                """
                INSERT INTO sprint_calendar_assignments (
                  run_id,target_slug,item_id,plan_date,position,duration_minutes,
                  precision,priority_tier,action_json,expected_gain_milli
                ) VALUES (?,'sefaz_ce',?,'2026-07-15',1,180,
                          'provisional','maintenance','{}',0)
                """,
                (run_id, item_id),
            )
    finally:
        connection.close()


def test_calendar_requires_explicit_unavailable_for_zero_capacity(tmp_path: Path):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        MigrationRunner(connection).migrate()
        seed_target(connection)
        with pytest.raises(sqlite3.IntegrityError, match="CHECK"):
            connection.execute(
                """
                INSERT INTO sprint_calendar_day_overrides (
                  target_slug,scope_kind,scope_value,availability,
                  ls_minutes,extra_minutes
                ) VALUES ('sefaz_ce','date','2026-07-16','available',0,0)
                """
            )
        connection.execute(
            """
            INSERT INTO sprint_calendar_day_overrides (
              target_slug,scope_kind,scope_value,availability,
              ls_minutes,extra_minutes
            ) VALUES ('sefaz_ce','date','2026-07-16','unavailable',0,0)
            """
        )
    finally:
        connection.close()
