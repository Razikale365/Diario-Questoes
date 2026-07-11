import json
import os
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from study_os_service.domain.inventory import CoursePackageChoice


CATALOG_CHECKED_AT = datetime(2026, 7, 11, 9, 0, tzinfo=UTC)
DOWNLOAD_STARTED_AT = datetime(2026, 7, 11, 10, 0, tzinfo=UTC)
DOWNLOADED_AT = datetime(2026, 7, 11, 12, 0, tzinfo=UTC)


def package_values(**overrides):
    values = {
        "target_slug": "bacen_economia_financas",
        "provider": "Estrategia Concursos",
        "package_name": "BACEN completo",
        "package_id": None,
        "package_url": "https://www.estrategiaconcursos.com.br/curso/bacen/",
        "edition_note": "Catalogo atual",
        "acquisition_method": "estrategia_downloader",
        "root_path": None,
        "download_status": "selected",
        "downloader_name": None,
        "downloader_version": None,
        "acquisition_id": None,
        "catalog_checked_at": CATALOG_CHECKED_AT,
        "download_started_at": None,
        "downloaded_at": None,
        "acquisition_manifest_path": None,
        "expected_file_count": None,
        "observed_file_count": None,
        "failed_item_count": None,
    }
    values.update(overrides)
    return values


def write_acquisition_manifest(root: Path, **overrides) -> Path:
    values = {
        "packageId": "249654",
        "acquisitionId": "download-20260711-100000",
        "downloaderName": "Estrategia Downloader",
        "downloaderVersion": "3.1",
        "catalogCheckedAt": CATALOG_CHECKED_AT.isoformat(),
        "downloadStartedAt": DOWNLOAD_STARTED_AT.isoformat(),
        "downloadedAt": DOWNLOADED_AT.isoformat(),
        "expectedFileCount": 2,
        "observedFileCount": 2,
        "failedItemCount": 0,
    }
    values.update(overrides)
    path = root / ".study-os-download.json"
    path.write_text(json.dumps(values), encoding="utf-8")
    return path


def downloaded_values(tmp_path: Path, status="downloaded", **overrides):
    root = tmp_path / "fresh-download"
    root.mkdir()
    (root / "Aula 00.pdf").write_bytes(b"%PDF-fixture")
    (root / "Aula 01.PDF").write_bytes(b"%PDF-fixture")
    manifest = write_acquisition_manifest(root)
    values = package_values(
        package_id="249654",
        root_path=root,
        download_status=status,
        downloader_name="Estrategia Downloader",
        downloader_version="3.1",
        acquisition_id="download-20260711-100000",
        download_started_at=DOWNLOAD_STARTED_AT,
        downloaded_at=DOWNLOADED_AT,
        acquisition_manifest_path=manifest,
        expected_file_count=2,
        observed_file_count=2,
        failed_item_count=0,
    )
    values.update(overrides)
    return values


def test_selected_package_round_trips_without_pretending_download():
    choice = CoursePackageChoice(**package_values())

    restored = CoursePackageChoice.from_dict(choice.to_dict())

    assert restored == choice
    assert restored.root_path is None
    assert restored.download_status == "selected"
    assert restored.catalog_checked_at == CATALOG_CHECKED_AT


@pytest.mark.parametrize("status", ["downloaded", "validated"])
def test_fresh_downloaded_states_round_trip_with_full_provenance(tmp_path: Path, status: str):
    choice = CoursePackageChoice(**downloaded_values(tmp_path, status=status))

    restored = CoursePackageChoice.from_dict(choice.to_dict())

    assert restored == choice
    assert restored.root_path == (tmp_path / "fresh-download").resolve()
    assert restored.acquisition_manifest_path == (
        tmp_path / "fresh-download" / ".study-os-download.json"
    ).resolve()
    assert restored.to_dict()["observedFileCount"] == 2


def test_historical_directory_without_acquisition_manifest_is_rejected(tmp_path: Path):
    stale_root = tmp_path / "Pacote Regular Fiscal 2023"
    stale_root.mkdir()
    values = downloaded_values(tmp_path)

    with pytest.raises(ValueError, match="fresh acquisition manifest"):
        CoursePackageChoice(
            **(values | {"root_path": stale_root, "acquisition_manifest_path": None})
        )


def test_acquisition_manifest_must_be_inside_package_root(tmp_path: Path):
    values = downloaded_values(tmp_path)
    outside = tmp_path / "outside.json"
    outside.write_text("{}", encoding="utf-8")

    with pytest.raises(ValueError, match="inside the package root"):
        CoursePackageChoice(**(values | {"acquisition_manifest_path": outside}))


