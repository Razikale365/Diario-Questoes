from pathlib import Path
import sqlite3

import pytest

from study_os_service.db.connection import connect_database
from study_os_service.db.migrations import (
    CURRENT_SCHEMA_VERSION,
    MIGRATIONS,
    MigrationRunner,
)


def install_version_three(connection: sqlite3.Connection) -> None:
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
        if version > 3:
            break
        for statement in statements:
            connection.execute(statement)
        connection.execute(
            "INSERT INTO schema_migrations (version) VALUES (?)", (version,)
        )
    connection.commit()


def seed_inventory(connection: sqlite3.Connection) -> tuple[int, int]:
    root_id = connection.execute(
        """
        INSERT INTO course_roots (
          target_slug, provider, package_name, package_id, package_url,
          edition_note, root_path, source_kind, acquisition_method,
          download_status, catalog_checked_at, active
        ) VALUES (
          'rfb_auditor', 'Estrategia Concursos', 'Fixture', '249654',
          'https://www.estrategiaconcursos.com.br/app/dashboard/pacote/249654',
          'fixture', 'C:/fixture/rfb', 'course_package',
          'estrategia_downloader', 'validated',
          '2026-07-11T12:00:00+00:00', 1
        )
        """
    ).lastrowid
    course_id = connection.execute(
        """
        INSERT INTO courses (
          root_id, display_name, provider, relative_path, active, scan_state
        ) VALUES (?, 'Direito Tributario', 'Estrategia Concursos',
                  'Direito Tributario', 1, 'available')
        """,
        (root_id,),
    ).lastrowid
    lesson_id = connection.execute(
        """
        INSERT INTO lessons (
          course_id, lesson_number, title, sequence_index, status, available
        ) VALUES (?, 1, 'Aula 01', 0, 'unread', 1)
        """,
        (course_id,),
    ).lastrowid
    material_id = connection.execute(
        """
        INSERT INTO materials (
          course_id, lesson_id, absolute_path, relative_path,
          normalized_relative_path, kind, size_bytes, modified_at,
          available, is_primary, primary_selection, trust_level
        ) VALUES (?, ?, 'C:/fixture/rfb/Direito/PDF/Aula 01.pdf',
                  'Direito/PDF/Aula 01.pdf', 'direito/pdf/aula 01.pdf',
                  'original', 1024, '1', 1, 1, 'automatic', 10)
        """,
        (course_id, lesson_id),
    ).lastrowid
    return lesson_id, material_id


def table_names(connection: sqlite3.Connection) -> set[str]:
    return {
        row["name"]
        for row in connection.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        )
    }


def test_version_three_upgrades_without_losing_inventory(tmp_path: Path):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        install_version_three(connection)
        lesson_id, material_id = seed_inventory(connection)

        assert MigrationRunner(connection).migrate() == CURRENT_SCHEMA_VERSION

        assert {"progress_states", "study_sessions"} <= table_names(connection)
        assert connection.execute(
            "SELECT id FROM lessons WHERE id=?", (lesson_id,)
        ).fetchone()[0] == lesson_id
        assert connection.execute(
            "SELECT id FROM materials WHERE id=?", (material_id,)
        ).fetchone()[0] == material_id
        assert [
            row["version"]
            for row in connection.execute(
                "SELECT version FROM schema_migrations ORDER BY version"
            )
        ] == list(range(1, CURRENT_SCHEMA_VERSION + 1))
    finally:
        connection.close()


def test_progress_and_session_constraints_reject_invalid_state(tmp_path: Path):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        MigrationRunner(connection).migrate()
        lesson_id, material_id = seed_inventory(connection)
        connection.execute(
            """
            INSERT INTO progress_states (
              lesson_id, material_id, cursor_page, furthest_page
            ) VALUES (?, ?, 8, 10)
            """,
            (lesson_id, material_id),
        )

        with pytest.raises(sqlite3.IntegrityError, match="UNIQUE"):
            connection.execute(
                """
                INSERT INTO progress_states (
                  lesson_id, material_id, cursor_page, furthest_page
                ) VALUES (?, ?, 1, 1)
                """,
                (lesson_id, material_id),
            )
        with pytest.raises(sqlite3.IntegrityError, match="CHECK"):
            connection.execute(
                "UPDATE progress_states SET cursor_page=11 WHERE lesson_id=?",
                (lesson_id,),
            )
        with pytest.raises(sqlite3.IntegrityError, match="CHECK"):
            connection.execute(
                """
                INSERT INTO study_sessions (
                  idempotency_key, target_slug, lesson_id, material_id,
                  state, started_at, ended_at, start_page, outcome
                ) VALUES (
                  'bad-active', 'rfb_auditor', ?, ?, 'active',
                  '2026-07-12T12:00:00+00:00',
                  '2026-07-12T12:01:00+00:00', 1, 'partial'
                )
                """,
                (lesson_id, material_id),
            )
    finally:
        connection.close()


def test_only_one_active_session_exists_per_lesson_material(tmp_path: Path):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        MigrationRunner(connection).migrate()
        lesson_id, material_id = seed_inventory(connection)
        for key in ("first", "second"):
            if key == "second":
                with pytest.raises(sqlite3.IntegrityError, match="UNIQUE"):
                    connection.execute(
                        """
                        INSERT INTO study_sessions (
                          idempotency_key, target_slug, lesson_id, material_id,
                          state, started_at, start_page
                        ) VALUES (?, 'rfb_auditor', ?, ?, 'active',
                                  '2026-07-12T12:00:00+00:00', 1)
                        """,
                        (key, lesson_id, material_id),
                    )
            else:
                connection.execute(
                    """
                    INSERT INTO study_sessions (
                      idempotency_key, target_slug, lesson_id, material_id,
                      state, started_at, start_page
                    ) VALUES (?, 'rfb_auditor', ?, ?, 'active',
                              '2026-07-12T12:00:00+00:00', 1)
                    """,
                    (key, lesson_id, material_id),
                )
    finally:
        connection.close()


def test_migration_four_rolls_back_if_version_record_fails(tmp_path: Path):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        install_version_three(connection)
        connection.executescript(
            """
            CREATE TRIGGER reject_version_four
            BEFORE INSERT ON schema_migrations
            WHEN NEW.version = 4
            BEGIN
              SELECT RAISE(ABORT, 'migration four rejected');
            END;
            """
        )

        with pytest.raises(sqlite3.IntegrityError, match="migration four rejected"):
            MigrationRunner(connection).migrate()

        assert not ({"progress_states", "study_sessions"} & table_names(connection))
        assert connection.execute(
            "SELECT MAX(version) FROM schema_migrations"
        ).fetchone()[0] == 3
    finally:
        connection.close()
