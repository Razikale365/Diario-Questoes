from __future__ import annotations

from datetime import date
import hashlib
import json
import sqlite3
from typing import Any, Mapping

from study_os_service.domain.task_execution import TaskExecution, TaskExecutionInput
from study_os_service.repositories.sprint import SprintRepository, SprintVersionConflictError
from study_os_service.repositories.sprint_calendar import SprintCalendarRepository
from study_os_service.repositories.task_execution import (
    TaskExecutionIdempotencyConflict,
    TaskExecutionRepository,
)
from study_os_service.services.source_plan_cycles import SourcePlanCycleService
from study_os_service.services.sprint_evidence import SprintEvidenceService


class SourceTaskNotFoundError(KeyError):
    pass


def _canonical_hash(value: object) -> str:
    encoded = json.dumps(
        value, ensure_ascii=True, sort_keys=True, separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _text(value: object, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{label} is required")
    return value.strip()


def _integer(value: object, label: str, *, default: int | None = None) -> int:
    if value is None and default is not None:
        return default
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"{label} must be an integer")
    return value


def _positive_integer(value: object, label: str) -> int:
    parsed = _integer(value, label)
    if parsed < 1:
        raise ValueError(f"{label} must be a positive integer")
    return parsed


def _resolve_optional_positive_integer(
    payload: Mapping[str, Any],
    body_key: str,
    explicit_value: int | None,
) -> int | None:
    body_value = (
        _positive_integer(payload[body_key], body_key)
        if body_key in payload
        else None
    )
    explicit = (
        _positive_integer(explicit_value, body_key)
        if explicit_value is not None
        else None
    )
    if body_value is not None and explicit is not None and body_value != explicit:
        raise ValueError(f"{body_key} does not match the explicit service argument")
    return body_value if body_value is not None else explicit


def _date(value: object) -> date:
    if not isinstance(value, str):
        raise ValueError("performedOn must use YYYY-MM-DD")
    try:
        parsed = date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError("performedOn must use YYYY-MM-DD") from exc
    if parsed.isoformat() != value:
        raise ValueError("performedOn must use YYYY-MM-DD")
    return parsed


def _execution_document(execution: TaskExecution) -> dict[str, Any]:
    return {
        "id": execution.id,
        "outcome": execution.outcome,
        "performedOn": execution.performed_on.isoformat(),
        "taskMinutes": execution.task_minutes,
        "exerciseMinutes": execution.exercise_minutes,
        "questionsTotal": execution.questions_total,
        "correctCount": execution.correct_count,
        "wrongCount": execution.wrong_count,
        "doubtCount": execution.doubt_count,
        "performanceBp": execution.performance_bp,
        "energyAfter": execution.energy_after,
        "notes": execution.notes,
        "recordedAt": execution.recorded_at.isoformat(timespec="microseconds").replace("+00:00", "Z"),
        "version": execution.version,
    }


class TaskExecutionService:
    def __init__(self, connection: sqlite3.Connection):
        self.connection = connection
        self.executions = TaskExecutionRepository(connection)
        self.sprint = SprintRepository(connection)
        self.calendar = SprintCalendarRepository(connection)

    def record(
        self,
        source_task_id: int,
        payload: Mapping[str, Any],
        *,
        idempotency_key: str,
        sprint_action_id: int | None = None,
        expected_version: int | None = None,
        append_legacy_action_evidence: bool = False,
        question_refs: tuple[Mapping[str, Any], ...] = (),
    ) -> dict[str, Any]:
        if not isinstance(payload, Mapping):
            raise ValueError("task execution payload must be an object")
        key = _text(idempotency_key, "Idempotency-Key")
        resolved_action_id = _resolve_optional_positive_integer(
            payload, "sprintActionId", sprint_action_id
        )
        resolved_expected_version = _resolve_optional_positive_integer(
            payload, "expectedVersion", expected_version
        )
        if (resolved_action_id is None) != (resolved_expected_version is None):
            raise ValueError(
                "sprintActionId and expectedVersion must be provided together"
            )
        source = self.sprint.get_source_task(source_task_id)
        if source is None:
            raise SourceTaskNotFoundError(source_task_id)
        if resolved_action_id is not None:
            bound_action = self.sprint.get_action(resolved_action_id)
            if bound_action is None:
                raise ValueError("sprintActionId does not identify an action")
            if bound_action["source_plan_task_id"] != source_task_id:
                raise ValueError("sprintActionId does not belong to the source task")
        task_input = TaskExecutionInput(
            target_slug=source.target_slug,
            source_plan_task_id=source_task_id,
            sprint_action_id=resolved_action_id,
            outcome=_text(payload.get("outcome"), "outcome"),  # type: ignore[arg-type]
            performed_on=_date(payload.get("performedOn")),
            task_minutes=_integer(payload.get("taskMinutes"), "taskMinutes"),
            exercise_minutes=_integer(payload.get("exerciseMinutes", 0), "exerciseMinutes"),
            questions_total=_integer(payload.get("questionsTotal", 0), "questionsTotal"),
            correct_count=_integer(payload.get("correctCount", 0), "correctCount"),
            wrong_count=_integer(payload.get("wrongCount", 0), "wrongCount"),
            doubt_count=_integer(payload.get("doubtCount", 0), "doubtCount"),
            energy_after=(
                _integer(payload["energyAfter"], "energyAfter")
                if payload.get("energyAfter") is not None else None
            ),
            notes=str(payload.get("notes", "")),
        )
        request_hash = _canonical_hash({
            "sourceTaskId": source_task_id,
            "sprintActionId": resolved_action_id,
            "payload": dict(payload),
        })
        self.connection.execute("BEGIN IMMEDIATE")
        try:
            execution, replayed = self.executions.insert_or_replay(
                task_input, key, request_hash
            )
            if replayed:
                source = self.sprint.get_source_task(source_task_id)
                action = self.sprint.get_action(execution.sprint_action_id) if execution.sprint_action_id else None
                calendar_item = self.connection.execute(
                    "SELECT * FROM sprint_calendar_items WHERE source_plan_task_id=?",
                    (source_task_id,),
                ).fetchone()
                self.connection.commit()
                return self._document(execution, source, action, calendar_item, True)
            source = self.sprint.update_source_task_result_in_transaction(
                source_task_id, execution=execution
            )
            action = self.sprint.reconcile_actions_for_source_in_transaction(
                source_task_id,
                execution=execution,
                expected_action_id=resolved_action_id,
                expected_version=resolved_expected_version,
            )
            if resolved_action_id is not None:
                self.sprint.insert_action_question_refs(resolved_action_id, question_refs)
            if execution.outcome == "completed":
                SourcePlanCycleService(self.connection).mark_recovered_in_transaction(
                    source_task_id, execution.performed_on
                )
            self.calendar.ensure_source_item_in_transaction(source)
            calendar_item = self.calendar.project_execution_for_source_in_transaction(
                source_task_id, execution=execution
            )
            evidence = SprintEvidenceService(self.connection)
            evidence.append_task_execution_in_transaction(execution, source)
            if append_legacy_action_evidence and action is not None:
                evidence.append_action_result_in_transaction(action)
            self.connection.commit()
            return self._document(execution, source, action, calendar_item, False)
        except Exception:
            if self.connection.in_transaction:
                self.connection.rollback()
            raise

    @staticmethod
    def _document(
        execution: TaskExecution,
        source: Any,
        action: sqlite3.Row | None,
        calendar_item: sqlite3.Row | None,
        replayed: bool,
    ) -> dict[str, Any]:
        source_document = {
            "id": source.id, "targetSlug": source.target_slug,
            "status": source.status, "spentMinutes": source.spent_minutes,
            "performanceBp": source.performance_bp, "provenance": source.provenance,
        }
        action_document = (
            None if action is None else {
                "id": action["id"], "state": action["state"],
                "decision": action["decision"], "version": action["version"],
            }
        )
        calendar_document = (
            None if calendar_item is None else {
                "id": calendar_item["id"], "state": calendar_item["state"],
                "completedAt": calendar_item["completed_at"], "version": calendar_item["version"],
            }
        )
        return {
            "execution": _execution_document(execution),
            "sourceTask": source_document,
            "sprintAction": action_document,
            "calendarItem": calendar_document,
            "replayed": replayed,
            "refreshRequired": execution.outcome in {"completed", "failed", "skipped"},
        }
