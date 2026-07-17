from __future__ import annotations

from datetime import UTC, date, datetime
import sqlite3
from typing import cast

from study_os_service.domain.task_execution import Outcome, TaskExecution, TaskExecutionInput


class TaskExecutionIdempotencyConflict(RuntimeError):
    pass


def _parse_timestamp(value: str) -> datetime:
    parsed = datetime.fromisoformat(value[:-1] + "+00:00" if value.endswith("Z") else value)
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError("stored execution timestamp must be timezone-aware")
    return parsed.astimezone(UTC)


def _execution(row: sqlite3.Row) -> TaskExecution:
    return TaskExecution(
        id=row["id"],
        idempotency_key=row["idempotency_key"],
        request_hash=row["request_hash"],
        target_slug=row["target_slug"],
        source_plan_task_id=row["source_plan_task_id"],
        sprint_action_id=row["sprint_action_id"],
        outcome=cast(Outcome, row["outcome"]),
        performed_on=date.fromisoformat(row["performed_on"]),
        task_minutes=row["task_minutes"],
        exercise_minutes=row["exercise_minutes"],
        questions_total=row["questions_total"],
        correct_count=row["correct_count"],
        wrong_count=row["wrong_count"],
        doubt_count=row["doubt_count"],
        performance_bp=row["performance_bp"],
        energy_after=row["energy_after"],
        notes=row["notes"],
        recorded_at=_parse_timestamp(row["recorded_at"]),
        version=row["version"],
    )


class TaskExecutionRepository:
    def __init__(self, connection: sqlite3.Connection):
        self.connection = connection

    def _require_transaction(self) -> None:
        if not self.connection.in_transaction:
            raise RuntimeError("caller must own an active task execution transaction")

    def get(self, execution_id: int) -> TaskExecution | None:
        row = self.connection.execute(
            "SELECT * FROM task_executions WHERE id=?", (execution_id,)
        ).fetchone()
        return _execution(row) if row is not None else None

    def list_for_source_task(
        self, target_slug: str, source_plan_task_id: int
    ) -> tuple[TaskExecution, ...]:
        rows = self.connection.execute(
            """
            SELECT * FROM task_executions
            WHERE target_slug=? AND source_plan_task_id=?
            ORDER BY performed_on DESC, id DESC
            """,
            (target_slug, source_plan_task_id),
        )
        return tuple(_execution(row) for row in rows)

    def latest_terminal_for_source_task(
        self, target_slug: str, source_plan_task_id: int
    ) -> TaskExecution | None:
        row = self.connection.execute(
            """
            SELECT * FROM task_executions
            WHERE target_slug=? AND source_plan_task_id=?
              AND outcome IN ('completed', 'failed', 'skipped')
            ORDER BY performed_on DESC, id DESC
            LIMIT 1
            """,
            (target_slug, source_plan_task_id),
        ).fetchone()
        return _execution(row) if row is not None else None

    def insert_or_replay(
        self,
        task_input: TaskExecutionInput,
        idempotency_key: str,
        request_hash: str,
    ) -> tuple[TaskExecution, bool]:
        self._require_transaction()
        if not isinstance(task_input, TaskExecutionInput):
            raise TypeError("task input must be a TaskExecutionInput")
        existing_row = self.connection.execute(
            "SELECT * FROM task_executions WHERE idempotency_key=?", (idempotency_key,)
        ).fetchone()
        if existing_row is not None:
            existing = _execution(existing_row)
            if existing.request_hash != request_hash:
                raise TaskExecutionIdempotencyConflict("idempotency key was already used for another request")
            return existing, True

        cursor = self.connection.execute(
            """
            INSERT INTO task_executions (
              idempotency_key, request_hash, target_slug, source_plan_task_id,
              sprint_action_id, outcome, performed_on, task_minutes, exercise_minutes,
              questions_total, correct_count, wrong_count, doubt_count, performance_bp,
              energy_after, notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                idempotency_key,
                request_hash,
                task_input.target_slug,
                task_input.source_plan_task_id,
                task_input.sprint_action_id,
                task_input.outcome,
                task_input.performed_on.isoformat(),
                task_input.task_minutes,
                task_input.exercise_minutes,
                task_input.questions_total,
                task_input.correct_count,
                task_input.wrong_count,
                task_input.doubt_count,
                task_input.performance_bp,
                task_input.energy_after,
                task_input.notes,
            ),
        )
        created = self.get(int(cursor.lastrowid))
        if created is None:
            raise RuntimeError("inserted task execution was not visible")
        return created, False
