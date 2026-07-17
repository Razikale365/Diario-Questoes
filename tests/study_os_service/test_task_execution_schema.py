from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path
import sqlite3

import pytest

from study_os_service.db.connection import connect_database
from study_os_service.db.migrations import CURRENT_SCHEMA_VERSION, MIGRATIONS, MigrationRunner
from study_os_service.domain.task_execution import TaskExecutionInput
from study_os_service.repositories.task_execution import (
    TaskExecutionIdempotencyConflict,
    TaskExecutionRepository,
)


def valid_input(**overrides: object) -> TaskExecutionInput:
    payload: dict[str, object] = {
        "target_slug": "sefaz_ce",
        "source_plan_task_id": 1,
        "sprint_action_id": None,
        "outcome": "completed",
        "performed_on": date(2026, 7, 16),
        "task_minutes": 60,
        "exercise_minutes": 35,
        "questions_total": 20,
        "correct_count": 16,
        "wrong_count": 4,
        "doubt_count": 2,
        "supplied_performance_bp": None,
        "energy_after": 3,
        "notes": "Revisão de ontem",
    }
    payload.update(overrides)
    return TaskExecutionInput(**payload)  # type: ignore[arg-type]


def _install_version_twelve(connection: sqlite3.Connection) -> None:
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
        if version > 12:
            break
        for statement in statements:
            connection.execute(statement)
        connection.execute("INSERT INTO schema_migrations (version) VALUES (?)", (version,))
    connection.commit()


def _seed_target_and_source_task(
    connection: sqlite3.Connection, target_slug: str = "sefaz_ce"
) -> int:
    connection.execute(
        """
        INSERT INTO exam_targets (
          target_slug, display_name, institution, role, banca, phase,
          deadline, daily_quota, priority_score, source_urls_json
        ) VALUES (?, ?, ?, 'Auditor Fiscal', 'FCC',
                  'pos_edital', '2026-08-01', 4, 100, '["https://example.test/edital"]')
        """,
        (target_slug, target_slug, target_slug),
    )
    return int(
        connection.execute(
            """
            INSERT INTO source_plan_tasks (
              target_slug, source_kind, external_task_id, plan_label,
              source_order, discipline, topic_hint, task_kind, description,
              estimated_minutes, relevance, status
            ) VALUES (?, 'ls', ?, 'Meta 47', 1,
                      'Legislação Tributária', 'ICMS', 'questions', 'Resolver bateria',
                      60, 10, 'pending')
            """,
            (target_slug, f"{target_slug}-meta-47-task-1"),
        ).lastrowid
    )


def _seed_sprint_action(
    connection: sqlite3.Connection, target_slug: str, source_plan_task_id: int
) -> int:
    run_id = connection.execute(
        """
        INSERT INTO sprint_day_runs (
          idempotency_key, target_slug, plan_date, days_remaining,
          ls_budget_minutes, extra_budget_minutes, algorithm_version, input_hash, status
        ) VALUES (?, ?, '2026-07-16', 16, 240, 0, 'sprint-v1', 'input-hash', 'generated')
        """,
        (f"{target_slug}-sprint-run", target_slug),
    ).lastrowid
    return int(
        connection.execute(
            """
            INSERT INTO sprint_actions (
              run_id, target_slug, position, action_kind, recommendation,
              source_plan_task_id, title, duration_minutes
            ) VALUES (?, ?, 1, 'ls_execute', 'execute', ?, 'Resolver bateria', 60)
            """,
            (run_id, target_slug, source_plan_task_id),
        ).lastrowid
    )


def _seed_calendar_run(connection: sqlite3.Connection) -> int:
    return int(
        connection.execute(
            """
            INSERT INTO sprint_calendar_runs (
              idempotency_key, target_slug, window_start, window_end,
              planning_cutoff, exact_through, algorithm_version, request_hash,
              input_hash, decision, status, warnings_json, shortfalls_json,
              projection_snapshot_json, capacity_snapshot_json
            ) VALUES (
              'calendar-run-1', 'sefaz_ce', '2026-07-14', '2026-07-20',
              '2026-07-14T08:00:00.000000Z', '2026-07-16', 'calendar-v1',
              ?, ?, 'draft', 'generated', '[]', '[]', '{}', '{}'
            )
            """,
            ("a" * 64, "b" * 64),
        ).lastrowid
    )


def _execution_values(**overrides: object) -> dict[str, object]:
    values: dict[str, object] = {
        "idempotency_key": "execution-1",
        "request_hash": "c" * 64,
        "target_slug": "sefaz_ce",
        "source_plan_task_id": 1,
        "sprint_action_id": None,
        "outcome": "completed",
        "performed_on": "2026-07-16",
        "task_minutes": 60,
        "exercise_minutes": 35,
        "questions_total": 20,
        "correct_count": 16,
        "wrong_count": 4,
        "doubt_count": 2,
        "performance_bp": 8000,
        "energy_after": 3,
        "notes": "Revisão de ontem",
    }
    values.update(overrides)
    return values


def _insert_execution(connection: sqlite3.Connection, **overrides: object) -> None:
    values = _execution_values(**overrides)
    connection.execute(
        """
        INSERT INTO task_executions (
          idempotency_key, request_hash, target_slug, source_plan_task_id,
          sprint_action_id, outcome, performed_on, task_minutes, exercise_minutes,
          questions_total, correct_count, wrong_count, doubt_count, performance_bp,
          energy_after, notes
        ) VALUES (
          :idempotency_key, :request_hash, :target_slug, :source_plan_task_id,
          :sprint_action_id, :outcome, :performed_on, :task_minutes, :exercise_minutes,
          :questions_total, :correct_count, :wrong_count, :doubt_count, :performance_bp,
          :energy_after, :notes
        )
        """,
        values,
    )


