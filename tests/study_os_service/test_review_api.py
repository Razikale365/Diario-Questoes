from pathlib import Path

from fastapi.testclient import TestClient

from study_os_service.app import create_app
from study_os_service.config import StudyOsSettings


def settings(tmp_path: Path) -> StudyOsSettings:
    return StudyOsSettings.from_environment(tmp_path)


def seed_due_review(client: TestClient) -> None:
    assert client.post(
        "/api/v1/planner/targets/seed",
        json={"targetSlugs": ["bacen_economia_financas"]},
    ).status_code == 201
    generated = client.post(
        "/api/v1/planner/generate-day",
        headers={"Idempotency-Key": "review-api-day"},
        json={"targetSlug": "bacen_economia_financas", "date": "2026-07-13"},
    ).json()
    question = next(
        block for block in generated["blocks"] if block["blockKind"] == "questions"
    )
    assert client.post(
        f"/api/v1/planner/blocks/{question['id']}/result",
        json={
            "state": "completed",
            "questionsDone": 20,
            "correctCount": 8,
            "wrongCount": 12,
            "doubtCount": 2,
            "favoriteCount": 0,
            "expectedVersion": question["version"],
        },
    ).status_code == 200


def test_review_rebuild_list_and_defer_http_contract(tmp_path: Path):
    with TestClient(create_app(settings(tmp_path))) as client:
        seed_due_review(client)
        rebuilt = client.post(
            "/api/v1/review/rebuild",
            headers={"Idempotency-Key": "review-rebuild-api"},
            json={"targetSlug": "bacen_economia_financas", "asOf": "2026-07-13"},
        )
        listed = client.get(
            "/api/v1/review/queue",
            params={"targetSlug": "bacen_economia_financas", "asOf": "2026-07-13"},
        )
        item = listed.json()["items"][0]
        deferred = client.post(
            f"/api/v1/review/items/{item['id']}/defer",
            headers={"Idempotency-Key": "review-defer-api"},
            json={"dueDate": "2026-07-16", "expectedVersion": item["version"]},
        )
        replayed = client.post(
            f"/api/v1/review/items/{item['id']}/defer",
            headers={"Idempotency-Key": "review-defer-api"},
            json={"dueDate": "2026-07-16", "expectedVersion": item["version"]},
        )
        conflict = client.post(
            f"/api/v1/review/items/{item['id']}/defer",
            headers={"Idempotency-Key": "review-defer-api"},
            json={"dueDate": "2026-07-17", "expectedVersion": item["version"]},
        )

    assert rebuilt.status_code == 200
    assert listed.status_code == 200
    assert item["targetSlug"] == "bacen_economia_financas"
    assert item["boundedQuestions"] == 8
    assert item["triggerEventIds"]
    assert deferred.status_code == 200
    assert deferred.json()["state"] == "deferred"
    assert deferred.json()["dueDate"] == "2026-07-16"
    assert replayed.status_code == 200
    assert replayed.json()["version"] == deferred.json()["version"]
    assert conflict.status_code == 409
    assert conflict.json()["code"] == "review_idempotency_conflict"


def test_review_mutations_require_idempotency_and_structured_errors(tmp_path: Path):
    with TestClient(create_app(settings(tmp_path))) as client:
        missing_key = client.post(
            "/api/v1/review/rebuild",
            json={"targetSlug": "bacen_economia_financas", "asOf": "2026-07-13"},
        )
        invalid_date = client.post(
            "/api/v1/review/rebuild",
            headers={"Idempotency-Key": "invalid-review-date"},
            json={"targetSlug": "bacen_economia_financas", "asOf": "13/07/2026"},
        )

    assert missing_key.status_code == 400
    assert missing_key.json()["code"] == "invalid_review_request"
    assert invalid_date.status_code == 400
    assert invalid_date.json()["code"] == "invalid_review_request"
