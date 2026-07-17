from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from study_os_service.app import create_app
from study_os_service.config import StudyOsSettings
from study_os_service.db.connection import connect_database
from study_os_service.services.sprint_day import SprintDayService
from study_os_service.services.sprint_evidence import SprintEvidenceService


def client(tmp_path: Path) -> TestClient:
    return TestClient(create_app(StudyOsSettings.from_environment(tmp_path)))


def database(http: TestClient):
    return connect_database(http.app.state.settings.database_path)


def prepare(http: TestClient) -> dict:
    assert http.post(
        "/api/v1/planner/targets/seed", json={"targetSlugs": ["sefaz_ce"]}
    ).status_code == 201
    assert http.get(
        "/api/v1/sprints/config", params={"targetSlug": "sefaz_ce"}
    ).status_code == 200
    imported = http.post(
        "/api/v1/source-plans/import",
        headers={"Idempotency-Key": "materialization-meta-47"},
        json={
            "targetSlug": "sefaz_ce",
            "sourceKind": "ls",
            "planLabel": "Meta 47",
            "metaNumber": 47,
            "cycle": {
                "releasedAt": "2026-07-11T11:00:00Z",
                "startsOn": "2026-07-14",
                "endsOn": "2026-07-17",
            },
            "tasks": [
                {
                    "externalTaskId": "materialized-lte",
                    "scheduledDate": "2026-07-14",
                    "sourceOrder": 1,
                    "discipline": "Legis. Tribut. Estadual (ICMS)",
                    "topicHint": "ICMS Ceara",
                    "taskKind": "questions",
                    "description": "Resolver bateria LS",
                    "estimatedMinutes": 60,
                    "relevance": 10,
                    "status": "pending",
                }
            ],
        },
    )
    assert imported.status_code == 201, imported.text
    preview = http.post(
        "/api/v1/sprints/calendar/preview",
        headers={"Idempotency-Key": "materialization-preview"},
        json={
            "targetSlug": "sefaz_ce",
            "startDate": "2026-07-14",
            "endDate": "2026-07-20",
            "expectedRunId": None,
        },
    )
    assert preview.status_code == 201, preview.text
    document = preview.json()
    applied = http.post(
        f"/api/v1/sprints/calendar/runs/{document['run']['id']}/apply",
        headers={"Idempotency-Key": "materialization-apply"},
        json={"expectedRunId": None, "expectedOverrideVersions": {}},
    )
    assert applied.status_code == 200, applied.text
    return document


