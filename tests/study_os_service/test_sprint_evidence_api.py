from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime
import json
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from study_os_service.app import create_app
from study_os_service.config import StudyOsSettings
from study_os_service.db.connection import connect_database


EVIDENCE_IMPORT_PATH = "/api/v1/sprints/evidence/import"


def _client(tmp_path: Path) -> TestClient:
    return TestClient(create_app(StudyOsSettings.from_environment(tmp_path)))


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    with _client(tmp_path) as test_client:
        seeded = test_client.post(
            "/api/v1/planner/targets/seed",
            json={"targetSlugs": ["sefaz_ce"]},
        )
        assert seeded.status_code == 201
        bootstrapped = test_client.get(
            "/api/v1/sprints/config?targetSlug=sefaz_ce"
        )
        assert bootstrapped.status_code == 200
        yield test_client


def _observation(**overrides: Any) -> dict[str, Any]:
    observation: dict[str, Any] = {
        "discipline": "Economia",
        "topicHint": "Microeconomia",
        "observedOn": "2026-07-14",
        "sourceRecordId": "meta47-task12",
        "sourceRevision": "2026-07-14T10:00:00Z",
        "sourceUpdatedAt": "2026-07-14T10:00:00Z",
        "measurementType": "unseen_set",
        "examBoard": "FCC",
        "correctCount": 8,
        "wrongCount": 2,
        "doubtCount": 1,
        "percentageBp": 8000,
        "transferScope": "content",
        "transferabilityBp": 10000,
        "provenance": {
            "planningId": "119790",
            "metaNumber": 47,
            "sourceTaskId": "12",
        },
    }
    observation.update(overrides)
    return observation


