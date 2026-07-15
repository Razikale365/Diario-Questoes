from datetime import date

from study_os_service.domain.sprint_calendar import (
    CapacityDefaults,
    CapacityObservation,
    CapacityOverride,
    HorizonDayCapacity,
)
from study_os_service.services.sprint_capacity import suggest_horizon_capacities


TARGET = date(2026, 7, 18)


def defaults(minutes: int = 240) -> CapacityDefaults:
    return CapacityDefaults(ls_minutes=minutes, extra_minutes=30, energy_level=3)


def observation(plan_date: date, actual: int, **overrides: object) -> CapacityObservation:
    values: dict[str, object] = {
        "plan_date": plan_date,
        "planned_minutes": actual,
        "actual_minutes": actual,
        "scheduled_actions": 3,
        "completed_actions": 3,
        "energy_level": 3,
        "result_bearing": True,
        "available": True,
    }
    values.update(overrides)
    return CapacityObservation(**values)


def three_observations() -> tuple[CapacityObservation, ...]:
    return (
        observation(date(2026, 7, 4), 210),
        observation(date(2026, 7, 10), 240),
        observation(date(2026, 7, 11), 270),
    )


def override(
    scope_kind: str,
    scope_value: date | int | None,
    minutes: int,
    *,
    availability: str = "available",
    version: int = 1,
) -> CapacityOverride:
    return CapacityOverride(
        scope_kind=scope_kind,
        scope_value=scope_value,
        availability=availability,
        ls_minutes=minutes,
        extra_minutes=0 if availability == "unavailable" else 30,
        energy_level=3,
        version=version,
    )


def test_missing_days_do_not_become_zero_and_three_samples_enable_learning():
    sparse = suggest_horizon_capacities(
        dates=(TARGET,),
        defaults=defaults(),
        observations=three_observations()[:2],
        overrides=(),
        previous={},
    )
    assert sparse[0].ls_minutes == 240
    assert sparse[0].origin == "default"

    learned = suggest_horizon_capacities(
        dates=(TARGET,),
        defaults=defaults(),
        observations=three_observations(),
        overrides=(),
        previous={},
    )
    assert learned[0].origin == "learned"
    assert 180 <= learned[0].ls_minutes <= 300
    assert learned[0].confidence_bp == 5500


def test_date_override_beats_weekday_global_and_learned():
    result = suggest_horizon_capacities(
        dates=(TARGET,),
        defaults=defaults(),
        observations=three_observations(),
        overrides=(
            override("global", None, 220),
            override("weekday", TARGET.weekday(), 200),
            override("date", TARGET, 180),
        ),
        previous={},
    )
    assert result[0].origin == "manual_date"
    assert result[0].ls_minutes == 180


def test_weekday_beats_global_and_unavailable_date_is_explicit_zero():
    weekday = suggest_horizon_capacities(
        dates=(TARGET,),
        defaults=defaults(),
        observations=(),
        overrides=(
            override("global", None, 220),
            override("weekday", TARGET.weekday(), 200),
        ),
        previous={},
    )[0]
    assert (weekday.origin, weekday.ls_minutes) == ("manual_weekday", 200)

    unavailable = suggest_horizon_capacities(
        dates=(TARGET,),
        defaults=defaults(),
        observations=three_observations(),
        overrides=(override("date", TARGET, 0, availability="unavailable"),),
        previous={},
    )[0]
    assert unavailable.available is False
    assert unavailable.total_minutes == 0
    assert unavailable.origin == "manual_date"


def test_learning_ignores_non_result_and_unavailable_observations():
    excluded = (
        observation(date(2026, 7, 1), 720, result_bearing=False),
        observation(
            date(2026, 7, 2),
            0,
            planned_minutes=0,
            scheduled_actions=0,
            completed_actions=0,
            available=False,
        ),
    )
    result = suggest_horizon_capacities(
        dates=(TARGET,),
        defaults=defaults(),
        observations=three_observations()[:2] + excluded,
        overrides=(),
        previous={},
    )[0]
    assert result.origin == "default"
    assert result.ls_minutes == 240


def test_learning_is_bounded_by_default_and_previous_calendar():
    high_history = tuple(
        observation(date(2026, 7, day), 720)
        for day in (1, 2, 3)
    )
    previous = {
        TARGET: HorizonDayCapacity(
            plan_date=TARGET,
            ls_minutes=240,
            extra_minutes=30,
            energy_level=3,
            available=True,
            origin="learned",
            confidence_bp=5500,
        )
    }
    result = suggest_horizon_capacities(
        dates=(TARGET,),
        defaults=defaults(),
        observations=high_history,
        overrides=(),
        previous=previous,
    )[0]
    assert result.ls_minutes == 276
    assert result.ls_minutes <= 300


def test_removed_manual_override_does_not_leak_from_previous_calendar():
    previous = {
        TARGET: HorizonDayCapacity(
            plan_date=TARGET,
            ls_minutes=180,
            extra_minutes=0,
            energy_level=2,
            available=True,
            origin="manual_date",
            confidence_bp=10000,
        )
    }
    result = suggest_horizon_capacities(
        dates=(TARGET,),
        defaults=defaults(),
        observations=(),
        overrides=(),
        previous=previous,
    )[0]
    assert (result.origin, result.ls_minutes, result.energy_level) == (
        "default",
        240,
        3,
    )


def test_weighted_median_tie_chooses_lower_value():
    history = (
        observation(date(2026, 7, 4), 180, energy_level=1),
        observation(date(2026, 7, 11), 180, energy_level=1),
        observation(date(2026, 7, 10), 300, energy_level=3),
        observation(date(2026, 7, 9), 300, energy_level=3),
    )
    result = suggest_horizon_capacities(
        dates=(TARGET,),
        defaults=defaults(),
        observations=history,
        overrides=(),
        previous={},
    )[0]
    assert result.ls_minutes == 222
