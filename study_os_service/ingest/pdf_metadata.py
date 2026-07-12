from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from pypdf import PdfReader
from pypdf.errors import PdfReadError


@dataclass(frozen=True, slots=True)
class PdfMetadata:
    page_count: int


def inspect_pdf(path: Path) -> PdfMetadata:
    resolved = Path(path).expanduser().resolve()
    if not resolved.is_file():
        raise ValueError("material must be an existing file")
    if resolved.suffix.casefold() != ".pdf":
        raise ValueError("material is not a PDF")
    try:
        with resolved.open("rb") as handle:
            page_count = len(PdfReader(handle, strict=False).pages)
    except (OSError, PdfReadError) as exc:
        raise ValueError("PDF could not be read") from exc
    if page_count < 1:
        raise ValueError("PDF has no readable pages")
    return PdfMetadata(page_count=page_count)
