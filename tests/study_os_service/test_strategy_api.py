from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from study_os_service.app import create_app
from study_os_service.config import StudyOsSettings


def _client(tmp_path: Path) -> TestClient:
    return TestClient(create_app(StudyOsSettings.from_environment(tmp_path)))


def _seed_and_topic(client: TestClient) -> int:
    seeded = client.post(
        "/api/v1/planner/targets/seed",
        json={"targetSlugs": ["rfb_auditor"]},
    )
    assert seeded.status_code == 201
    topics = client.get(
        "/api/v1/planner/topics?targetSlug=rfb_auditor"
    ).json()["items"]
    return next(
        item["id"]
        for item in topics
        if item["discipline"] == "Direito Tributario"
        and item["topic"] == "Credito tributario"
    )


def _tec_payload(topic_id: int) -> dict:
    return {
        "targetSlug": "rfb_auditor",
        "sourceKey": "tec-rfb-api",
        "displayName": "TEC RFB",
        "banca": "FGV",
        "checkedAt": "2026-07-13",
        "cadernos": [
            {
                "discipline": "Direito Tributario",
                "topicHint": "Credito tributario",
                "targetTopicId": topic_id,
                "incidence": 88,
                "cadernoId": "tec-api-1",
                "cadernoUrl": "https://www.tecconcursos.com.br/questoes/cadernos/1",
            }
        ],
    }


def test_strategy_api_ingests_lists_and_replays_tec_metadata(tmp_path: Path):
    with _client(tmp_path) as client:
        topic_id = _seed_and_topic(client)
        payload = _tec_payload(topic_id)
        first = client.post(
            "/api/v1/strategy/ingest/tec",
            headers={"Idempotency-Key": "tec-api-1"},
            json=payload,
        )
        replay = client.post(
            "/api/v1/strategy/ingest/tec",
            headers={"Idempotency-Key": "tec-api-1"},
            json=payload,
        )
        sources = client.get(
            "/api/v1/strategy/sources?targetSlug=rfb_auditor"
        )
        mappings = client.get(
            "/api/v1/strategy/mappings?targetSlug=rfb_auditor"
        )

    assert first.status_code == 201
    assert replay.status_code == 201
    assert replay.json() == first.json()
    assert first.json()["mappedCount"] == 1
    assert first.json()["unresolved"] == []
    assert sources.status_code == 200
    assert sources.json()["items"][0]["sourceKind"] == "tec"
    assert mappings.status_code == 200
    assert mappings.json()["items"][0]["mappingStatus"] == "approved"


def test_strategy_api_returns_conflict_and_rejects_question_content(tmp_path: Path):
    with _client(tmp_path) as client:
        topic_id = _seed_and_topic(client)
        payload = _tec_payload(topic_id)
        assert client.post(
            "/api/v1/strategy/ingest/tec",
            headers={"Idempotency-Key": "tec-api-conflict"},
            json=payload,
        ).status_code == 201
        payload["cadernos"][0]["incidence"] = 99
        conflict = client.post(
            "/api/v1/strategy/ingest/tec",
            headers={"Idempotency-Key": "tec-api-conflict"},
            json=payload,
        )
        payload["cadernos"][0]["question"] = "paid content"
        rejected = client.post(
            "/api/v1/strategy/ingest/tec",
            headers={"Idempotency-Key": "tec-api-rejected"},
            json=payload,
        )

    assert conflict.status_code == 409
    assert conflict.json()["code"] == "strategy_ingestion_conflict"
    assert rejected.status_code == 422
    assert rejected.json()["code"] == "invalid_strategy_ingestion"


def test_strategy_api_requires_idempotency_and_known_target(tmp_path: Path):
    with _client(tmp_path) as client:
        missing_key = client.post(
            "/api/v1/strategy/ingest/andrety",
            json={
                "targetSlug": "rfb_auditor",
                "sourceKey": "andrety-rfb",
                "displayName": "Guia Andrety",
                "sourceDate": "2026-07-13",
                "sourceVersion": "1",
                "rows": [],
            },
        )
        unknown = client.post(
            "/api/v1/strategy/ingest/andrety",
            headers={"Idempotency-Key": "unknown-target"},
            json={
                "targetSlug": "unknown",
                "sourceKey": "andrety-unknown",
                "displayName": "Guia Andrety",
                "sourceDate": "2026-07-13",
                "sourceVersion": "1",
                "rows": [],
            },
        )

    assert missing_key.status_code == 422
    assert unknown.status_code == 404
    assert unknown.json()["code"] == "strategy_target_not_found"
