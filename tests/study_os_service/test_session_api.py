from pathlib import Path

from fastapi.testclient import TestClient
from pypdf import PdfWriter

from study_os_service.app import create_app
from study_os_service.config import StudyOsSettings
from tests.study_os_service.inventory_api_fixture import (
    make_validated_api_choice,
    register_api_root,
    wait_for_scan,
)


def write_three_page_pdf(path: Path) -> None:
    writer = PdfWriter()
    for _ in range(3):
        writer.add_blank_page(width=612, height=792)
    with path.open("wb") as handle:
        writer.write(handle)


def prepare_session_inventory(client: TestClient, choice) -> tuple[int, int]:
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
    original = next(item for item in detail["materials"] if item["kind"] == "original")
    return lesson["id"], original["id"]


def make_session_app(tmp_path: Path):
    choice = make_validated_api_choice(tmp_path)
    original = (
        choice.root_path
        / "Economia e Financas Publicas"
        / "PDF"
        / "Aula 01_Apostila.pdf"
    )
    write_three_page_pdf(original)
    return create_app(StudyOsSettings.from_environment(tmp_path)), choice


def start_session(client, lesson_id, material_id, key="session-start"):
    return client.post(
        "/api/v1/sessions",
        headers={"Idempotency-Key": key},
        json={
            "targetSlug": "rfb_auditor",
            "lessonId": lesson_id,
            "materialId": material_id,
        },
    )


def test_session_start_rejects_invalid_planner_block_id(tmp_path: Path):
    app, choice = make_session_app(tmp_path)
    with TestClient(app) as client:
        lesson_id, material_id = prepare_session_inventory(client, choice)
        response = client.post(
            "/api/v1/sessions",
            headers={"Idempotency-Key": "invalid-planner-block"},
            json={
                "targetSlug": "rfb_auditor",
                "lessonId": lesson_id,
                "materialId": material_id,
                "plannerBlockId": 999999,
            },
        )

    assert response.status_code == 404
    assert response.json()["code"] == "session_not_found"
    assert "planner block" in response.json()["message"]


def test_material_inspection_is_lazy_target_scoped_and_cached(tmp_path: Path):
    app, choice = make_session_app(tmp_path)

    with TestClient(app) as client:
        _, material_id = prepare_session_inventory(client, choice)
        before = client.get("/api/v1/courses?targetSlug=rfb_auditor").json()
        inspected = client.post(
            f"/api/v1/materials/{material_id}/inspect?targetSlug=rfb_auditor"
        )
        wrong_target = client.post(
            f"/api/v1/materials/{material_id}/inspect?targetSlug=bacen_economia_financas"
        )

    assert before["items"][0]["materialCount"] > 0
    assert inspected.status_code == 200
    assert inspected.json() == {
        "materialId": material_id,
        "pageCount": 3,
        "pageOffset": 0,
    }
    assert wrong_target.status_code == 404


def test_start_requires_idempotency_and_duplicate_retry_returns_same_session(
    tmp_path: Path,
):
    app, choice = make_session_app(tmp_path)

    with TestClient(app) as client:
        lesson_id, material_id = prepare_session_inventory(client, choice)
        missing_key = client.post(
            "/api/v1/sessions",
            json={
                "targetSlug": "rfb_auditor",
                "lessonId": lesson_id,
                "materialId": material_id,
            },
        )
        first = start_session(client, lesson_id, material_id)
        second = start_session(client, lesson_id, material_id)
        wrong_target = client.post(
            "/api/v1/sessions",
            headers={"Idempotency-Key": "wrong-target"},
            json={
                "targetSlug": "bacen_economia_financas",
                "lessonId": lesson_id,
                "materialId": material_id,
            },
        )

    assert missing_key.status_code == 422
    assert missing_key.json()["code"] == "idempotency_key_required"
    assert first.status_code == 201
    assert second.status_code == 201
    assert second.json()["session"]["id"] == first.json()["session"]["id"]
    assert first.json()["progress"]["cursorPage"] == 1
    assert first.json()["openUrl"].endswith(
        f"materials/{material_id}/file?targetSlug=rfb_auditor#page=1"
    )
    assert wrong_target.status_code == 404


def test_checkpoint_partial_reload_and_resume_exact_page(tmp_path: Path):
    app, choice = make_session_app(tmp_path)

    with TestClient(app) as client:
        lesson_id, material_id = prepare_session_inventory(client, choice)
        inspected = client.post(
            f"/api/v1/materials/{material_id}/inspect?targetSlug=rfb_auditor"
        )
        assert inspected.status_code == 200
        started = start_session(client, lesson_id, material_id).json()
        session_id = started["session"]["id"]
        checkpoint = client.patch(
            f"/api/v1/sessions/{session_id}",
            json={"endPage": 2, "elapsedSeconds": 300, "expectedVersion": 1},
        )
        stale = client.patch(
            f"/api/v1/sessions/{session_id}",
            json={"endPage": 3, "elapsedSeconds": 360, "expectedVersion": 1},
        )
        active = client.get(
            "/api/v1/sessions/active"
            f"?targetSlug=rfb_auditor&lessonId={lesson_id}&materialId={material_id}"
        )
        partial = client.post(
            f"/api/v1/sessions/{session_id}/finish",
            json={
                "outcome": "partial",
                "endPage": 2,
                "elapsedSeconds": 1200,
                "questionsDone": 0,
                "correctCount": 0,
                "wrongCount": 0,
                "doubtCount": 0,
                "favoriteCount": 0,
                "notes": "intervalo",
                "expectedVersion": checkpoint.json()["session"]["version"],
            },
        )
        progress = client.get(
            "/api/v1/progress"
            f"?targetSlug=rfb_auditor&lessonId={lesson_id}&materialId={material_id}"
        )
        resumed = start_session(
            client, lesson_id, material_id, key="session-resume"
        )

    assert checkpoint.status_code == 200
    assert checkpoint.json()["progress"]["sessionCount"] == 0
    assert stale.status_code == 409
    assert stale.json()["code"] == "session_conflict"
    assert active.status_code == 200
    assert partial.status_code == 200
    assert partial.json()["progress"]["cursorPage"] == 2
    assert partial.json()["progress"]["status"] == "in_progress"
    assert progress.json()["cursorPage"] == 2
    assert resumed.json()["session"]["startPage"] == 2
    assert resumed.json()["openUrl"].endswith("#page=2")