def generate_day(http: TestClient) -> dict:
    response = http.post(
        "/api/v1/sprints/generate-day",
        headers={"Idempotency-Key": "materialized-day-14"},
        json={
            "targetSlug": "sefaz_ce",
            "date": "2026-07-14",
            "energyLevel": 3,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def completion_payload(action: dict, *, state="completed") -> dict:
    return {
        "expectedVersion": action["version"],
        "decision": "accepted",
        "state": state,
        "actualMinutes": 55,
        "questionsDone": 10,
        "correctCount": 8,
        "wrongCount": 2,
        "doubtCount": 1,
        "energyAfter": 3,
        "questionRefs": [],
    }


def test_exact_calendar_assignment_materializes_and_completion_is_global(
    tmp_path: Path,
):
    with client(tmp_path) as http:
        calendar = prepare(http)
        day = generate_day(http)
        action = next(row for row in day["actions"] if row["sourcePlanTaskId"])
        source_id = action["sourcePlanTaskId"]
        stored = database(http)
        item_before = stored.execute(
            "SELECT * FROM sprint_calendar_items WHERE source_plan_task_id=?",
            (source_id,),
        ).fetchone()
        materialized = stored.execute(
            """
            SELECT materialization.*, assignment.plan_date
            FROM sprint_calendar_materializations AS materialization
            JOIN sprint_calendar_assignments AS assignment
              ON assignment.id=materialization.assignment_id
            WHERE materialization.sprint_action_id=?
            """,
            (action["id"],),
        ).fetchone()
        assert materialized is not None
        assert materialized["plan_date"] == "2026-07-14"

        completed = http.put(
            f"/api/v1/sprints/actions/{action['id']}",
            headers={"Idempotency-Key": "materialized-completion"},
            json=completion_payload(action),
        )
        assert completed.status_code == 200, completed.text
        item_after = stored.execute(
            "SELECT * FROM sprint_calendar_items WHERE source_plan_task_id=?",
            (source_id,),
        ).fetchone()
        source_status = stored.execute(
            "SELECT status FROM source_plan_tasks WHERE id=?", (source_id,)
        ).fetchone()[0]
        execution = stored.execute(
            """
            SELECT id, outcome, performed_on, task_minutes, questions_total
            FROM task_executions WHERE sprint_action_id=?
            """,
            (action["id"],),
        ).fetchone()
        execution_evidence = stored.execute(
            """
            SELECT observed_on, source_record_id
            FROM sprint_performance_observations
            WHERE origin='task_execution'
            """
        ).fetchone()
        head = http.get(
            "/api/v1/sprints/calendar",
            params={"targetSlug": "sefaz_ce", "startDate": "2026-07-14"},
        ).json()
        visible = next(
            row for row in head["items"] if row["sourcePlanTaskId"] == source_id
        )
        reflow = http.post(
            "/api/v1/sprints/calendar/preview",
            headers={"Idempotency-Key": "reflow-after-completion"},
            json={
                "targetSlug": "sefaz_ce",
                "startDate": "2026-07-14",
                "endDate": "2026-07-20",
                "expectedRunId": head["run"]["id"],
            },
        )
        assert reflow.status_code == 201, reflow.text
        reflow_item = next(
            row
            for row in reflow.json()["items"]
            if row["sourcePlanTaskId"] == source_id
        )
        reflow_assignment = next(
            row
            for row in reflow.json()["assignments"]
            if row["itemId"] == reflow_item["id"]
        )
        replay = http.put(
            f"/api/v1/sprints/actions/{action['id']}",
            headers={"Idempotency-Key": "materialized-completion"},
            json=completion_payload(action),
        )
        item_replayed = stored.execute(
            "SELECT * FROM sprint_calendar_items WHERE source_plan_task_id=?",
            (source_id,),
        ).fetchone()
        stored.close()

    assert calendar["run"]["decision"] == "draft"
    assert item_before["state"] == "pending"
    assert item_after["state"] == "completed"
    assert item_after["completed_at"] is not None
    assert item_after["version"] == item_before["version"] + 1
    assert source_status == "completed"
    assert tuple(execution)[1:] == ("completed", "2026-07-14", 55, 10)
    assert tuple(execution_evidence) == (
        "2026-07-14",
        f"task-execution:{execution['id']}",
    )
    assert visible["state"] == "completed"
    assert visible["completedAt"] == item_after["completed_at"]
    assert reflow_item["state"] == "completed"
    assert reflow_assignment["date"] == "2026-07-14"
    assert reflow_assignment["precision"] == "protected"
    assert replay.status_code == 200
    assert replay.json()["replayed"] is True
    assert item_replayed["version"] == item_after["version"]
    assert item_replayed["completed_at"] == item_after["completed_at"]


def test_future_cycle_placeholder_never_materializes(tmp_path: Path):
    with client(tmp_path) as http:
        prepare(http)
        response = http.post(
            "/api/v1/sprints/generate-day",
            headers={"Idempotency-Key": "placeholder-day-18"},
            json={
                "targetSlug": "sefaz_ce",
                "date": "2026-07-18",
                "energyLevel": 3,
            },
        )
        stored = database(http)
        placeholder_links = stored.execute(
            """
            SELECT COUNT(*)
            FROM sprint_calendar_materializations AS materialization
            JOIN sprint_calendar_assignments AS assignment
              ON assignment.id=materialization.assignment_id
            JOIN sprint_calendar_items AS item ON item.id=assignment.item_id
            WHERE item.kind='future_cycle_capacity'
            """
        ).fetchone()[0]
        stored.close()

    assert response.status_code == 201, response.text
    assert placeholder_links == 0


def test_failed_action_marks_item_failed_but_does_not_close_source(tmp_path: Path):
    with client(tmp_path) as http:
        prepare(http)
        day = generate_day(http)
        action = next(row for row in day["actions"] if row["sourcePlanTaskId"])
        failed = http.put(
            f"/api/v1/sprints/actions/{action['id']}",
            headers={"Idempotency-Key": "materialized-failure"},
            json=completion_payload(action, state="failed"),
        )
        stored = database(http)
        item = stored.execute(
            "SELECT * FROM sprint_calendar_items WHERE source_plan_task_id=?",
            (action["sourcePlanTaskId"],),
        ).fetchone()
        source = stored.execute(
            "SELECT status FROM source_plan_tasks WHERE id=?",
            (action["sourcePlanTaskId"],),
        ).fetchone()[0]
        stored.close()

    assert failed.status_code == 200, failed.text
    assert item["state"] == "failed"
    assert item["completed_at"] is None
    assert source == "pending"


def test_skipped_daily_action_leaves_calendar_item_and_source_pending(
    tmp_path: Path,
):
    with client(tmp_path) as http:
        prepare(http)
        day = generate_day(http)
        action = next(row for row in day["actions"] if row["sourcePlanTaskId"])
        skipped = http.put(
            f"/api/v1/sprints/actions/{action['id']}",
            headers={"Idempotency-Key": "materialized-skip"},
            json=completion_payload(action, state="skipped"),
        )
        stored = database(http)
        item = stored.execute(
            "SELECT state FROM sprint_calendar_items WHERE source_plan_task_id=?",
            (action["sourcePlanTaskId"],),
        ).fetchone()[0]
        source = stored.execute(
            "SELECT status FROM source_plan_tasks WHERE id=?",
            (action["sourcePlanTaskId"],),
        ).fetchone()[0]
        stored.close()

    assert skipped.status_code == 200, skipped.text
    assert skipped.json()["state"] == "skipped"
    assert item == "pending"
    assert source == "pending"


def test_evidence_failure_rolls_back_action_item_source_and_receipt(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    with client(tmp_path) as http:
        prepare(http)
        day = generate_day(http)
        action = next(row for row in day["actions"] if row["sourcePlanTaskId"])
        stored = database(http)

        def fail_evidence(_service, _saved):
            raise RuntimeError("forced evidence failure")

        monkeypatch.setattr(
            SprintEvidenceService,
            "append_action_result_in_transaction",
            fail_evidence,
        )
        with pytest.raises(RuntimeError, match="forced evidence failure"):
            SprintDayService(stored).update_action(
                action["id"],
                completion_payload(action),
                idempotency_key="rollback-materialized-completion",
            )

        stored_action = stored.execute(
            "SELECT state, version FROM sprint_actions WHERE id=?", (action["id"],)
        ).fetchone()
        item = stored.execute(
            "SELECT state FROM sprint_calendar_items WHERE source_plan_task_id=?",
            (action["sourcePlanTaskId"],),
        ).fetchone()
        source = stored.execute(
            "SELECT status FROM source_plan_tasks WHERE id=?",
            (action["sourcePlanTaskId"],),
        ).fetchone()[0]
        receipt = stored.execute(
            "SELECT idempotency_key FROM sprint_mutation_receipts WHERE idempotency_key=?",
            (f"sprint-action:{action['id']}:rollback-materialized-completion",),
        ).fetchone()
        stored.close()

    assert tuple(stored_action) == ("pending", action["version"])
    assert item["state"] == "pending"
    assert source == "pending"
    assert receipt is None
