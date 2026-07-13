from pathlib import Path
from threading import Event

from fastapi.testclient import TestClient

from study_os_service.app import create_app
import study_os_service.api.inventory as inventory_api
from study_os_service.config import StudyOsSettings
from study_os_service.ingest.course_scanner import scan_course_root
from tests.study_os_service.inventory_api_fixture import (
    make_validated_api_choice,
    register_api_root,
    wait_for_scan,
)


def test_setup_status_is_safe_before_any_package_is_registered(tmp_path: Path):
    app = create_app(StudyOsSettings.from_environment(tmp_path))

    with TestClient(app) as client:
        response = client.get("/api/v1/setup/status")

    assert response.status_code == 200
    assert response.json() == {
        "configuredRoots": 0,
        "activeScans": 0,
        "courseCount": 0,
        "materialCount": 0,
        "needsPackageSetup": True,
    }


def test_root_registration_is_idempotent_and_invalid_metadata_is_structured(tmp_path: Path):
    app = create_app(StudyOsSettings.from_environment(tmp_path))
    choice = make_validated_api_choice(tmp_path)

    with TestClient(app) as client:
        first = client.post("/api/v1/course-roots", json=choice.to_dict())
        second = client.post("/api/v1/course-roots", json=choice.to_dict())
        invalid = client.post(
            "/api/v1/course-roots",
            json=choice.to_dict() | {"packageUrl": "file:///stale"},
        )
        roots = client.get("/api/v1/course-roots?targetSlug=rfb_auditor")

    assert first.status_code == 201
    assert second.status_code == 201
    assert second.json()["id"] == first.json()["id"]
    assert roots.status_code == 200
    assert len(roots.json()["items"]) == 1
    assert invalid.status_code == 422
    assert invalid.json() == {
        "code": "invalid_course_root",
        "message": "package URL must be HTTP or HTTPS",
    }


def test_root_registration_can_read_downloader_manifest_from_minimal_input(tmp_path: Path):
    app = create_app(StudyOsSettings.from_environment(tmp_path))
    choice = make_validated_api_choice(tmp_path)

    with TestClient(app) as client:
        response = client.post(
            "/api/v1/course-roots",
            json={"targetSlug": "rfb_auditor", "rootPath": str(choice.root_path)},
        )

    assert response.status_code == 201
    assert response.json()["packageId"] == "249654"
    assert response.json()["packageName"] == "RFB Auditor Pacotaco"
    assert response.json()["downloadStatus"] == "validated"
    assert response.json()["observedFileCount"] == 9


def test_generate_scan_returns_immediately_and_deduplicates_active_root(tmp_path: Path):
    app = create_app(StudyOsSettings.from_environment(tmp_path))
    choice = make_validated_api_choice(tmp_path)
    entered = Event()
    release = Event()

    def blocking_scanner(*args):
        entered.set()
        assert release.wait(3)
        return scan_course_root(*args)

    with TestClient(app) as client:
        root_id = register_api_root(client, choice)
        app.state.inventory_scanner = blocking_scanner
        first = client.post("/api/v1/scans", json={"rootId": root_id})
        assert entered.wait(1)
        second = client.post("/api/v1/scans", json={"rootId": root_id})
        release.set()
        completed = wait_for_scan(client, first.json()["id"])

    assert first.status_code == 202
    assert second.status_code == 202
    assert second.json()["id"] == first.json()["id"]
    assert completed["state"] == "completed"
    assert completed["discoveredCount"] == 9


def test_scan_exposes_target_scoped_courses_lessons_and_manual_mapping(tmp_path: Path):
    app = create_app(StudyOsSettings.from_environment(tmp_path))
    choice = make_validated_api_choice(tmp_path)

    with TestClient(app) as client:
        root_id = register_api_root(client, choice)
        run = client.post("/api/v1/scans", json={"rootId": root_id}).json()
        assert wait_for_scan(client, run["id"])["state"] == "completed"
        courses = client.get("/api/v1/courses?targetSlug=rfb_auditor").json()
        economy = next(
            item
            for item in courses["items"]
            if item["displayName"] == "Economia e Financas Publicas"
        )
        wrong_target = client.get(
            f"/api/v1/courses/{economy['id']}/lessons?targetSlug=bacen_economia_financas"
        )
        lessons = client.get(
            f"/api/v1/courses/{economy['id']}/lessons?targetSlug=rfb_auditor&limit=10&offset=0"
        ).json()
        lesson_id = lessons["items"][0]["id"]
        mapped = client.put(
            f"/api/v1/lessons/{lesson_id}/mapping",
            json={
                "targetSlug": "rfb_auditor",
                "disciplineName": "Economia Aplicada",
                "title": "Aula 01 - Politica fiscal",
            },
        )
        lesson = client.get(
            f"/api/v1/lessons/{lesson_id}?targetSlug=rfb_auditor"
        )

    assert courses["total"] == 4
    assert economy["lessonCount"] == 1
    assert economy["materialCount"] == 6
    assert wrong_target.status_code == 404
    assert lessons["total"] == 1
    assert mapped.status_code == 200
    assert lesson.json()["title"] == "Aula 01 - Politica fiscal"
    assert lesson.json()["disciplineName"] == "Economia Aplicada"
    assert lesson.json()["mappingSource"] == "manual"


