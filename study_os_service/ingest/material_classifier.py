from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Literal
import unicodedata


MaterialKind = Literal[
    "original",
    "simplified",
    "highlighted",
    "slides",
    "mind_map",
    "summary",
    "bizu",
    "track",
    "other",
]


@dataclass(frozen=True, slots=True)
class MaterialClassification:
    kind: MaterialKind
    trust_level: int
    can_be_primary: bool


@dataclass(frozen=True, slots=True)
class ClassifiedMaterial:
    material_id: str
    kind: MaterialKind
    trust_level: int
    can_be_primary: bool

    @classmethod
    def from_classification(
        cls, material_id: str, classification: MaterialClassification
    ) -> "ClassifiedMaterial":
        return cls(
            material_id=material_id,
            kind=classification.kind,
            trust_level=classification.trust_level,
            can_be_primary=classification.can_be_primary,
        )


_POLICY: dict[MaterialKind, tuple[int, bool]] = {
    "original": (10, True),
    "simplified": (9, True),
    "highlighted": (8, True),
    "other": (7, True),
    "slides": (5, False),
    "mind_map": (5, False),
    "summary": (5, False),
    "track": (4, False),
    "bizu": (2, False),
}


def _plain(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value)
    return "".join(
        character for character in normalized if not unicodedata.combining(character)
    ).casefold()


def _classification(kind: MaterialKind) -> MaterialClassification:
    trust_level, can_be_primary = _POLICY[kind]
    return MaterialClassification(kind, trust_level, can_be_primary)


def classify_material(filename: str, course_directory: str) -> MaterialClassification:
    course = _plain(course_directory)
    evidence = _plain(filename)
    if "dicas e bizus" in course or "bizu" in course:
        return _classification("bizu")
    if "trilha estrategica" in course:
        return _classification("track")
    if "simplific" in evidence:
        return _classification("simplified")
    if "grifada" in evidence or "grifado" in evidence or "marcacao dos aprovados" in evidence:
        return _classification("highlighted")
    if "slide" in evidence:
        return _classification("slides")
    if "mapa mental" in evidence or "mapa_mental" in evidence:
        return _classification("mind_map")
    if "resumo" in evidence:
        return _classification("summary")
    if "bizu" in evidence:
        return _classification("bizu")
    if "trilha" in evidence:
        return _classification("track")
    if "apostila" in evidence or "livro eletronico" in evidence or "original" in evidence:
        return _classification("original")
    return _classification("other")


def choose_primary_material(
    materials: Iterable[ClassifiedMaterial], preference: str = "original"
) -> str | None:
    if preference not in {"original", "simplified"}:
        raise ValueError("primary material preference must be original or simplified")
    preferred_order = (
        ("original", "simplified", "highlighted", "other")
        if preference == "original"
        else ("simplified", "original", "highlighted", "other")
    )
    rank = {kind: index for index, kind in enumerate(preferred_order)}
    candidates = [material for material in materials if material.can_be_primary]
    if not candidates:
        return None
    selected = min(
        candidates,
        key=lambda material: (
            rank.get(material.kind, len(rank)),
            -material.trust_level,
            material.material_id,
        ),
    )
    return selected.material_id
