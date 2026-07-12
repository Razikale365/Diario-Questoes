from pathlib import Path

import pytest

from study_os_service.db.connection import connect_database
from study_os_service.db.migrations import MigrationRunner
from study_os_service.repositories.progress import (
    ProgressConflictError,
    ProgressRepository,
)
from tests.study_os_service.test_session_migration import seed_inventory


@pytest.fixture
def progress_repository(tmp_path: Path):
    database_path = tmp_path / "study.sqlite3"
    connection = connect_database(database_path)
    MigrationRunner(connection).migrate()
    lesson_id, material_id = seed_inventory(connection)
    repository = ProgressRepository(connection)
    try:
        yield database_path, connection, repository, lesson_id, material_id
    finally:
        connection.close()


def test_get_or_create_is_idempotent_and_material_specific(progress_repository):
    _, connection, repository, lesson_id, material_id = progress_repository

    first = repository.get_or_create(lesson_id, material_id)
    second = repository.get_or_create(lesson_id, material_id)

    assert second == first
    assert first.status == "unread"
    assert first.cursor_page == 1
    assert first.furthest_page == 1
    assert first.version == 1
    assert connection.execute("SELECT COUNT(*) FROM progress_states").fetchone()[0] == 1


def test_get_or_create_rejects_lesson_material_mismatch(progress_repository):
    _, connection, repository, _, material_id = progress_repository
    course_id = connection.execute("SELECT course_id FROM lessons LIMIT 1").fetchone()[0]
    other_lesson = connection.execute(
        """
        INSERT INTO lessons (
          course_id, lesson_number, title, sequence_index, status, available
        ) VALUES (?, 2, 'Aula 02', 1, 'unread', 1)
        """,
        (course_id,),
    ).lastrowid

    with pytest.raises(ValueError, match="does not belong"):
        repository.get_or_create(other_lesson, material_id)


def test_checkpoint_advances_cursor_without_counting_a_session(progress_repository):
    _, _, repository, lesson_id, material_id = progress_repository
    initial = repository.get_or_create(lesson_id, material_id)

    updated = repository.advance_cursor(
        lesson_id,
        material_id,
        cursor_page=8,
        expected_version=initial.version,
    )

    assert updated.cursor_page == 8
    assert updated.furthest_page == 8
    assert updated.status == "in_progress"
    assert updated.total_seconds == 0
    assert updated.session_count == 0
    assert updated.version == 2


def test_stale_version_cannot_overwrite_newer_cursor(progress_repository):
    _, _, repository, lesson_id, material_id = progress_repository
    initial = repository.get_or_create(lesson_id, material_id)
    repository.advance_cursor(
        lesson_id, material_id, cursor_page=8, expected_version=initial.version
    )

    with pytest.raises(ProgressConflictError, match="changed"):
        repository.advance_cursor(
            lesson_id,
            material_id,
            cursor_page=9,
            expected_version=initial.version,
        )

    assert repository.get(lesson_id, material_id).cursor_page == 8


def test_cursor_is_monotonic_and_cannot_exceed_known_page_count(progress_repository):
    _, connection, repository, lesson_id, material_id = progress_repository
    connection.execute(
        "UPDATE materials SET page_count=10 WHERE id=?", (material_id,)
    )
    progress = repository.get_or_create(lesson_id, material_id)
    progress = repository.advance_cursor(
        lesson_id, material_id, cursor_page=8, expected_version=progress.version
    )

    with pytest.raises(ValueError, match="cannot move backwards"):
        repository.advance_cursor(
            lesson_id, material_id, cursor_page=7, expected_version=progress.version
        )
    with pytest.raises(ValueError, match="page count"):
        repository.advance_cursor(
            lesson_id, material_id, cursor_page=11, expected_version=progress.version
        )


def test_recorded_partial_and_completion_count_each_session_once(progress_repository):
    _, _, repository, lesson_id, material_id = progress_repository
    progress = repository.get_or_create(lesson_id, material_id)
    partial = repository.record_session(
        lesson_id,
        material_id,
        cursor_page=8,
        elapsed_seconds=900,
        status="in_progress",
        expected_version=progress.version,
    )
    completed = repository.record_session(
        lesson_id,
        material_id,
        cursor_page=12,
        elapsed_seconds=600,
        status="covered",
        expected_version=partial.version,
    )

    assert partial.total_seconds == 900
    assert partial.session_count == 1
    assert completed.total_seconds == 1500
    assert completed.session_count == 2
    assert completed.status == "covered"
    assert completed.completed_at is not None


def test_progress_survives_a_new_database_connection(progress_repository):
    database_path, connection, repository, lesson_id, material_id = progress_repository
    progress = repository.get_or_create(lesson_id, material_id)
    repository.record_session(
        lesson_id,
        material_id,
        cursor_page=18,
        elapsed_seconds=1200,
        status="in_progress",
        expected_version=progress.version,
    )
    connection.close()

    restored_connection = connect_database(database_path)
    try:
        restored = ProgressRepository(restored_connection).get(lesson_id, material_id)
        assert restored.cursor_page == 18
        assert restored.total_seconds == 1200
        assert restored.session_count == 1
    finally:
        restored_connection.close()


def test_progress_list_is_target_isolated(progress_repository):
    _, connection, repository, lesson_id, material_id = progress_repository
    repository.get_or_create(lesson_id, material_id)

    assert len(repository.list_for_target("rfb_auditor")) == 1
    assert repository.list_for_target("bacen_economia_financas") == []
