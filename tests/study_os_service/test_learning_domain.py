from datetime import UTC, date, datetime

import pytest

from study_os_service.domain.learning import (
    LearningEvent,
    ReviewQueueItem,
    TopicLearningState,
)
from study_os_service.domain.weekly import PlannerWeekRun, PlannerWeekSlot


NOW = datetime(2026, 7, 13, 12, tzinfo=UTC)


def make_event(**overrides) -> LearningEvent:
    values = {
        "id": 1,
        "idempotency_key": "block-1-result",
        "target_slug": "bacen_economia_financas",
        "topic_target_slug": "bacen_economia_financas",
        "target_topic_id": 1,
        "source_kind": "planner_block",
        "source_id": "1",
        "event_kind": "questions",
        "outcome": "completed",
        "questions_done": 20,
        "correct_count": 16,
        "wrong_count": 4,
        "doubt_count": 1,
        "favorite_count": 0,
        "elapsed_seconds": 3600,
        "start_page": None,
        "end_page": None,
        "occurred_at": NOW,
        "evidence": {"plannerRunId": 1, "tecSourceId": "bacen-macro"},
        "created_at": NOW,
    }
    values.update(overrides)
    return LearningEvent(**values)


def make_state(**overrides) -> TopicLearningState:
    values = {
        "target_slug": "bacen_economia_financas",
        "topic_target_slug": "bacen_economia_financas",
        "target_topic_id": 1,
        "mastery_bp": 7200,
        "confidence_bp": 6500,
        "coverage_status": "covered",
        "review_debt_bp": 1800,
        "last_activity_at": NOW,
        "last_success_at": NOW,
        "next_review_date": date(2026, 8, 12),
        "stale_at": date(2026, 8, 12),
        "success_streak": 2,
        "failure_streak": 0,
        "event_cursor": 4,
        "version": 1,
    }
    values.update(overrides)
    return TopicLearningState(**values)


def make_review(**overrides) -> ReviewQueueItem:
    values = {
        "id": 1,
        "target_slug": "bacen_economia_financas",
        "topic_target_slug": "bacen_economia_financas",
        "target_topic_id": 1,
        "due_date": date(2026, 7, 14),
        "state": "pending",
        "bounded_questions": 8,
        "trigger_event_ids": (1, 2),
        "reason": "wrong_and_doubt",
        "debt_bp": 3200,
        "attempt_count": 0,
        "resolved_event_id": None,
        "version": 1,
        "created_at": NOW,
        "updated_at": NOW,
    }
    values.update(overrides)
    return ReviewQueueItem(**values)


def make_week(**overrides) -> PlannerWeekRun:
    values = {
        "id": 1,
        "idempotency_key": "week-2026-07-13",
        "target_slug": "bacen_economia_financas",
        "week_start": date(2026, 7, 13),
        "phase": "pre_edital",
        "algorithm_version": "m5-v1",
        "input_hash": "abc123",
        "supersedes_week_run_id": None,
        "status": "generated",
        "shortfall_count": 0,
        "shortfall_reasons": (),
        "generated_at": NOW,
    }
    values.update(overrides)
    return PlannerWeekRun(**values)


def make_slot(**overrides) -> PlannerWeekSlot:
    values = {
        "id": 1,
        "week_run_id": 1,
        "target_slug": "bacen_economia_financas",
        "scheduled_date": date(2026, 7, 13),
        "position": 1,
        "candidate_key": "candidate-1",
        "topic_target_slug": "bacen_economia_financas",
        "target_topic_id": 1,
        "block_kind": "questions",
        "duration_minutes": 60,
        "planned_questions": 20,
        "score": {"finalScore": 32000},
        "evidence": {"forecastReason": "highest_due_value"},
        "state": "forecast",
        "day_run_id": None,
        "day_block_id": None,
    }
    values.update(overrides)
    return PlannerWeekSlot(**values)


def test_adaptive_domain_records_preserve_immutable_evidence():
    assert make_event().correct_count == 16
    assert make_state().next_review_date == date(2026, 8, 12)
    assert make_review().bounded_questions == 8
    assert make_week().week_start.weekday() == 0
    assert make_slot().score["finalScore"] == 32000


@pytest.mark.parametrize(
    "evidence",
    [
        {"question": "proprietary statement"},
        {"alternatives": ["A", "B"]},
        {"nested": {"correctAnswer": "B"}},
        {"commentHtml": "<p>copied</p>"},
    ],
)
def test_learning_event_rejects_proprietary_question_payloads(evidence):
    with pytest.raises(ValueError, match="proprietary"):
        make_event(evidence=evidence)


def test_learning_event_checks_aggregate_and_page_contracts():
    with pytest.raises(ValueError, match="result counts"):
        make_event(questions_done=10, correct_count=8, wrong_count=3)
    with pytest.raises(ValueError, match="theory"):
        make_event(
            event_kind="theory",
            questions_done=1,
            correct_count=0,
            wrong_count=0,
            doubt_count=0,
        )
    with pytest.raises(ValueError, match="page"):
        make_event(start_page=1, end_page=2)
    assert make_event(
        event_kind="theory",
        outcome="partial",
        questions_done=0,
        correct_count=0,
        wrong_count=0,
        doubt_count=0,
        start_page=1,
        end_page=25,
    ).end_page == 25


@pytest.mark.parametrize("questions", [4, 11])
def test_review_queue_enforces_bounded_proof_set(questions):
    with pytest.raises(ValueError, match="between 5 and 10"):
        make_review(bounded_questions=questions)


def test_resolved_review_requires_exact_resolution_event():
    with pytest.raises(ValueError, match="resolved event"):
        make_review(state="resolved")
    with pytest.raises(ValueError, match="unresolved"):
        make_review(state="pending", resolved_event_id=3)
    assert make_review(state="resolved", resolved_event_id=3).state == "resolved"


def test_topic_state_requires_ordered_projection_values():
    with pytest.raises(ValueError, match="mastery"):
        make_state(mastery_bp=10001)
    with pytest.raises(ValueError, match="event cursor"):
        make_state(event_cursor=-1)
    with pytest.raises(ValueError, match="last success"):
        make_state(last_activity_at=None, last_success_at=NOW)


def test_week_records_reject_non_monday_and_partial_materialization():
    with pytest.raises(ValueError, match="Monday"):
        make_week(week_start=date(2026, 7, 14))
    with pytest.raises(ValueError, match="materialized"):
        make_slot(state="materialized", day_run_id=2)
    with pytest.raises(ValueError, match="forecast"):
        make_slot(day_run_id=2, day_block_id=3)
    materialized = make_slot(
        state="materialized", day_run_id=2, day_block_id=3
    )
    assert materialized.day_block_id == 3


def test_week_shortfall_requires_matching_reasons():
    with pytest.raises(ValueError, match="shortfall"):
        make_week(status="shortfall", shortfall_count=1, shortfall_reasons=())
