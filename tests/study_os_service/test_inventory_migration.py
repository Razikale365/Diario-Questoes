from pathlib import Path
import sqlite3

import pytest

from study_os_service.db.connection import connect_database
from study_os_service.db.migrations import MIGRATIONS, MigrationRunner


INVENTORY_TABLES = {
    "course_roots",
    "courses",
    "disciplines",
    "course_disciplines",
    "lessons",
    "materials",
    "import_runs",
    "import_issues",
}


def table_names(connection: sqlite3.Connection) -> set[str]:
    return {
        row["name"]
        for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")
    }


def install_version_one(connection: sqlite3.Connection) -> None:
    connection.execute("BEGIN IMMEDIATE")
    connection.execute(
        """
        CREATE TABLE schema_migrations (
          version INTEGER PRIMARY KEY,
          applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    for statement in MIGRATIONS[0][1]:
        connection.execute(statement)
    connection.execute("INSERT INTO schema_migrations (version) VALUES (1)")
    connection.commit()


def insert_root(connection: sqlite3.Connection, root_path: str, **overrides) -> int:
    values = {
        "target_slug": "rfb_auditor",
        "provider": "Estrategia Concursos",
        "package_name": "RFB Auditor Pacotaco",
        "package_id": "249654",
        "package_url": "https://www.estrategiaconcursos.com.br/app/dashboard/pacote/249654",
        "edition_note": "Catalogo 2026-07-11",
        "root_path": root_path,
        "source_kind": "course_package",
        "acquisition_method": "estrategia_downloader",
        "download_status": "downloaded",
        "catalog_checked_at": "2026-07-11T12:00:00+00:00",
        "active": 1,
    }
    values.update(overrides)
    cursor = connection.execute(
        """
        INSERT INTO course_roots (
          target_slug, provider, package_name, package_id, package_url,
          edition_note, root_path, source_kind, acquisition_method,
          download_status, catalog_checked_at, active
        ) VALUES (
          :target_slug, :provider, :package_name, :package_id, :package_url,
          :edition_note, :root_path, :source_kind, :acquisition_method,
          :download_status, :catalog_checked_at, :active
        )
        """,
        values,
    )
    return cursor.lastrowid


def test_empty_database_migrates_to_inventory_schema_version_two(tmp_path: Path):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        assert MigrationRunner(connection).migrate() == 2
        assert INVENTORY_TABLES <= table_names(connection)
        assert [
            row["version"]
            for row in connection.execute(
                "SELECT version FROM schema_migrations ORDER BY version"
            )
        ] == [1, 2]
    finally:
        connection.close()


def test_version_one_database_upgrades_without_losing_foundation_data(tmp_path: Path):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        install_version_one(connection)
        connection.execute(
            "INSERT INTO app_settings (key, value_json) VALUES ('theme', '\"dark\"')"
        )

        assert MigrationRunner(connection).migrate() == 2
        assert connection.execute(
            "SELECT value_json FROM app_settings WHERE key='theme'"
        ).fetchone()[0] == '"dark"'
        assert INVENTORY_TABLES <= table_names(connection)
    finally:
        connection.close()


def test_inventory_migration_is_idempotent(tmp_path: Path):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        runner = MigrationRunner(connection)
        runner.migrate()
        first_sql = {
            row["name"]: row["sql"]
            for row in connection.execute(
                "SELECT name, sql FROM sqlite_master WHERE type='table'"
            )
        }

        assert runner.migrate() == 2
        assert {
            row["name"]: row["sql"]
            for row in connection.execute(
                "SELECT name, sql FROM sqlite_master WHERE type='table'"
            )
        } == first_sql
    finally:
        connection.close()


def test_inventory_migration_rolls_back_every_new_table_when_version_record_fails(
    tmp_path: Path,
):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        install_version_one(connection)
        connection.executescript(
            """
            CREATE TRIGGER reject_version_two
            BEFORE INSERT ON schema_migrations
            WHEN NEW.version = 2
            BEGIN
              SELECT RAISE(ABORT, 'migration two rejected');
            END;
            """
        )

        with pytest.raises(sqlite3.IntegrityError, match="migration two rejected"):
            MigrationRunner(connection).migrate()

        assert not (INVENTORY_TABLES & table_names(connection))
        assert [
            row["version"]
            for row in connection.execute("SELECT version FROM schema_migrations")
        ] == [1]
    finally:
        connection.close()


def test_course_root_path_is_unique_and_enum_fields_are_checked(tmp_path: Path):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        MigrationRunner(connection).migrate()
        insert_root(connection, "C:/courses/rfb")

        with pytest.raises(sqlite3.IntegrityError, match="UNIQUE"):
            insert_root(connection, "C:/courses/rfb", target_slug="bacen_economia_financas")
        with pytest.raises(sqlite3.IntegrityError, match="CHECK"):
            insert_root(
                connection,
                "C:/courses/invalid-status",
                download_status="invented",
            )
        with pytest.raises(sqlite3.IntegrityError, match="CHECK"):
            insert_root(connection, "C:/courses/invalid-bool", active=2)
    finally:
        connection.close()


def test_inventory_foreign_keys_restrict_destructive_root_deletion(tmp_path: Path):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        MigrationRunner(connection).migrate()
        root_id = insert_root(connection, "C:/courses/rfb")
        connection.execute(
            """
            INSERT INTO courses (
              root_id, display_name, provider, relative_path,
              active, scan_state
            ) VALUES (?, 'Portuguese', 'Estrategia Concursos', 'Portuguese', 1, 'available')
            """,
            (root_id,),
        )

        with pytest.raises(sqlite3.IntegrityError, match="FOREIGN KEY"):
            connection.execute("DELETE FROM course_roots WHERE id=?", (root_id,))
    finally:
        connection.close()


def test_json_columns_reject_invalid_json_and_have_valid_defaults(tmp_path: Path):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        MigrationRunner(connection).migrate()
        connection.execute(
            "INSERT INTO disciplines (canonical_name) VALUES ('Lingua Portuguesa')"
        )
        assert connection.execute(
            "SELECT aliases_json FROM disciplines WHERE canonical_name='Lingua Portuguesa'"
        ).fetchone()[0] == "[]"

        with pytest.raises(sqlite3.IntegrityError, match="CHECK"):
            connection.execute(
                "INSERT INTO disciplines (canonical_name, aliases_json) VALUES ('Bad', 'not-json')"
            )
    finally:
        connection.close()
