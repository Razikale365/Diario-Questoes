from pathlib import Path

from fastapi.testclient import TestClient

from study_os_service.app import create_app
from study_os_service.config import StudyOsSettings
from study_os_service.db.connection import connect_database
from tests.study_os_service.inventory_api_fixture import (
    make_validated_api_choice,
    register_api_root,
    wait_for_scan,
)


def test_material_file_is_resolved_by_id_inline_and_supports_ranges(tmp_path: Path):
    app = create_app(StudyOsSettings.from_environment(tmp_path))
    choice = make_validated_api_choice(tmp_path)
    original = choice.root_path / "Economia e Financas Publicas" / "PDF" / "Aula 01_Apostila.pdf"
    original.write_bytes(b"%PDF-1.7\nfixture-payload")

    with TestClient(app) as client:
        root_id = register_api_root(client, choice)
        run_id = client.post("/api/v1/scans", json={"rootId": root_id}).json()["id"]
        assert wait_for_scan(client, run_id)["state"] == "completed"
        courses = client.get("/api/v1/courses?targetSlug=rfb_auditor").json()["items"]
        economy = next(
            item for item in courses if item["displayName"] == "Economia e Financas Publicas"
        )
        lesson = client.get(
            f"/api/v1/courses/{economy['id']}/lessons?targetSlug=rfb_auditor"
        ).json()["items"][0]
        detail = client.get(
            f"/api/v1/lessons/{lesson['id']}?targetSlug=rfb_auditor"
        ).json()
        material = next(item for item in detail["materials"] if item["kind"] == "original")
        full = client.get(
            f"/api/v1/materials/{material['id']}/file?targetSlug=rfb_auditor"
        )
        partial = client.get(
            f"/api/v1/materials/{material['id']}/file?targetSlug=rfb_auditor",
            headers={"Range": "bytes=0-4"},
        )
        wrong_target = client.get(
            f"/api/v1/materials/{material['id']}/file?targetSlug=bacen_economia_financas"
        )

    assert full.status_code == 200
    assert full.content.startswith(b"%PDF-")
    assert full.headers["content-type"].startswith("application/pdf")
    assert full.headers["content-disposition"].startswith("inline")
    assert partial.status_code == 206
    assert partial.content == b"%PDF-"
    assert wrong_target.status_code == 404


def test_material_file_rechecks_path_containment_and_availability(tmp_path: Path):
    app = create_app(StudyOsSettings.from_environment(tmp_path))
    choice = make_validated_api_choice(tmp_path)

    with TestClient(app) as client:
        root_id = register_api_root(client, choice)
        run_id = client.post("/api/v1/scans", json={"rootId": root_id}).json()["id"]
        assert wait_for_scan(client, run_id)["state"] == "completed"
        test_connection = connect_database(app.state.settings.database_path)
        try:
            material_id = test_connection.execute(
                "SELECT id FROM materials ORDER BY id LIMIT 1"
            ).fetchone()[0]
            test_connection.execute(
                "UPDATE materials SET absolute_path=?, available=1 WHERE id=?",
                (str((tmp_path / "outside.pdf").resolve()), material_id),
            )
        finally:
            test_connection.close()
        escaped = client.get(f"/api/v1/materials/{material_id}/file")
        test_connection = connect_database(app.state.settings.database_path)
        try:
            test_connection.execute(
                "UPDATE materials SET available=0 WHERE id=?", (material_id,)
            )
        finally:
            test_connection.close()
        unavailable = client.get(f"/api/v1/materials/{material_id}/file")

    assert escaped.status_code == 409
    assert escaped.json()["code"] == "material_path_invalid"
    assert unavailable.status_code == 404
