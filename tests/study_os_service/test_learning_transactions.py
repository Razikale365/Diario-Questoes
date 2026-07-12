from datetime import date
from pathlib import Path

import pytest

from study_os_service.db.connection import connect_database
from study_os_service.db.migrations import MigrationRunner
from study_os_service.services.planner_generation import PlannerGenerationService
from study_os_service.services.sessions import SessionService
from tests.study_os_service.test_planner_generation import prepare_target


@pytest.fixture
def learning_plan(tmp_path: Path):
    connection = connect_database(tmp_path / "study.sqlite3")
    MigrationRunner(connection).migrate()
    prepare_target(connection)
    pdf_path = tmp_path / "Aula 01.pdf"
    pdf_path.write_bytes(b"%PDF-1.7\nfixture")
    connection.execute("UPDATE materials SET absolute_path=?", (str(pdf_path),))
    planner = PlannerGenerationService(connection)
    day = planner.generate_day(
        "bacen_economia_financas",
        date(2026, 7, 13),
        idempotency_key="learning-day",
        time_budget_minutes=240,
    )
    try:
        yield connection, planner, day
    finally:
        connection.close()


def test_planner_result_appends_event_and_projection_in_same_transaction(
    learning_plan,
):
    connection, planner, day = learning_plan
    block = next(item for item in day.blocks if item.block_kind == "questions")

    saved = planner.record_block_result(
        block.id,
        state="completed",
        questions_done=20,
        correct_count=16,
        wrong_count=4,
        doubt_count=1,
        favorite_count=0,
        expected_version=block.version,
    )
    event = connection.execute("SELECT * FROM learning_events").fetchone()
    state = connection.execute("SELECT * FROM topic_learning_states").fetchone()
    replayed = planner.learning.record_planner_block(saved)

    assert saved.state == "completed"
    assert event["source_kind"] == "planner_block"
    assert event["source_id"] == str(block.id)
    assert tuple(event[key] for key in (
        "questions_done", "correct_count", "wrong_count", "doubt_count"
    )) == (20, 16, 4, 1)
    assert state["event_cursor"] == event["id"]
    assert replayed.event.id == event["id"]
    assert connection.execute("SELECT COUNT(*) FROM learning_events").fetchone()[0] == 1


def test_learning_failure_rolls_back_planner_result(learning_plan):
    connection, planner, day = learning_plan
    block = next(item for item in day.blocks if item.block_kind == "questions")
    connection.executescript(
        """
        CREATE TRIGGER reject_learning_event
        BEFORE INSERT ON learning_events
        BEGIN
          SELECT RAISE(ABORT, 'learning event rejected');
        END;
        """
    )

    with pytest.raises(Exception, match="learning event rejected"):
        planner.record_block_result(
            block.id,
            state="completed",
            questions_done=20,
            correct_count=16,
            wrong_count=4,
            doubt_count=0,
            favorite_count=0,
            expected_version=block.version,
        )

    assert planner.repository.get_block(block.id).state == "pending"
    assert connection.execute("SELECT COUNT(*) FROM learning_events").fetchone()[0] == 0


def test_partial_session_appends_page_event_and_releases_theory_block(
    learning_plan,
):
    connection, planner, day = learning_plan
    theory = next(item for item in day.blocks if item.block_kind == "theory")
    candidate = next(item for item in day.candidates if item.id == theory.candidate_id)
    sessions = SessionService(connection)
    started = sessions.start(
        "bacen_economia_financas",
        candidate.lesson_id,
        candidate.material_id,
        "learning-session",
        planner_block_id=theory.id,
    )
    sessions.finish(
        started.session.id,
        outcome="partial",
        end_page=25,
        elapsed_seconds=1800,
        questions_done=0,
        correct_count=0,
        wrong_count=0,
        doubt_count=0,
        favorite_count=0,
        notes="intervalo",
        expected_version=started.session.version,
    )
    event = connection.execute(
        "SELECT * FROM learning_events WHERE source_kind='study_session'"
    ).fetchone()

    assert (event["event_kind"], event["outcome"]) == ("theory", "partial")
    assert (event["start_page"], event["end_page"]) == (1, 25)
    assert planner.repository.get_block(theory.id).state == "pending"


def test_learning_failure_rolls_back_session_finish(learning_plan):
    connection, _planner, day = learning_plan
    theory = next(item for item in day.blocks if item.block_kind == "theory")
    candidate = next(item for item in day.candidates if item.id == theory.candidate_id)
    sessions = SessionService(connection)
    started = sessions.start(
        "bacen_economia_financas",
        candidate.lesson_id,
        candidate.material_id,
        "rollback-session",
        planner_block_id=theory.id,
    )
    connection.executescript(
        """
        CREATE TRIGGER reject_session_learning
        BEFORE INSERT ON learning_events
        BEGIN
          SELECT RAISE(ABORT, 'session learning rejected');
        END;
        """
    )

    with pytest.raises(Exception, match="session learning rejected"):
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

    assert sessions.sessions.get(started.session.id).state == "active"
    assert connection.execute("SELECT COUNT(*) FROM learning_events").fetchone()[0] == 0