def test_acquisition_manifest_must_use_canonical_filename(tmp_path: Path):
    values = downloaded_values(tmp_path)
    canonical = values["acquisition_manifest_path"]
    arbitrary = values["root_path"] / "receipt.json"
    canonical.replace(arbitrary)

    with pytest.raises(ValueError, match=r"\.study-os-download\.json"):
        CoursePackageChoice(**(values | {"acquisition_manifest_path": arbitrary}))


def test_acquisition_manifest_must_match_recorded_run(tmp_path: Path):
    values = downloaded_values(tmp_path)
    manifest = values["acquisition_manifest_path"]
    write_acquisition_manifest(values["root_path"], acquisitionId="another-run")

    with pytest.raises(ValueError, match="acquisitionId"):
        CoursePackageChoice(**(values | {"acquisition_manifest_path": manifest}))


def test_stale_pdf_cannot_be_promoted_with_a_new_matching_manifest(tmp_path: Path):
    values = downloaded_values(tmp_path)
    stale_pdf = values["root_path"] / "Aula 00.pdf"
    stale_timestamp = (CATALOG_CHECKED_AT - timedelta(days=365)).timestamp()
    os.utime(stale_pdf, (stale_timestamp, stale_timestamp))

    with pytest.raises(ValueError, match="predates the acquisition"):
        CoursePackageChoice(**values)


def test_observed_count_is_checked_against_real_filesystem(tmp_path: Path):
    values = downloaded_values(tmp_path, observed_file_count=1)
    write_acquisition_manifest(values["root_path"], observedFileCount=1)

    with pytest.raises(ValueError, match="observed file count does not match"):
        CoursePackageChoice(**values)


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("package_id", None, "package id"),
        ("downloader_name", None, "downloader name"),
        ("downloader_version", None, "downloader version"),
        ("acquisition_id", None, "acquisition id"),
        ("download_started_at", None, "start time"),
        ("downloaded_at", None, "completion time"),
        ("expected_file_count", None, "expected file count"),
        ("observed_file_count", None, "observed file count"),
        ("failed_item_count", None, "failed item count"),
    ],
)
def test_downloaded_package_requires_complete_provenance(
    tmp_path: Path, field: str, value, message: str
):
    values = downloaded_values(tmp_path)
    values[field] = value

    with pytest.raises(ValueError, match=message):
        CoursePackageChoice(**values)


def test_download_times_must_be_ordered_after_catalog_check(tmp_path: Path):
    values = downloaded_values(tmp_path)
    values["download_started_at"] = CATALOG_CHECKED_AT - timedelta(minutes=1)

    with pytest.raises(ValueError, match="after the catalog check"):
        CoursePackageChoice(**values)


def test_validated_package_requires_independent_count_match(tmp_path: Path):
    values = downloaded_values(tmp_path, status="validated", observed_file_count=1)
    write_acquisition_manifest(values["root_path"], observedFileCount=1)

    with pytest.raises(ValueError, match="counts must match"):
        CoursePackageChoice(**values)


def test_validated_package_requires_zero_failed_items(tmp_path: Path):
    values = downloaded_values(tmp_path, status="validated", failed_item_count=1)
    write_acquisition_manifest(values["root_path"], failedItemCount=1)

    with pytest.raises(ValueError, match="zero failed items"):
        CoursePackageChoice(**values)


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"target_slug": " "}, "target"),
        ({"provider": ""}, "provider"),
        ({"package_name": ""}, "package name"),
        ({"package_url": "file:///tmp/package"}, "HTTP"),
        ({"acquisition_method": "manual"}, "acquisition method"),
        ({"expected_file_count": -1}, "non-negative"),
        ({"observed_file_count": True}, "non-negative"),
        ({"failed_item_count": -1}, "non-negative"),
        ({"download_status": "unknown"}, "download status"),
        ({"catalog_checked_at": datetime(2026, 7, 11, 9, 0)}, "timezone-aware"),
    ],
)
def test_package_choice_rejects_invalid_metadata(overrides: dict, message: str):
    with pytest.raises(ValueError, match=message):
        CoursePackageChoice(**package_values(**overrides))


@pytest.mark.parametrize("field", ["targetSlug", "provider", "packageName", "packageUrl"])
def test_from_dict_rejects_null_required_strings(field: str):
    payload = CoursePackageChoice(**package_values()).to_dict()
    payload[field] = None

    with pytest.raises(ValueError, match="required"):
        CoursePackageChoice.from_dict(payload)
