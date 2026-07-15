from dataclasses import replace
from datetime import UTC, date, datetime, timedelta

import pytest

from study_os_service.domain.sprint_calendar import (
    HorizonDayCapacity,
    HorizonItemDraft,
    LockedCalendarAssignment,
    SprintHorizonRequest,
    SprintHorizonSnapshot,
)
from study_os_service.domain.sprint_evidence import SourcePlanCycle
from study_os_service.services.sprint import DEFAULT_SEFAZ_CONFIG
from study_os_service.services.sprint_horizon_engine import SprintHorizonEngine
from tests.study_os_service.test_sprint_engine import (
    _projection,
    _source_task,
    _subject_projections,
    _subjects,
)


CUTOFF = datetime(2026, 7, 14, 20, tzinfo=UTC)


def cycle(
    cycle_id: int = 1,
    meta: int = 47,
    starts_on: date = date(2026, 7, 11),
    ends_on: date = date(2026, 7, 17),
) -> SourcePlanCycle:
    return SourcePlanCycle(
        id=cycle_id,
        target_slug="sefaz_ce",
        source_kind="ls",
        plan_label=f"Meta {meta}",
        meta_number=meta,
        released_at=datetime.combine(starts_on, datetime.min.time(), tzinfo=UTC),
        starts_on=starts_on,
        ends_on=ends_on,
        version=1,
    )


def capacity(plan_date: date, *, energy: int = 3, ls: int = 180, extra: int = 30):
    return HorizonDayCapacity(
        plan_date=plan_date,
        ls_minutes=ls,
        extra_minutes=extra,
        energy_level=energy,
        available=True,
        origin="default",
        confidence_bp=0,
    )


def request(starts_on: date, days: int, *, energy: int = 3) -> SprintHorizonRequest:
    dates = tuple(starts_on + timedelta(days=offset) for offset in range(days))
    return SprintHorizonRequest(
        target_slug="sefaz_ce",
        starts_on=dates[0],
        ends_on=dates[-1],
        capacities=tuple(capacity(day, energy=energy) for day in dates),
    )


def source(task_id: int, *, source_cycle_id: int = 1, meta: int = 47, **kwargs):
    return replace(
        _source_task(task_id, kwargs.pop("subject_key", "p2_lte"), **kwargs),
        source_cycle_id=source_cycle_id,
        meta_number=meta,
        plan_label=f"Meta {meta}",
    )


def snapshot(
    *,
    tasks=None,
    cycles=None,
    stable_items=(),
    locked_assignments=(),
) -> SprintHorizonSnapshot:
    subjects = _subjects()
    projections = _subject_projections(subjects=subjects)
    return SprintHorizonSnapshot(
        target_slug="sefaz_ce",
        planning_cutoff=CUTOFF,
        config=DEFAULT_SEFAZ_CONFIG,
        subjects=subjects,
        projection=_projection(projections, as_of=date(2026, 7, 14)),
        source_tasks=tuple(tasks if tasks is not None else (source(1), source(2))),
        cycles=tuple(cycles if cycles is not None else (cycle(),)),
        stable_items=stable_items,
        locked_assignments=locked_assignments,
        capacity_observations=(),
        override_versions={},
    )


def assignments(draft):
    return tuple(item for day in draft.days for item in day.assignments)


def test_each_released_ls_task_is_reserved_once_across_the_horizon():
    draft = SprintHorizonEngine().plan(
        request=request(date(2026, 7, 15), 3),
        snapshot=snapshot(tasks=(source(1), source(2), source(3))),
    )
    ids = [item.source_plan_task_id for item in assignments(draft) if item.source_plan_task_id]
    assert set(ids) == {1, 2, 3}
    assert len(ids) == len(set(ids))


def test_task_is_never_scheduled_before_its_released_cycle_window():
    meta48 = replace(
        cycle(2, 48, date(2026, 7, 18), date(2026, 7, 24)),
        released_at=CUTOFF,
    )
    draft = SprintHorizonEngine().plan(
        request=request(date(2026, 7, 15), 4),
        snapshot=snapshot(
            tasks=(source(8, source_cycle_id=2, meta=48),),
            cycles=(cycle(), meta48),
        ),
    )
    reserved = next(item for item in assignments(draft) if item.source_plan_task_id == 8)
    assert reserved.plan_date == date(2026, 7, 18)


def test_released_cycle_outside_horizon_is_not_a_false_shortfall():
    later = replace(
        cycle(2, 48, date(2026, 7, 25), date(2026, 7, 31)),
        released_at=CUTOFF,
    )
    draft = SprintHorizonEngine().plan(
        request=request(date(2026, 7, 15), 3),
        snapshot=snapshot(
            tasks=(source(8, source_cycle_id=2, meta=48),),
            cycles=(cycle(), later),
        ),
    )
    assert not any(item.source_plan_task_id == 8 for item in assignments(draft))
    assert "unscheduled_source_task:8" not in draft.shortfalls


