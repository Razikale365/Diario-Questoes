from pathlib import Path

from fastapi.testclient import TestClient

from study_os_service.app import create_app
from study_os_service.config import StudyOsSettings


def test_empty_seeded_profile_generates_shortfall_and_exposes_scoreboard(tmp_path: Path):
    app = create_app(StudyOsSettings.from_environment(tmp_path))
    with TestClient(app) as client:
        assert client.post(
            "/api/v1/planner/targets/seed",
            json={"targetSlugs": ["bacen_economia_financas"]},
        ).status_code == 201
        generated = client.post(
            "/api/v1/planner/generate-day",
            headers={"Idempotency-Key": "empty-bacen-day"},
            json={
                "targetSlug": "bacen_economia_financas",
                "date": "2026-07-13",
                "timeBudgetMinutes": 240,
            },
        )
        day = client.get(
            "/api/v1/planner/day?targetSlug=bacen_economia_financas&date=2026-07-13"
        )
        scoreboard = client.get(
            f"/api/v1/planner/scoreboard?runId={generated.json()['run']['id']}"
        )

    assert generated.status_code == 201
    assert generated.json()["run"]["status"] == "shortfall"
    assert len(generated.json()["blocks"]) == 2
    assert day.status_code == 200
    assert day.json()["run"]["id"] == generated.json()["run"]["id"]
    assert scoreboard.status_code == 200
    assert len(scoreboard.json()["items"]) == 18
    assert all(
        "finalScore" in item["scoreBreakdown"]
        for item in scoreboard.json()["items"]
    )


def test_planner_api_returns_structured_input_and_result_errors(tmp_path: Path):
    app = create_app(StudyOsSettings.from_environment(tmp_path))
    with TestClient(app) as client:
        missing_target = client.post(
            "/api/v1/planner/generate-day",
            headers={"Idempotency-Key": "missing-target"},
            json={"targetSlug": "nao_existe", "date": "2026-07-13"},
        )
        invalid_date = client.post(
            "/api/v1/planner/generate-day",
            headers={"Idempotency-Key": "invalid-date"},
            json={"targetSlug": "bacen_economia_financas", "date": "13/07/2026"},
        )
        missing_day = client.get(
            "/api/v1/planner/day?targetSlug=bacen_economia_financas&date=2026-07-13"
        )

    assert missing_target.status_code == 404
    assert missing_target.json()["code"] == "target_profile_not_found"
    assert invalid_date.status_code == 422
    assert invalid_date.json()["code"] == "invalid_planner_request"
    assert missing_day.status_code == 404
    assert missing_day.json()["code"] == "planner_day_not_found"


def test_block_result_and_refresh_api_are_optimistic_and_immutable(tmp_path: Path):
    app = create_app(StudyOsSettings.from_environment(tmp_path))
    with TestClient(app) as client:
        client.post(
            "/api/v1/planner/targets/seed",
            json={"targetSlugs": ["rfb_analista"]},
        )
        topics = client.get(
            "/api/v1/planner/topics?targetSlug=rfb_analista"
        ).json()["items"]
        client.put(
            "/api/v1/planner/topics?targetSlug=rfb_analista",
            json={
                "items": [
                    {
                        "id": item["id"],
                        "coverageStatus": "weak",
                        "reviewDebt": 70,
                        "expectedVersion": item["version"],
                    }
                    for item in topics
                ]
            },
        )
        generated = client.post(
            "/api/v1/planner/generate-day",
            headers={"Idempotency-Key": "rfb-result-day"},
            json={"targetSlug": "rfb_analista", "date": "2026-07-13"},
        ).json()
        question = next(
            block for block in generated["blocks"] if block["blockKind"] == "questions"
        )
        result = client.post(
            f"/api/v1/planner/blocks/{question['id']}/result",
            json={
                "state": "completed",
                "questionsDone": 20,
                "correctCount": 15,
                "wrongCount": 5,
                "doubtCount": 2,
                "favoriteCount": 1,
                "expectedVersion": question["version"],
            },
        )
        stale = client.post(
            f"/api/v1/planner/blocks/{question['id']}/result",
            json={
                "state": "skipped",
                "questionsDone": 0,
                "correctCount": 0,
                "wrongCount": 0,
                "doubtCount": 0,
                "favoriteCount": 0,
                "expectedVersion": question["version"],
            },
        )
        refresh = client.post(
            "/api/v1/planner/refresh-day",
            headers={"Idempotency-Key": "rfb-refreshed-day"},
            json={
                "previousRunId": generated["run"]["id"],
                "targetSlug": "rfb_analista",
                "date": "2026-07-14",
            },
        )

    assert result.status_code == 200
    assert result.json()["state"] == "completed"
    assert result.json()["version"] == question["version"] + 1
    assert stale.status_code == 409
    assert stale.json()["code"] == "stale_planner_block"
    assert refresh.status_code == 201
    assert refresh.json()["run"]["supersedesRunId"] == generated["run"]["id"]
