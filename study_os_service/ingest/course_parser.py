from __future__ import annotations

from pathlib import Path
import re


_LESSON_NUMBER = re.compile(r"^\s*aula[\s_-]*(\d{1,3})(?=\D|$)", re.IGNORECASE)
_TARGET_PREFIX = re.compile(
    r"^(?:receita\s+federal|rfb)\s*(?:\([^)]*\))?\s*",
    re.IGNORECASE,
)
_PASSO_PREFIX = re.compile(r"^passo\s+estrat[eé]gico\s+de\s+", re.IGNORECASE)
_PRODUCT_SUFFIX = re.compile(r"\s+(?:regular|passo\s+estrat[eé]gico)\s*$", re.IGNORECASE)


def parse_lesson_number(filename: str) -> int | None:
    match = _LESSON_NUMBER.match(Path(filename).name)
    return int(match.group(1)) if match else None


def normalize_discipline_candidate(course_directory: str) -> str:
    value = course_directory.replace("_", " ").strip()
    value = re.sub(r"^\d+\s*[-.:]\s*", "", value)
    value = _TARGET_PREFIX.sub("", value)
    value = _PASSO_PREFIX.sub("", value)
    value = _PRODUCT_SUFFIX.sub("", value)
    return " ".join(value.split())
