from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from study_os_service.app import create_app
from study_os_service.config import StudyOsSettings
from study_os_service.db.connection import connect_database
from study_os_service.repositories.sprint_calendar import SprintCalendarRepository


def rich_payload(performed_on: str = "2026-07-16") -> dict[str, object]:
    return {
        "outcome": "completed",
        "performedOn": performed_on,
        "taskMinutes": 60,
        "exerciseMinutes": 35,
        "questionsTotal": 20,
        "correctCount": 16,
        "wrongCount": 4,
        "doubtCount": 2,
        "energyAfter": 3,
        "notes": "Revisão registrada no dia correto",
    }


@pytest.fixture
def client(tmp_path: Path):
    with TestClient(
        create_app(StudyOsSettings.from_environment(tmp_path))
    ) as http:
        yield http


@pytest.fixture
def seeded_source_task(client: TestClient) -> int:
    assert client.post(
        "/api/v1/planner/targets/seed",
        json={"targetSlugs": ["sefaz_ce"]},
    ).status_code == 201
    assert client.get(
        "/api/v1/sprints/config", params={"targetSlug": "sefaz_ce"}
    ).status_code == 200
    imported = client.post(
        "/api/v1/source-plans/import",
        headers={"Idempotency-Key": "execution-source-import"},
        json={
            "targetSlug": "sefaz_ce",
            "sourceKind": "ls",
            "planLabel": "Meta execução",
            "metaNumber": 47,
            "cycle": {
                "releasedAt": "2026-07-11T11:00:00Z",
                "startsOn": "2026-07-12",
                "endsOn": "2026-07-15",
            },
            "tasks": [
                {
                    "externalTaskId": "execution-source-1",
                    "scheduledDate": "2026-07-14",
                    "sourceOrder": 1,
                    "discipline": "Legis. Tribut. Estadual (ICMS)",
                    "topicHint": "ICMS Ceará",
                    "taskKind": "questions",
                    "description": "Resolver bateria LS",
                    "details": "Manter detalhe importado",
                    "materialHint": "TEC Concursos",
                    "estimatedMinutes": 60,
                    "relevance": 10,
                    "status": "pending",
                    "provenance": {
                        "origin": "ls-visible-history",
                        "browserUpdatedAt": "2026-07-15T22:00:00Z",
                        "preservedKey": "must-survive",
                    },
                }
            ],
        },
    )
    assert imported.status_code == 201, imported.text
    listed = client.get(
        "/api/v1/source-plans/tasks",
        params={"targetSlug": "sefaz_ce"},
    )
    assert listed.status_code == 200, listed.text
    return listed.json()["items"][0]["id"]


def preview_and_apply_calendar(
    client: TestClient,
    *,
    key: str,
    expected_run_id: int | None = None,
) -> dict[str, object]:
    preview = client.post(
        "/api/v1/sprints/calendar/preview",
        headers={"Idempotency-Key": f"{key}-preview"},
        json={
            "targetSlug": "sefaz_ce",
            "startDate": "2026-07-16",
            "endDate": "2026-07-20",
            "expectedRunId": expected_run_id,
        },
    )
    assert preview.status_code == 201, preview.text
    document = preview.json()
    applied = client.post(
        f"/api/v1/sprints/calendar/runs/{document['run']['id']}/apply",
        headers={"Idempotency-Key": f"{key}-apply"},
        json={
            "expectedRunId": expected_run_id,
            "expectedOverrideVersions": {},
        },
    )
    assert applied.status_code == 200, applied.text
    return document


def executable_source_ids(document: dict[str, object]) -> set[int]:
    items = {
        item["id"]: item
        for item in document["items"]
        if item["sourcePlanTaskId"] is not None
        and item["state"] in {"pending", "active", "failed"}
    }
    return {
        items[assignment["itemId"]]["sourcePlanTaskId"]
        for assignment in document["assignments"]
        if assignment["itemId"] in items
    }


