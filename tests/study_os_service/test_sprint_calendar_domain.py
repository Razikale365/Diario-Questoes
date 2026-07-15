from datetime import UTC, date, datetime

import pytest

from study_os_service.domain.sprint_calendar import (
    CapacityDefaults,
    CapacityObservation,
    CapacityOverride,
    HorizonAssignmentDraft,
    HorizonDayCapacity,
    HorizonDayDraft,
    HorizonItemDraft,
    LockedCalendarAssignment,
    SprintHorizonRequest,
    SprintHorizonSnapshot,
)


def capacity(plan_date: date, **overrides: object) -> HorizonDayCapacity:
    values: dict[str, object] = {
        "plan_date": plan_date,
        "ls_minutes": 180,
        "extra_minutes": 30,
        "energy_level": 3,
        "available": True,
        "origin": "default",
        "confidence_bp": 0,
    }
    values.update(overrides)
    return HorizonDayCapacity(**values)


def item(**overrides: object) -> HorizonItemDraft:
    values: dict[str, object] = {
        "item_key": "source:ls:119790:47:1",
        "origin": "source",
        "kind": "source_task",
        "source_plan_task_id": 9,
        "subject_profile_id": 4,
        "title": "ICMS - revisão e exercícios",
        "expected_meta_number": 47,
    }
    values.update(overrides)
    return HorizonItemDraft(**values)


def assignment(**overrides: object) -> HorizonAssignmentDraft:
    values: dict[str, object] = {
        "item_key": "source:ls:119790:47:1",
        "source_plan_task_id": 9,
        "kind": "ls_execute",
        "plan_date": date(2026, 7, 18),
        "position": 1,
        "duration_minutes": 60,
        "precision": "exact",
        "priority_tier": "critical",
        "reasons": ("cycle_expires_in_two_days",),
        "pinned": False,
        "action": None,
        "expected_gain_milli": 1200,
    }
    values.update(overrides)
    return HorizonAssignmentDraft(**values)


def test_request_requires_contiguous_capacities_and_at_most_fifteen_days():
    with pytest.raises(ValueError, match="contiguous"):
        SprintHorizonRequest(
            target_slug="sefaz_ce",
            starts_on=date(2026, 7, 18),
            ends_on=date(2026, 7, 20),
            capacities=(capacity(date(2026, 7, 18)), capacity(date(2026, 7, 20))),
        )

    with pytest.raises(ValueError, match="between 1 and 15"):
        SprintHorizonRequest(
            target_slug="sefaz_ce",
            starts_on=date(2026, 7, 1),
            ends_on=date(2026, 7, 16),
            capacities=tuple(capacity(date(2026, 7, day)) for day in range(1, 17)),
        )


def test_capacity_rejects_false_availability_with_minutes_and_exposes_total():
    assert capacity(date(2026, 7, 18)).total_minutes == 210
    with pytest.raises(ValueError, match="unavailable day"):
        capacity(date(2026, 7, 18), available=False)


def test_placeholder_cannot_claim_source_subject_result_or_completion():
    with pytest.raises(ValueError, match="placeholder"):
        item(
            item_key="future-cycle:48:2026-07-18",
            origin="system",
            kind="future_cycle_capacity",
            source_plan_task_id=9,
            subject_profile_id=None,
            title="Capacidade reservada",
            expected_meta_number=48,
        )

    with pytest.raises(ValueError, match="placeholder"):
        item(
            item_key="future-cycle:48:2026-07-18",
            origin="system",
            kind="future_cycle_capacity",
            source_plan_task_id=None,
            subject_profile_id=None,
            title="Capacidade reservada",
            expected_meta_number=48,
            state="completed",
            result={"spentMinutes": 60},
            completed_at=datetime(2026, 7, 18, 12, tzinfo=UTC),
        )


@pytest.mark.parametrize(
    ("action", "expected_gain_milli"),
    [(object(), 0), (None, 1)],
)
def test_placeholder_assignment_cannot_claim_action_or_gain(action, expected_gain_milli):
    with pytest.raises(ValueError, match="placeholder assignment"):
        assignment(
            item_key="future-cycle:48:2026-07-18",
            source_plan_task_id=None,
            kind="future_cycle_capacity",
            precision="provisional",
            priority_tier="maintenance",
            action=action,
            expected_gain_milli=expected_gain_milli,
        )


def test_item_freezes_result_and_requires_source_identity_for_source_kind():
    result = {"spentMinutes": 60}
    draft = item(result=result)
    result["spentMinutes"] = 999
    assert draft.result["spentMinutes"] == 60
    with pytest.raises(TypeError):
        draft.result["spentMinutes"] = 30
    with pytest.raises(ValueError, match="source task"):
        item(source_plan_task_id=None)


def test_assignment_and_day_require_unique_matching_positions():
    first = assignment()
    with pytest.raises(ValueError, match="assignment date"):
        HorizonDayDraft(
            plan_date=date(2026, 7, 19),
            precision="exact",
            capacity=capacity(date(2026, 7, 19)),
            assignments=(first,),
        )
    with pytest.raises(ValueError, match="unique positions"):
        HorizonDayDraft(
            plan_date=date(2026, 7, 18),
            precision="exact",
            capacity=capacity(date(2026, 7, 18)),
            assignments=(first, assignment(item_key="source:2", source_plan_task_id=10)),
        )


def test_locked_assignment_is_always_protected_and_pinned():
    with pytest.raises(ValueError, match="protected"):
        LockedCalendarAssignment(
            item_key="source:1",
            plan_date=date(2026, 7, 18),
            position=1,
            duration_minutes=60,
            precision="exact",
            priority_tier="high",
            source_plan_task_id=9,
            reason="manual_pin",
        )


def test_capacity_observation_and_override_validate_real_execution_state():
    with pytest.raises(ValueError, match="completed actions"):
        CapacityObservation(
            plan_date=date(2026, 7, 14),
            planned_minutes=180,
            actual_minutes=120,
            scheduled_actions=2,
            completed_actions=3,
            energy_level=3,
            result_bearing=True,
            available=True,
        )
    with pytest.raises(ValueError, match="scope value"):
        CapacityOverride(
            scope_kind="weekday",
            scope_value=7,
            availability="available",
            ls_minutes=180,
            extra_minutes=0,
            energy_level=3,
            version=1,
        )
    defaults = CapacityDefaults(ls_minutes=240, extra_minutes=30, energy_level=3)
    assert defaults.total_minutes == 270


def test_snapshot_requires_utc_cutoff_before_validating_dependencies():
    with pytest.raises(ValueError, match="timezone-aware UTC"):
        SprintHorizonSnapshot(
            target_slug="sefaz_ce",
            planning_cutoff=datetime(2026, 7, 15, 8),
            config=None,
            subjects=(),
            projection=None,
            source_tasks=(),
            cycles=(),
            stable_items=(),
            locked_assignments=(),
            capacity_observations=(),
            override_versions={},
        )
