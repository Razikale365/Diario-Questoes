from pathlib import Path

from fastapi.testclient import TestClient

from study_os_service.app import create_app
from study_os_service.config import StudyOsSettings


def _client(tmp_path: Path) -> TestClient:
    return TestClient(create_app(StudyOsSettings.from_environment(tmp_path)))


def _seed(client: TestClient) -> None:
    assert client.post(
        "/api/v1/planner/targets/seed", json={"targetSlugs": ["sefaz_ce"]}
    ).status_code == 201
    assert client.get(
        "/api/v1/sprints/config", params={"targetSlug": "sefaz_ce"}
    ).status_code == 200


def _task(
    external_id: str,
    discipline: str,
    scheduled_date: str,
    *,
    relevance: int = 5,
) -> dict[str, object]:
    return {
        "externalTaskId": external_id,
        "scheduledDate": scheduled_date,
        "sourceOrder": 1,
        "discipline": discipline,
        "taskKind": "questions",
        "description": f"Aggregate task {external_id}",
        "estimatedMinutes": 60,
        "relevance": relevance,
        "status": "pending",
    }


def _import_cycle(
    client: TestClient,
    *,
    key: str,
    label: str,
    meta: int,
    released_at: str,
    starts_on: str,
    ends_on: str,
    tasks: list[dict[str, object]],
):
    return client.post(
        "/api/v1/source-plans/import",
        headers={"Idempotency-Key": key},
        json={
            "targetSlug": "sefaz_ce",
            "sourceKind": "ls",
            "planLabel": label,
            "metaNumber": meta,
            "cycle": {
                "releasedAt": released_at,
                "startsOn": starts_on,
                "endsOn": ends_on,
            },
            "tasks": tasks,
        },
    )


def test_cycle_overrun_is_unscheduled_but_keeps_original_date(tmp_path: Path):
    with _client(tmp_path) as client:
        _seed(client)
        imported = _import_cycle(
            client,
            key="meta47-overrun",
            label="Meta 47",
            meta=47,
            released_at="2026-07-11T08:00:00-03:00",
            starts_on="2026-07-11",
            ends_on="2026-07-17",
            tasks=[_task("late-47", "Economia", "2026-07-21")],
        )
        listed = client.get(
            "/api/v1/source-plans/tasks",
            params={"targetSlug": "sefaz_ce", "includeInactive": True},
        )

    assert imported.status_code == 201, imported.text
    assert imported.json()["cycleOverrunCount"] == 1
    assert imported.json()["cycle"]["endsOn"] == "2026-07-17"
    task = listed.json()["items"][0]
    assert task["scheduledDate"] is None
    assert task["provenance"]["originalScheduledDate"] == "2026-07-21"
    assert task["cycle"]["planLabel"] == "Meta 47"


def test_meta48_is_released_on_17_but_only_eligible_from_18(tmp_path: Path):
    with _client(tmp_path) as client:
        _seed(client)
        imported = _import_cycle(
            client,
            key="meta48-window",
            label="Meta 48",
            meta=48,
            released_at="2026-07-17T08:00:00-03:00",
            starts_on="2026-07-18",
            ends_on="2026-07-24",
            tasks=[_task("meta48-lte", "Legis. Tribut. Estadual (ICMS)", "2026-07-18")],
        )
        day17 = client.post(
            "/api/v1/sprints/generate-day",
            headers={"Idempotency-Key": "meta48-day17"},
            json={"targetSlug": "sefaz_ce", "date": "2026-07-17", "energyLevel": 3},
        )
        day18 = client.post(
            "/api/v1/sprints/generate-day",
            headers={"Idempotency-Key": "meta48-day18"},
            json={"targetSlug": "sefaz_ce", "date": "2026-07-18", "energyLevel": 3},
        )

    assert imported.status_code == 201, imported.text
    assert not any(row["sourcePlanTaskId"] for row in day17.json()["actions"])
    source = next(row for row in day18.json()["actions"] if row["sourcePlanTaskId"])
    assert source["scoreDetails"]["cycle"]["metaNumber"] == 48
    assert source["scoreDetails"]["backlog"] is None


def test_closed_cycle_creates_visible_backlog_and_recovers_only_high_return(
    tmp_path: Path,
):
    with _client(tmp_path) as client:
        _seed(client)
        imported = _import_cycle(
            client,
            key="meta47-backlog",
            label="Meta 47",
            meta=47,
            released_at="2026-07-11T08:00:00-03:00",
            starts_on="2026-07-11",
            ends_on="2026-07-17",
            tasks=[
                _task("high-lte", "Legis. Tribut. Estadual (ICMS)", "2026-07-17", relevance=10),
                _task("low-portuguese", "Lingua Portuguesa", "2026-07-17", relevance=0),
            ],
        )
        day = client.post(
            "/api/v1/sprints/generate-day",
            headers={"Idempotency-Key": "closed-meta-day"},
            json={"targetSlug": "sefaz_ce", "date": "2026-07-18", "energyLevel": 3},
        )
        backlog = client.get(
            "/api/v1/source-plans/backlog",
            params={"targetSlug": "sefaz_ce", "includeAll": True},
        )
        operational_backlog = client.get(
            "/api/v1/source-plans/backlog",
            params={"targetSlug": "sefaz_ce"},
        )

    assert imported.status_code == 201, imported.text
    assert backlog.status_code == 200, backlog.text
    assert len(backlog.json()["items"]) == 2
    assert {row["state"] for row in backlog.json()["items"]} == {
        "candidate",
        "dismissed",
    }
    assert operational_backlog.status_code == 200, operational_backlog.text
    assert len(operational_backlog.json()["items"]) == 1
    assert operational_backlog.json()["items"][0]["returnScoreMilli"] >= 1000
    recovered = [row for row in day.json()["actions"] if row["sourcePlanTaskId"]]
    assert len(recovered) == 1
    assert recovered[0]["scoreDetails"]["backlog"]["returnScoreMilli"] >= 1000


def test_conflicting_cycle_reimport_returns_409(tmp_path: Path):
    with _client(tmp_path) as client:
        _seed(client)
        first = _import_cycle(
            client,
            key="cycle-conflict-a",
            label="Meta 49",
            meta=49,
            released_at="2026-07-25T08:00:00-03:00",
            starts_on="2026-07-25",
            ends_on="2026-07-31",
            tasks=[_task("meta49-a", "Economia", "2026-07-25")],
        )
        conflict = _import_cycle(
            client,
            key="cycle-conflict-b",
            label="Meta 49",
            meta=49,
            released_at="2026-07-25T08:00:00-03:00",
            starts_on="2026-07-26",
            ends_on="2026-07-31",
            tasks=[_task("meta49-b", "Economia", "2026-07-26")],
        )

    assert first.status_code == 201, first.text
    assert conflict.status_code == 409
    assert conflict.json()["code"] == "source_plan_cycle_conflict"
