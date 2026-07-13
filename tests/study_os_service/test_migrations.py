from pathlib import Path
import sqlite3

import pytest

import study_os_service.db.connection as connection_module
from study_os_service.db.connection import connect_database
from study_os_service.db.migrations import (
    CURRENT_SCHEMA_VERSION,
    MigrationRunner,
    UnsupportedSchemaVersionError,
)


def test_migrate_initializes_foundation_schema_idempotently(tmp_path: Path):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        runner = MigrationRunner(connection)

        assert runner.migrate() == CURRENT_SCHEMA_VERSION
        assert runner.migrate() == CURRENT_SCHEMA_VERSION

        tables = {
            row["name"]
            for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
        assert {
            "schema_migrations",
            "app_settings",
            "app_events",
        } <= tables
        assert connection.execute("PRAGMA foreign_keys").fetchone()[0] == 1
        assert connection.execute("PRAGMA journal_mode").fetchone()[0].lower() == "wal"
    finally:
        connection.close()


def test_connection_uses_row_factory_busy_timeout_and_exact_timeout(tmp_path: Path):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        row = connection.execute("SELECT 1 AS value").fetchone()
        assert isinstance(row, sqlite3.Row)
        assert row["value"] == 1
        assert connection.execute("PRAGMA busy_timeout").fetchone()[0] == 5000
    finally:
        connection.close()


def test_connect_database_closes_connection_when_pragma_setup_fails(monkeypatch, tmp_path: Path):
    class FailingConnection:
        closed = False
        row_factory = None

        def execute(self, statement):
            if statement == "PRAGMA journal_mode=WAL":
                raise RuntimeError("pragma failed")
            return self

        def close(self):
            self.closed = True

    fake_connection = FailingConnection()
    captured = {}

    def fake_connect(path, **kwargs):
        captured["path"] = path
        captured.update(kwargs)
        return fake_connection

    monkeypatch.setattr(connection_module.sqlite3, "connect", fake_connect)

    with pytest.raises(RuntimeError, match="pragma failed"):
        connect_database(tmp_path / "study.sqlite3")

    assert captured["timeout"] == 5.0
    assert captured["isolation_level"] is None
    assert fake_connection.closed is True


def test_migrate_rejects_newer_unsupported_schema_version(tmp_path: Path):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        connection.execute(
            """
            CREATE TABLE schema_migrations (
              version INTEGER PRIMARY KEY,
              applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        newer_version = CURRENT_SCHEMA_VERSION + 1
        connection.execute(
            "INSERT INTO schema_migrations (version) VALUES (?)", (newer_version,)
        )

        with pytest.raises(UnsupportedSchemaVersionError, match=str(newer_version)):
            MigrationRunner(connection).migrate()
    finally:
        connection.close()


def test_migrate_rolls_back_foundation_schema_when_version_record_fails(tmp_path: Path):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
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

        with pytest.raises(sqlite3.IntegrityError, match="migration rejected"):
            MigrationRunner(connection).migrate()

        tables = {
            row["name"]
            for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
        assert "app_settings" not in tables
        assert "app_events" not in tables
    finally:
        connection.close()


def test_migrate_creates_required_columns_defaults_and_severity_check(tmp_path: Path):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        MigrationRunner(connection).migrate()

        def table_info(table_name):
            return {
                row["name"]: (row["type"], row["notnull"], row["dflt_value"])
                for row in connection.execute(f"PRAGMA table_info({table_name})")
            }

        assert table_info("schema_migrations") == {
            "version": ("INTEGER", 0, None),
            "applied_at": ("TEXT", 1, "CURRENT_TIMESTAMP"),
        }
        assert table_info("app_settings") == {
            "key": ("TEXT", 0, None),
            "value_json": ("TEXT", 1, None),
            "updated_at": ("TEXT", 1, "CURRENT_TIMESTAMP"),
            "version": ("INTEGER", 1, "1"),
        }
        assert table_info("app_events") == {
            "id": ("INTEGER", 0, None),
            "event_type": ("TEXT", 1, None),
            "severity": ("TEXT", 1, None),
            "message": ("TEXT", 1, None),
            "context_json": ("TEXT", 1, "'{}'"),
            "created_at": ("TEXT", 1, "CURRENT_TIMESTAMP"),
        }
        app_events_sql = connection.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='app_events'"
        ).fetchone()[0]
        assert "CHECK (severity IN ('info','warning','error'))" in app_events_sql
    finally:
        connection.close()
