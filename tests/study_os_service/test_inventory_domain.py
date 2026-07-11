from datetime import UTC, datetime
from pathlib import Path

import pytest

from study_os_service.domain.inventory import CoursePackageChoice


def test_selected_package_round_trips_without_pretending_download(tmp_path: Path):
    choice = CoursePackageChoice(
        target_slug="bacen_economia_financas",
        provider="Estrategia Concursos",
        package_name="BACEN - Analista - Area 2 - Economia e Financas - Pacote",
        package_url="https://www.estrategiaconcursos.com.br/curso/bacen-analista-area-2-economia-e-financas-pacote/",
        edition_note="Catalogo consultado em 2026-07-11",
        acquisition_method="estrategia_downloader",
        root_path=None,
        download_status="selected",
        downloader_version=None,
        downloaded_at=None,
        expected_file_count=None,
    )

    restored = CoursePackageChoice.from_dict(choice.to_dict())

    assert restored == choice
    assert restored.root_path is None
    assert restored.download_status == "selected"
    assert restored.acquisition_method == "estrategia_downloader"


def test_validated_package_requires_existing_directory_and_count(tmp_path: Path):
    root = tmp_path / "bacen"
    root.mkdir()

    choice = CoursePackageChoice(
        target_slug="bacen_economia_financas",
        provider="Estrategia Concursos",
        package_name="BACEN completo",
        package_url="https://www.estrategiaconcursos.com.br/curso/bacen/",
        edition_note="Atual",
        acquisition_method="estrategia_downloader",
        root_path=root,
        download_status="validated",
        downloader_version="3.1",
        downloaded_at=datetime(2026, 7, 11, 12, 0, tzinfo=UTC),
        expected_file_count=123,
    )

    assert choice.root_path == root.resolve()
    assert choice.to_dict()["rootPath"] == str(root.resolve())
    assert choice.to_dict()["expectedFileCount"] == 123


@pytest.mark.parametrize("status", ["downloaded", "validated"])
def test_downloaded_states_require_an_existing_directory(tmp_path: Path, status: str):
    with pytest.raises(ValueError, match="existing directory"):
        CoursePackageChoice(
            target_slug="bacen_economia_financas",
            provider="Estrategia Concursos",
            package_name="BACEN completo",
            package_url="https://www.estrategiaconcursos.com.br/curso/bacen/",
            edition_note="Atual",
            acquisition_method="estrategia_downloader",
            root_path=tmp_path / "missing",
            download_status=status,  # type: ignore[arg-type]
            downloader_version="3.1",
            downloaded_at=datetime(2026, 7, 11, 12, 0, tzinfo=UTC),
            expected_file_count=0,
        )


def test_validated_package_requires_an_observed_file_count(tmp_path: Path):
    root = tmp_path / "bacen"
    root.mkdir()

    with pytest.raises(ValueError, match="file count"):
        CoursePackageChoice(
            target_slug="bacen_economia_financas",
            provider="Estrategia Concursos",
            package_name="BACEN completo",
            package_url="https://www.estrategiaconcursos.com.br/curso/bacen/",
            edition_note="Atual",
            acquisition_method="estrategia_downloader",
            root_path=root,
            download_status="validated",
            downloader_version="3.1",
            downloaded_at=datetime(2026, 7, 11, 12, 0, tzinfo=UTC),
            expected_file_count=None,
        )


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"target_slug": " "}, "target"),
        ({"provider": ""}, "provider"),
        ({"package_name": ""}, "package name"),
        ({"package_url": "file:///tmp/package"}, "HTTP"),
        ({"acquisition_method": "manual"}, "acquisition method"),
        ({"expected_file_count": -1}, "non-negative"),
        ({"download_status": "unknown"}, "download status"),
    ],
)
def test_package_choice_rejects_invalid_metadata(overrides: dict, message: str):
    values = {
        "target_slug": "bacen_economia_financas",
        "provider": "Estrategia Concursos",
        "package_name": "BACEN completo",
        "package_url": "https://www.estrategiaconcursos.com.br/curso/bacen/",
        "edition_note": "Atual",
        "acquisition_method": "estrategia_downloader",
        "root_path": None,
        "download_status": "candidate",
        "downloader_version": None,
        "downloaded_at": None,
        "expected_file_count": None,
    }
    values.update(overrides)

    with pytest.raises(ValueError, match=message):
        CoursePackageChoice(**values)


@pytest.mark.parametrize(
    ("downloader_version", "downloaded_at", "message"),
    [
        (None, datetime(2026, 7, 11, 12, 0, tzinfo=UTC), "downloader version"),
        ("3.1", None, "completion time"),
        ("3.1", datetime(2026, 7, 11, 12, 0), "timezone-aware"),
    ],
)
def test_downloaded_package_requires_downloader_provenance(
    tmp_path: Path,
    downloader_version: str | None,
    downloaded_at: datetime | None,
    message: str,
):
    root = tmp_path / "fresh-download"
    root.mkdir()

    with pytest.raises(ValueError, match=message):
        CoursePackageChoice(
            target_slug="bacen_economia_financas",
            provider="Estrategia Concursos",
            package_name="BACEN completo",
            package_url="https://www.estrategiaconcursos.com.br/curso/bacen/",
            edition_note="Atual",
            acquisition_method="estrategia_downloader",
            root_path=root,
            download_status="downloaded",
            downloader_version=downloader_version,
            downloaded_at=downloaded_at,
            expected_file_count=None,
        )
