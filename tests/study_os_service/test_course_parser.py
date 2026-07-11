import pytest

from study_os_service.ingest.course_parser import (
    normalize_discipline_candidate,
    parse_lesson_number,
)


@pytest.mark.parametrize(
    ("filename", "lesson_number"),
    [
        ("Aula 01_Apostila.pdf", 1),
        ("Aula 1 - Resumo.pdf", 1),
        ("Aula 001 - Mapa Mental.pdf", 1),
        ("Aula_02_Apostila.pdf", 2),
        ("aUlA-09-LIVRO-ELETRONICO.PDF", 9),
        ("  Aula 00 - Introducao.pdf", 0),
        ("Aula 01_01_Slide.pdf", 1),
    ],
)
def test_parse_lesson_number_accepts_provider_filename_variants(
    filename: str, lesson_number: int
):
    assert parse_lesson_number(filename) == lesson_number


@pytest.mark.parametrize(
    "filename",
    [
        "Questao 002 - Direito Tributario.pdf",
        "2026 - Reforma Tributaria.pdf",
        "Aula 2023 - Retrospectiva.pdf",
        "PDF.pdf",
        "Material Aula 03.pdf",
        "Aula sem numero.pdf",
    ],
)
def test_parse_lesson_number_rejects_questions_years_and_non_filename_hints(
    filename: str,
):
    assert parse_lesson_number(filename) is None


@pytest.mark.parametrize(
    ("directory", "normalized"),
    [
        ("01 - Economia_e_Financas_Publicas", "Economia e Financas Publicas"),
        (
            "Receita Federal (Auditor Fiscal) Direito Tributario Regular",
            "Direito Tributario",
        ),
        (
            "Receita Federal (Auditor Fiscal) Passo Estrategico de Estatistica",
            "Estatistica",
        ),
        ("  Direito   Constitucional  ", "Direito Constitucional"),
    ],
)
def test_normalize_discipline_candidate_removes_provider_scaffolding(
    directory: str, normalized: str
):
    assert normalize_discipline_candidate(directory) == normalized
