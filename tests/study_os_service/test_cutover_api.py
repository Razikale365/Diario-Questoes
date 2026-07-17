from __future__ import annotations

from copy import deepcopy
import json
from pathlib import Path

from fastapi.testclient import TestClient

from study_os_service.app import create_app
from study_os_service.config import StudyOsSettings


FIXTURE = (
    Path(__file__).parent
    / "fixtures"
    / "cutover"
    / "browser_bundle_v1.json"
)


def _client(tmp_path: Path) -> TestClient:
    return TestClient(create_app(StudyOsSettings.from_environment(tmp_path)))


def _bundle() -> dict:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def test_cutover_status_is_safe_when_command_layer_is_empty(tmp_path: Path):
    with _client(tmp_path) as client:
        response = client.get("/api/v1/cutover/status")

    assert response.status_code == 200
    assert response.json() == {
        "schemaVersion": 13,
        "ownership": "sqlite",
        "activeTarget": None,
        "migrations": [],
        "legacyMappingCount": 0,
    }


def test_active_target_preference_updates_and_rejects_stale_version(tmp_path: Path):
    with _client(tmp_path) as client:
        seeded = client.post(
            "/api/v1/planner/targets/seed",
            json={"targetSlugs": ["rfb_auditor", "bacen_economia_financas"]},
        )
        assert seeded.status_code == 201
        initial = client.get("/api/v1/cutover/status").json()["activeTarget"]
        replacement = (
            "rfb_auditor"
            if initial["targetSlug"] != "rfb_auditor"
            else "bacen_economia_financas"
        )
        saved = client.put(
            "/api/v1/preferences/active-target",
            json={"targetSlug": replacement, "version": initial["version"]},
        )
        stale = client.put(
            "/api/v1/preferences/active-target",
            json={"targetSlug": initial["targetSlug"], "version": initial["version"]},
        )

    assert saved.status_code == 200
    assert saved.json()["targetSlug"] == replacement
    assert saved.json()["version"] == initial["version"] + 1
    assert saved.json()["updatedAt"].endswith("Z")
    assert stale.status_code == 409
    assert stale.json() == {
        "code": "stale_active_target",
        "message": "active target preference has changed",
    }


def test_browser_migration_imports_replays_and_reports_only_safe_metadata(
    tmp_path: Path,
):
    value = _bundle()
    reordered = {key: value[key] for key in reversed(value)}
    with _client(tmp_path) as client:
        first = client.post(
            "/api/v1/cutover/browser-migration",
            headers={"Idempotency-Key": "browser-cutover:api-a1"},
            json=value,
        )
        replay = client.post(
            "/api/v1/cutover/browser-migration",
            headers={"Idempotency-Key": "browser-cutover:api-a1"},
            json=reordered,
        )
        status = client.get("/api/v1/cutover/status")

    assert first.status_code == 201
    assert replay.status_code == 201
    assert replay.json() == first.json()
    body = first.json()
    assert set(body) == {"migration", "report"}
    assert body["migration"]["state"] == "completed"
    assert body["migration"]["payloadHash"]
    assert body["report"]["legacyIdsRecorded"] == 5
    assert "targetProfiles" not in json.dumps(body)
    status_body = status.json()
    assert status_body["activeTarget"]["targetSlug"] == "rfb_auditor"
    assert status_body["legacyMappingCount"] == 5
    assert status_body["migrations"] == [body["migration"]]


def test_browser_migration_rejects_changed_replay(tmp_path: Path):
    value = _bundle()
    changed = deepcopy(value)
    changed["targetProfiles"][0]["priorityScore"] = 89
    with _client(tmp_path) as client:
        assert client.post(
            "/api/v1/cutover/browser-migration",
            headers={"Idempotency-Key": "browser-cutover:api-conflict"},
            json=value,
        ).status_code == 201
        conflict = client.post(
            "/api/v1/cutover/browser-migration",
            headers={"Idempotency-Key": "browser-cutover:api-conflict"},
            json=changed,
        )

    assert conflict.status_code == 409
    assert conflict.json()["code"] == "migration_replay_conflict"
    assert "priorityScore" not in conflict.json()["message"]


def test_browser_migration_returns_structured_sanitized_validation_errors(
    tmp_path: Path,
):
    secret = "do-not-echo-this-paid-question"
    invalid = _bundle()
    invalid["sourceSignals"][0]["metadata"]["question"] = secret
    with _client(tmp_path) as client:
        missing_key = client.post(
            "/api/v1/cutover/browser-migration",
            json=_bundle(),
        )
        bad_shape = client.post(
            "/api/v1/cutover/browser-migration",
            headers={"Idempotency-Key": "browser-cutover:bad-shape"},
            json=[],
        )
        rejected = client.post(
            "/api/v1/cutover/browser-migration",
            headers={"Idempotency-Key": "browser-cutover:secret"},
            json=invalid,
        )

    assert missing_key.status_code == 422
    assert missing_key.json()["code"] == "missing_idempotency_key"
    assert bad_shape.status_code == 422
    assert bad_shape.json()["code"] == "invalid_browser_migration"
    assert rejected.status_code == 422
    assert rejected.json()["code"] == "invalid_browser_migration"
    assert secret not in rejected.text


def test_active_target_preference_rejects_unknown_fields_and_missing_target(
    tmp_path: Path,
):
    with _client(tmp_path) as client:
        malformed = client.put(
            "/api/v1/preferences/active-target",
            json={"targetSlug": "rfb_auditor", "version": 1, "extra": True},
        )
        missing = client.put(
            "/api/v1/preferences/active-target",
            json={"targetSlug": "rfb_auditor", "version": 1},
        )

    assert malformed.status_code == 422
    assert malformed.json()["code"] == "invalid_active_target_preference"
    assert missing.status_code == 404
    assert missing.json()["code"] == "active_target_not_found"