def materialize_day(client: TestClient, *, key: str) -> dict[str, object]:
    response = client.post(
        "/api/v1/sprints/generate-day",
        headers={"Idempotency-Key": key},
        json={
            "targetSlug": "sefaz_ce",
            "date": "2026-07-16",
            "energyLevel": 3,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_direct_completion_projects_every_surface_and_backdated_evidence(
    client: TestClient, seeded_source_task: int
):
    preview_and_apply_calendar(client, key="execution-calendar")
    day = materialize_day(client, key="execution-day")
    action = next(
        row
        for row in day["actions"]
        if row["sourcePlanTaskId"] == seeded_source_task
    )

    saved = client.post(
        f"/api/v1/source-plans/tasks/{seeded_source_task}/executions",
        headers={"Idempotency-Key": "exec-1"},
        json=rich_payload(),
    )

    assert saved.status_code == 201, saved.text
    document = saved.json()
    assert set(document) == {
        "execution",
        "sourceTask",
        "sprintAction",
        "calendarItem",
        "replayed",
        "refreshRequired",
    }
    assert document["replayed"] is False
    assert document["refreshRequired"] is True
    assert document["execution"]["outcome"] == "completed"
    assert document["execution"]["performedOn"] == "2026-07-16"
    assert document["execution"]["performanceBp"] == 8000
    assert document["sourceTask"]["status"] == "completed"
    assert document["sourceTask"]["spentMinutes"] == 60
    assert document["sourceTask"]["performanceBp"] == 8000
    assert document["sourceTask"]["provenance"]["preservedKey"] == "must-survive"
    expected_execution_provenance = {
        "observedOn": "2026-07-16",
        "lastOutcome": "completed",
        "questionsTotal": 20,
        "correctCount": 16,
        "wrongCount": 4,
        "doubtCount": 2,
        "exerciseMinutes": 35,
    }
    assert {
        key: document["sourceTask"]["provenance"][key]
        for key in expected_execution_provenance
    } == expected_execution_provenance
    assert document["sourceTask"]["provenance"]["completedAt"]
    assert document["sprintAction"]["id"] == action["id"]
    assert document["sprintAction"]["state"] == "completed"
    assert document["calendarItem"]["state"] == "completed"

    stored = connect_database(client.app.state.settings.database_path)
    evidence = stored.execute(
        """
        SELECT * FROM sprint_performance_observations
        WHERE source_record_id=?
        """,
        (f"task-execution:{document['execution']['id']}",),
    ).fetchone()
    backlog = stored.execute(
        """
        SELECT state, recovered_on FROM source_plan_backlog_candidates
        WHERE source_plan_task_id=?
        """,
        (seeded_source_task,),
    ).fetchone()
    actions = stored.execute(
        """
        SELECT state FROM sprint_actions
        WHERE source_plan_task_id=? AND state IN ('pending','active')
        """,
        (seeded_source_task,),
    ).fetchall()
    stored.close()

    assert evidence is not None
    assert evidence["origin"] == "task_execution"
    assert evidence["observed_on"] == "2026-07-16"
    assert evidence["correct_count"] == 16
    assert evidence["wrong_count"] == 4
    assert evidence["doubt_count"] == 2
    assert evidence["percentage_bp"] == 8000
    assert tuple(backlog) == ("recovered", "2026-07-16")
    assert actions == []


def test_complete_then_reflow_never_requeues(
    client: TestClient, seeded_source_task: int
):
    first = preview_and_apply_calendar(client, key="before-completion")
    materialize_day(client, key="day-before-reflow")
    saved = client.post(
        f"/api/v1/source-plans/tasks/{seeded_source_task}/executions",
        headers={"Idempotency-Key": "exec-reflow"},
        json=rich_payload(),
    )
    assert saved.status_code == 201, saved.text

    reflow = preview_and_apply_calendar(
        client,
        key="after-completion",
        expected_run_id=first["run"]["id"],
    )
    refreshed = client.post(
        "/api/v1/sprints/refresh-day",
        headers={"Idempotency-Key": "day-after-completion"},
        json={
            "targetSlug": "sefaz_ce",
            "date": "2026-07-16",
            "energyLevel": 3,
        },
    )

    assert seeded_source_task not in executable_source_ids(reflow)
    assert refreshed.status_code == 201, refreshed.text
    assert not any(
        row["sourcePlanTaskId"] == seeded_source_task
        for row in refreshed.json()["actions"]
    )


def test_execution_replay_is_stable_and_changed_replay_conflicts(
    client: TestClient, seeded_source_task: int
):
    url = f"/api/v1/source-plans/tasks/{seeded_source_task}/executions"
    saved = client.post(
        url,
        headers={"Idempotency-Key": "exec-replay"},
        json=rich_payload(),
    )
    replay = client.post(
        url,
        headers={"Idempotency-Key": "exec-replay"},
        json=rich_payload(),
    )
    changed = client.post(
        url,
        headers={"Idempotency-Key": "exec-replay"},
        json=rich_payload() | {"notes": "different"},
    )

    assert saved.status_code == 201, saved.text
    assert replay.status_code == 201, replay.text
    assert replay.json()["execution"]["id"] == saved.json()["execution"]["id"]
    assert replay.json()["replayed"] is True
    assert changed.status_code == 409
    assert changed.json()["code"] == "task_execution_idempotency_conflict"


def test_execution_rejects_future_date_missing_key_and_unknown_source(
    client: TestClient, seeded_source_task: int
):
    url = f"/api/v1/source-plans/tasks/{seeded_source_task}/executions"
    future = client.post(
        url,
        headers={"Idempotency-Key": "exec-future"},
        json=rich_payload((date.today() + timedelta(days=1)).isoformat()),
    )
    missing_key = client.post(url, json=rich_payload())
    missing_source = client.post(
        "/api/v1/source-plans/tasks/999999/executions",
        headers={"Idempotency-Key": "exec-missing"},
        json=rich_payload(),
    )

    assert future.status_code == 422
    assert future.json()["code"] == "invalid_task_execution"
    assert missing_key.status_code == 422
    assert missing_key.json()["code"] == "invalid_task_execution"
    assert missing_source.status_code == 404
    assert missing_source.json()["code"] == "source_task_not_found"


def _transaction_snapshot(client: TestClient, source_task_id: int) -> dict[str, list[tuple]]:
    stored = connect_database(client.app.state.settings.database_path)
    queries = {
        "executions": "SELECT * FROM task_executions ORDER BY id",
        "source": (
            "SELECT status, spent_minutes, performance_bp, provenance_json, version "
            f"FROM source_plan_tasks WHERE id={source_task_id}"
        ),
        "actions": (
            "SELECT decision, state, actual_minutes, questions_done, correct_count, "
            "wrong_count, doubt_count, energy_after, version FROM sprint_actions "
            f"WHERE source_plan_task_id={source_task_id} ORDER BY id"
        ),
        "backlog": (
            "SELECT state, recovered_on FROM source_plan_backlog_candidates "
            f"WHERE source_plan_task_id={source_task_id}"
        ),
        "calendar": (
            "SELECT state, result_json, completed_at, version FROM sprint_calendar_items "
            f"WHERE source_plan_task_id={source_task_id}"
        ),
        "batches": (
            "SELECT * FROM sprint_evidence_import_batches "
            "ORDER BY batch_id, target_slug, origin"
        ),
        "evidence": "SELECT * FROM sprint_performance_observations ORDER BY id",
    }
    snapshot = {
        key: [tuple(row) for row in stored.execute(query).fetchall()]
        for key, query in queries.items()
    }
    stored.close()
    return snapshot


def test_calendar_failure_rolls_back_execution_and_every_projection(
    client: TestClient,
    seeded_source_task: int,
    monkeypatch: pytest.MonkeyPatch,
):
    preview_and_apply_calendar(client, key="rollback-calendar")
    materialize_day(client, key="rollback-day")
    before = _transaction_snapshot(client, seeded_source_task)

    def fail_calendar(*_args, **_kwargs):
        raise RuntimeError("forced calendar projection failure")

    monkeypatch.setattr(
        SprintCalendarRepository,
        "project_execution_for_source_in_transaction",
        fail_calendar,
        raising=False,
    )
    with pytest.raises(RuntimeError, match="forced calendar projection failure"):
        client.post(
            f"/api/v1/source-plans/tasks/{seeded_source_task}/executions",
            headers={"Idempotency-Key": "exec-rollback"},
            json=rich_payload(),
        )

    assert _transaction_snapshot(client, seeded_source_task) == before


def test_rich_legacy_started_action_records_canonical_execution(
    client: TestClient, seeded_source_task: int
):
    day = materialize_day(client, key="legacy-started-day")
    action = next(
        row for row in day["actions"] if row["sourcePlanTaskId"] == seeded_source_task
    )

    response = client.put(
        f"/api/v1/sprints/actions/{action['id']}",
        headers={"Idempotency-Key": "legacy-started-execution"},
        json={
            "expectedVersion": action["version"],
            "decision": "accepted",
            "state": "active",
            "performedOn": "2026-07-16",
            "taskMinutes": 45,
            "exerciseMinutes": 20,
            "questionsTotal": 10,
            "correctCount": 7,
            "wrongCount": 3,
            "doubtCount": 1,
        },
    )
    stored = connect_database(client.app.state.settings.database_path)
    execution = stored.execute(
        "SELECT outcome, performed_on, task_minutes FROM task_executions"
    ).fetchone()
    stored.close()

    assert response.status_code == 200, response.text
    assert response.json()["state"] == "active"
    assert tuple(execution) == ("started", "2026-07-16", 45)


def test_rich_legacy_payload_rejects_incompatible_or_source_less_actions(
    client: TestClient, seeded_source_task: int
):
    day = materialize_day(client, key="legacy-rich-validation-day")
    source_action = next(
        row for row in day["actions"] if row["sourcePlanTaskId"] == seeded_source_task
    )
    source_less_action = next(
        row for row in day["actions"] if row["sourcePlanTaskId"] is None
    )
    incompatible = client.put(
        f"/api/v1/sprints/actions/{source_action['id']}",
        headers={"Idempotency-Key": "legacy-rich-incompatible"},
        json={
            "expectedVersion": source_action["version"],
            "decision": "rejected",
            "state": "skipped",
            "performedOn": "2026-07-16",
            "taskMinutes": 20,
        },
    )
    source_less = client.put(
        f"/api/v1/sprints/actions/{source_less_action['id']}",
        headers={"Idempotency-Key": "legacy-rich-source-less"},
        json={
            "expectedVersion": source_less_action["version"],
            "decision": "accepted",
            "state": "active",
            "performedOn": "2026-07-16",
            "taskMinutes": 20,
        },
    )

    assert incompatible.status_code == 422
    assert incompatible.json()["code"] == "invalid_sprint_action"
    assert source_less.status_code == 422
    assert source_less.json()["code"] == "invalid_sprint_action"
