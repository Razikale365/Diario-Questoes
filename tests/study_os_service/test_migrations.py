from pathlib import Path

from study_os_service.db.connection import connect_database
from study_os_service.db.migrations import MigrationRunner


def test_migrate_initializes_foundation_schema_idempotently(tmp_path: Path):
    connection = connect_database(tmp_path / "study.sqlite3")
    runner = MigrationRunner(connection)

    assert runner.migrate() == 1
    assert runner.migrate() == 1

    tables = {
        row["name"]
        for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")
    }
    assert {"schema_migrations", "app_settings", "app_events"} <= tables
    assert connection.execute("PRAGMA foreign_keys").fetchone()[0] == 1
    assert connection.execute("PRAGMA journal_mode").fetchone()[0].lower() == "wal"


def test_migrate_rolls_back_foundation_schema_when_version_record_fails(tmp_path: Path):
    connection = connect_database(tmp_path / "study.sqlite3")
    connection.executescript(
        """
        CREATE TABLE schema_migrations (
          version INTEGER PRIMARY KEY,
          applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TRIGGER reject_version_one
        BEFORE INSERT ON schema_migrations
        WHEN NEW.version = 1
        BEGIN
          SELECT RAISE(ABORT, 'migration rejected');
        END;
        """
    )

    try:
        MigrationRunner(connection).migrate()
    except Exception as error:
        assert "migration rejected" in str(error)
    else:
        raise AssertionError("migration should fail")

    tables = {
        row["name"]
        for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")
    }
    assert "app_settings" not in tables
    assert "app_events" not in tables
