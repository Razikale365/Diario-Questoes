from datetime import UTC, datetime

import pytest

from study_os_service.domain.sessions import ProgressState, StudySession


NOW = datetime(2026, 7, 12, 12, 0, tzinfo=UTC)
LATER = datetime(2026, 7, 12, 12, 30, tzinfo=UTC)


def make_progress(**overrides) -> ProgressState:
    values = {
        "id": 1,
        "lesson_id": 10,
        "material_id": 20,
        "status": "in_progress",
        "cursor_page": 8,
        "furthest_page": 10,
        "completed_at": None,
        "last_seen_at": NOW,
        "confidence": 0.4,
        "total_seconds": 900,
        "session_count": 1,
        "version": 2,
    }
    values.update(overrides)
    return ProgressState(**values)


def make_session(**overrides) -> StudySession:
    values = {
        "id": 1,
        "idempotency_key": "session-1",
        "target_slug": "rfb_auditor",
        "lesson_id": 10,
        "material_id": 20,
        "state": "finished",
        "started_at": NOW,
        "ended_at": LATER,
        "elapsed_seconds": 1800,
        "start_page": 1,
        "end_page": 12,
        "questions_done": 0,
        "correct_count": 0,
        "wrong_count": 0,
        "doubt_count": 0,
        "favorite_count": 0,
        "outcome": "partial",
        "skip_reason": None,
        "notes": "",
        "version": 2,
    }
    values.update(overrides)
    return StudySession(**values)


def test_progress_accepts_material_specific_cursor():
    progress = make_progress()

    assert progress.cursor_page == 8
    assert progress.furthest_page == 10
    assert progress.status == "in_progress"


@pytest.mark.parametrize(
    ("updates", "message"),
    [
        ({"cursor_page": 0}, "cursor page"),
        ({"furthest_page": 7}, "furthest page"),
        ({"confidence": 1.1}, "confidence"),
        ({"total_seconds": -1}, "total seconds"),
        ({"session_count": -1}, "session count"),
        ({"version": 0}, "version"),
        ({"last_seen_at": datetime(2026, 7, 12)}, "timezone-aware"),
    ],
)
def test_progress_rejects_invalid_bounds(updates, message):
    with pytest.raises(ValueError, match=message):
        make_progress(**updates)


def test_finished_partial_session_is_valid():
    session = make_session()

    assert session.outcome == "partial"
    assert session.end_page == 12
    assert session.elapsed_seconds == 1800


def test_active_session_cannot_have_outcome_or_end_time():
    with pytest.raises(ValueError, match="active session"):
        make_session(state="active", outcome="partial", ended_at=LATER)


def test_finished_session_requires_outcome_and_end_time():
    with pytest.raises(ValueError, match="finished session"):
        make_session(outcome=None, ended_at=None)


@pytest.mark.parametrize(
    ("outcome", "skip_reason", "message"),
    [
        ("skipped", None, "skip reason"),
        ("partial", "fatigue", "only skipped"),
    ],
)
def test_skip_reason_matches_skipped_outcome(outcome, skip_reason, message):
    with pytest.raises(ValueError, match=message):
        make_session(outcome=outcome, skip_reason=skip_reason)


@pytest.mark.parametrize(
    "reason",
    [
        "lack_of_time",
        "fatigue",
        "wrong_material",
        "blocked_prerequisite",
        "too_difficult",
        "other",
    ],
)
def test_all_skip_reasons_are_valid(reason):
    session = make_session(outcome="skipped", skip_reason=reason, end_page=None)

    assert session.skip_reason == reason


@pytest.mark.parametrize(
    ("updates", "message"),
    [
        ({"target_slug": " "}, "target"),
        ({"start_page": 0}, "start page"),
        ({"end_page": 0}, "end page"),
        ({"elapsed_seconds": -1}, "elapsed seconds"),
        ({"wrong_count": -1}, "wrong count"),
        ({"started_at": datetime(2026, 7, 12)}, "timezone-aware"),
        ({"ended_at": NOW.replace(tzinfo=None)}, "timezone-aware"),
        ({"version": 0}, "version"),
    ],
)
def test_session_rejects_invalid_values(updates, message):
    with pytest.raises(ValueError, match=message):
        make_session(**updates)