def test_schema_thirteen_migrates_without_changing_existing_source_or_calendar_rows(
    tmp_path: Path,
):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        _install_version_twelve(connection)
        source_id = _seed_target_and_source_task(connection)
        calendar_id = _seed_calendar_run(connection)
        before = {
            table: tuple(
                tuple(row)
                for row in connection.execute(f"SELECT * FROM {table} ORDER BY rowid")
            )
            for table in ("source_plan_tasks", "sprint_calendar_runs")
        }

        assert MigrationRunner(connection).migrate() == 13
        assert CURRENT_SCHEMA_VERSION == 13
        after = {
            table: tuple(
                tuple(row)
                for row in connection.execute(f"SELECT * FROM {table} ORDER BY rowid")
            )
            for table in before
        }
        assert after == before
        assert source_id == 1
        assert calendar_id == 1
    finally:
        connection.close()


@pytest.mark.parametrize(
    "overrides",
    (
        {"idempotency_key": " "},
        {"request_hash": "not-a-hash"},
        {"outcome": "unknown"},
        {"performed_on": "2026-7-16"},
        {"task_minutes": 721},
        {"exercise_minutes": 61},
        {"questions_total": 10001},
        {"correct_count": 21},
        {"wrong_count": 21},
        {"doubt_count": 21},
        {"performance_bp": 7999},
        {"energy_after": 6},
    ),
)
def test_execution_ledger_schema_enforces_execution_bounds(
    tmp_path: Path, overrides: dict[str, object]
):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        MigrationRunner(connection).migrate()
        _seed_target_and_source_task(connection)
        with pytest.raises(sqlite3.IntegrityError):
            _insert_execution(connection, **overrides)
    finally:
        connection.close()


def test_execution_ledger_schema_rejects_answer_counts_above_total(tmp_path: Path):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        MigrationRunner(connection).migrate()
        _seed_target_and_source_task(connection)
        with pytest.raises(sqlite3.IntegrityError):
            _insert_execution(connection, correct_count=16, wrong_count=5)
    finally:
        connection.close()


def test_execution_ledger_schema_requires_null_performance_without_answers(tmp_path: Path):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        MigrationRunner(connection).migrate()
        _seed_target_and_source_task(connection)
        with pytest.raises(sqlite3.IntegrityError):
            _insert_execution(
                connection,
                questions_total=0,
                correct_count=0,
                wrong_count=0,
                doubt_count=0,
                performance_bp=0,
            )
        _insert_execution(
            connection,
            questions_total=0,
            correct_count=0,
            wrong_count=0,
            doubt_count=0,
            performance_bp=None,
        )
    finally:
        connection.close()


def test_execution_ledger_schema_rejects_sprint_action_from_other_target(tmp_path: Path):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        MigrationRunner(connection).migrate()
        _seed_target_and_source_task(connection, "sefaz_ce")
        other_source_id = _seed_target_and_source_task(connection, "other_target")
        other_action_id = _seed_sprint_action(connection, "other_target", other_source_id)

        with pytest.raises(sqlite3.IntegrityError, match="target mismatch"):
            _insert_execution(connection, sprint_action_id=other_action_id)

        _insert_execution(connection, idempotency_key="execution-without-action")
        with pytest.raises(sqlite3.IntegrityError, match="target mismatch"):
            connection.execute(
                "UPDATE task_executions SET sprint_action_id=? WHERE id=1",
                (other_action_id,),
            )
    finally:
        connection.close()


def test_counts_derive_performance_without_inventing_empty_evidence():
    assert valid_input().performance_bp == 8000
    assert valid_input(correct_count=0, wrong_count=20).performance_bp == 0
    assert (
        valid_input(
            questions_total=0,
            correct_count=0,
            wrong_count=0,
            doubt_count=0,
        ).performance_bp
        is None
    )
    with pytest.raises(ValueError, match="empty answers"):
        valid_input(
            questions_total=0,
            correct_count=0,
            wrong_count=0,
            doubt_count=0,
            supplied_performance_bp=0,
        )


def test_input_accepts_backdated_result_and_rejects_future_date():
    assert valid_input(performed_on=date(2026, 7, 1)).performed_on == date(2026, 7, 1)
    with pytest.raises(ValueError, match="future"):
        valid_input(performed_on=date.today() + timedelta(days=1))


def test_input_rejects_exercise_minutes_above_task_minutes_and_count_overflow():
    with pytest.raises(ValueError, match="exercise"):
        valid_input(exercise_minutes=61)
    with pytest.raises(ValueError, match="correct"):
        valid_input(correct_count=21)


def test_repository_inserts_replays_and_lists_immutable_executions(tmp_path: Path):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        MigrationRunner(connection).migrate()
        _seed_target_and_source_task(connection)
        repository = TaskExecutionRepository(connection)
        payload = valid_input()

        with pytest.raises(RuntimeError, match="active"):
            repository.insert_or_replay(payload, "execution-1", "d" * 64)

        connection.execute("BEGIN IMMEDIATE")
        created, replayed = repository.insert_or_replay(payload, "execution-1", "d" * 64)
        duplicate, duplicate_replayed = repository.insert_or_replay(
            payload, "execution-1", "d" * 64
        )
        connection.commit()

        assert replayed is False
        assert duplicate_replayed is True
        assert duplicate == created
        assert repository.get(created.id) == created
        assert repository.list_for_source_task("sefaz_ce", 1) == (created,)

        connection.execute("BEGIN IMMEDIATE")
        with pytest.raises(TaskExecutionIdempotencyConflict):
            repository.insert_or_replay(payload, "execution-1", "e" * 64)
        connection.rollback()
    finally:
        connection.close()
