import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from study_os_service.app import create_app
from study_os_service.config import StudyOsSettings
from study_os_service.db.connection import connect_database
from study_os_service.repositories.sprint_evidence import SprintEvidenceRepository


def _client(tmp_path: Path) -> TestClient:
    return TestClient(create_app(StudyOsSettings.from_environment(tmp_path)))


def _prepare(client: TestClient, *, task_count: int = 5) -> None:
    assert client.post(
        "/api/v1/planner/targets/seed", json={"targetSlugs": ["sefaz_ce"]}
    ).status_code == 201
    assert client.get("/api/v1/sprints/config?targetSlug=sefaz_ce").status_code == 200
    subjects = (
        "Legis. Tribut. Estadual (ICMS)",
        "Financas Publicas",
        "Contabilidade de Custos",
        "Direito Tributario",
        "Lingua Portuguesa",
    )
    tasks = [
        {
            "externalTaskId": f"meta-47-task-{index + 1}",
            "scheduledDate": "2026-07-14",
            "sourceOrder": index + 1,
            "discipline": subjects[index],
            "topicHint": f"Topico {index + 1}",
            "taskKind": "questions",
            "description": f"Tarefa LS {index + 1}",
            "estimatedMinutes": 75,
            "relevance": 10 - index,
            "status": "pending",
        }
        for index in range(task_count)
    ]
    imported = client.post(
        "/api/v1/source-plans/import",
        headers={"Idempotency-Key": "meta-47-day-14"},
        json={
            "targetSlug": "sefaz_ce",
            "sourceKind": "ls",
            "planLabel": "Meta 47",
            "metaNumber": 47,
            "tasks": tasks,
        },
    )
    assert imported.status_code == 201, imported.text


def _projection_observation(
    *,
    record_id: str,
    discipline: str,
    measurement_type: str,
    correct_count: int | None,
    wrong_count: int | None,
    percentage_bp: int | None,
    doubt_count: int = 0,
) -> dict[str, object]:
    return {
        "discipline": discipline,
        "topicHint": "Aggregate-only projection evidence",
        "observedOn": "2026-07-14",
        "sourceRecordId": record_id,
        "sourceRevision": "v1",
        "sourceUpdatedAt": "2026-07-14T12:00:00Z",
        "measurementType": measurement_type,
        "examBoard": "FCC",
        "correctCount": correct_count,
        "wrongCount": wrong_count,
        "doubtCount": doubt_count,
        "percentageBp": percentage_bp,
        "transferScope": "content",
        "transferabilityBp": 10000,
        "provenance": {
            "provider": "sprint-day-integration-test",
            "sourceTaskId": record_id,
        },
    }


def _import_projection_evidence(
    client: TestClient,
    *,
    batch_id: str,
    origin: str,
    observations: list[dict[str, object]],
) -> dict[str, object]:
    response = client.post(
        "/api/v1/sprints/evidence/import",
        json={
            "targetSlug": "sefaz_ce",
            "batchId": batch_id,
            "origin": origin,
            "dryRun": False,
            "observations": observations,
        },
    )
    assert response.status_code == 201, response.text
    assert response.json()["insertedCount"] == len(observations)
    return response.json()


def test_generate_get_and_replay_sprint_day_are_auditable(tmp_path: Path):
    request = {
        "targetSlug": "sefaz_ce",
        "date": "2026-07-14",
        "energyLevel": 3,
        "p1Projection": 42,
        "p2Projection": 55,
    }
    with _client(tmp_path) as client:
        _prepare(client)
        generated = client.post(
            "/api/v1/sprints/generate-day",
            headers={"Idempotency-Key": "sprint-2026-07-14-v1"},
            json=request,
        )
        replay = client.post(
            "/api/v1/sprints/generate-day",
            headers={"Idempotency-Key": "sprint-2026-07-14-v1"},
            json=request,
        )
        day = client.get(
            "/api/v1/sprints/day?targetSlug=sefaz_ce&date=2026-07-14"
        )
        source_tasks = client.get(
            "/api/v1/source-plans/tasks"
            "?targetSlug=sefaz_ce&date=2026-07-14"
        )

    assert generated.status_code == 201, generated.text
    payload = generated.json()
    assert payload["targetSlug"] == "sefaz_ce"
    assert payload["date"] == "2026-07-14"
    assert payload["daysRemaining"] == 18
    assert payload["capacity"] == {
        "lsBudgetMinutes": 240,
        "extraBudgetMinutes": 60,
        "energyLevel": 3,
    }
    assert payload["projections"]["p1"] == 42
    assert payload["projections"]["p2"] == 55
    assert payload["replayed"] is False
    assert payload["version"] == 1

    ls_actions = [row for row in payload["actions"] if row["sourcePlanTaskId"]]
    assert {row["recommendation"] for row in ls_actions} >= {"compress", "defer"}
    assert sum(
        row["durationMinutes"]
        for row in ls_actions
        if row["recommendation"] != "defer"
    ) <= 240
    extras = [row for row in payload["actions"] if row["recommendation"] == "extra"]
    assert sum(row["durationMinutes"] for row in extras) <= 60
    assert all(row["materialHint"] == "" for row in extras)
    assert any("Piso da P1" in " ".join(row["rationale"]) for row in extras)
    assert all(row["whyNow"] for row in payload["actions"])
    assert all("scoreDetails" in row for row in payload["actions"])
    minimum_ids = set(payload["minimumViable"]["actionIds"])
    minimum = [row for row in payload["actions"] if row["id"] in minimum_ids]
    assert any(row["sourcePlanTaskId"] is not None for row in minimum)
    assert any(
        row["sourcePlanTaskId"] is None and row["subjectKey"] == "p2_lte"
        for row in minimum
    )
    assert any(
        row["sourcePlanTaskId"] is None and row["subjectKey"] != "p2_lte"
        for row in minimum
    )

    assert replay.status_code == 201
    assert replay.json()["runId"] == payload["runId"]
    assert replay.json()["replayed"] is True
    assert day.status_code == 200
    assert day.json()["runId"] == payload["runId"]
    assert [row["status"] for row in source_tasks.json()["items"]] == [
        "pending"
    ] * 5


