from pathlib import Path

import pytest
from pypdf import PdfWriter

import study_os_service.ingest.pdf_metadata as pdf_metadata
from study_os_service.db.connection import connect_database
from study_os_service.db.migrations import MigrationRunner
from study_os_service.ingest.course_scanner import scan_course_root
from study_os_service.ingest.pdf_metadata import inspect_pdf
from study_os_service.repositories.inventory import InventoryRepository
from tests.study_os_service.fixture_tree import create_audited_course_tree
from tests.study_os_service.test_session_migration import seed_inventory


def write_pdf(path: Path, pages: int) -> Path:
    writer = PdfWriter()
    for _ in range(pages):
        writer.add_blank_page(width=612, height=792)
    with path.open("wb") as handle:
        writer.write(handle)
    return path


def test_inspect_pdf_returns_physical_page_count(tmp_path: Path):
    path = write_pdf(tmp_path / "Aula 01.pdf", pages=3)

    metadata = inspect_pdf(path)

    assert metadata.page_count == 3


def test_inspect_pdf_rejects_missing_non_pdf_and_invalid_files(tmp_path: Path):
    text_file = tmp_path / "Aula 01.txt"
    text_file.write_text("not a pdf", encoding="utf-8")
    invalid_pdf = tmp_path / "Aula 02.pdf"
    invalid_pdf.write_bytes(b"not-a-pdf")

    with pytest.raises(ValueError, match="existing file"):
        inspect_pdf(tmp_path / "missing.pdf")
    with pytest.raises(ValueError, match="not a PDF"):
        inspect_pdf(text_file)
    with pytest.raises(ValueError, match="could not be read"):
        inspect_pdf(invalid_pdf)


def test_material_page_metadata_is_validated_and_persisted(tmp_path: Path):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        MigrationRunner(connection).migrate()
        _, material_id = seed_inventory(connection)
        repository = InventoryRepository(connection)

        repository.update_material_page_metadata(
            material_id, page_count=120, page_offset=2
        )

        row = connection.execute(
            "SELECT page_count, page_offset FROM materials WHERE id=?", (material_id,)
        ).fetchone()
        assert dict(row) == {"page_count": 120, "page_offset": 2}
        with pytest.raises(ValueError, match="page count"):
            repository.update_material_page_metadata(
                material_id, page_count=0, page_offset=0
            )
        with pytest.raises(ValueError, match="page offset"):
            repository.update_material_page_metadata(
                material_id, page_count=1, page_offset=-1
            )
        with pytest.raises(KeyError, match="999"):
            repository.update_material_page_metadata(
                999, page_count=1, page_offset=0
            )
    finally:
        connection.close()


def test_course_scanner_never_reads_pdf_page_metadata(
    tmp_path: Path, monkeypatch
):
    root = create_audited_course_tree(tmp_path / "package")

    def fail_if_called(*_args, **_kwargs):
        raise AssertionError("ordinary scan must not inspect PDF content")

    monkeypatch.setattr(pdf_metadata, "PdfReader", fail_if_called)

    snapshot = scan_course_root(root, "rfb_auditor", "Estrategia Concursos")

    assert snapshot.material_count == 9
