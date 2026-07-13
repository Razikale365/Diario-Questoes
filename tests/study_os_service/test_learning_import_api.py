from pathlib import Path
import sqlite3

from fastapi.testclient import TestClient

from study_os_service.app import create_app
from study_os_service.config import StudyOsSettings


def test_imports_exact_aggregate_rows_and_reports_unmapped_topics(tmp_path: Path):
    settings = StudyOsSettings.from_environment(tmp_path)
    with TestClient(create_app(settings)) as client:
        client.post(
            "/api/v1/planner/targets/seed",
            json={"targetSlugs": ["bacen_economia_financas"]},
        )
        topics = client.get(
            "/api/v1/planner/topics?targetSlug=bacen_economia_financas"
        ).json()["items"]
        macro = topics[0]
        payload = {
            "targetSlug": "bacen_economia_financas",
            "batchId": "legacy-batch-1",
            "items": [
                {
                    "sourceItemId": "group-1",
                    "targetTopicId": macro["id"],
                    "discipline": macro["discipline"],
                    "topic": macro["topic"],
                    "eventKind": "questions",
                    "occurredAt": "2026-07-10T12:00:00Z",
                    "sourceDate": "2026-07-10",
                    "questionsDone": 20,
                    "correctCount": 15,
                    "wrongCount": 5,
                    "doubtCount": 2,
                    "favoriteCount": 1,
                },
                {
                    "sourceItemId": "group-2",
                    "discipline": topics[1]["discipline"],
                    "topic": topics[1]["topic"],
                    "eventKind": "questions",
                    "occurredAt": "2026-07-11T12:00:00Z",
                    "sourceDate": "2026-07-11",
                    "questionsDone": 10,
                    "correctCount": 8,
                    "wrongCount": 2,
                    "doubtCount": 0,
                    "favoriteCount": 0,
                },
                {
                    "sourceItemId": "unmapped",
                    "discipline": "Disciplina inexistente",
                    "topic": "Topico inexistente",
                    "eventKind": "questions",
                    "occurredAt": "2026-07-11T12:00:00Z",
                    "questionsDone": 5,
                    "correctCount": 2,
                    "wrongCount": 3,
                    "doubtCount": 0,
                    "favoriteCount": 0,
                },
            ],
        }
        imported = client.post(
            "/api/v1/learning/import-aggregates",
            headers={"Idempotency-Key": "legacy-import-1"},
            json=payload,
        )
        replayed = client.post(
            "/api/v1/learning/import-aggregates",
            headers={"Idempotency-Key": "legacy-import-1"},
            json=payload,
        )

    assert imported.status_code == 200
    assert imported.json()["importedCount"] == 2
    assert imported.json()["rejectedCount"] == 1
    assert imported.json()["rejected"][0]["code"] == "topic_unmapped"
    assert replayed.json() == imported.json()
    with sqlite3.connect(settings.database_path) as connection:
        connection.row_factory = sqlite3.Row
        events = connection.execute(
            "SELECT * FROM learning_events WHERE source_kind='legacy_aggregate'"
        ).fetchall()
        assert len(events) == 2
        assert all("statement" not in row["evidence_json"].lower() for row in events)
        assert connection.execute(
            "SELECT COUNT(*) FROM learning_import_runs"
        ).fetchone()[0] == 1


def test_import_rejects_proprietary_fields_and_rolls_back(tmp_path: Path):
    settings = StudyOsSettings.from_environment(tmp_path)
    with TestClient(create_app(settings)) as client:
        client.post(
            "/api/v1/planner/targets/seed",
            json={"targetSlugs": ["bacen_economia_financas"]},
        )
        topic = client.get(
            "/api/v1/planner/topics?targetSlug=bacen_economia_financas"
        ).json()["items"][0]
        rejected = client.post(
            "/api/v1/learning/import-aggregates",
            headers={"Idempotency-Key": "proprietary-import"},
            json={
                "targetSlug": "bacen_economia_financas",
                "batchId": "bad-batch",
                "items": [{
                    "sourceItemId": "bad-1",
                    "targetTopicId": topic["id"],
                    "discipline": topic["discipline"],
                    "topic": topic["topic"],
                    "eventKind": "questions",
                    "occurredAt": "2026-07-10T12:00:00Z",
                    "questionsDone": 1,
                    "correctCount": 1,
                    "wrongCount": 0,
                    "doubtCount": 0,
                    "favoriteCount": 0,
                    "statement": "conteudo que nao pode cruzar",
                }],
            },
        )

    assert rejected.status_code == 400
    assert rejected.json()["code"] == "invalid_learning_import"
    with sqlite3.connect(settings.database_path) as connection:
        assert connection.execute(
            "SELECT COUNT(*) FROM learning_events"
        ).fetchone()[0] == 0
        assert connection.execute(
            "SELECT COUNT(*) FROM learning_import_runs"
        ).fetchone()[0] == 0


def test_import_key_reuse_with_changed_counts_is_conflict(tmp_path: Path):
    settings = StudyOsSettings.from_environment(tmp_path)
    with TestClient(create_app(settings)) as client:
        client.post(
            "/api/v1/planner/targets/seed",
            json={"targetSlugs": ["bacen_economia_financas"]},
        )
        topic = client.get(
            "/api/v1/planner/topics?targetSlug=bacen_economia_financas"
        ).json()["items"][0]
        item = {
            "sourceItemId": "same-group",
            "targetTopicId": topic["id"],
            "discipline": topic["discipline"],
            "topic": topic["topic"],
            "eventKind": "questions",
            "occurredAt": "2026-07-10T12:00:00Z",
            "questionsDone": 10,
            "correctCount": 8,
            "wrongCount": 2,
            "doubtCount": 0,
            "favoriteCount": 0,
        }
        first = client.post(
            "/api/v1/learning/import-aggregates",
            headers={"Idempotency-Key": "same-import-key"},
            json={"targetSlug": "bacen_economia_financas", "items": [item]},
        )
        conflict = client.post(
            "/api/v1/learning/import-aggregates",
            headers={"Idempotency-Key": "same-import-key"},
            json={
                "targetSlug": "bacen_economia_financas",
                "items": [{**item, "correctCount": 7, "wrongCount": 3}],
            },
        )

    assert first.status_code == 200
    assert conflict.status_code == 409
    assert conflict.json()["code"] == "learning_import_conflict"