def test_action_result_uses_version_idempotency_and_refreshes_remaining_day(
    tmp_path: Path,
):
    with _client(tmp_path) as client:
        _prepare(client, task_count=4)
        generated = client.post(
            "/api/v1/sprints/generate-day",
            headers={"Idempotency-Key": "day-before-result"},
            json={
                "targetSlug": "sefaz_ce",
                "date": "2026-07-14",
                "energyLevel": 3,
                "p1Projection": 49,
                "p2Projection": 60,
            },
        ).json()
        action = next(
            row
            for row in generated["actions"]
            if row["recommendation"] == "execute"
            and row["plannedQuestions"] > 0
        )
        result_payload = {
            "expectedVersion": action["version"],
            "decision": "accepted",
            "state": "completed",
            "actualMinutes": 58,
            "questionsDone": 10,
            "correctCount": 7,
            "wrongCount": 3,
            "doubtCount": 2,
            "energyAfter": 2,
            "questionRefs": [
                {
                    "questionFingerprint": "meta47-q-0042",
                    "sourceTaskId": "legacy-task-42",
                    "reason": "doubt",
                },
                {
                    "questionFingerprint": "meta47-q-0048",
                    "sourceTaskId": "legacy-task-42",
                    "reason": "wrong",
                },
            ],
        }
        completed = client.put(
            f"/api/v1/sprints/actions/{action['id']}",
            headers={"Idempotency-Key": "finish-first-action"},
            json=result_payload,
        )
        replay = client.put(
            f"/api/v1/sprints/actions/{action['id']}",
            headers={"Idempotency-Key": "finish-first-action"},
            json=result_payload,
        )
        stale = client.put(
            f"/api/v1/sprints/actions/{action['id']}",
            headers={"Idempotency-Key": "stale-first-action"},
            json=result_payload | {"state": "failed"},
        )
        refreshed = client.post(
            "/api/v1/sprints/refresh-day",
            headers={"Idempotency-Key": "refresh-after-first"},
            json={
                "targetSlug": "sefaz_ce",
                "date": "2026-07-14",
                "energyLevel": 2,
            },
        )
        refreshed_again = client.post(
            "/api/v1/sprints/refresh-day",
            headers={"Idempotency-Key": "refresh-after-first-again"},
            json={
                "targetSlug": "sefaz_ce",
                "date": "2026-07-14",
                "energyLevel": 2,
            },
        )
        trajectory = client.get(
            "/api/v1/sprints/trajectory?targetSlug=sefaz_ce"
        )
        source = client.get(
            "/api/v1/source-plans/tasks"
            "?targetSlug=sefaz_ce&date=2026-07-14"
        ).json()["items"]

    assert completed.status_code == 200, completed.text
    assert completed.json()["state"] == "completed"
    assert completed.json()["version"] == action["version"] + 1
    assert completed.json()["replayed"] is False
    assert replay.status_code == 200
    assert replay.json()["version"] == completed.json()["version"]
    assert replay.json()["replayed"] is True
    assert stale.status_code == 409
    assert stale.json()["code"] == "stale_sprint_action"

    assert refreshed.status_code == 201, refreshed.text
    refreshed_payload = refreshed.json()
    assert refreshed_payload["supersedesRunId"] == generated["runId"]
    assert refreshed_payload["capacity"]["energyLevel"] == 2
    assert not any(
        row["sourcePlanTaskId"] == action["sourcePlanTaskId"]
        for row in refreshed_payload["actions"]
    )
    assert refreshed_again.status_code == 201, refreshed_again.text
    assert not any(
        row["sourcePlanTaskId"] == action["sourcePlanTaskId"]
        for row in refreshed_again.json()["actions"]
    )
    carried_refs = {
        ref["questionFingerprint"]
        for row in refreshed_payload["actions"]
        if row["subjectProfileId"] == action["subjectProfileId"]
        for ref in row["questionRefs"]
    }
    assert carried_refs == {"meta47-q-0042", "meta47-q-0048"}
    assert trajectory.status_code == 200
    assert len(trajectory.json()["runs"]) == 3
    assert trajectory.json()["latest"]["p1"] >= 0
    assert next(
        row for row in source if row["id"] == action["sourcePlanTaskId"]
    )["status"] == "completed"
    assert all(
        row["status"] == "pending"
        for row in source
        if row["id"] != action["sourcePlanTaskId"]
    )


