from __future__ import annotations

from fastapi.testclient import TestClient

from tests.study_os_service.test_task_execution_api import (
    _transaction_snapshot,
    client,
    preview_and_apply_calendar,
    rich_payload,
    seeded_source_task,
)

__all__ = ["client", "seeded_source_task"]


def test_completed_source_rejects_new_started_execution_without_partial_writes(
    client: TestClient, seeded_source_task: int
) -> None:
    # Given
    preview_and_apply_calendar(client, key="terminal-source-calendar")
    url = f"/api/v1/source-plans/tasks/{seeded_source_task}/executions"
    completed = client.post(
        url,
        headers={"Idempotency-Key": "terminal-source-completed"},
        json=rich_payload(),
    )
    assert completed.status_code == 201, completed.text
    before = _transaction_snapshot(client, seeded_source_task)

    # When
    reopened = client.post(
        url,
        headers={"Idempotency-Key": "terminal-source-started"},
        json=rich_payload() | {"outcome": "started"},
    )

    # Then
    assert reopened.status_code == 409, reopened.text
    assert reopened.json()["code"] == "source_task_terminal"
    assert _transaction_snapshot(client, seeded_source_task) == before
