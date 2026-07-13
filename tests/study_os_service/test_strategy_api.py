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


def test_strategy_workbench_lists_unresolved_items_and_missing_package(tmp_path: Path):
    with _client(tmp_path) as client:
        _seed_and_topic(client)
        payload = _tec_payload(999)
        payload["cadernos"][0].pop("targetTopicId")
        payload["cadernos"][0]["topicHint"] = "Tema sem correspondencia"
        ingested = client.post(
            "/api/v1/strategy/ingest/tec",
            headers={"Idempotency-Key": "tec-workbench-unresolved"},
            json=payload,
        )
        workbench = client.get(
            "/api/v1/strategy/workbench?targetSlug=rfb_auditor"
        )

    assert ingested.status_code == 201
    assert ingested.json()["unresolvedCount"] == 1
    assert workbench.status_code == 200
    body = workbench.json()
    assert body["targetSlug"] == "rfb_auditor"
    assert body["packageStatus"] == {
        "state": "missing",
        "rootId": None,
        "packageName": None,
        "packageId": None,
        "downloadStatus": None,
        "manifestPath": None,
        "expectedFileCount": None,
        "observedFileCount": None,
        "failedItemCount": None,
        "validated": False,
    }
    assert len(body["items"]) == 1
    item = body["items"][0]
    assert item["sourceKind"] == "tec"
    assert item["topicHint"] == "Tema sem correspondencia"
    assert item["mappings"] == []
    assert item["resolutionState"] == "unresolved"


def test_strategy_api_saves_manual_mapping_and_rejects_stale_version(tmp_path: Path):
    with _client(tmp_path) as client:
        topic_id = _seed_and_topic(client)
        payload = _tec_payload(topic_id)
        ingested = client.post(
            "/api/v1/strategy/ingest/tec",
            headers={"Idempotency-Key": "tec-manual-mapping"},
            json=payload,
        )
        assert ingested.status_code == 201
        workbench = client.get(
            "/api/v1/strategy/workbench?targetSlug=rfb_auditor"
        ).json()
        item = workbench["items"][0]
        mapping = item["mappings"][0]
        update = {
            "targetSlug": "rfb_auditor",
            "targetTopicId": topic_id,
            "expectedVersion": mapping["version"],
            "expectedSourceVersion": item["sourceVersion"],
            "sourceTrustTier": 6,
            "mappingStatus": "approved",
            "transferKind": "target_specific",
            "confidenceBp": 10000,
            "primaryEligible": False,
            "notes": "Confirmado manualmente no edital do alvo.",
        }
        saved = client.put(
            f'/api/v1/strategy/source-items/{item["sourceItemId"]}/mapping',
            json=update,
        )
        stale = client.put(
            f'/api/v1/strategy/source-items/{item["sourceItemId"]}/mapping',
            json=update,
        )
        stale_source = client.put(
            f'/api/v1/strategy/source-items/{item["sourceItemId"]}/mapping',
            json={**update, "expectedVersion": saved.json()["version"]},
        )
        refreshed = client.get(
            "/api/v1/strategy/workbench?targetSlug=rfb_auditor"
        ).json()["items"][0]

    assert saved.status_code == 200
    assert saved.json()["manualOverride"] is True
    assert saved.json()["version"] == mapping["version"] + 1
    assert stale.status_code == 409
    assert stale.json()["code"] == "stale_strategy_mapping"
    assert stale_source.status_code == 409
    assert stale_source.json()["code"] == "stale_strategy_source"
    assert refreshed["resolutionState"] == "approved"
    assert refreshed["trustTier"] == 6
    assert refreshed["sourceVersion"] == item["sourceVersion"] + 1
    assert refreshed["mappings"][0]["version"] == saved.json()["version"]
    assert refreshed["mappings"][0]["notes"].startswith("Confirmado")


def test_strategy_api_blocks_blind_cross_target_mapping(tmp_path: Path):
    with _client(tmp_path) as client:
        rfb_topic_id = _seed_and_topic(client)
        client.post(
            "/api/v1/planner/targets/seed",
            json={"targetSlugs": ["bacen_economia_financas"]},
        )
        bacen_topic_id = client.get(
            "/api/v1/planner/topics?targetSlug=bacen_economia_financas"
        ).json()["items"][0]["id"]
        payload = _tec_payload(rfb_topic_id)
        ingested = client.post(
            "/api/v1/strategy/ingest/tec",
            headers={"Idempotency-Key": "tec-cross-target"},
            json=payload,
        )
        assert ingested.status_code == 201
        source_item_id = client.get(
            "/api/v1/strategy/workbench?targetSlug=rfb_auditor"
        ).json()["items"][0]["sourceItemId"]
        blocked = client.put(
            f"/api/v1/strategy/source-items/{source_item_id}/mapping",
            json={
                "targetSlug": "bacen_economia_financas",
                "targetTopicId": bacen_topic_id,
                "expectedVersion": 0,
                "expectedSourceVersion": 1,
                "sourceTrustTier": 8,
                "mappingStatus": "approved",
                "transferKind": "target_specific",
                "confidenceBp": 9000,
                "primaryEligible": False,
                "notes": "",
            },
        )

    assert blocked.status_code == 422
    assert blocked.json()["code"] == "invalid_strategy_mapping"
    assert "cross-target" in blocked.json()["message"]