def test_config_update_is_idempotent_and_optimistically_versioned(tmp_path: Path):
    with _client(tmp_path) as client:
        _prepare(client, task_count=1)
        current = client.get(
            "/api/v1/sprints/config?targetSlug=sefaz_ce"
        ).json()
        update = {
            "targetSlug": "sefaz_ce",
            "expectedVersion": current["version"],
            "lsBudgetMinutes": 210,
            "extraBudgetMinutes": 45,
            "goals": current["goals"],
            "state": "active",
        }
        saved = client.put(
            "/api/v1/sprints/config",
            headers={"Idempotency-Key": "capacity-change"},
            json=update,
        )
        replay = client.put(
            "/api/v1/sprints/config",
            headers={"Idempotency-Key": "capacity-change"},
            json=update,
        )
        stale = client.put(
            "/api/v1/sprints/config",
            headers={"Idempotency-Key": "stale-capacity-change"},
            json=update | {"extraBudgetMinutes": 30},
        )

    assert saved.status_code == 200
    assert saved.json()["lsBudgetMinutes"] == 210
    assert saved.json()["extraBudgetMinutes"] == 45
    assert saved.json()["version"] == current["version"] + 1
    assert saved.json()["replayed"] is False
    assert replay.status_code == 200
    assert replay.json()["version"] == saved.json()["version"]
    assert replay.json()["replayed"] is True
    assert stale.status_code == 409
    assert stale.json()["code"] == "stale_sprint_config"


def test_config_rejects_inverted_goal_ranges_without_database_error(tmp_path: Path):
    with _client(tmp_path) as client:
        _prepare(client, task_count=1)
        current = client.get(
            "/api/v1/sprints/config?targetSlug=sefaz_ce"
        ).json()
        response = client.put(
            "/api/v1/sprints/config",
            headers={"Idempotency-Key": "invalid-inverted-goals"},
            json={
                "targetSlug": "sefaz_ce",
                "expectedVersion": current["version"],
                "goals": current["goals"] | {"p1Low": 60, "p1High": 50},
            },
        )

    assert response.status_code == 422
    assert response.json()["code"] == "invalid_sprint_config"
    assert "P1" in response.json()["message"]


def test_valid_extreme_source_durations_generate_persistable_actions(tmp_path: Path):
    with _client(tmp_path) as client:
        assert client.post(
            "/api/v1/planner/targets/seed", json={"targetSlugs": ["sefaz_ce"]}
        ).status_code == 201
        assert client.get(
            "/api/v1/sprints/config?targetSlug=sefaz_ce"
        ).status_code == 200
        imported = client.post(
            "/api/v1/source-plans/import",
            headers={"Idempotency-Key": "duration-boundaries"},
            json={
                "targetSlug": "sefaz_ce",
                "sourceKind": "ls",
                "planLabel": "Meta limites",
                "metaNumber": 48,
                "tasks": [
                    {
                        "externalTaskId": "one-minute-task",
                        "scheduledDate": "2026-07-14",
                        "sourceOrder": 1,
                        "discipline": "Legis. Tribut. Estadual (ICMS)",
                        "taskKind": "questions",
                        "description": "Registro minimo",
                        "estimatedMinutes": 1,
                    },
                    {
                        "externalTaskId": "five-hour-task",
                        "scheduledDate": "2026-07-15",
                        "sourceOrder": 2,
                        "discipline": "Legis. Tribut. Estadual (ICMS)",
                        "taskKind": "questions",
                        "description": "Bloco longo",
                        "estimatedMinutes": 300,
                    },
                ],
            },
        )
        short = client.post(
            "/api/v1/sprints/generate-day",
            headers={"Idempotency-Key": "duration-short-day"},
            json={
                "targetSlug": "sefaz_ce",
                "date": "2026-07-14",
                "energyLevel": 3,
                "lsBudgetMinutes": 15,
                "extraBudgetMinutes": 0,
            },
        )
        long = client.post(
            "/api/v1/sprints/generate-day",
            headers={"Idempotency-Key": "duration-long-day"},
            json={
                "targetSlug": "sefaz_ce",
                "date": "2026-07-15",
                "energyLevel": 3,
                "lsBudgetMinutes": 300,
                "extraBudgetMinutes": 0,
            },
        )

    assert imported.status_code == 201, imported.text
    assert short.status_code == 201, short.text
    assert long.status_code == 201, long.text
    assert next(row for row in short.json()["actions"] if row["sourcePlanTaskId"])["durationMinutes"] == 5
    long_action = next(row for row in long.json()["actions"] if row["sourcePlanTaskId"])
    assert long_action["durationMinutes"] == 240
    assert long_action["recommendation"] == "compress"


def test_long_simulation_is_persisted_as_compression_with_source_identity(tmp_path: Path):
    with _client(tmp_path) as client:
        assert client.post(
            "/api/v1/planner/targets/seed", json={"targetSlugs": ["sefaz_ce"]}
        ).status_code == 201
        assert client.get(
            "/api/v1/sprints/config?targetSlug=sefaz_ce"
        ).status_code == 200
        imported = client.post(
            "/api/v1/source-plans/import",
            headers={"Idempotency-Key": "long-simulation-source"},
            json={
                "targetSlug": "sefaz_ce",
                "sourceKind": "ls",
                "planLabel": "Meta simulada",
                "metaNumber": 48,
                "tasks": [{
                    "externalTaskId": "long-simulation",
                    "scheduledDate": "2026-07-14",
                    "sourceOrder": 1,
                    "discipline": "Simulados",
                    "taskKind": "simulation",
                    "description": "Simulado completo P1 e P2",
                    "estimatedMinutes": 300,
                }],
            },
        )
        generated = client.post(
            "/api/v1/sprints/generate-day",
            headers={"Idempotency-Key": "long-simulation-day"},
            json={
                "targetSlug": "sefaz_ce",
                "date": "2026-07-14",
                "energyLevel": 3,
                "lsBudgetMinutes": 300,
                "extraBudgetMinutes": 0,
            },
        )

    assert imported.status_code == 201, imported.text
    assert generated.status_code == 201, generated.text
    action = next(row for row in generated.json()["actions"] if row["sourcePlanTaskId"])
    assert action["actionKind"] == "ls_compress"
    assert action["recommendation"] == "compress"
    assert action["scoreDetails"]["sourceTaskKind"] == "simulation"


