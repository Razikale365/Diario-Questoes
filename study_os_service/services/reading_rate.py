from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Sequence

from study_os_service.domain.sessions import StudySession


@dataclass(frozen=True, slots=True)
class ReadingRate:
    pages_per_hour: float
    sample_count: int
    total_seconds: int
    source: Literal["default", "observed"]


def calculate_reading_rate(sessions: Sequence[StudySession]) -> ReadingRate:
    valid = [
        session
        for session in sessions
        if session.outcome in {"partial", "completed"}
        and session.end_page is not None
        and session.elapsed_seconds >= 300
        and session.end_page >= session.start_page
    ]
    if not valid:
        return ReadingRate(
            pages_per_hour=20.0,
            sample_count=0,
            total_seconds=0,
            source="default",
        )
    pages = sum(session.end_page - session.start_page + 1 for session in valid)
    total_seconds = sum(session.elapsed_seconds for session in valid)
    observed = pages * 3600 / total_seconds
    bounded = min(30.0, max(10.0, observed))
    return ReadingRate(
        pages_per_hour=round(bounded, 2),
        sample_count=len(valid),
        total_seconds=total_seconds,
        source="observed",
    )


def estimate_page_target(
    cursor_page: int,
    page_count: int | None,
    available_minutes: int,
    rate: ReadingRate | None = None,
) -> int:
    if isinstance(cursor_page, bool) or not isinstance(cursor_page, int) or cursor_page < 1:
        raise ValueError("cursor page must be a positive integer")
    if page_count is not None:
        if isinstance(page_count, bool) or not isinstance(page_count, int) or page_count < 1:
            raise ValueError("page count must be a positive integer")
        if page_count < cursor_page:
            raise ValueError("page count cannot precede cursor page")
    if (
        isinstance(available_minutes, bool)
        or not isinstance(available_minutes, int)
        or available_minutes < 1
    ):
        raise ValueError("available minutes must be a positive integer")
    resolved_rate = rate or calculate_reading_rate([])
    planned_pages = max(
        1, round(resolved_rate.pages_per_hour * available_minutes / 60)
    )
    target = cursor_page + planned_pages - 1
    return min(target, page_count) if page_count is not None else target