def test_unknown_meta_uses_non_executable_capacity_envelope():
    draft = SprintHorizonEngine().plan(
        request=request(date(2026, 7, 15), 15),
        snapshot=snapshot(tasks=(source(1),)),
    )
    future = next(item for item in draft.items if item.kind == "future_cycle_capacity")
    reserved = next(item for item in assignments(draft) if item.item_key == future.item_key)
    assert reserved.precision == "provisional"
    assert reserved.action is None
    assert reserved.source_plan_task_id is None
    assert reserved.expected_gain_milli == 0


def test_energy_one_and_five_change_composition_not_available_minutes():
    tasks = (
        source(1, subject_key="p1_portugues", minutes=120, task_kind="simulation"),
        source(2, subject_key="p2_lte", minutes=60, task_kind="questions"),
    )
    low = SprintHorizonEngine().plan(
        request=request(date(2026, 7, 15), 1, energy=1),
        snapshot=snapshot(tasks=tasks),
    )
    high = SprintHorizonEngine().plan(
        request=request(date(2026, 7, 15), 1, energy=5),
        snapshot=snapshot(tasks=tasks),
    )
    assert low.days[0].capacity.total_minutes == high.days[0].capacity.total_minutes
    assert [item.kind for item in low.days[0].assignments] != [
        item.kind for item in high.days[0].assignments
    ]


def test_known_ls_simulation_prevents_a_duplicate_weekend_intervention():
    weekend_cycle = replace(
        cycle(2, 48, date(2026, 7, 19), date(2026, 7, 25)),
        released_at=CUTOFF,
    )
    draft = SprintHorizonEngine().plan(
        request=request(date(2026, 7, 25), 1),
        snapshot=snapshot(
            tasks=(
                source(
                    8,
                    source_cycle_id=2,
                    meta=48,
                    subject_key="p1_portugues",
                    minutes=120,
                    task_kind="simulation",
                ),
            ),
            cycles=(cycle(), weekend_cycle),
        ),
    )
    simulations = [item for item in assignments(draft) if item.kind == "simulation"]
    assert len(simulations) == 1
    assert simulations[0].source_plan_task_id == 8


def test_d1_future_capacity_respects_120_ls_and_30_extra_caps():
    draft = SprintHorizonEngine().plan(
        request=SprintHorizonRequest(
            target_slug="sefaz_ce",
            starts_on=date(2026, 7, 31),
            ends_on=date(2026, 7, 31),
            capacities=(capacity(date(2026, 7, 31), ls=180, extra=60),),
        ),
        snapshot=snapshot(tasks=()),
    )
    day = draft.days[0]
    placeholder = next(item for item in day.assignments if item.kind == "future_cycle_capacity")
    assert placeholder.duration_minutes == 120
    assert sum(item.duration_minutes for item in day.assignments) <= 150
    assert day.precision == "protected"


def test_locked_completed_item_stays_on_its_original_date_and_can_overload():
    completed = HorizonItemDraft(
        item_key="source-task:99",
        origin="source",
        kind="source_task",
        source_plan_task_id=99,
        subject_profile_id=4,
        title="Tarefa concluída",
        expected_meta_number=47,
        state="completed",
        result={"spentMinutes": 240},
        completed_at=datetime(2026, 7, 15, 12, tzinfo=UTC),
    )
    lock = LockedCalendarAssignment(
        item_key=completed.item_key,
        plan_date=date(2026, 7, 15),
        position=1,
        duration_minutes=240,
        precision="protected",
        priority_tier="protected",
        source_plan_task_id=99,
        reason="completed",
        state="completed",
    )
    draft = SprintHorizonEngine().plan(
        request=SprintHorizonRequest(
            target_slug="sefaz_ce",
            starts_on=date(2026, 7, 15),
            ends_on=date(2026, 7, 15),
            capacities=(capacity(date(2026, 7, 15), ls=180, extra=0),),
        ),
        snapshot=snapshot(tasks=(), stable_items=(completed,), locked_assignments=(lock,)),
    )
    reserved = next(item for item in assignments(draft) if item.item_key == completed.item_key)
    assert (reserved.plan_date, reserved.precision, reserved.pinned) == (
        date(2026, 7, 15),
        "protected",
        True,
    )
    assert draft.days[0].overage_minutes == 60
    assert any("over_capacity" in warning for warning in draft.days[0].warnings)


def test_horizon_cannot_include_p1_itself():
    with pytest.raises(ValueError, match="day before P1"):
        SprintHorizonEngine().plan(
            request=request(date(2026, 7, 31), 2),
            snapshot=snapshot(tasks=()),
        )