def test_paused_sprint_rejects_day_generation(tmp_path: Path):
    with _client(tmp_path) as client:
        _prepare(client, task_count=1)
        current = client.get(
            "/api/v1/sprints/config?targetSlug=sefaz_ce"
        ).json()
        paused = client.put(
            "/api/v1/sprints/config",
            headers={"Idempotency-Key": "pause-sprint"},
            json={
                "targetSlug": "sefaz_ce",
                "expectedVersion": current["version"],
                "state": "paused",
            },
        )
        generated = client.post(
            "/api/v1/sprints/generate-day",
            headers={"Idempotency-Key": "paused-day"},
            json={
                "targetSlug": "sefaz_ce",
                "date": "2026-07-14",
                "energyLevel": 3,
            },
        )

    assert paused.status_code == 200, paused.text
    assert generated.status_code == 422
    assert generated.json()["code"] == "invalid_sprint_day"
    assert "active" in generated.json()["message"]


def test_action_update_rejects_contradictory_decision_and_state(tmp_path: Path):
    with _client(tmp_path) as client:
        _prepare(client, task_count=1)
        day = client.post(
            "/api/v1/sprints/generate-day",
            headers={"Idempotency-Key": "decision-state-day"},
            json={
                "targetSlug": "sefaz_ce",
                "date": "2026-07-14",
                "energyLevel": 3,
            },
        ).json()
        action = day["actions"][0]
        invalid = client.put(
            f"/api/v1/sprints/actions/{action['id']}",
            headers={"Idempotency-Key": "contradictory-decision-state"},
            json={
                "expectedVersion": action["version"],
                "decision": "rejected",
                "state": "active",
                "questionsDone": 0,
                "correctCount": 0,
                "wrongCount": 0,
                "doubtCount": 0,
            },
        )

    assert invalid.status_code == 422
    assert invalid.json()["code"] == "invalid_sprint_action"


def test_action_idempotency_key_is_scoped_to_the_action(tmp_path: Path):
    with _client(tmp_path) as client:
        _prepare(client, task_count=2)
        day = client.post(
            "/api/v1/sprints/generate-day",
            headers={"Idempotency-Key": "action-scope-day"},
            json={
                "targetSlug": "sefaz_ce",
                "date": "2026-07-14",
                "energyLevel": 3,
            },
        ).json()
        first_action, second_action = [
            action for action in day["actions"] if action["sourcePlanTaskId"] is not None
        ][:2]
        assert first_action["version"] == second_action["version"]
        payload = {
            "expectedVersion": first_action["version"],
            "decision": "accepted",
            "state": "active",
            "questionsDone": 0,
            "correctCount": 0,
            "wrongCount": 0,
            "doubtCount": 0,
        }
        first = client.put(
            f"/api/v1/sprints/actions/{first_action['id']}",
            headers={"Idempotency-Key": "accept-action"},
            json=payload,
        )
        second = client.put(
            f"/api/v1/sprints/actions/{second_action['id']}",
            headers={"Idempotency-Key": "accept-action"},
            json=payload,
        )

    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    assert first.json()["id"] == first_action["id"]
    assert second.json()["id"] == second_action["id"]
    assert first.json()["replayed"] is False
    assert second.json()["replayed"] is False


def test_refresh_does_not_resurface_an_accepted_defer_action(tmp_path: Path):
    with _client(tmp_path) as client:
        _prepare(client, task_count=5)
        generated = client.post(
            "/api/v1/sprints/generate-day",
            headers={"Idempotency-Key": "day-before-defer"},
            json={
                "targetSlug": "sefaz_ce",
                "date": "2026-07-14",
                "energyLevel": 3,
                "p1Projection": 49,
                "p2Projection": 60,
            },
        ).json()
        deferred = next(
            row for row in generated["actions"]
            if row["recommendation"] == "defer"
        )
        accepted = client.put(
            f"/api/v1/sprints/actions/{deferred['id']}",
            headers={"Idempotency-Key": "accept-defer"},
            json={
                "expectedVersion": deferred["version"],
                "decision": "accepted",
                "state": "skipped",
            },
        )
        refreshed = client.post(
            "/api/v1/sprints/refresh-day",
            headers={"Idempotency-Key": "refresh-after-defer"},
            json={
                "targetSlug": "sefaz_ce",
                "date": "2026-07-14",
                "energyLevel": 3,
            },
        )

    assert accepted.status_code == 200, accepted.text
    assert refreshed.status_code == 201, refreshed.text
    assert not any(
        row["sourcePlanTaskId"] == deferred["sourcePlanTaskId"]
        for row in refreshed.json()["actions"]
    )


