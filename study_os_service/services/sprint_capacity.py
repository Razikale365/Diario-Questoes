from __future__ import annotations

from datetime import date, timedelta
from typing import Mapping

from study_os_service.domain.sprint_calendar import (
    CapacityDefaults,
    CapacityObservation,
    CapacityOverride,
    HorizonDayCapacity,
)


_OVERRIDE_PRECEDENCE = {"global": 1, "weekday": 2, "date": 3}


def _effective_minutes(item: CapacityObservation) -> int:
    if item.scheduled_actions <= 0:
        return item.actual_minutes
    ratio = item.completed_actions / item.scheduled_actions
    return round(
        item.actual_minutes
        + max(0, item.planned_minutes - item.actual_minutes) * ratio
    )


def _sample_weight(item: CapacityObservation, target: date, energy: int) -> int:
    weight = 1
    if item.plan_date.weekday() == target.weekday():
        weight *= 2
    if abs(item.energy_level - energy) <= 1:
        weight *= 2
    return min(4, weight)


def _weighted_median(values: tuple[tuple[int, int], ...]) -> int:
    ordered = sorted(values, key=lambda pair: pair[0])
    total_weight = sum(weight for _, weight in ordered)
    cumulative = 0
    for value, weight in ordered:
        cumulative += weight
        if cumulative * 2 >= total_weight:
            return value
    raise ValueError("weighted median requires at least one value")


def _bounded_update(default: int, previous: int, observed: int) -> int:
    blended = round(previous * 0.70 + observed * 0.30)
    floor, ceiling = round(default * 0.75), round(default * 1.25)
    step_floor, step_ceiling = round(previous * 0.85), round(previous * 1.15)
    return min(ceiling, step_ceiling, max(floor, step_floor, blended))


def _manual_override(
    overrides: tuple[CapacityOverride, ...], target: date
) -> CapacityOverride | None:
    applicable = tuple(item for item in overrides if item.applies_to(target))
    if not applicable:
        return None
    return max(
        applicable,
        key=lambda item: (_OVERRIDE_PRECEDENCE[item.scope_kind], item.version),
    )


def _eligible_observations(
    observations: tuple[CapacityObservation, ...], horizon_start: date
) -> tuple[CapacityObservation, ...]:
    lookback_start = horizon_start - timedelta(days=14)
    return tuple(
        item
        for item in observations
        if lookback_start <= item.plan_date < horizon_start
        and item.available
        and item.result_bearing
        and item.scheduled_actions > 0
        and item.completed_actions > 0
    )


def suggest_horizon_capacities(
    *,
    dates: tuple[date, ...],
    defaults: CapacityDefaults,
    observations: tuple[CapacityObservation, ...],
    overrides: tuple[CapacityOverride, ...],
    previous: Mapping[date, HorizonDayCapacity],
) -> tuple[HorizonDayCapacity, ...]:
    if not isinstance(dates, tuple) or len(set(dates)) != len(dates):
        raise ValueError("capacity dates must be a unique tuple")
    if not isinstance(observations, tuple) or not isinstance(overrides, tuple):
        raise ValueError("capacity observations and overrides must be tuples")
    if not isinstance(previous, Mapping):
        raise ValueError("previous capacities must be a mapping")

    samples = _eligible_observations(observations, min(dates)) if dates else ()
    suggestions: list[HorizonDayCapacity] = []
    for target in dates:
        prior = previous.get(target)
        prior_learned = (
            prior
            if prior is not None and prior.available and prior.origin == "learned"
            else None
        )
        base_ls = prior_learned.ls_minutes if prior_learned is not None else defaults.ls_minutes
        base_extra = defaults.extra_minutes
        energy = defaults.energy_level
        origin = "learned" if prior_learned is not None else "default"
        confidence = prior_learned.confidence_bp if prior_learned is not None else 0

        if len(samples) >= 3:
            observed = _weighted_median(
                tuple(
                    (_effective_minutes(item), _sample_weight(item, target, energy))
                    for item in samples
                )
            )
            base_ls = _bounded_update(defaults.ls_minutes, base_ls, observed)
            origin = "learned"
            confidence = min(9000, 5500 + 1000 * (len(samples) - 3))

        manual = _manual_override(overrides, target)
        if manual is not None and manual.availability == "unavailable":
            suggestions.append(
                HorizonDayCapacity(
                    plan_date=target,
                    ls_minutes=0,
                    extra_minutes=0,
                    energy_level=manual.energy_level or energy,
                    available=False,
                    origin=manual.origin,
                    confidence_bp=10000,
                )
            )
            continue
        if manual is not None:
            base_ls = manual.ls_minutes if manual.ls_minutes is not None else base_ls
            base_extra = (
                manual.extra_minutes
                if manual.extra_minutes is not None
                else base_extra
            )
            energy = manual.energy_level if manual.energy_level is not None else energy
            origin = manual.origin
            confidence = 10000

        suggestions.append(
            HorizonDayCapacity(
                plan_date=target,
                ls_minutes=base_ls,
                extra_minutes=base_extra,
                energy_level=energy,
                available=True,
                origin=origin,
                confidence_bp=confidence,
            )
        )
    return tuple(suggestions)
