from datetime import UTC, datetime
from pathlib import Path
import shutil

from fastapi.testclient import TestClient
from pypdf import PdfWriter

from study_os_service.app import create_app
from study_os_service.config import StudyOsSettings
from study_os_service.db.backup import create_backup
from study_os_service.db.connection import connect_database
from tests.study_os_service.inventory_api_fixture import (
    make_validated_api_choice,
    register_api_root,
    wait_for_scan,
)


def _write_pdf(path: Path, page_count: int = 24) -> None:
    writer = PdfWriter()
    for _ in range(page_count):
        writer.add_blank_page(width=612, height=792)
    with path.open("wb") as handle:
        writer.write(handle)


def _settings(tmp_path: Path, name: str = "source") -> StudyOsSettings:
    data_dir = tmp_path / name / "data"
    return StudyOsSettings(
        repo_root=tmp_path,
        data_dir=data_dir,
        database_path=data_dir / "study-os.sqlite3",
        backup_dir=data_dir / "backups",
    )


def _prepare_material(client: TestClient, tmp_path: Path) -> tuple[int, int]:
    choice = make_validated_api_choice(tmp_path)
    primary = (
        choice.root_path
        / "Economia e Financas Publicas"
        / "PDF"
        / "Aula 01_Apostila.pdf"
    )
    _write_pdf(primary)
    root_id = register_api_root(client, choice)
    scan_id = client.post("/api/v1/scans", json={"rootId": root_id}).json()["id"]
    assert wait_for_scan(client, scan_id)["state"] == "completed"
    courses = client.get("/api/v1/courses?targetSlug=rfb_auditor").json()["items"]
    course = next(
        item for item in courses if item["displayName"] == "Economia e Financas Publicas"
    )
    lesson = client.get(
        f"/api/v1/courses/{course['id']}/lessons?targetSlug=rfb_auditor"
    ).json()["items"][0]
    detail = client.get(
        f"/api/v1/lessons/{lesson['id']}?targetSlug=rfb_auditor"
    ).json()
    material = next(
        item for item in detail["materials"] if item["kind"] == "original"
    )
    inspected = client.post(
        f"/api/v1/materials/{material['id']}/inspect?targetSlug=rfb_auditor"
    )
    assert inspected.json()["pageCount"] == 24
    return lesson["id"], material["id"]


def _record_partial_session(
    client: TestClient,
    lesson_id: int,
    material_id: int,
) -> tuple[int, int]:
    started = client.post(
        "/api/v1/sessions",
        headers={"Idempotency-Key": "durability-start"},
        json={
            "targetSlug": "rfb_auditor",
            "lessonId": lesson_id,
            "materialId": material_id,
        },
    )
    assert started.status_code == 201
    session = started.json()["session"]
    finished = client.post(
        f"/api/v1/sessions/{session['id']}/finish",
        json={
            "outcome": "partial",
            "endPage": 18,
            "elapsedSeconds": 1200,
            "expectedVersion": session["version"],
        },
    )
    assert finished.status_code == 200
    return session["id"], finished.json()["progress"]["version"]


def test_partial_session_survives_full_app_and_connection_restart(tmp_path: Path):
    settings = _settings(tmp_path)
    with TestClient(create_app(settings)) as first_client:
        lesson_id, material_id = _prepare_material(first_client, tmp_path)
        session_id, progress_version = _record_partial_session(
            first_client, lesson_id, material_id
        )

    with TestClient(create_app(settings)) as restarted_client:
        progress = restarted_client.get(
            "/api/v1/progress"
            f"?targetSlug=rfb_auditor&lessonId={lesson_id}&materialId={material_id}"
        )
        prior_session = restarted_client.get(
            f"/api/v1/sessions/{session_id}?targetSlug=rfb_auditor"
        )
        resumed = restarted_client.post(
            "/api/v1/sessions",
            headers={"Idempotency-Key": "durability-resume"},
            json={
                "targetSlug": "rfb_auditor",
                "lessonId": lesson_id,
                "materialId": material_id,
            },
        )

    assert progress.status_code == 200
    assert progress.json()["cursorPage"] == 18
    assert progress.json()["status"] == "in_progress"
    assert progress.json()["version"] == progress_version
    assert progress.json()["totalSeconds"] == 1200
    assert progress.json()["sessionCount"] == 1
    assert prior_session.status_code == 200
    assert prior_session.json()["state"] == "finished"
    assert prior_session.json()["outcome"] == "partial"
    assert prior_session.json()["endPage"] == 18
    assert prior_session.json()["version"] == 2
    assert resumed.status_code == 201
    assert resumed.json()["session"]["startPage"] == 18
    assert resumed.json()["openUrl"].endswith("#page=18")


def test_backup_restore_preserves_inventory_cursor_versions_and_history(
    tmp_path: Path,
):
    source_settings = _settings(tmp_path)
    with TestClient(create_app(source_settings)) as client:
        lesson_id, material_id = _prepare_material(client, tmp_path)
        session_id, _ = _record_partial_session(client, lesson_id, material_id)

    source = connect_database(source_settings.database_path)
    try:
        backup_path = create_backup(
            source,
            source_settings.backup_dir,
            datetime(2026, 7, 12, 18, 0, tzinfo=UTC),
        )
        table_names = (
            "course_roots",
            "courses",
            "lessons",
            "materials",
            "progress_states",
            "study_sessions",
        )
        source_counts = {
            table: source.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            for table in table_names
        }
        source_progress = tuple(
            source.execute(
                """
                SELECT cursor_page, furthest_page, status, total_seconds,
                       session_count, version
                FROM progress_states
                WHERE lesson_id=? AND material_id=?
                """,
                (lesson_id, material_id),
            ).fetchone()
        )
        source_session = tuple(
            source.execute(
                """
                SELECT state, outcome, start_page, end_page, elapsed_seconds, version
                FROM study_sessions WHERE id=?
                """,
                (session_id,),
            ).fetchone()
        )
    finally:
        source.close()

    restored_settings = _settings(tmp_path, "restored")
    restored_settings.data_dir.mkdir(parents=True)
    shutil.copy2(backup_path, restored_settings.database_path)
    restored = connect_database(restored_settings.database_path)
    try:
        assert restored.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        restored_counts = {
            table: restored.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            for table in table_names
        }
        restored_progress = tuple(
            restored.execute(
                """
                SELECT cursor_page, furthest_page, status, total_seconds,
                       session_count, version
                FROM progress_states
                WHERE lesson_id=? AND material_id=?
                """,
                (lesson_id, material_id),
            ).fetchone()
        )
        restored_session = tuple(
            restored.execute(
                """
                SELECT state, outcome, start_page, end_page, elapsed_seconds, version
                FROM study_sessions WHERE id=?
                """,
                (session_id,),
            ).fetchone()
        )
    finally:
        restored.close()

    assert restored_counts == source_counts
    assert restored_progress == source_progress == (
        18,
        18,
        "in_progress",
        1200,
        1,
        3,
    )
    assert restored_session == source_session == (
        "finished",
        "partial",
        1,
        18,
        1200,
        2,
    )