def test_generate_day_excludes_completed_and_ignored_source_tasks(tmp_path: Path):
    with _client(tmp_path) as client:
        _prepare(client, task_count=1)
        imported = client.post(
            "/api/v1/source-plans/import",
            headers={"Idempotency-Key": "historical-meta-47-states"},
            json={
                "targetSlug": "sefaz_ce",
                "sourceKind": "ls",
                "planLabel": "Meta 47",
                "metaNumber": 47,
                "tasks": [
                    {
                        "externalTaskId": "meta-47-completed",
                        "scheduledDate": "2026-07-14",
                        "sourceOrder": 90,
                        "discipline": "Legis. Tribut. Estadual (ICMS)",
                        "taskKind": "review",
                        "description": "Revisao ja concluida",
                        "estimatedMinutes": 60,
                        "status": "completed",
                    },
                    {
                        "externalTaskId": "meta-47-ignored",
                        "scheduledDate": "2026-07-14",
                        "sourceOrder": 91,
                        "discipline": "Estatistica",
                        "taskKind": "review",
                        "description": "Revisao ignorada",
                        "estimatedMinutes": 60,
                        "status": "ignored",
                    },
                ],
            },
        )
        generated = client.post(
            "/api/v1/sprints/generate-day",
            headers={"Idempotency-Key": "day-with-historical-states"},
            json={
                "targetSlug": "sefaz_ce",
                "date": "2026-07-14",
                "energyLevel": 3,
            },
        )

    assert imported.status_code == 201, imported.text
    assert generated.status_code == 201, generated.text
    external_ids = {
        row["externalTaskId"] for row in generated.json()["actions"]
        if row["sourcePlanTaskId"] is not None
    }
    assert "meta-47-completed" not in external_ids
    assert "meta-47-ignored" not in external_ids


def test_two_recent_representative_sets_demote_a_subject_at_goal(
    tmp_path: Path,
):
    with _client(tmp_path) as client:
        _prepare(client, task_count=1)
        evidence = _import_projection_evidence(
            client,
            batch_id="lte-representative-sets",
            origin="diario_backup",
            observations=[
                _projection_observation(
                    record_id=f"lte-representative-{index}",
                    discipline="Legis. Tribut. Estadual (ICMS)",
                    measurement_type="unseen_set",
                    correct_count=20,
                    wrong_count=0,
                    percentage_bp=None,
                )
                for index in (1, 2)
            ],
        )
        generated = client.post(
            "/api/v1/sprints/generate-day",
            headers={"Idempotency-Key": "day-after-lte-goal"},
            json={
                "targetSlug": "sefaz_ce",
                "date": "2026-07-14",
                "energyLevel": 3,
                "p1Projection": 49,
                "p2Projection": 60,
            },
        )

    assert evidence["insertedCount"] == 2
    assert generated.status_code == 201, generated.text
    assert not any(
        row["recommendation"] == "extra" and row["subjectKey"] == "p2_lte"
        for row in generated.json()["actions"]
    )


def test_day_capacity_override_is_explicit_and_does_not_change_default_config(
    tmp_path: Path,
):
    with _client(tmp_path) as client:
        _prepare(client, task_count=5)
        generated = client.post(
            "/api/v1/sprints/generate-day",
            headers={"Idempotency-Key": "reduced-capacity-day"},
            json={
                "targetSlug": "sefaz_ce",
                "date": "2026-07-14",
                "energyLevel": 2,
                "lsBudgetMinutes": 120,
                "extraBudgetMinutes": 30,
            },
        )
        config = client.get(
            "/api/v1/sprints/config?targetSlug=sefaz_ce"
        )

    assert generated.status_code == 201, generated.text
    payload = generated.json()
    assert payload["capacity"] == {
        "lsBudgetMinutes": 120,
        "extraBudgetMinutes": 30,
        "energyLevel": 2,
    }
    assert sum(
        row["durationMinutes"]
        for row in payload["actions"]
        if row["sourcePlanTaskId"] is not None
        and row["recommendation"] != "defer"
    ) <= 120
    assert sum(
        row["durationMinutes"]
        for row in payload["actions"]
        if row["recommendation"] == "extra"
    ) <= 30
    assert config.json()["lsBudgetMinutes"] == 240
    assert config.json()["extraBudgetMinutes"] == 60


def test_projection_is_derived_when_day_generation_omits_manual_values(
    tmp_path: Path,
):
    with _client(tmp_path) as client:
        _prepare(client, task_count=1)
        live = client.get(
            "/api/v1/sprints/projection",
            params={"targetSlug": "sefaz_ce", "asOf": "2026-07-14"},
        )
        generated = client.post(
            "/api/v1/sprints/generate-day",
            headers={"Idempotency-Key": "derived-projection-day"},
            json={
                "targetSlug": "sefaz_ce",
                "date": "2026-07-14",
                "energyLevel": 3,
            },
        )

    assert live.status_code == 200, live.text
    assert generated.status_code == 201, generated.text
    live_projection = live.json()
    day = generated.json()
    assert day["projectionOrigin"] == "derived"
    assert day["algorithmVersion"] == "sefaz-ce-sprint-v2"
    assert day["projections"] == {
        "p1": pytest.approx(live_projection["p1"]["projected"]),
        "p2": pytest.approx(live_projection["p2"]["projected"]),
    }
    assert (day["projections"]["p1"], day["projections"]["p2"]) != (
        42,
        55,
    )
    assert day["projection"] == live_projection


def test_partial_projection_override_is_rejected_instead_of_mixing_origins(
    tmp_path: Path,
):
    with _client(tmp_path) as client:
        _prepare(client, task_count=1)
        response = client.post(
            "/api/v1/sprints/generate-day",
            headers={"Idempotency-Key": "partial-projection-override"},
            json={
                "targetSlug": "sefaz_ce",
                "date": "2026-07-14",
                "energyLevel": 3,
                "p1Projection": 50,
            },
        )

    assert response.status_code == 422
    assert response.json()["code"] == "invalid_sprint_day"
    assert "supplied together" in response.json()["message"]


