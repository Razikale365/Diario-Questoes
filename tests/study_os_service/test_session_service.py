from pathlib import Path

import pytest

from study_os_service.db.connection import connect_database
from study_os_service.db.migrations import MigrationRunner
from study_os_service.repositories.progress import ProgressRepository
from study_os_service.repositories.sessions import (
    IdempotencyConflictError,
    SessionConflictError,
)
from study_os_service.services.sessions import SessionService


def seed_executable_material(connection, root: Path) -> tuple[int, int]:
    root.mkdir()
    pdf_path = root / "Aula 01.pdf"
    pdf_path.write_bytes(b"%PDF-fixture")
    root_id = connection.execute(
        """
        INSERT INTO course_roots (
          target_slug, provider, package_name, package_id, package_url,
          edition_note, root_path, source_kind, acquisition_method,
          download_status, catalog_checked_at, active
        ) VALUES (
          'rfb_auditor', 'Estrategia Concursos', 'Fixture', '249654',
          'https://www.estrategiaconcursos.com.br/app/dashboard/pacote/249654',
          'fixture', ?, 'course_package', 'estrategia_downloader',
          'validated', '2026-07-11T12:00:00+00:00', 1
        )
        """,
        (str(root.resolve()),),
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
          page_count, available, is_primary, primary_selection, trust_level
        ) VALUES (?, ?, ?, 'Direito/PDF/Aula 01.pdf',
                  'direito/pdf/aula 01.pdf', 'original', ?, '1',
                  100, 1, 1, 'automatic', 10)
        """,
        (course_id, lesson_id, str(pdf_path.resolve()), pdf_path.stat().st_size),
    ).lastrowid
    return lesson_id, material_id


@pytest.fixture
def session_context(tmp_path: Path):
    database_path = tmp_path / "study.sqlite3"
    connection = connect_database(database_path)
    MigrationRunner(connection).migrate()
    lesson_id, material_id = seed_executable_material(
        connection, tmp_path / "package"
    )
    service = SessionService(connection)
    try:
        yield database_path, connection, service, lesson_id, material_id
    finally:
        connection.close()


def start(service, lesson_id, material_id, key="start-1"):
    return service.start(
        target_slug="rfb_auditor",
        lesson_id=lesson_id,
        material_id=material_id,
        idempotency_key=key,
    )


def test_start_is_idempotent_and_opens_exact_cursor(session_context):
    _, connection, service, lesson_id, material_id = session_context

    first = start(service, lesson_id, material_id)
    second = start(service, lesson_id, material_id)

    assert second == first
    assert first.session.state == "active"
    assert first.session.start_page == 1
    assert first.progress.status == "in_progress"
    assert first.open_url == (
        f"/api/v1/materials/{material_id}/file"
        "?targetSlug=rfb_auditor#page=1"
    )
    assert connection.execute("SELECT COUNT(*) FROM study_sessions").fetchone()[0] == 1


def test_new_key_reuses_an_existing_active_session(session_context):
    _, connection, service, lesson_id, material_id = session_context
    first = start(service, lesson_id, material_id, key="first")

    second = start(service, lesson_id, material_id, key="second")

    assert second.session.id == first.session.id
    assert connection.execute("SELECT COUNT(*) FROM study_sessions").fetchone()[0] == 1


def test_idempotency_key_cannot_be_reused_for_another_material(session_context):
    _, connection, service, lesson_id, material_id = session_context
    start(service, lesson_id, material_id, key="same-key")
    course_id = connection.execute(
        "SELECT course_id FROM lessons WHERE id=?", (lesson_id,)
    ).fetchone()[0]
    other_lesson = connection.execute(
        """
        INSERT INTO lessons (
          course_id, lesson_number, title, sequence_index, status, available
        ) VALUES (?, 2, 'Aula 02', 1, 'unread', 1)
        """,
        (course_id,),
    ).lastrowid
    other_material = connection.execute(
        """
        INSERT INTO materials (
          course_id, lesson_id, absolute_path, relative_path,
          normalized_relative_path, kind, size_bytes, modified_at,
          page_count, available, is_primary, primary_selection, trust_level
        ) SELECT course_id, ?, absolute_path, 'Direito/PDF/Aula 02.pdf',
                 'direito/pdf/aula 02.pdf', kind, size_bytes, modified_at,
                 page_count, available, 1, 'automatic', trust_level
          FROM materials WHERE id=?
        """,
        (other_lesson, material_id),
    ).lastrowid

    with pytest.raises(IdempotencyConflictError, match="another request"):
        service.start(
            target_slug="rfb_auditor",
            lesson_id=other_lesson,
            material_id=other_material,
            idempotency_key="same-key",
        )


def test_checkpoint_advances_page_without_counting_session(session_context):
    _, _, service, lesson_id, material_id = session_context
    started = start(service, lesson_id, material_id)

    checkpoint = service.checkpoint(
        started.session.id,
        end_page=10,
        elapsed_seconds=300,
        expected_version=started.session.version,
    )

    assert checkpoint.session.state == "active"
    assert checkpoint.session.end_page == 10
    assert checkpoint.session.elapsed_seconds == 300
    assert checkpoint.progress.cursor_page == 10
    assert checkpoint.progress.session_count == 0
    assert checkpoint.progress.total_seconds == 0


def test_partial_finish_advances_cursor_without_covering_lesson(session_context):
    _, _, service, lesson_id, material_id = session_context
    started = start(service, lesson_id, material_id)

    result = service.finish(
        started.session.id,
        outcome="partial",
        end_page=18,
        elapsed_seconds=1200,
        questions_done=0,
        correct_count=0,
        wrong_count=0,
        doubt_count=0,
        favorite_count=0,
        notes="intervalo",
        expected_version=started.session.version,
    )

    assert result.session.state == "finished"
    assert result.session.outcome == "partial"
    assert result.progress.cursor_page == 18
    assert result.progress.status == "in_progress"
    assert result.progress.total_seconds == 1200
    assert result.progress.session_count == 1


def test_new_service_connection_resumes_same_material_page(session_context):
    database_path, connection, service, lesson_id, material_id = session_context
    started = start(service, lesson_id, material_id)
    service.finish(
        started.session.id,
        outcome="partial",
        end_page=18,
        elapsed_seconds=1200,
        questions_done=0,
        correct_count=0,
        wrong_count=0,
        doubt_count=0,
        favorite_count=0,
        notes="",
        expected_version=started.session.version,
    )
    connection.close()

    restored_connection = connect_database(database_path)
    try:
        resumed = start(
            SessionService(restored_connection),
            lesson_id,
            material_id,
            key="start-2",
        )
        assert resumed.session.start_page == 18
        assert resumed.open_url.endswith("#page=18")
    finally:
        restored_connection.close()


def test_completed_and_failed_outcomes_update_progress(session_context):
    _, _, service, lesson_id, material_id = session_context
    started = start(service, lesson_id, material_id)
    completed = service.finish(
        started.session.id,
        outcome="completed",
        end_page=100,
        elapsed_seconds=3600,
        questions_done=0,
        correct_count=0,
        wrong_count=0,
        doubt_count=0,
        favorite_count=0,
        notes="",
        expected_version=started.session.version,
    )
    failed_start = start(service, lesson_id, material_id, key="failed-start")
    failed = service.finish(
        failed_start.session.id,
        outcome="failed",
        end_page=100,
        elapsed_seconds=600,
        questions_done=0,
        correct_count=0,
        wrong_count=0,
        doubt_count=0,
        favorite_count=0,
        notes="dificil",
        expected_version=failed_start.session.version,
    )

    assert completed.progress.status == "covered"
    assert completed.progress.completed_at is not None
    assert failed.progress.status == "weak"
    assert failed.progress.session_count == 2


@pytest.mark.parametrize(
    ("reason", "expected_status"),
    [
        ("lack_of_time", "in_progress"),
        ("fatigue", "in_progress"),
        ("wrong_material", "in_progress"),
        ("blocked_prerequisite", "in_progress"),
        ("too_difficult", "weak"),
        ("other", "in_progress"),
    ],
)
def test_skip_reasons_are_durable_without_counting_a_session(
    session_context, reason, expected_status
):
    _, _, service, lesson_id, material_id = session_context
    started = start(service, lesson_id, material_id)

    result = service.skip(
        started.session.id,
        reason=reason,
        notes="hoje nao",
        expected_version=started.session.version,
    )

    assert result.session.outcome == "skipped"
    assert result.session.skip_reason == reason
    assert result.progress.status == expected_status
    assert result.progress.session_count == 0
    assert result.progress.total_seconds == 0


def test_start_rejects_target_mismatch_unavailable_and_non_pdf(session_context):
    _, connection, service, lesson_id, material_id = session_context

    with pytest.raises(ValueError, match="target"):
        service.start("bacen_economia_financas", lesson_id, material_id, "wrong-target")
    connection.execute("UPDATE materials SET available=0 WHERE id=?", (material_id,))
    with pytest.raises(ValueError, match="unavailable"):
        start(service, lesson_id, material_id, key="missing")
    connection.execute(
        "UPDATE materials SET available=1, absolute_path='C:/fixture/not-pdf.txt' WHERE id=?",
        (material_id,),
    )
    with pytest.raises(ValueError, match="PDF"):
        start(service, lesson_id, material_id, key="not-pdf")


def test_stale_session_version_is_rejected(session_context):
    _, _, service, lesson_id, material_id = session_context
    started = start(service, lesson_id, material_id)
    service.checkpoint(
        started.session.id,
        end_page=5,
        elapsed_seconds=300,
        expected_version=started.session.version,
    )

    with pytest.raises(SessionConflictError, match="changed"):
        service.checkpoint(
            started.session.id,
            end_page=6,
            elapsed_seconds=360,
            expected_version=started.session.version,
        )


def test_finish_rolls_back_session_when_progress_update_fails(
    session_context, monkeypatch
):
    _, connection, service, lesson_id, material_id = session_context
    started = start(service, lesson_id, material_id)

    def fail_progress(*_args, **_kwargs):
        raise RuntimeError("forced progress failure")

    monkeypatch.setattr(ProgressRepository, "record_session", fail_progress)

    with pytest.raises(RuntimeError, match="forced progress failure"):
        service.finish(
            started.session.id,
            outcome="partial",
            end_page=18,
            elapsed_seconds=1200,
            questions_done=0,
            correct_count=0,
            wrong_count=0,
            doubt_count=0,
            favorite_count=0,
            notes="",
            expected_version=started.session.version,
        )

    row = connection.execute(
        "SELECT state, outcome FROM study_sessions WHERE id=?",
        (started.session.id,),
    ).fetchone()
    assert dict(row) == {"state": "active", "outcome": None}
