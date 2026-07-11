from pathlib import Path
import time

import pytest

from study_os_service.ingest.course_scanner import scan_course_root
from tests.study_os_service.fixture_tree import create_audited_course_tree


def test_scanner_uses_directory_above_pdf_as_course_and_filename_as_lesson(tmp_path: Path):
    root = create_audited_course_tree(tmp_path / "package")

    snapshot = scan_course_root(root, "rfb_auditor", "Estrategia Concursos")

    courses = {course.display_name: course for course in snapshot.courses}
    assert set(courses) == {
        "Economia e Financas Publicas",
        "Direito Tributario",
        "Trilha Estrategica",
        "Dicas e Bizus",
    }
    economy = courses["Economia e Financas Publicas"]
    assert economy.relative_path == "Economia e Financas Publicas"
    assert [lesson.lesson_number for lesson in economy.lessons] == [1]
    assert economy.lessons[0].sequence_index == 0
    assert len(economy.lessons[0].materials) == 6
    assert all("/PDF/" in f"/{item.relative_path}" for item in economy.materials)
    assert [lesson.lesson_number for lesson in courses["Direito Tributario"].lessons] == [2]
    assert snapshot.material_count == 9


def test_scanner_carries_classifier_policy_without_choosing_bizu_as_primary(tmp_path: Path):
    root = create_audited_course_tree(tmp_path / "package")

    snapshot = scan_course_root(root, "rfb_auditor", "Estrategia Concursos")
    courses = {course.display_name: course for course in snapshot.courses}
    economy = courses["Economia e Financas Publicas"]
    kinds = {material.kind for material in economy.materials}

    assert kinds == {
        "original",
        "simplified",
        "highlighted",
        "slides",
        "mind_map",
        "summary",
    }
    assert economy.lessons[0].primary_material_relative_path.endswith(
        "Aula 01_Apostila.pdf"
    )
    assert courses["Dicas e Bizus"].lessons[0].primary_material_relative_path is None
    assert courses["Trilha Estrategica"].lessons[0].primary_material_relative_path is None


@pytest.mark.parametrize("invalid_kind", ["missing", "file"])
def test_scanner_rejects_invalid_roots(tmp_path: Path, invalid_kind: str):
    root = tmp_path / "root"
    if invalid_kind == "file":
        root.write_text("not a directory", encoding="utf-8")

    with pytest.raises(ValueError, match="course root"):
        scan_course_root(root, "rfb_auditor", "Estrategia Concursos")


def test_scanner_ignores_unsupported_files_and_counts_uppercase_pdf(tmp_path: Path):
    root = tmp_path / "package"
    pdf_dir = root / "Economia" / "PDF"
    pdf_dir.mkdir(parents=True)
    (pdf_dir / "Aula 01_Apostila.PDF").write_bytes(b"")
    (pdf_dir / "Aula 01.txt").write_text("ignore", encoding="utf-8")
    (pdf_dir / "thumb.jpg").write_bytes(b"")

    snapshot = scan_course_root(root, "rfb_auditor", "Estrategia Concursos")

    assert snapshot.material_count == 1
    assert snapshot.courses[0].materials[0].relative_path.endswith(".PDF")


def test_duplicate_provider_directories_remain_distinct_courses(tmp_path: Path):
    root = tmp_path / "package"
    for provider in ("Professor A", "Professor B"):
        pdf_dir = root / provider / "Contabilidade Geral" / "PDF"
        pdf_dir.mkdir(parents=True)
        (pdf_dir / "Aula 01_Apostila.pdf").write_bytes(b"")

    snapshot = scan_course_root(root, "rfb_auditor", "Estrategia Concursos")

    assert len(snapshot.courses) == 2
    assert {course.relative_path for course in snapshot.courses} == {
        "Professor A/Contabilidade Geral",
        "Professor B/Contabilidade Geral",
    }


def test_unknown_discipline_and_lesson_emit_issues_without_dropping_files(tmp_path: Path):
    root = tmp_path / "package"
    pdf_dir = root / "Curso Misterioso" / "PDF"
    pdf_dir.mkdir(parents=True)
    (pdf_dir / "Material complementar.pdf").write_bytes(b"")

    snapshot = scan_course_root(root, "rfb_auditor", "Estrategia Concursos")

    assert snapshot.material_count == 1
    assert snapshot.courses[0].materials[0].lesson_number is None
    assert {issue.issue_kind for issue in snapshot.issues} == {
        "unknown_discipline",
        "unknown_lesson",
    }


def test_scanner_never_opens_pdf_content(monkeypatch, tmp_path: Path):
    root = create_audited_course_tree(tmp_path / "package")

    def fail_if_opened(*args, **kwargs):
        raise AssertionError("PDF content was opened")

    monkeypatch.setattr(Path, "open", fail_if_opened)
    monkeypatch.setattr(Path, "read_bytes", fail_if_opened)
    monkeypatch.setattr(Path, "read_text", fail_if_opened)

    snapshot = scan_course_root(root, "rfb_auditor", "Estrategia Concursos")

    assert snapshot.material_count == 9


def test_scanner_rejects_pdf_symlink_resolving_outside_root(tmp_path: Path):
    root = tmp_path / "package"
    pdf_dir = root / "Economia" / "PDF"
    pdf_dir.mkdir(parents=True)
    outside = tmp_path / "outside.pdf"
    outside.write_bytes(b"")
    link = pdf_dir / "Aula 01_Apostila.pdf"
    try:
        link.symlink_to(outside)
    except OSError as exc:
        pytest.skip(f"symlinks unavailable: {exc}")

    snapshot = scan_course_root(root, "rfb_auditor", "Estrategia Concursos")

    assert snapshot.material_count == 0
    assert [issue.issue_kind for issue in snapshot.issues] == ["path_escape"]


def test_scanner_handles_3589_pdf_metadata_records_without_reading_content(tmp_path: Path):
    root = tmp_path / "large-package"
    pdf_dir = root / "Economia" / "PDF"
    pdf_dir.mkdir(parents=True)
    for index in range(3589):
        (pdf_dir / f"Aula {index % 100:03d}_Anexo_{index:04d}.pdf").touch()

    started = time.perf_counter()
    snapshot = scan_course_root(root, "rfb_auditor", "Estrategia Concursos")
    elapsed = time.perf_counter() - started

    assert snapshot.material_count == 3589
    assert elapsed < 10
