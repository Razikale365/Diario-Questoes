import json
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path

from fastapi.testclient import TestClient

from study_os_service.domain.inventory import CoursePackageChoice
from tests.study_os_service.fixture_tree import create_audited_course_tree


def make_validated_api_choice(tmp_path: Path) -> CoursePackageChoice:
    root = create_audited_course_tree(tmp_path / "fresh-package")
    now = datetime.now(UTC)
    catalog_at = now - timedelta(minutes=10)
    started_at = now - timedelta(minutes=5)
    acquisition_id = "api-fixture-249654"
    manifest = root / ".study-os-download.json"
    manifest.write_text(
        json.dumps(
            {
                "packageId": "249654",
                "packageUrl": "https://www.estrategiaconcursos.com.br/app/dashboard/pacote/249654",
                "packageName": "RFB Auditor Pacotaco",
                "acquisitionId": acquisition_id,
                "downloaderName": "Study OS Estrategia Package Downloader",
                "downloaderVersion": "1.0.0+fixture",
                "catalogCheckedAt": catalog_at.isoformat(),
                "downloadStartedAt": started_at.isoformat(),
                "downloadedAt": now.isoformat(),
                "expectedFileCount": 9,
                "observedFileCount": 9,
                "failedItemCount": 0,
            }
        ),
        encoding="utf-8",
    )
    return CoursePackageChoice(
        target_slug="rfb_auditor",
        provider="Estrategia Concursos",
        package_name="RFB Auditor Pacotaco",
        package_id="249654",
        package_url="https://www.estrategiaconcursos.com.br/app/dashboard/pacote/249654",
        edition_note="Fixture atual",
        acquisition_method="estrategia_downloader",
        root_path=root,
        download_status="validated",
        downloader_name="Study OS Estrategia Package Downloader",
        downloader_version="1.0.0+fixture",
        acquisition_id=acquisition_id,
        catalog_checked_at=catalog_at,
        download_started_at=started_at,
        downloaded_at=now,
        acquisition_manifest_path=manifest,
        expected_file_count=9,
        observed_file_count=9,
        failed_item_count=0,
    )


def register_api_root(client: TestClient, choice: CoursePackageChoice) -> int:
    response = client.post("/api/v1/course-roots", json=choice.to_dict())
    assert response.status_code == 201, response.text
    return response.json()["id"]


def wait_for_scan(client: TestClient, run_id: int, timeout: float = 5.0) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        payload = client.get(f"/api/v1/scans/{run_id}").json()
        if payload["state"] in {"completed", "failed"}:
            return payload
        time.sleep(0.02)
    raise AssertionError(f"scan {run_id} did not finish")
