from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import unicodedata

from .course_parser import normalize_discipline_candidate, parse_lesson_number
from .material_classifier import (
    ClassifiedMaterial,
    classify_material,
    choose_primary_material,
)


@dataclass(frozen=True, slots=True)
class ScanIssue:
    issue_kind: str
    severity: str
    relative_path: str
    message: str


@dataclass(frozen=True, slots=True)
class ScannedMaterial:
    absolute_path: Path
    relative_path: str
    normalized_relative_path: str
    lesson_number: int | None
    kind: str
    size_bytes: int
    modified_at_ns: int
    trust_level: int
    can_be_primary: bool


@dataclass(frozen=True, slots=True)
class ScannedLesson:
    lesson_number: int
    title: str
    sequence_index: int
    materials: tuple[ScannedMaterial, ...]
    primary_material_relative_path: str | None


@dataclass(frozen=True, slots=True)
class ScannedCourse:
    display_name: str
    relative_path: str
    discipline_candidate: str
    lessons: tuple[ScannedLesson, ...]
    materials: tuple[ScannedMaterial, ...]


@dataclass(frozen=True, slots=True)
class CourseScanSnapshot:
    root: Path
    target_slug: str
    provider: str
    courses: tuple[ScannedCourse, ...]
    issues: tuple[ScanIssue, ...]

    @property
    def material_count(self) -> int:
        return sum(len(course.materials) for course in self.courses)

    @property
    def lesson_count(self) -> int:
        return sum(len(course.lessons) for course in self.courses)


def _normalized_relative_path(path: Path, root: Path) -> str:
    relative = path.relative_to(root).as_posix()
    return unicodedata.normalize("NFKC", relative).casefold()


def _plain(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value)
    return "".join(
        character for character in normalized if not unicodedata.combining(character)
    ).casefold()


_DISCIPLINE_MARKERS = (
    "administracao",
    "auditoria",
    "comercio",
    "contabilidade",
    "direito",
    "economia",
    "estatistica",
    "financas",
    "fluencia",
    "ingles",
    "legislacao",
    "lingua",
    "macroeconomia",
    "matematica",
    "microeconomia",
    "portugues",
    "raciocinio",
    "sistema financeiro",
    "trilha estrategica",
    "dicas e bizus",
)


def _known_discipline(candidate: str) -> bool:
    plain = _plain(candidate)
    return any(marker in plain for marker in _DISCIPLINE_MARKERS)


def _scan_material(
    path: Path,
    *,
    root: Path,
    course_directory: str,
    issues: list[ScanIssue],
) -> ScannedMaterial | None:
    relative_path = path.relative_to(root).as_posix()
    resolved = path.resolve()
    try:
        resolved.relative_to(root)
    except ValueError:
        issues.append(
            ScanIssue(
                issue_kind="path_escape",
                severity="error",
                relative_path=relative_path,
                message="PDF resolves outside the registered course root",
            )
        )
        return None
    stat = resolved.stat()
    classification = classify_material(path.name, course_directory)
    return ScannedMaterial(
        absolute_path=resolved,
        relative_path=relative_path,
        normalized_relative_path=_normalized_relative_path(path, root),
        lesson_number=parse_lesson_number(path.name),
        kind=classification.kind,
        size_bytes=stat.st_size,
        modified_at_ns=stat.st_mtime_ns,
        trust_level=classification.trust_level,
        can_be_primary=classification.can_be_primary,
    )


def _build_course(
    course_dir: Path,
    pdf_dir: Path,
    *,
    root: Path,
    issues: list[ScanIssue],
) -> ScannedCourse:
    relative_course = course_dir.relative_to(root).as_posix()
    display_name = course_dir.name
    discipline_candidate = normalize_discipline_candidate(display_name)
    if not discipline_candidate or not _known_discipline(discipline_candidate):
        issues.append(
            ScanIssue(
                issue_kind="unknown_discipline",
                severity="warning",
                relative_path=relative_course,
                message=f"No canonical discipline mapping for {discipline_candidate or display_name}",
            )
        )

    materials = []
    candidates = sorted(
        (
            path
            for path in pdf_dir.rglob("*")
            if path.is_file() and path.suffix.casefold() == ".pdf"
        ),
        key=lambda path: _normalized_relative_path(path, root),
    )
    for path in candidates:
        material = _scan_material(
            path,
            root=root,
            course_directory=display_name,
            issues=issues,
        )
        if material is None:
            continue
        materials.append(material)
        if material.lesson_number is None:
            issues.append(
                ScanIssue(
                    issue_kind="unknown_lesson",
                    severity="warning",
                    relative_path=material.relative_path,
                    message="Lesson number could not be derived from the PDF filename",
                )
            )

    lessons = []
    lesson_numbers = sorted(
        {material.lesson_number for material in materials if material.lesson_number is not None}
    )
    for sequence_index, lesson_number in enumerate(lesson_numbers):
        lesson_materials = tuple(
            material for material in materials if material.lesson_number == lesson_number
        )
        classified = [
            ClassifiedMaterial(
                material_id=material.relative_path,
                kind=material.kind,
                trust_level=material.trust_level,
                can_be_primary=material.can_be_primary,
            )
            for material in lesson_materials
        ]
        lessons.append(
            ScannedLesson(
                lesson_number=lesson_number,
                title=f"Aula {lesson_number:02d}",
                sequence_index=sequence_index,
                materials=lesson_materials,
                primary_material_relative_path=choose_primary_material(classified),
            )
        )

    return ScannedCourse(
        display_name=display_name,
        relative_path=relative_course,
        discipline_candidate=discipline_candidate,
        lessons=tuple(lessons),
        materials=tuple(materials),
    )


def scan_course_root(root: Path, target_slug: str, provider: str) -> CourseScanSnapshot:
    resolved_root = Path(root).expanduser().resolve()
    if not resolved_root.is_dir():
        raise ValueError("course root must be an existing directory")
    if not target_slug.strip():
        raise ValueError("target slug is required")
    if not provider.strip():
        raise ValueError("provider is required")

    issues: list[ScanIssue] = []
    pdf_directories = sorted(
        (
            path
            for path in resolved_root.rglob("*")
            if path.is_dir() and path.name.casefold() == "pdf"
        ),
        key=lambda path: _normalized_relative_path(path, resolved_root),
    )
    courses = [
        _build_course(
            pdf_dir.parent,
            pdf_dir,
            root=resolved_root,
            issues=issues,
        )
        for pdf_dir in pdf_directories
    ]
    return CourseScanSnapshot(
        root=resolved_root,
        target_slug=target_slug.strip(),
        provider=provider.strip(),
        courses=tuple(courses),
        issues=tuple(issues),
    )