def test_skip_and_finish_validation_are_structured(tmp_path: Path):
    app, choice = make_session_app(tmp_path)

    with TestClient(app) as client:
        lesson_id, material_id = prepare_session_inventory(client, choice)
        started = start_session(client, lesson_id, material_id).json()
        session_id = started["session"]["id"]
        invalid_finish = client.post(
            f"/api/v1/sessions/{session_id}/finish",
            json={
                "outcome": "partial",
                "endPage": -1,
                "elapsedSeconds": 10,
                "expectedVersion": 1,
            },
        )
        skipped = client.post(
            f"/api/v1/sessions/{session_id}/skip",
            json={
                "reason": "too_difficult",
                "notes": "rever base",
                "expectedVersion": 1,
            },
        )
        fetched = client.get(
            f"/api/v1/sessions/{session_id}?targetSlug=rfb_auditor"
        )

    assert invalid_finish.status_code == 422
    assert invalid_finish.json()["code"] == "invalid_session"
    assert skipped.status_code == 200
    assert skipped.json()["session"]["skipReason"] == "too_difficult"
    assert skipped.json()["progress"]["status"] == "weak"
    assert fetched.json()["outcome"] == "skipped"


def test_completed_session_and_every_skip_reason_have_http_contract(tmp_path: Path):
    app, choice = make_session_app(tmp_path)
    skip_reasons = (
        "lack_of_time",
        "fatigue",
        "wrong_material",
        "blocked_prerequisite",
        "too_difficult",
        "other",
    )

    with TestClient(app) as client:
        lesson_id, material_id = prepare_session_inventory(client, choice)
        inspected = client.post(
            f"/api/v1/materials/{material_id}/inspect?targetSlug=rfb_auditor"
        )
        assert inspected.status_code == 200
        started = start_session(
            client, lesson_id, material_id, key="complete-session"
        ).json()
        completed = client.post(
            f"/api/v1/sessions/{started['session']['id']}/finish",
            json={
                "outcome": "completed",
                "endPage": 3,
                "elapsedSeconds": 900,
                "expectedVersion": 1,
            },
        )
        skipped_payloads = []
        for index, reason in enumerate(skip_reasons):
            session = start_session(
                client,
                lesson_id,
                material_id,
                key=f"skip-session-{index}",
            ).json()["session"]
            response = client.post(
                f"/api/v1/sessions/{session['id']}/skip",
                json={
                    "reason": reason,
                    "notes": "",
                    "expectedVersion": session["version"],
                },
            )
            assert response.status_code == 200
            skipped_payloads.append(response.json()["session"])

    assert completed.status_code == 200
    assert completed.json()["session"]["outcome"] == "completed"
    assert completed.json()["progress"]["status"] == "covered"
    assert [item["skipReason"] for item in skipped_payloads] == list(skip_reasons)


def test_negative_result_count_is_a_structured_validation_error(tmp_path: Path):
    app, choice = make_session_app(tmp_path)

    with TestClient(app) as client:
        lesson_id, material_id = prepare_session_inventory(client, choice)
        started = start_session(client, lesson_id, material_id).json()["session"]
        invalid = client.post(
            f"/api/v1/sessions/{started['id']}/finish",
            json={
                "outcome": "partial",
                "endPage": 1,
                "elapsedSeconds": 60,
                "wrongCount": -1,
                "expectedVersion": started["version"],
            },
        )

    assert invalid.status_code == 422
    assert invalid.json()["code"] == "invalid_session"


def test_reading_rate_returns_material_history_for_target(tmp_path: Path):
    app, choice = make_session_app(tmp_path)

    with TestClient(app) as client:
        lesson_id, material_id = prepare_session_inventory(client, choice)
        started = start_session(client, lesson_id, material_id).json()
        client.post(
            f"/api/v1/sessions/{started['session']['id']}/finish",
            json={
                "outcome": "partial",
                "endPage": 2,
                "elapsedSeconds": 1200,
                "questionsDone": 0,
                "correctCount": 0,
                "wrongCount": 0,
                "doubtCount": 0,
                "favoriteCount": 0,
                "notes": "",
                "expectedVersion": 1,
            },
        )
        rates = client.get(
            "/api/v1/reading-rates?targetSlug=rfb_auditor"
        )
        wrong_target = client.get(
            "/api/v1/reading-rates?targetSlug=bacen_economia_financas"
        )

    assert rates.status_code == 200
    assert rates.json()["items"] == [
        {
            "materialId": material_id,
            "pagesPerHour": 10.0,
            "sampleCount": 1,
            "totalSeconds": 1200,
            "source": "observed",
        }
    ]
    assert wrong_target.json()["items"] == []