def _batch(
    *,
    batch_id: str = "ls-meta47-v1",
    dry_run: bool = False,
    origin: str = "ls_history",
    observations: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    return {
        "targetSlug": "sefaz_ce",
        "batchId": batch_id,
        "origin": origin,
        "dryRun": dry_run,
        "observations": [_observation()] if observations is None else observations,
    }


def _import(client: TestClient, payload: dict[str, Any]):
    return client.post(EVIDENCE_IMPORT_PATH, json=payload)


def _list(client: TestClient, target_slug: str = "sefaz_ce"):
    return client.get(
        "/api/v1/sprints/evidence",
        params={"targetSlug": target_slug},
    )


def _stored_counts(client: TestClient) -> tuple[int, int]:
    connection = connect_database(client.app.state.settings.database_path)
    try:
        batches = connection.execute(
            "SELECT COUNT(*) FROM sprint_evidence_import_batches"
        ).fetchone()[0]
        observations = connection.execute(
            "SELECT COUNT(*) FROM sprint_performance_observations"
        ).fetchone()[0]
        return batches, observations
    finally:
        connection.close()


def test_economia_exact_alias_never_maps_to_financas_publicas(
    client: TestClient,
):
    response = _import(client, _batch())

    assert response.status_code == 201, response.text
    report = response.json()
    assert report["insertedCount"] == 1
    assert report["unresolvedCount"] == 0
    assert report["items"][0]["subjectKey"] == "p1_economia"


def test_ambiguous_approximate_alias_is_left_unresolved(client: TestClient):
    payload = _batch(
        batch_id="ambiguous-accounting",
        observations=[
            _observation(
                discipline="Contabilidade",
                topicHint="Conjunto transversal",
                sourceRecordId="ambiguous-accounting",
            )
        ],
    )

    response = _import(client, payload)

    assert response.status_code == 201, response.text
    report = response.json()
    assert report["insertedCount"] == 1
    assert report["unresolvedCount"] == 1
    assert report["items"][0]["subjectKey"] is None
    listed = _list(client).json()["items"]
    assert listed[0]["subjectKey"] is None


def test_dry_run_uses_real_validation_but_rolls_back_every_write(
    client: TestClient,
):
    response = _import(client, _batch(batch_id="preview-only", dry_run=True))

    assert response.status_code == 201, response.text
    report = response.json()
    assert report["dryRun"] is True
    assert report["replayed"] is False
    assert report["insertedCount"] == 1
    assert _list(client).json()["items"] == []
    assert _stored_counts(client) == (0, 0)


def test_dry_run_flag_is_not_part_of_the_batch_hash(
    client: TestClient,
):
    payload = _batch(batch_id="preview-then-commit", dry_run=True)

    preview = _import(client, payload)
    committed = _import(client, payload | {"dryRun": False})

    assert preview.status_code == 201, preview.text
    assert preview.json()["insertedCount"] == 1
    assert committed.status_code == 201, committed.text
    assert committed.json()["insertedCount"] == 1
    assert committed.json()["replayed"] is False
    assert _stored_counts(client) == (1, 1)


def test_real_import_replays_same_batch_without_a_second_write(
    client: TestClient,
):
    payload = _batch(batch_id="stable-replay")

    first = _import(client, payload)
    replay = _import(client, payload)

    assert first.status_code == 201, first.text
    assert first.json()["replayed"] is False
    assert first.json()["dryRun"] is False
    assert first.json()["insertedCount"] == 1
    assert replay.status_code == 201, replay.text
    assert replay.json() | {"replayed": False} == first.json()
    assert replay.json()["replayed"] is True
    assert _stored_counts(client) == (1, 1)


def test_dry_run_detects_a_stored_duplicate_without_saving_preview_batch(
    client: TestClient,
):
    first = _import(client, _batch(batch_id="stored-before-preview"))
    preview = _import(
        client,
        _batch(batch_id="duplicate-preview", dry_run=True),
    )

    assert first.status_code == 201, first.text
    assert preview.status_code == 201, preview.text
    assert preview.json()["dryRun"] is True
    assert preview.json()["insertedCount"] == 0
    assert preview.json()["duplicateCount"] == 1
    assert preview.json()["conflictCount"] == 0
    assert _stored_counts(client) == (1, 1)


def test_same_batch_id_with_a_different_payload_is_409(
    client: TestClient,
):
    first = _import(client, _batch(batch_id="stable-batch"))
    changed = _import(
        client,
        _batch(
            batch_id="stable-batch",
            observations=[
                _observation(
                    sourceRevision="2026-07-14T11:00:00Z",
                    sourceUpdatedAt="2026-07-14T11:00:00Z",
                )
            ],
        ),
    )

    assert first.status_code == 201, first.text
    assert changed.status_code == 409
    assert changed.json()["code"] == "evidence_batch_conflict"
    assert _stored_counts(client) == (1, 1)


def test_same_source_revision_in_another_batch_is_reported_as_duplicate(
    client: TestClient,
):
    first = _import(client, _batch(batch_id="duplicate-a"))
    duplicate = _import(client, _batch(batch_id="duplicate-b"))

    assert first.status_code == 201, first.text
    assert duplicate.status_code == 201, duplicate.text
    assert duplicate.json()["insertedCount"] == 0
    assert duplicate.json()["duplicateCount"] == 1
    assert duplicate.json()["conflictCount"] == 0
    assert _stored_counts(client) == (2, 1)


def test_same_source_revision_with_changed_aggregate_is_a_conflict(
    client: TestClient,
):
    first = _import(client, _batch(batch_id="conflict-a"))
    conflict = _import(
        client,
        _batch(
            batch_id="conflict-b",
            observations=[
                _observation(correctCount=7, wrongCount=3, percentageBp=7000)
            ],
        ),
    )

    assert first.status_code == 201, first.text
    assert conflict.status_code == 201, conflict.text
    assert conflict.json()["insertedCount"] == 0
    assert conflict.json()["duplicateCount"] == 0
    assert conflict.json()["conflictCount"] == 1
    assert _stored_counts(client) == (2, 1)


def test_duplicate_identity_inside_one_batch_is_counted_without_integrity_error(
    client: TestClient,
):
    observation = _observation()
    response = _import(
        client,
        _batch(
            batch_id="internal-duplicate",
            observations=[observation, dict(observation)],
        ),
    )

    assert response.status_code == 201, response.text
    assert response.json()["insertedCount"] == 1
    assert response.json()["duplicateCount"] == 1
    assert response.json()["conflictCount"] == 0
    assert len(response.json()["items"]) == 2
    assert _stored_counts(client) == (1, 1)


def test_changed_identity_inside_one_batch_is_counted_as_conflict(
    client: TestClient,
):
    response = _import(
        client,
        _batch(
            batch_id="internal-conflict",
            observations=[
                _observation(),
                _observation(
                    correctCount=6,
                    wrongCount=4,
                    percentageBp=6000,
                ),
            ],
        ),
    )

    assert response.status_code == 201, response.text
    assert response.json()["insertedCount"] == 1
    assert response.json()["duplicateCount"] == 0
    assert response.json()["conflictCount"] == 1
    assert len(response.json()["items"]) == 2
    assert _stored_counts(client) == (1, 1)


def test_get_evidence_returns_the_auditable_aggregate_ledger(
    client: TestClient,
):
    imported = _import(client, _batch(batch_id="auditable-ledger"))
    response = _list(client)

    assert imported.status_code == 201, imported.text
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["targetSlug"] == "sefaz_ce"
    assert len(payload["items"]) == 1
    item = payload["items"][0]
    assert item["id"] > 0
    assert item["batchId"] == "auditable-ledger"
    assert item["subjectKey"] == "p1_economia"
    assert item["discipline"] == "Economia"
    assert item["topicHint"] == "Microeconomia"
    assert item["observedOn"] == "2026-07-14"
    assert item["origin"] == "ls_history"
    assert item["sourceRecordId"] == "meta47-task12"
    assert item["sourceRevision"] == "2026-07-14T10:00:00Z"
    source_updated_at = datetime.fromisoformat(
        item["sourceUpdatedAt"].replace("Z", "+00:00")
    )
    assert source_updated_at == datetime(2026, 7, 14, 10, tzinfo=UTC)
    assert item["measurementType"] == "unseen_set"
    assert item["examBoard"] == "FCC"
    assert item["correctCount"] == 8
    assert item["wrongCount"] == 2
    assert item["doubtCount"] == 1
    assert item["percentageBp"] == 8000
    assert item["transferScope"] == "content"
    assert item["transferabilityBp"] == 10000
    assert len(item["contentHash"]) == 64
    assert item["provenance"] == {
        "planningId": "119790",
        "metaNumber": 47,
        "sourceTaskId": "12",
    }
    encoded = json.dumps(payload)
    assert "statement" not in encoded
    assert "alternatives" not in encoded
    assert "correctAnswer" not in encoded
    assert '"answer"' not in encoded


@pytest.mark.parametrize(
    ("extra_key", "extra_value"),
    [
        ("statement", "proprietary question"),
        ("alternatives", ["secret A", "secret B"]),
        ("correctAnswer", "A"),
        ("answer", "B"),
        ("benignNote", "extras are not allowlisted"),
    ],
)
def test_observation_rejects_every_non_allowlisted_top_level_key_and_rolls_back(
    client: TestClient,
    extra_key: str,
    extra_value: Any,
):
    observation = _observation()
    observation[extra_key] = extra_value

    response = _import(
        client,
        _batch(batch_id=f"rejected-{extra_key}", observations=[observation]),
    )

    assert response.status_code == 422
    assert response.json()["code"] == "invalid_sprint_evidence"
    assert _stored_counts(client) == (0, 0)


@pytest.mark.parametrize(
    "provenance",
    [
        {"note": "unknown keys remain forbidden"},
        {"provider": {"name": "LS"}},
        {"provider": ["LS"]},
        {"provider": "LS\nquestion content"},
        {"provider": "x" * 201},
    ],
)
def test_provenance_requires_allowlisted_flat_bounded_single_line_scalars(
    client: TestClient,
    provenance: dict[str, Any],
):
    response = _import(
        client,
        _batch(
            batch_id="rejected-provenance",
            observations=[_observation(provenance=provenance)],
        ),
    )

    assert response.status_code == 422
    assert response.json()["code"] == "invalid_sprint_evidence"
    assert _stored_counts(client) == (0, 0)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("discipline", "Economia\nconteudo indevido"),
        ("discipline", "x" * 121),
        ("topicHint", "Microeconomia\rconteudo indevido"),
        ("topicHint", "x" * 201),
    ],
)
def test_text_fields_are_bounded_and_single_line(
    client: TestClient,
    field: str,
    value: str,
):
    response = _import(
        client,
        _batch(
            batch_id=f"rejected-{field}",
            observations=[_observation(**{field: value})],
        ),
    )

    assert response.status_code == 422
    assert response.json()["code"] == "invalid_sprint_evidence"
    assert _stored_counts(client) == (0, 0)


def test_import_and_list_return_existing_target_error_contracts(
    client: TestClient,
):
    payload = _batch(batch_id="unknown-target")
    payload["targetSlug"] = "target_that_does_not_exist"

    imported = _import(client, payload)
    listed = _list(client, "target_that_does_not_exist")

    assert imported.status_code == 404
    assert imported.json()["code"] == "sprint_target_not_found"
    assert listed.status_code == 404
    assert listed.json()["code"] == "sprint_target_not_found"
    assert _stored_counts(client) == (0, 0)


def test_invalid_batch_returns_stable_422_error_without_writes(
    client: TestClient,
):
    payload = _batch(batch_id="missing-origin")
    del payload["origin"]

    response = _import(client, payload)

    assert response.status_code == 422
    assert response.json()["code"] == "invalid_sprint_evidence"
    assert _stored_counts(client) == (0, 0)


def test_batch_rejects_non_allowlisted_top_level_keys(client: TestClient):
    payload = _batch(batch_id="batch-extra")
    payload["note"] = "must not enter the aggregate ledger"

    response = _import(client, payload)

    assert response.status_code == 422
    assert response.json()["code"] == "invalid_sprint_evidence"
    assert _stored_counts(client) == (0, 0)
