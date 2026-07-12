from datetime import UTC, datetime, timedelta

import pytest

from study_os_service.domain.sessions import StudySession
from study_os_service.services.reading_rate import (
    calculate_reading_rate,
    estimate_page_target,
)


NOW = datetime(2026, 7, 12, 12, 0, tzinfo=UTC)


def session(
    session_id: int,
    *,
    start_page: int,
    end_page: int | None,
    elapsed_seconds: int,
    outcome: str = "partial",
) -> StudySession:
    return StudySession(
        id=session_id,
        idempotency_key=f"session-{session_id}",
        target_slug="rfb_auditor",
        lesson_id=10,
        material_id=20,
        state="finished",
        started_at=NOW,
        ended_at=NOW + timedelta(seconds=elapsed_seconds),
        elapsed_seconds=elapsed_seconds,
        start_page=start_page,
        end_page=end_page,
        questions_done=0,
        correct_count=0,
        wrong_count=0,
        doubt_count=0,
        favorite_count=0,
        outcome=outcome,
        skip_reason="fatigue" if outcome == "skipped" else None,
        notes="",
        version=1,
    )


def test_rate_uses_default_until_a_valid_sample_exists():
    rate = calculate_reading_rate(
        [
            session(1, start_page=1, end_page=2, elapsed_seconds=120),
            session(2, start_page=1, end_page=None, elapsed_seconds=900, outcome="skipped"),
        ]
    )

    assert rate.pages_per_hour == 20
    assert rate.sample_count == 0
    assert rate.source == "default"


def test_rate_uses_weighted_valid_partial_and_completed_sessions():
    rate = calculate_reading_rate(
        [
            session(1, start_page=1, end_page=10, elapsed_seconds=1800),
            session(
                2,
                start_page=11,
                end_page=20,
                elapsed_seconds=1800,
                outcome="completed",
            ),
            session(3, start_page=1, end_page=30, elapsed_seconds=900, outcome="failed"),
        ]
    )

    assert rate.pages_per_hour == 20
    assert rate.sample_count == 2
    assert rate.total_seconds == 3600
    assert rate.source == "observed"


@pytest.mark.parametrize(
    ("end_page", "elapsed_seconds", "expected"),
    [
        (5, 3600, 10),
        (60, 3600, 30),
    ],
)
def test_observed_rate_is_bounded(end_page, elapsed_seconds, expected):
    rate = calculate_reading_rate(
        [session(1, start_page=1, end_page=end_page, elapsed_seconds=elapsed_seconds)]
    )

    assert rate.pages_per_hour == expected


def test_page_target_honors_time_cursor_and_document_end():
    rate = calculate_reading_rate([])

    assert estimate_page_target(18, None, 60, rate) == 37
    assert estimate_page_target(18, 30, 60, rate) == 30
    assert estimate_page_target(18, 100, 30, rate) == 27


@pytest.mark.parametrize(
    ("cursor", "page_count", "minutes", "message"),
    [
        (0, 100, 60, "cursor"),
        (10, 9, 60, "page count"),
        (1, 100, 0, "minutes"),
    ],
)
def test_page_target_rejects_invalid_inputs(cursor, page_count, minutes, message):
    with pytest.raises(ValueError, match=message):
        estimate_page_target(cursor, page_count, minutes, calculate_reading_rate([]))