def test_scan_submission_rejects_unknown_root_with_top_level_error(tmp_path: Path):
    app = create_app(StudyOsSettings.from_environment(tmp_path))

    with TestClient(app) as client:
        response = client.post("/api/v1/scans", json={"rootId": 999})

    assert response.status_code == 404
    assert response.json() == {
        "code": "course_root_not_found",
        "message": "Course root 999 was not found",
    }


def test_scan_worker_bootstrap_failure_is_persisted(
    tmp_path: Path, monkeypatch
):
    app = create_app(StudyOsSettings.from_environment(tmp_path))
    choice = make_validated_api_choice(tmp_path)

    def fail_to_connect(*_args, **_kwargs):
        raise OSError("worker database unavailable")

    with TestClient(app) as client:
        root_id = register_api_root(client, choice)
        monkeypatch.setattr(inventory_api, "connect_database", fail_to_connect)
        response = client.post("/api/v1/scans", json={"rootId": root_id})
        failed = wait_for_scan(client, response.json()["id"], timeout=1.0)

    assert response.status_code == 202
    assert failed["state"] == "failed"
    assert failed["errorMessage"] == "worker database unavailable"


def test_strategy_map_bridges_scanned_inventory_idempotently(tmp_path: Path):
    app = create_app(StudyOsSettings.from_environment(tmp_path))
    choice = make_validated_api_choice(tmp_path)

    with TestClient(app) as client:
        seeded = client.post(
            "/api/v1/planner/targets/seed",
            json={"targetSlugs": ["rfb_auditor"]},
        )
        root_id = register_api_root(client, choice)
        run = client.post("/api/v1/scans", json={"rootId": root_id}).json()
        assert wait_for_scan(client, run["id"])["state"] == "completed"

        first = client.post(
            f"/api/v1/course-roots/{root_id}/strategy-map",
            json={"targetSlug": "rfb_auditor"},
        )
        second = client.post(
            f"/api/v1/course-roots/{root_id}/strategy-map",
            json={"targetSlug": "rfb_auditor"},
        )

    assert seeded.status_code == 201
    assert first.status_code == 200
    assert first.json() == second.json()
    assert first.json() == {
        "rootId": root_id,
        "targetSlug": "rfb_auditor",
        "sourceIds": first.json()["sourceIds"],
        "runIds": first.json()["runIds"],
        "discoveredCount": 2,
        "mappedCount": 0,
        "unresolvedCount": 2,
        "algorithmVersion": "m6-course-map-v1",
    }
    assert len(first.json()["sourceIds"]) == 2
    assert len(first.json()["runIds"]) == 2


def test_strategy_map_reports_root_package_and_target_errors(tmp_path: Path):
    app = create_app(StudyOsSettings.from_environment(tmp_path))
    choice = make_validated_api_choice(tmp_path)
    unvalidated_dir = tmp_path / "unvalidated"
    unvalidated_dir.mkdir()
    unvalidated_choice = make_validated_api_choice(unvalidated_dir)

    with TestClient(app) as client:
        client.post(
            "/api/v1/planner/targets/seed",
            json={"targetSlugs": ["rfb_auditor"]},
        )
        missing_root = client.post(
            "/api/v1/course-roots/999/strategy-map",
            json={"targetSlug": "rfb_auditor"},
        )
        validated_id = register_api_root(client, choice)
        unvalidated_id = register_api_root(
            client,
            type(unvalidated_choice).from_dict(
                unvalidated_choice.to_dict() | {"downloadStatus": "downloaded"}
            ),
        )
        before_scan = client.post(
            f"/api/v1/course-roots/{validated_id}/strategy-map",
            json={"targetSlug": "rfb_auditor"},
        )
        not_ready = client.post(
            f"/api/v1/course-roots/{unvalidated_id}/strategy-map",
            json={"targetSlug": "rfb_auditor"},
        )
        unknown_target = client.post(
            f"/api/v1/course-roots/{validated_id}/strategy-map",
            json={"targetSlug": "target_inexistente"},
        )
        malformed = client.post(
            f"/api/v1/course-roots/{validated_id}/strategy-map",
            json={"topicAliases": []},
        )

    assert missing_root.status_code == 404
    assert missing_root.json() == {
        "code": "course_root_not_found",
        "message": "Course root 999 was not found",
    }
    assert not_ready.status_code == 409
    assert not_ready.json() == {
        "code": "course_mapping_not_ready",
        "message": "course mapping requires a validated fresh package",
    }
    assert before_scan.status_code == 409
    assert before_scan.json() == {
        "code": "course_mapping_not_ready",
        "message": "course root must have a completed scan before mapping",
    }
    assert unknown_target.status_code == 404
    assert unknown_target.json() == {
        "code": "target_profile_not_found",
        "message": "Target target_inexistente was not found",
    }
    assert malformed.status_code == 422
    assert malformed.json() == {
        "code": "invalid_course_mapping",
        "message": "topicAliases must be an object keyed by positive integer IDs",
    }