def test_complete_projection_override_is_visibly_marked_manual(
    tmp_path: Path,
):
    with _client(tmp_path) as client:
        _prepare(client, task_count=1)
        response = client.post(
            "/api/v1/sprints/generate-day",
            headers={"Idempotency-Key": "complete-projection-override"},
            json={
                "targetSlug": "sefaz_ce",
                "date": "2026-07-14",
                "energyLevel": 3,
                "p1Projection": 50,
                "p2Projection": 65,
            },
        )

    assert response.status_code == 201, response.text
    day = response.json()
    assert day["projectionOrigin"] == "manual"
    assert day["projections"] == {"p1": 50, "p2": 65}
    assert day["projection"]["p1"]["projected"] == 50
    assert day["projection"]["p2"]["projected"] == 65
    assert day["projection"]["weighted"]["projected"] == 180
    assert day["projection"]["weighted"]["distanceToTarget"] == 24
    assert day["projection"]["formulaVersion"] == "sefaz-ce-projection-v2"
    assert day["projection"]["scoreKind"] == (
        "raw_weighted_equivalent_not_fcc_standardized"
    )


def test_two_ls_percentage_projections_cannot_demote_a_focus_subject(
    tmp_path: Path,
):
    with _client(tmp_path) as client:
        _prepare(client, task_count=1)
        _import_projection_evidence(
            client,
            batch_id="two-ls-percentages",
            origin="ls_history",
            observations=[
                _projection_observation(
                    record_id=f"lte-ls-percentage-{index}",
                    discipline="Legis. Tribut. Estadual (ICMS)",
                    measurement_type="ls_percentage",
                    correct_count=None,
                    wrong_count=None,
                    percentage_bp=10000,
                )
                for index in (1, 2)
            ],
        )
        projection_response = client.get(
            "/api/v1/sprints/projection",
            params={"targetSlug": "sefaz_ce", "asOf": "2026-07-14"},
        )
        generated = client.post(
            "/api/v1/sprints/generate-day",
            headers={"Idempotency-Key": "day-after-two-ls-percentages"},
            json={
                "targetSlug": "sefaz_ce",
                "date": "2026-07-14",
                "energyLevel": 3,
            },
        )

    assert projection_response.status_code == 200, projection_response.text
    lte = next(
        subject
        for subject in projection_response.json()["subjects"]
        if subject["subjectKey"] == "p2_lte"
    )
    assert lte["representativeSetCount"] == 0
    assert lte["demotionEligible"] is False
    assert generated.status_code == 201, generated.text
    day = generated.json()
    assert day["projectionOrigin"] == "derived"
    assert any(
        action["recommendation"] == "extra"
        and action["subjectKey"] == "p2_lte"
        for action in day["actions"]
    )


def test_projection_snapshot_is_complete_and_immutable_after_generation(
    tmp_path: Path,
):
    with _client(tmp_path) as client:
        _prepare(client, task_count=1)
        generated_response = client.post(
            "/api/v1/sprints/generate-day",
            headers={"Idempotency-Key": "immutable-projection-snapshot"},
            json={
                "targetSlug": "sefaz_ce",
                "date": "2026-07-14",
                "energyLevel": 3,
            },
        )
        assert generated_response.status_code == 201, generated_response.text
        generated = generated_response.json()
        frozen = generated["projection"]

        _import_projection_evidence(
            client,
            batch_id="post-snapshot-perfect-exam",
            origin="diario_backup",
            observations=[
                _projection_observation(
                    record_id="economia-perfect-full-exam",
                    discipline="Economia",
                    measurement_type="full_exam",
                    correct_count=80,
                    wrong_count=0,
                    percentage_bp=None,
                )
            ],
        )
        live = client.get(
            "/api/v1/sprints/projection",
            params={"targetSlug": "sefaz_ce", "asOf": "2026-07-14"},
        ).json()
        stored_day = client.get(
            "/api/v1/sprints/day",
            params={"targetSlug": "sefaz_ce", "date": "2026-07-14"},
        ).json()
        database = connect_database(client.app.state.settings.database_path)
        try:
            snapshot_row = database.execute(
                "SELECT score_snapshot_json FROM sprint_day_runs WHERE id=?",
                (generated["runId"],),
            ).fetchone()
        finally:
            database.close()
        assert snapshot_row is not None
        stored_snapshot = json.loads(snapshot_row["score_snapshot_json"])

    assert live["p1"]["projected"] != frozen["p1"]["projected"]
    assert stored_day["projection"] == frozen
    assert stored_day["projectionOrigin"] == "derived"
    assert stored_snapshot["projection"] == frozen
    assert stored_snapshot["projectionOrigin"] == "derived"
    assert frozen["formulaVersion"] == "sefaz-ce-projection-v2"
    assert frozen["scoreKind"] == "raw_weighted_equivalent_not_fcc_standardized"
    assert frozen["interval"] == {
        "confidenceBp": 9000,
        "kind": "normal_approximation_raw_equivalent",
    }
    assert frozen["weighted"]["target"] == 204
    assert frozen["weighted"]["distanceToTarget"] == pytest.approx(
        204 - frozen["weighted"]["projected"]
    )
    assert isinstance(frozen["confidenceBp"], int)
    assert frozen["dominantOrigin"]
    assert len(frozen["subjects"]) == 13
    assert all(
        {
            "estimateBp",
            "lowBp",
            "highBp",
            "confidenceBp",
            "fragilityBp",
            "dominantOrigin",
        }
        <= subject.keys()
        for subject in frozen["subjects"]
    )
    assert generated["algorithmVersion"] == "sefaz-ce-sprint-v2"


