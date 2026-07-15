from pathlib import Path

from fastapi.testclient import TestClient

from study_os_service.app import create_app
from study_os_service.config import StudyOsSettings


def client(tmp_path: Path) -> TestClient:
    return TestClient(create_app(StudyOsSettings.from_environment(tmp_path)))


def seed(client: TestClient) -> None:
    assert client.post(
        "/api/v1/planner/targets/seed",
        json={"targetSlugs": ["sefaz_ce"]},
    ).status_code == 201
    assert client.get(
        "/api/v1/sprints/config", params={"targetSlug": "sefaz_ce"}
    ).status_code == 200
    imported = client.post(
        "/api/v1/source-plans/import",
        headers={"Idempotency-Key": "calendar-meta-47"},
        json={
            "targetSlug": "sefaz_ce",
            "sourceKind": "ls",
            "planLabel": "Meta 47",
            "metaNumber": 47,
            "cycle": {
                "releasedAt": "2026-07-11T11:00:00Z",
                "startsOn": "2026-07-11",
                "endsOn": "2026-07-17",
            },
            "tasks": [
                {
                    "externalTaskId": "calendar-meta-47-lte",
                    "scheduledDate": "2026-07-15",
                    "sourceOrder": 1,
                    "discipline": "Legis. Tribut. Estadual (ICMS)",
                    "taskKind": "questions",
                    "description": "Resolver bateria LS",
                    "estimatedMinutes": 60,
                    "status": "pending",
                }
            ],
        },
    )
    assert imported.status_code == 201, imported.text


def preview_payload(expected_run_id=None):
    return {
        "targetSlug": "sefaz_ce",
        "startDate": "2026-07-18",
        "endDate": "2026-07-31",
        "expectedRunId": expected_run_id,
    }


def test_preview_apply_head_and_run_contract(tmp_path: Path):
    with client(tmp_path) as http:
        seed(http)
        draft = http.post(
            "/api/v1/sprints/calendar/preview",
            headers={"Idempotency-Key": "preview-api-1"},
            json=preview_payload(),
        )
        assert draft.status_code == 201, draft.text
        run_id = draft.json()["run"]["id"]
        applied = http.post(
            f"/api/v1/sprints/calendar/runs/{run_id}/apply",
            headers={"Idempotency-Key": "apply-api-1"},
            json={"expectedRunId": None, "expectedOverrideVersions": {}},
        )
        head = http.get(
            "/api/v1/sprints/calendar",
            params={"targetSlug": "sefaz_ce", "startDate": "2026-07-18"},
        )
        historical = http.get(f"/api/v1/sprints/calendar/runs/{run_id}")

    assert draft.json()["run"]["decision"] == "draft"
    assert applied.status_code == 200, applied.text
    assert applied.json()["run"]["decision"] == "applied"
    assert head.status_code == 200
    assert head.json()["run"]["id"] == run_id
    assert historical.status_code == 200
    assert historical.json()["run"]["id"] == run_id


def test_preview_replay_conflict_and_stale_head_error_shapes(tmp_path: Path):
    with client(tmp_path) as http:
        seed(http)
        first = http.post(
            "/api/v1/sprints/calendar/preview",
            headers={"Idempotency-Key": "preview-replay"},
            json=preview_payload(),
        )
        replay = http.post(
            "/api/v1/sprints/calendar/preview",
            headers={"Idempotency-Key": "preview-replay"},
            json=preview_payload(),
        )
        conflict = http.post(
            "/api/v1/sprints/calendar/preview",
            headers={"Idempotency-Key": "preview-replay"},
            json=preview_payload() | {"endDate": "2026-07-30"},
        )
        run_id = first.json()["run"]["id"]
        assert http.post(
            f"/api/v1/sprints/calendar/runs/{run_id}/apply",
            headers={"Idempotency-Key": "apply-stale-base"},
            json={"expectedRunId": None, "expectedOverrideVersions": {}},
        ).status_code == 200
        stale = http.post(
            "/api/v1/sprints/calendar/preview",
            headers={"Idempotency-Key": "stale-preview"},
            json=preview_payload(),
        )

    assert replay.status_code == 201
    assert replay.json() == first.json() | {"replayed": True}
    assert conflict.status_code == 409
    assert conflict.json()["code"] == "calendar_idempotency_conflict"
    assert stale.status_code == 409
    assert stale.json()["code"] == "stale_calendar_run"


def test_invalid_window_and_missing_calendar_are_stable(tmp_path: Path):
    with client(tmp_path) as http:
        seed(http)
        missing = http.get(
            "/api/v1/sprints/calendar",
            params={"targetSlug": "sefaz_ce", "startDate": "2026-07-15"},
        )
        invalid = http.post(
            "/api/v1/sprints/calendar/preview",
            headers={"Idempotency-Key": "invalid-window"},
            json=preview_payload() | {
                "startDate": "2026-07-15",
                "endDate": "2026-07-31",
            },
        )
        missing_run = http.get("/api/v1/sprints/calendar/runs/999999")

    assert missing.status_code == 404
    assert missing.json()["code"] == "calendar_not_found"
    assert invalid.status_code == 422
    assert invalid.json()["code"] == "invalid_calendar_window"
    assert missing_run.status_code == 404
    assert missing_run.json()["code"] == "calendar_run_not_found"


def test_day_override_and_manual_item_routes(tmp_path: Path):
    with client(tmp_path) as http:
        seed(http)
        capacity = http.put(
            "/api/v1/sprints/calendar/days/2026-07-18",
            json={
                "targetSlug": "sefaz_ce",
                "availability": "available",
                "lsMinutes": 180,
                "extraMinutes": 30,
                "energyLevel": 4,
                "expectedVersion": None,
            },
        )
        manual = http.post(
            "/api/v1/sprints/calendar/items",
            headers={"Idempotency-Key": "api-manual-item"},
            json={
                "targetSlug": "sefaz_ce",
                "title": "Revisar erros de hoje",
                "planDate": "2026-07-18",
                "startTime": "08:30",
                "durationMinutes": 35,
            },
        )
        item_id = manual.json()["item"]["id"]
        moved = http.put(
            f"/api/v1/sprints/calendar/items/{item_id}/override",
            json={
                "targetSlug": "sefaz_ce",
                "planDate": "2026-07-19",
                "startTime": "09:00",
                "durationMinutes": 40,
                "position": 1,
                "pinned": True,
                "expectedVersion": 1,
            },
        )

    assert capacity.status_code == 200, capacity.text
    assert capacity.json()["scopeValue"] == "2026-07-18"
    assert manual.status_code == 201, manual.text
    assert manual.json()["item"]["kind"] == "manual"
    assert moved.status_code == 200, moved.text
    assert moved.json()["planDate"] == "2026-07-19"
    assert moved.json()["version"] == 2

