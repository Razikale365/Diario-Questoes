import pytest

from study_os_service.ingest.material_classifier import (
    ClassifiedMaterial,
    classify_material,
    choose_primary_material,
)


@pytest.mark.parametrize(
    ("filename", "course_directory", "kind", "trust", "primary"),
    [
        ("Aula 01_Apostila.pdf", "Economia", "original", 10, True),
        ("Aula 01_Apostila_simplificada.pdf", "Economia", "simplified", 9, True),
        ("Aula 01_Apostila_grifada.pdf", "Economia", "highlighted", 8, True),
        ("Aula 01_01_Slide.pdf", "Economia", "slides", 5, False),
        ("Aula 001 - Mapa Mental.pdf", "Economia", "mind_map", 5, False),
        ("Aula 1 - Resumo.pdf", "Economia", "summary", 5, False),
        ("Aula 01_Bizu.pdf", "Dicas e Bizus", "bizu", 2, False),
        ("Aula 01_Trilha.pdf", "Trilha Estrategica", "track", 4, False),
        ("Aula 01_Anexo.pdf", "Economia", "other", 7, True),
    ],
)
def test_classify_material_applies_trust_and_primary_policy(
    filename: str,
    course_directory: str,
    kind: str,
    trust: int,
    primary: bool,
):
    classification = classify_material(filename, course_directory)

    assert classification.kind == kind
    assert classification.trust_level == trust
    assert classification.can_be_primary is primary


def material(material_id: str, filename: str) -> ClassifiedMaterial:
    classification = classify_material(filename, "Economia")
    return ClassifiedMaterial.from_classification(material_id, classification)


def test_original_is_default_primary_over_simplified_and_highlighted():
    materials = [
        material("simplified", "Aula 01_Apostila_simplificada.pdf"),
        material("highlighted", "Aula 01_Apostila_grifada.pdf"),
        material("original", "Aula 01_Apostila.pdf"),
    ]

    assert choose_primary_material(materials) == "original"


def test_simplified_preference_is_explicit_and_keeps_original_as_fallback():
    materials = [
        material("original", "Aula 01_Apostila.pdf"),
        material("simplified", "Aula 01_Apostila_simplificada.pdf"),
    ]

    assert choose_primary_material(materials, preference="simplified") == "simplified"


def test_other_material_is_only_a_last_resort_trusted_fallback():
    materials = [
        material("other", "Aula 01_Anexo.pdf"),
        material("highlighted", "Aula 01_Apostila_grifada.pdf"),
    ]

    assert choose_primary_material(materials) == "highlighted"


def test_bizu_track_and_supplementary_only_sets_have_no_primary():
    materials = []
    for material_id, filename, directory in (
        ("bizu", "Aula 01_Bizu.pdf", "Dicas e Bizus"),
        ("track", "Aula 01_Trilha.pdf", "Trilha Estrategica"),
        ("slides", "Aula 01_Slide.pdf", "Economia"),
    ):
        classification = classify_material(filename, directory)
        materials.append(ClassifiedMaterial.from_classification(material_id, classification))

    assert choose_primary_material(materials) is None


def test_primary_selection_is_deterministic_for_tied_fallbacks():
    materials = [
        material("z-path", "Aula 01_Anexo Z.pdf"),
        material("a-path", "Aula 01_Anexo A.pdf"),
    ]

    assert choose_primary_material(materials) == "a-path"


def test_unknown_primary_preference_is_rejected():
    with pytest.raises(ValueError, match="preference"):
        choose_primary_material([], preference="bizu")