def test_legacy_v1_score_snapshot_remains_readable(tmp_path: Path):
    with _client(tmp_path) as client:
        _prepare(client, task_count=1)
        generated = client.post(
            "/api/v1/sprints/generate-day",
            headers={"Idempotency-Key": "legacy-readable-seed"},
            json={
                "targetSlug": "sefaz_ce",
                "date": "2026-07-14",
                "energyLevel": 3,
            },
        ).json()
        database = connect_database(client.app.state.settings.database_path)
        try:
            database.execute(
                """
                UPDATE sprint_day_runs
                SET algorithm_version='sefaz-ce-sprint-v1',
                    score_snapshot_json=?
                WHERE id=?
                """,
                (
                    json.dumps(
                        {
                            "p1Projection": 42,
                            "p2Projection": 55,
                            "modeLabel": "Legacy V1",
                        }
                    ),
                    generated["runId"],
                ),
            )
            database.commit()
        finally:
            database.close()
        stored = client.get(
            "/api/v1/sprints/day",
            params={"targetSlug": "sefaz_ce", "date": "2026-07-14"},
        )
        trajectory = client.get(
            "/api/v1/sprints/trajectory",
            params={"targetSlug": "sefaz_ce"},
        )

    assert stored.status_code == 200, stored.text
    assert stored.json()["projections"] == {"p1": 42, "p2": 55}
    assert stored.json()["projection"] is None
    assert stored.json()["projectionOrigin"] == "legacy_manual"
    assert stored.json()["algorithmVersion"] == "sefaz-ce-sprint-v1"
    assert trajectory.status_code == 200, trajectory.text
    legacy = trajectory.json()["latest"]
    assert legacy["projectionOrigin"] == "legacy_manual"
    assert legacy["projection"] is None
    assert legacy["confidenceBp"] is None
    assert legacy["formulaVersion"] is None
    assert legacy["weightedProjected"] == 152
    assert legacy["distanceToTarget"] == 52


def test_completed_action_appends_aggregate_evidence_once_without_question_data(
    tmp_path: Path,
):
    with _client(tmp_path) as client:
        _prepare(client, task_count=1)
        day = client.post(
            "/api/v1/sprints/generate-day",
            headers={"Idempotency-Key": "action-evidence-day"},
            json={
                "targetSlug": "sefaz_ce",
                "date": "2026-07-14",
                "energyLevel": 3,
            },
        ).json()
        action = next(
            row
            for row in day["actions"]
            if row["sourcePlanTaskId"] is not None
            and row["plannedQuestions"] > 0
        )
        payload = {
            "expectedVersion": action["version"],
            "decision": "accepted",
            "state": "completed",
            "actualMinutes": 40,
            "questionsDone": 10,
            "correctCount": 8,
            "wrongCount": 2,
            "doubtCount": 1,
            "questionRefs": [
                {
                    "questionFingerprint": "never-copy-this-fingerprint",
                    "sourceTaskId": "never-copy-this-answer",
                    "reason": "doubt",
                }
            ],
        }
        completed = client.put(
            f"/api/v1/sprints/actions/{action['id']}",
            headers={"Idempotency-Key": "record-action-evidence"},
            json=payload,
        )
        replay = client.put(
            f"/api/v1/sprints/actions/{action['id']}",
            headers={"Idempotency-Key": "record-action-evidence"},
            json=payload,
        )
        database = connect_database(client.app.state.settings.database_path)
        try:
            batches = tuple(
                database.execute(
                    "SELECT * FROM sprint_evidence_import_batches WHERE batch_id LIKE ?",
                    (f"sprint-action:{action['id']}:%",),
                )
            )
            observations = tuple(
                database.execute(
                    "SELECT * FROM sprint_performance_observations WHERE source_record_id=?",
                    (f"sprint-action:{action['id']}",),
                )
            )
        finally:
            database.close()

    assert completed.status_code == 200, completed.text
    assert replay.status_code == 200, replay.text
    assert replay.json()["replayed"] is True
    expected_batch = f"sprint-action:{action['id']}:v{completed.json()['version']}"
    assert [row["batch_id"] for row in batches] == [expected_batch]
    assert len(observations) == 1
    observation = observations[0]
    assert observation["correct_count"] == 8
    assert observation["wrong_count"] == 2
    assert observation["doubt_count"] == 1
    assert observation["measurement_type"] == "sprint_action"
    encoded = json.dumps(dict(observation), ensure_ascii=True)
    assert "never-copy-this" not in encoded


