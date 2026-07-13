from pathlib import Path

from fastapi.testclient import TestClient

from study_os_service.app import create_app
from study_os_service.config import StudyOsSettings
from study_os_service.db.connection import connect_database
from study_os_service.db.migrations import MigrationRunner
from tests.study_os_service.test_planner_generation import prepare_target
from tests.study_os_service.test_source_choice import _add_source, _local_material


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


def test_planner_api_promotes_immutable_source_choice_on_block_and_scoreboard(
    tmp_path: Path,
):
    settings = StudyOsSettings.from_environment(tmp_path)
    connection = connect_database(settings.database_path)
    try:
        MigrationRunner(connection).migrate()
        topic_ids = prepare_target(connection, "rfb_auditor")
        _, lesson_id, material_id = _local_material(
            connection,
            target_slug="rfb_auditor",
            label="api-strategy-course",
        )
        _add_source(
            connection,
            target_slug="rfb_auditor",
            target_topic_id=topic_ids[0],
            source_key="api-strategy-source",
            source_kind="course",
            content_role="primary_theory",
            trust_tier=10,
            edition="2026.2",
            lesson_id=lesson_id,
            material_id=material_id,
            primary_eligible=True,
        )
    finally:
        connection.close()
    app = create_app(settings)
    with TestClient(app) as client:
        generated = client.post(
            "/api/v1/planner/generate-day",
            headers={"Idempotency-Key": "api-strategy-day"},
            json={
                "targetSlug": "rfb_auditor",
                "date": "2026-07-13",
                "timeBudgetMinutes": 60,
            },
        )
        scoreboard = client.get(
            f"/api/v1/planner/scoreboard?runId={generated.json()['run']['id']}"
        )

    assert generated.status_code == 201
    block = generated.json()["blocks"][0]
    assert block["sourceChoice"]["sourceKind"] == "course"
    assert block["sourceChoice"]["choiceRowId"] > 0
    chosen = next(
        item for item in scoreboard.json()["items"] if item["chosenPosition"] == 1
    )
    assert chosen["sourceChoice"] == block["sourceChoice"]


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
