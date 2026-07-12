from pathlib import Path

from fastapi.testclient import TestClient

from study_os_service.app import create_app
from study_os_service.config import StudyOsSettings


def test_generate_get_and_refresh_week_http_contract(tmp_path: Path):
    app = create_app(StudyOsSettings.from_environment(tmp_path))
    with TestClient(app) as client:
        client.post(
            "/api/v1/planner/targets/seed",
            json={"targetSlugs": ["bacen_economia_financas"]},
        )
        generated = client.post(
            "/api/v1/planner/generate-week",
            headers={"Idempotency-Key": "api-week-1"},
            json={
                "targetSlug": "bacen_economia_financas",
                "weekStart": "2026-07-13",
                "dailyQuotas": {"2026-07-13": 2},
            },
        )
        fetched = client.get(
            "/api/v1/planner/week",
            params={
                "targetSlug": "bacen_economia_financas",
                "weekStart": "2026-07-13",
            },
        )
        refreshed = client.post(
            "/api/v1/planner/refresh-week",
            headers={"Idempotency-Key": "api-week-2"},
            json={
                "previousWeekRunId": generated.json()["run"]["id"],
                "targetSlug": "bacen_economia_financas",
                "weekStart": "2026-07-13",
            },
        )

    assert generated.status_code == 201
    assert generated.json()["run"]["weekStart"] == "2026-07-13"
    assert generated.json()["slots"]
    assert fetched.status_code == 200
    assert fetched.json()["run"]["id"] == generated.json()["run"]["id"]
    assert refreshed.status_code == 201
    assert refreshed.json()["run"]["supersedesWeekRunId"] == generated.json()["run"]["id"]


def test_week_api_rejects_non_monday_and_reused_key(tmp_path: Path):
    app = create_app(StudyOsSettings.from_environment(tmp_path))
    with TestClient(app) as client:
        client.post(
            "/api/v1/planner/targets/seed",
            json={"targetSlugs": ["bacen_economia_financas"]},
        )
        invalid = client.post(
            "/api/v1/planner/generate-week",
            headers={"Idempotency-Key": "bad-week"},
            json={
                "targetSlug": "bacen_economia_financas",
                "weekStart": "2026-07-14",
            },
        )
        first = client.post(
            "/api/v1/planner/generate-week",
            headers={"Idempotency-Key": "same-week-key"},
            json={
                "targetSlug": "bacen_economia_financas",
                "weekStart": "2026-07-13",
            },
        )
        conflict = client.post(
            "/api/v1/planner/generate-week",
            headers={"Idempotency-Key": "same-week-key"},
            json={
                "targetSlug": "bacen_economia_financas",
                "weekStart": "2026-07-13",
                "dailyQuotas": {"2026-07-13": 1},
            },
        )

    assert invalid.status_code == 422
    assert invalid.json()["code"] == "invalid_planner_request"
    assert first.status_code == 201
    assert conflict.status_code == 409
    assert conflict.json()["code"] == "planner_idempotency_conflict"