def test_cross_paper_simulation_result_does_not_calibrate_lte(
    tmp_path: Path,
):
    with _client(tmp_path) as client:
        assert client.post(
            "/api/v1/planner/targets/seed",
            json={"targetSlugs": ["sefaz_ce"]},
        ).status_code == 201
        assert client.get(
            "/api/v1/sprints/config?targetSlug=sefaz_ce"
        ).status_code == 200
        imported = client.post(
            "/api/v1/source-plans/import",
            headers={"Idempotency-Key": "cross-paper-simulation-source"},
            json={
                "targetSlug": "sefaz_ce",
                "sourceKind": "ls",
                "planLabel": "Meta simulada",
                "metaNumber": 48,
                "tasks": [{
                    "externalTaskId": "cross-paper-simulation",
                    "scheduledDate": "2026-07-14",
                    "sourceOrder": 1,
                    "discipline": "Simulados",
                    "taskKind": "simulation",
                    "description": "Simulado completo P1 e P2",
                    "estimatedMinutes": 60,
                }],
            },
        )
        assert imported.status_code == 201, imported.text
        before = client.get(
            "/api/v1/sprints/projection",
            params={"targetSlug": "sefaz_ce", "asOf": "2026-07-14"},
        ).json()
        generated = client.post(
            "/api/v1/sprints/generate-day",
            headers={"Idempotency-Key": "cross-paper-simulation-day"},
            json={
                "targetSlug": "sefaz_ce",
                "date": "2026-07-14",
                "energyLevel": 3,
            },
        )
        assert generated.status_code == 201, generated.text
        action = next(
            row
            for row in generated.json()["actions"]
            if row["externalTaskId"] == "cross-paper-simulation"
        )
        completed = client.put(
            f"/api/v1/sprints/actions/{action['id']}",
            headers={"Idempotency-Key": "cross-paper-simulation-result"},
            json={
                "expectedVersion": action["version"],
                "decision": "accepted",
                "state": "completed",
                "questionsDone": 20,
                "correctCount": 20,
                "wrongCount": 0,
                "doubtCount": 0,
            },
        )
        after = client.get(
            "/api/v1/sprints/projection",
            params={"targetSlug": "sefaz_ce", "asOf": "2026-07-14"},
        ).json()
        evidence = client.get(
            "/api/v1/sprints/evidence",
            params={"targetSlug": "sefaz_ce"},
        ).json()["items"]

    assert completed.status_code == 200, completed.text
    before_lte = next(
        row for row in before["subjects"] if row["subjectKey"] == "p2_lte"
    )
    after_lte = next(
        row for row in after["subjects"] if row["subjectKey"] == "p2_lte"
    )
    assert after_lte == before_lte
    observation = next(
        row for row in evidence if row["sourceRecordId"] == f"sprint-action:{action['id']}"
    )
    assert observation["measurementType"] == "sectional_mock"
    assert observation["subjectProfileId"] is None
    assert observation["subjectKey"] is None
    assert observation["transferabilityBp"] == 0
    assert observation["provenance"]["attributionScope"] == "cross_paper_aggregate"


def test_action_and_evidence_append_roll_back_together(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    with _client(tmp_path) as client:
        _prepare(client, task_count=1)
        day = client.post(
            "/api/v1/sprints/generate-day",
            headers={"Idempotency-Key": "rollback-evidence-day"},
            json={
                "targetSlug": "sefaz_ce",
                "date": "2026-07-14",
                "energyLevel": 3,
            },
        ).json()
        action = next(
            row
            for row in day["actions"]
            if row["sourcePlanTaskId"] is not None
            and row["plannedQuestions"] > 0
        )

        def fail_append(*_args, **_kwargs):
            raise RuntimeError("forced evidence append failure")

        monkeypatch.setattr(
            SprintEvidenceRepository,
            "append_observation_in_transaction",
            fail_append,
        )
        with pytest.raises(RuntimeError, match="forced evidence append failure"):
            client.put(
                f"/api/v1/sprints/actions/{action['id']}",
                headers={"Idempotency-Key": "rollback-action-evidence"},
                json={
                    "expectedVersion": action["version"],
                    "decision": "accepted",
                    "state": "completed",
                    "questionsDone": 10,
                    "correctCount": 7,
                    "wrongCount": 3,
                    "doubtCount": 1,
                },
            )
        database = connect_database(client.app.state.settings.database_path)
        try:
            saved = database.execute(
                "SELECT state, version FROM sprint_actions WHERE id=?",
                (action["id"],),
            ).fetchone()
            batch_count = database.execute(
                "SELECT COUNT(*) FROM sprint_evidence_import_batches WHERE batch_id LIKE ?",
                (f"sprint-action:{action['id']}:%",),
            ).fetchone()[0]
        finally:
            database.close()

    assert (saved["state"], saved["version"]) == (
        action["state"],
        action["version"],
    )
    assert batch_count == 0


def test_trajectory_exposes_the_frozen_v2_projection_audit(tmp_path: Path):
    with _client(tmp_path) as client:
        _prepare(client, task_count=1)
        generated = client.post(
            "/api/v1/sprints/generate-day",
            headers={"Idempotency-Key": "trajectory-v2-day"},
            json={
                "targetSlug": "sefaz_ce",
                "date": "2026-07-14",
                "energyLevel": 3,
            },
        ).json()
        response = client.get(
            "/api/v1/sprints/trajectory",
            params={"targetSlug": "sefaz_ce"},
        )

    assert response.status_code == 200, response.text
    latest = response.json()["latest"]
    assert latest["projection"] == generated["projection"]
    assert latest["projectionOrigin"] == "derived"
    assert latest["confidenceBp"] == generated["projection"]["confidenceBp"]
    assert latest["weightedProjected"] == pytest.approx(
        generated["projection"]["weighted"]["projected"]
    )
    assert latest["distanceToTarget"] == pytest.approx(
        generated["projection"]["weighted"]["distanceToTarget"]
    )
    assert latest["dominantOrigin"] == generated["projection"]["dominantOrigin"]
    assert latest["formulaVersion"] == "sefaz-ce-projection-v2"
    assert latest["projection"]["p1"]["low"] is not None
    assert latest["projection"]["p2"]["high"] is not None
