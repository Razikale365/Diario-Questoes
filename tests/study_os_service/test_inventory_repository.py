import json
from datetime import UTC, datetime
from pathlib import Path

import pytest

from study_os_service.db.connection import connect_database
from study_os_service.db.migrations import MigrationRunner
from study_os_service.domain.inventory import CoursePackageChoice
from study_os_service.repositories.inventory import (
    InventoryRepository,
    RootTargetConflictError,
)


CATALOG_AT = datetime(2026, 7, 11, 12, 0, tzinfo=UTC)
STARTED_AT = datetime(2026, 7, 11, 13, 0, tzinfo=UTC)
COMPLETED_AT = datetime(2026, 7, 11, 14, 0, tzinfo=UTC)


def make_validated_choice(tmp_path: Path, target_slug="rfb_auditor") -> CoursePackageChoice:
    root = tmp_path / "fresh-course"
    root.mkdir()
    (root / "course").mkdir()
    (root / "course" / "Aula 00.pdf").write_bytes(b"%PDF-fixture")
    acquisition_id = "run-249654"
    manifest = root / ".study-os-download.json"
    manifest.write_text(
        json.dumps(
            {
                "packageId": "249654",
                "acquisitionId": acquisition_id,
                "downloaderName": "Study OS Estrategia Package Downloader",
                "downloaderVersion": "1.0.0+bb2c490",
                "catalogCheckedAt": CATALOG_AT.isoformat(),
                "downloadStartedAt": STARTED_AT.isoformat(),
                "downloadedAt": COMPLETED_AT.isoformat(),
                "expectedFileCount": 1,
                "observedFileCount": 1,
                "failedItemCount": 0,
            }
        ),
        encoding="utf-8",
    )
    return CoursePackageChoice(
        target_slug=target_slug,
        provider="Estrategia Concursos",
        package_name="RFB Auditor Pacotaco",
        package_id="249654",
        package_url="https://www.estrategiaconcursos.com.br/app/dashboard/pacote/249654",
        edition_note="Catalogo 2026-07-11",
        acquisition_method="estrategia_downloader",
        root_path=root,
        download_status="validated",
        downloader_name="Study OS Estrategia Package Downloader",
        downloader_version="1.0.0+bb2c490",
        acquisition_id=acquisition_id,
        catalog_checked_at=CATALOG_AT,
        download_started_at=STARTED_AT,
        downloaded_at=COMPLETED_AT,
        acquisition_manifest_path=manifest,
        expected_file_count=1,
        observed_file_count=1,
        failed_item_count=0,
    )


@pytest.fixture
def repository(tmp_path: Path):
    connection = connect_database(tmp_path / "study.sqlite3")
    MigrationRunner(connection).migrate()
    try:
        yield InventoryRepository(connection)
    finally:
        connection.close()


def test_register_root_is_idempotent_and_preserves_full_provenance(
    repository: InventoryRepository, tmp_path: Path
):
    choice = make_validated_choice(tmp_path)

    first_id = repository.register_root(choice)
    second_id = repository.register_root(choice)
    restored = repository.get_root(first_id)

    assert second_id == first_id
    assert restored is not None
    assert restored.target_slug == "rfb_auditor"
    assert restored.package_id == "249654"
    assert restored.root_path == choice.root_path
    assert restored.acquisition_id == "run-249654"
    assert restored.download_status == "validated"
    assert restored.observed_file_count == 1
    assert repository.count_roots() == 1


def test_same_root_cannot_be_silently_reassigned_to_another_target(
    repository: InventoryRepository, tmp_path: Path
):
    choice = make_validated_choice(tmp_path)
    repository.register_root(choice)
    other_target = CoursePackageChoice.from_dict(
        choice.to_dict() | {"targetSlug": "bacen_economia_financas"}
    )

    with pytest.raises(RootTargetConflictError, match="rfb_auditor"):
        repository.register_root(other_target)


def test_list_roots_is_target_isolated(repository: InventoryRepository, tmp_path: Path):
    rfb_id = repository.register_root(make_validated_choice(tmp_path))
    second_parent = tmp_path / "second"
    second_parent.mkdir()
    bacen_id = repository.register_root(
        make_validated_choice(second_parent, target_slug="bacen_economia_financas")
    )

    assert [row.id for row in repository.list_roots(target_slug="rfb_auditor")] == [
        rfb_id
    ]
    assert [
        row.id
        for row in repository.list_roots(target_slug="bacen_economia_financas")
    ] == [bacen_id]


def test_root_activation_can_be_changed_without_deleting_inventory(
    repository: InventoryRepository, tmp_path: Path
):
    root_id = repository.register_root(make_validated_choice(tmp_path))

    repository.set_root_active(root_id, False)

    assert repository.get_root(root_id).active is False
    assert repository.list_roots(active_only=True) == []
    assert [row.id for row in repository.list_roots()] == [root_id]


def test_registration_rejects_choice_that_is_not_downloaded(
    repository: InventoryRepository,
):
    selected = CoursePackageChoice(
        target_slug="rfb_auditor",
        provider="Estrategia Concursos",
        package_name="RFB Auditor Pacotaco",
        package_id="249654",
        package_url="https://www.estrategiaconcursos.com.br/app/dashboard/pacote/249654",
        edition_note="Catalogo 2026-07-11",
        acquisition_method="estrategia_downloader",
        root_path=None,
        download_status="selected",
        downloader_name=None,
        downloader_version=None,
        acquisition_id=None,
        catalog_checked_at=CATALOG_AT,
        download_started_at=None,
        downloaded_at=None,
        acquisition_manifest_path=None,
        expected_file_count=None,
        observed_file_count=None,
        failed_item_count=None,
    )

    with pytest.raises(ValueError, match="downloaded or validated"):
        repository.register_root(selected)


def test_inventory_reads_are_scoped_to_target_and_course(
    repository: InventoryRepository, tmp_path: Path
):
    rfb_root = repository.register_root(make_validated_choice(tmp_path))
    second_parent = tmp_path / "second"
    second_parent.mkdir()
    bacen_root = repository.register_root(
        make_validated_choice(second_parent, target_slug="bacen_economia_financas")
    )
    rfb_course = repository.connection.execute(
        """
        INSERT INTO courses (
          root_id, display_name, provider, relative_path, active, scan_state
        ) VALUES (?, 'Direito Tributario', 'Estrategia Concursos', 'Direito Tributario', 1, 'available')
        """,
        (rfb_root,),
    ).lastrowid
    repository.connection.execute(
        """
        INSERT INTO courses (
          root_id, display_name, provider, relative_path, active, scan_state
        ) VALUES (?, 'Macroeconomia', 'Estrategia Concursos', 'Macroeconomia', 1, 'available')
        """,
        (bacen_root,),
    )
    discipline_id = repository.connection.execute(
        "INSERT INTO disciplines (canonical_name) VALUES ('Direito Tributario')"
    ).lastrowid
    repository.connection.execute(
        """
        INSERT INTO lessons (
          course_id, discipline_id, lesson_number, title,
          sequence_index, status, available
        ) VALUES (?, ?, 0, 'Obrigacao tributaria', 0, 'unread', 1)
        """,
        (rfb_course, discipline_id),
    )

    rfb_courses = repository.list_courses(target_slug="rfb_auditor")
    lessons = repository.list_lessons(rfb_course)

    assert [(row.id, row.display_name) for row in rfb_courses] == [
        (rfb_course, "Direito Tributario")
    ]
    assert len(lessons) == 1
    assert lessons[0].lesson_number == 0
    assert lessons[0].title == "Obrigacao tributaria"
