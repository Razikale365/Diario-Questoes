from datetime import date
from pathlib import Path

import pytest

from study_os_service.db.connection import connect_database
from study_os_service.db.migrations import MigrationRunner
from study_os_service.services.planner_generation import PlannerGenerationService
from study_os_service.services.sessions import SessionService
from tests.study_os_service.test_planner_generation import prepare_target


@pytest.fixture
def linked_plan(tmp_path: Path):
    connection = connect_database(tmp_path / "study.sqlite3")
    MigrationRunner(connection).migrate()
    prepare_target(connection)
    pdf_path = tmp_path / "Aula 01.pdf"
    pdf_path.write_bytes(b"%PDF-1.7\nfixture")
    connection.execute(
        "UPDATE materials SET absolute_path=?",
        (str(pdf_path),),
    )
    planner = PlannerGenerationService(connection)
    day = planner.generate_day(
        "bacen_economia_financas",
        date(2026, 7, 13),
        idempotency_key="session-link-day",
        time_budget_minutes=240,
    )
    try:
        yield connection, planner, day
    finally:
        connection.close()


def test_theory_session_claims_exact_pending_block_atomically(linked_plan):
    connection, planner, day = linked_plan
    theory = next(block for block in day.blocks if block.block_kind == "theory")
    candidate = next(item for item in day.candidates if item.id == theory.candidate_id)

    started = SessionService(connection).start(
        "bacen_economia_financas",
        candidate.lesson_id,
        candidate.material_id,
        "linked-theory-session",
        planner_block_id=theory.id,
    )
    reopened = SessionService(connection).start(
        "bacen_economia_financas",
        candidate.lesson_id,
        candidate.material_id,
        "linked-theory-session-reopen",
        planner_block_id=theory.id,
    )
    linked = planner.repository.get_block(theory.id)

    assert reopened.session.id == started.session.id
    assert linked.state == "active"
    assert linked.execution_session_id == started.session.id
    assert started.session.lesson_id == candidate.lesson_id
    assert started.session.material_id == candidate.material_id


def test_block_link_rejects_question_kind_and_material_or_target_mismatch(linked_plan):
    connection, _planner, day = linked_plan
    theory = next(block for block in day.blocks if block.block_kind == "theory")
    question = next(block for block in day.blocks if block.block_kind == "questions")
    candidate = next(item for item in day.candidates if item.id == theory.candidate_id)
    sessions = SessionService(connection)

    with pytest.raises(ValueError, match="theory block"):
        sessions.start(
            "bacen_economia_financas",
            candidate.lesson_id,
            candidate.material_id,
            "question-block-link",
            planner_block_id=question.id,
        )
    with pytest.raises((KeyError, ValueError), match="material"):
        sessions.start(
            "bacen_economia_financas",
            candidate.lesson_id,
            candidate.material_id + 999,
            "wrong-material-link",
            planner_block_id=theory.id,
        )
    with pytest.raises(ValueError, match="target"):
        sessions.start(
            "rfb_auditor",
            candidate.lesson_id,
            candidate.material_id,
            "wrong-target-link",
            planner_block_id=theory.id,
        )


def test_partial_session_releases_block_for_exact_page_resume(linked_plan):
    connection, planner, day = linked_plan
    theory = next(block for block in day.blocks if block.block_kind == "theory")
    candidate = next(item for item in day.candidates if item.id == theory.candidate_id)
    sessions = SessionService(connection)
    first = sessions.start(
        "bacen_economia_financas",
        candidate.lesson_id,
        candidate.material_id,
        "partial-linked-session",
        planner_block_id=theory.id,
    )
    finished = sessions.finish(
        first.session.id,
        outcome="partial",
        end_page=25,
        elapsed_seconds=1800,
        questions_done=0,
        correct_count=0,
        wrong_count=0,
        doubt_count=0,
        favorite_count=0,
        notes="intervalo",
        expected_version=first.session.version,
    )
    pending = planner.repository.get_block(theory.id)
    resumed = sessions.start(
        "bacen_economia_financas",
        candidate.lesson_id,
        candidate.material_id,
        "resumed-linked-session",
        planner_block_id=theory.id,
    )
    relinked = planner.repository.get_block(theory.id)

    assert finished.progress.cursor_page == 25
    assert pending.state == "pending"
    assert pending.execution_session_id == first.session.id
    assert resumed.session.start_page == 25
    assert relinked.state == "active"
    assert relinked.execution_session_id == resumed.session.id


def test_completed_session_closes_the_linked_block(linked_plan):
    connection, planner, day = linked_plan
    theory = next(block for block in day.blocks if block.block_kind == "theory")
    candidate = next(item for item in day.candidates if item.id == theory.candidate_id)
    sessions = SessionService(connection)
    started = sessions.start(
        "bacen_economia_financas",
        candidate.lesson_id,
        candidate.material_id,
        "completed-linked-session",
        planner_block_id=theory.id,
    )
    sessions.finish(
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

    assert planner.repository.get_block(theory.id).state == "completed"


def test_skipped_session_closes_the_linked_block(linked_plan):
    connection, planner, day = linked_plan
    theory = next(block for block in day.blocks if block.block_kind == "theory")
    candidate = next(item for item in day.candidates if item.id == theory.candidate_id)
    sessions = SessionService(connection)
    started = sessions.start(
        "bacen_economia_financas",
        candidate.lesson_id,
        candidate.material_id,
        "skipped-linked-session",
        planner_block_id=theory.id,
    )
    sessions.skip(
        started.session.id,
        reason="lack_of_time",
        notes="",
        expected_version=started.session.version,
    )

    assert planner.repository.get_block(theory.id).state == "skipped"
