from pathlib import Path
import sqlite3

import pytest

from study_os_service.db.connection import connect_database
from study_os_service.db.migrations import (
    CURRENT_SCHEMA_VERSION,
    MIGRATIONS,
    MigrationRunner,
)


CUTOVER_TABLES = {"legacy_migration_runs", "legacy_id_mappings"}


def install_version_eight(connection: sqlite3.Connection) -> None:
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
        if version > 8:
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


def app_setting_columns(connection: sqlite3.Connection) -> set[str]:
    return {
        row["name"]
        for row in connection.execute("PRAGMA table_info(app_settings)")
    }


def test_version_eight_upgrades_to_cutover_schema_without_setting_loss(
    tmp_path: Path,
):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        install_version_eight(connection)
        connection.execute(
            """
            INSERT INTO app_settings (key, value_json)
            VALUES ('theme', '"dark"')
            """
        )
        connection.commit()

        assert MigrationRunner(connection).migrate() == 9
        assert CURRENT_SCHEMA_VERSION == 9
        assert CUTOVER_TABLES <= table_names(connection)
        assert "version" in app_setting_columns(connection)
        assert dict(
            connection.execute(
                "SELECT value_json, version FROM app_settings WHERE key='theme'"
            ).fetchone()
        ) == {"value_json": '"dark"', "version": 1}
    finally:
        connection.close()


def test_cutover_schema_enforces_canonical_run_and_legacy_id_constraints(
    tmp_path: Path,
):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        MigrationRunner(connection).migrate()
        run_id = connection.execute(
            """
            INSERT INTO legacy_migration_runs (
              migration_key, schema_name, payload_hash, state, stage,
              report_json
            ) VALUES (
              'browser:abc', 'study-os.browser-migration.v1',
              ?, 'running', 'preferences', '{}'
            )
            """,
            ("a" * 64,),
        ).lastrowid
        connection.execute(
            """
            INSERT INTO legacy_id_mappings (
              migration_run_id, record_kind, legacy_id,
              target_type, target_ref, metadata_json
            ) VALUES (?, 'ls_task', 'task-29', 'strategy_source_item', '17', '{}')
            """,
            (run_id,),
        )

        with pytest.raises(sqlite3.IntegrityError, match="UNIQUE"):
            connection.execute(
                """
                INSERT INTO legacy_migration_runs (
                  migration_key, schema_name, payload_hash, state, stage
                ) VALUES ('browser:abc', 'study-os.browser-migration.v1', ?,
                          'running', 'preferences')
                """,
                ("b" * 64,),
            )
        with pytest.raises(sqlite3.IntegrityError, match="CHECK"):
            connection.execute(
                """
                INSERT INTO legacy_migration_runs (
                  migration_key, schema_name, payload_hash, state, stage,
                  report_json
                ) VALUES ('browser:bad-json', 'study-os.browser-migration.v1', ?,
                          'running', 'preferences', '[]')
                """,
                ("c" * 64,),
            )
        with pytest.raises(sqlite3.IntegrityError, match="UNIQUE"):
            connection.execute(
                """
                INSERT INTO legacy_id_mappings (
                  migration_run_id, record_kind, legacy_id,
                  target_type, target_ref
                ) VALUES (?, 'ls_task', 'task-29', 'strategy_source_item', '18')
                """,
                (run_id,),
            )
    finally:
        connection.close()


def test_migration_nine_rolls_back_tables_and_setting_column(tmp_path: Path):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        install_version_eight(connection)
        connection.executescript(
            """
            CREATE TRIGGER reject_version_nine
            BEFORE INSERT ON schema_migrations
            WHEN NEW.version = 9
            BEGIN
              SELECT RAISE(ABORT, 'migration nine rejected');
            END;
            """
        )

        with pytest.raises(sqlite3.IntegrityError, match="migration nine rejected"):
            MigrationRunner(connection).migrate()

        assert not (CUTOVER_TABLES & table_names(connection))
        assert "version" not in app_setting_columns(connection)
        assert connection.execute(
            "SELECT MAX(version) FROM schema_migrations"
        ).fetchone()[0] == 8
    finally:
        connection.close()
