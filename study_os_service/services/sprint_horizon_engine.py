from __future__ import annotations

from dataclasses import replace
from datetime import date, timedelta
from math import ceil

from study_os_service.domain.sprint import SourcePlanTask
from study_os_service.domain.sprint_calendar import (
    HorizonAssignmentDraft,
    HorizonDayCapacity,
    HorizonDayDraft,
    HorizonItemDraft,
    LockedCalendarAssignment,
    SprintHorizonDraft,
    SprintHorizonRequest,
    SprintHorizonSnapshot,
)
from study_os_service.domain.sprint_evidence import SourcePlanCycle
from study_os_service.services.sprint_engine import SprintActionDraft, SprintEngine


class SprintHorizonEngine:
    algorithm_version = "sefaz-ce-calendar-v1"

    def __init__(self, daily_engine: SprintEngine | None = None):
        self.daily_engine = daily_engine or SprintEngine()

    def plan(
        self,
        *,
        request: SprintHorizonRequest,
        snapshot: SprintHorizonSnapshot,
    ) -> SprintHorizonDraft:
        self._validate(request, snapshot)
        released_cycles = tuple(
            cycle
            for cycle in snapshot.cycles
            if cycle.released_at <= snapshot.planning_cutoff
        )
        exact_through = max(
            (cycle.ends_on for cycle in released_cycles),
            default=request.starts_on - timedelta(days=1),
        )
        latest_meta = max(
            (cycle.meta_number for cycle in released_cycles if cycle.meta_number is not None),
            default=0,
        )
        cycle_by_task = {
            task.id: self._task_cycle(task, released_cycles)
            for task in snapshot.source_tasks
        }
        remaining: dict[int, SourcePlanTask] = {}
        for task in snapshot.source_tasks:
            task_cycle = cycle_by_task.get(task.id)
            if (
                task.status in {"pending", "started"}
                and task_cycle is not None
                and task_cycle.starts_on <= request.ends_on
                and task_cycle.ends_on >= request.starts_on
            ):
                remaining[task.id] = task
        items_by_key = {item.item_key: item for item in snapshot.stable_items}
        source_item_by_id = {
            item.source_plan_task_id: item
            for item in snapshot.stable_items
            if item.source_plan_task_id is not None
        }
        locks_by_date: dict[date, list[LockedCalendarAssignment]] = {}
        for locked in snapshot.locked_assignments:
            if request.starts_on <= locked.plan_date <= request.ends_on:
                locks_by_date.setdefault(locked.plan_date, []).append(locked)
                if locked.source_plan_task_id is not None:
                    remaining.pop(locked.source_plan_task_id, None)

        days: list[HorizonDayDraft] = []
        global_warnings: list[str] = []
        shortfalls: list[str] = []
        intervention_counts: dict[tuple[date, str, int], int] = {}
        virtual_simulation_present = False
        virtual_afo_count = 0

        for capacity in request.capacities:
            locked_rows = tuple(
                sorted(locks_by_date.get(capacity.plan_date, ()), key=lambda item: item.position)
            )
            assignments = [
                self._locked_assignment(item, items_by_key)
                for item in locked_rows
            ]
            assigned_item_keys = {item.item_key for item in assignments}
            used_positions = {item.position for item in assignments}
            locked_minutes = sum(item.duration_minutes for item in assignments)
            locked_from_ls = min(capacity.ls_minutes, locked_minutes)
            remaining_locked = locked_minutes - locked_from_ls
            ls_minutes = max(0, capacity.ls_minutes - locked_from_ls)
            extra_minutes = max(0, capacity.extra_minutes - remaining_locked)
            available_minutes = max(0, capacity.total_minutes - locked_minutes)
            days_remaining = (snapshot.config.objective_date - capacity.plan_date).days
            if days_remaining == 1:
                ls_cap = max(0, 120 - min(120, locked_minutes))
                extra_cap = max(0, 30 - max(0, locked_minutes - 120))
                ls_minutes = min(ls_minutes, ls_cap)
                extra_minutes = min(extra_minutes, extra_cap)
                available_minutes = min(
                    available_minutes, ls_minutes + extra_minutes
                )
            elif days_remaining == 2:
                protected_remaining = max(0, 120 - locked_minutes)
                ls_minutes = min(ls_minutes, protected_remaining)
                extra_minutes = min(
                    extra_minutes, max(0, protected_remaining - ls_minutes)
                )
                available_minutes = min(
                    available_minutes, ls_minutes + extra_minutes
                )
            day_warnings: list[str] = []
            if locked_minutes > capacity.total_minutes:
                warning = f"over_capacity:{capacity.plan_date.isoformat()}:{locked_minutes - capacity.total_minutes}"
                day_warnings.append(warning)
                global_warnings.append(warning)
                shortfalls.append(warning)

            day_precision = self._day_precision(
                capacity.plan_date,
                exact_through=exact_through,
                objective_date=snapshot.config.objective_date,
                has_locks=bool(locked_rows),
            )
            next_position = self._next_position(used_positions)

            if capacity.available and available_minutes > 0:
                if capacity.plan_date > exact_through and ls_minutes > 0:
                    expected_meta = latest_meta + 1 + max(
                        0, (capacity.plan_date - exact_through - timedelta(days=1)).days // 7
                    )
                    placeholder_key = (
                        f"future-cycle:{expected_meta}:{capacity.plan_date.isoformat()}"
                    )
                    placeholder = items_by_key.get(placeholder_key)
                    if placeholder is None:
                        placeholder = HorizonItemDraft(
                            item_key=placeholder_key,
                            origin="system",
                            kind="future_cycle_capacity",
                            source_plan_task_id=None,
                            subject_profile_id=None,
                            title=f"Capacidade reservada · aguardando Meta {expected_meta}",
                            expected_meta_number=expected_meta,
                        )
                        items_by_key[placeholder_key] = placeholder
                    assignments.append(
                        HorizonAssignmentDraft(
                            item_key=placeholder_key,
                            source_plan_task_id=None,
                            kind="future_cycle_capacity",
                            plan_date=capacity.plan_date,
                            position=next_position,
                            duration_minutes=ls_minutes,
                            precision="provisional",
                            priority_tier="maintenance",
                            reasons=("future_ls_cycle_capacity_only",),
                            pinned=False,
                            action=None,
                            expected_gain_milli=0,
                        )
                    )
                    used_positions.add(next_position)
                    next_position = self._next_position(used_positions)
                    available_minutes = max(0, available_minutes - ls_minutes)
                    ls_minutes = 0

                released_tasks = tuple(
                    task
                    for task in remaining.values()
                    if ls_minutes > 0
                    and self._cycle_allows(
                        cycle_by_task[task.id], capacity.plan_date
                    )
                )
                actions = (
                    ()
                    if capacity.plan_date > exact_through
                    else self._daily_actions(
                        snapshot=snapshot,
                        capacity=capacity,
                        ls_minutes=ls_minutes,
                        extra_minutes=extra_minutes,
                        source_tasks=released_tasks,
                        afo_rescues_this_week=virtual_afo_count,
                        has_scheduled_simulation=(
                            virtual_simulation_present
                            or any(
                                task.task_kind == "simulation"
                                for task in released_tasks
                            )
                        ),
                    )
                )
                executable = self._fit_actions(actions, available_minutes)
                source_task_quota = self._source_task_quota(
                    remaining=remaining,
                    capacities=request.capacities,
                    plan_date=capacity.plan_date,
                    cycle_by_task=cycle_by_task,
                    max_tasks_per_day=request.max_tasks_per_day,
                )
                source_tasks_assigned = 0
                normal_count = sum(
                    1
                    for action in executable
                    if not self._protected_or_critical(
                        action,
                        capacity.plan_date,
                        snapshot.config.objective_date,
                        cycle_by_task,
                    )
                )
                high_count = ceil(normal_count / 3) if normal_count else 0
                normal_index = 0
                for action in executable:
                    if (
                        action.source_plan_task_id is not None
                        and source_tasks_assigned >= source_task_quota
                    ):
                        continue
                    source_task = (
                        remaining.get(action.source_plan_task_id)
                        if action.source_plan_task_id is not None
                        else None
                    )
                    item = self._item_for_action(
                        action=action,
                        source_task=source_task,
                        plan_date=capacity.plan_date,
                        items_by_key=items_by_key,
                        source_item_by_id=source_item_by_id,
                        intervention_counts=intervention_counts,
                    )
                    if item.item_key in assigned_item_keys:
                        continue
                    tier, reason = self._priority(
                        action=action,
                        source_task=source_task,
                        plan_date=capacity.plan_date,
                        objective_date=snapshot.config.objective_date,
                        cycle_by_task=cycle_by_task,
                        normal_index=normal_index,
                        high_count=high_count,
                    )
                    if tier not in {"protected", "critical"}:
                        normal_index += 1
                    precision = (
                        "protected"
                        if tier == "protected"
                        else "exact"
                    )
                    replaces_placeholder = (
                        f"future-cycle:{source_task.meta_number}:{capacity.plan_date.isoformat()}"
                        if source_task is not None
                        and source_task.meta_number is not None
                        and f"future-cycle:{source_task.meta_number}:{capacity.plan_date.isoformat()}" in items_by_key
                        else None
                    )
                    assignments.append(
                        HorizonAssignmentDraft(
                            item_key=item.item_key,
                            source_plan_task_id=action.source_plan_task_id,
                            kind=action.action_kind,
                            plan_date=capacity.plan_date,
                            position=next_position,
                            duration_minutes=action.duration_minutes,
                            precision=precision,
                            priority_tier=tier,
                            reasons=action.rationale + (reason,),
                            pinned=False,
                            action=action,
                            expected_gain_milli=action.expected_gain_milli,
                            replaces_placeholder_item_key=replaces_placeholder,
                        )
                    )
                    assigned_item_keys.add(item.item_key)
                    used_positions.add(next_position)
                    next_position = self._next_position(used_positions)
                    if action.source_plan_task_id is not None:
                        remaining.pop(action.source_plan_task_id, None)
                        source_tasks_assigned += 1
                    if action.action_kind == "simulation":
                        virtual_simulation_present = True
                    if action.subject_key == "p1_direito_financeiro" and action.recommendation == "extra":
                        virtual_afo_count += 1

            assignments.sort(key=lambda item: item.position)
            days.append(
                HorizonDayDraft(
                    plan_date=capacity.plan_date,
                    precision=day_precision,
                    capacity=capacity,
                    assignments=tuple(assignments),
                    warnings=tuple(day_warnings),
                )
            )

        for task_id in sorted(remaining):
            shortfalls.append(f"unscheduled_source_task:{task_id}")

        return SprintHorizonDraft(
            target_slug=request.target_slug,
            starts_on=request.starts_on,
            ends_on=request.ends_on,
            exact_through=exact_through,
            planning_cutoff=snapshot.planning_cutoff,
            algorithm_version=self.algorithm_version,
            days=tuple(days),
            items=tuple(items_by_key.values()),
            warnings=tuple(dict.fromkeys(global_warnings)),
            shortfalls=tuple(dict.fromkeys(shortfalls)),
        )

    @staticmethod
    def _source_task_quota(
        *,
        remaining: dict[int, SourcePlanTask],
        capacities: tuple[HorizonDayCapacity, ...],
        plan_date: date,
        cycle_by_task: dict[int, SourcePlanCycle | None],
        max_tasks_per_day: int,
    ) -> int:
        eligible_tasks = tuple(
            task
            for task in remaining.values()
            if SprintHorizonEngine._cycle_allows(cycle_by_task[task.id], plan_date)
        )
        eligible_days = tuple(
            capacity
            for capacity in capacities
            if capacity.available
            and capacity.total_minutes > 0
            and capacity.plan_date >= plan_date
            and any(
                SprintHorizonEngine._cycle_allows(
                    cycle_by_task[task.id], capacity.plan_date
                )
                for task in eligible_tasks
            )
        )
        if not eligible_tasks or not eligible_days:
            return 0
        return min(max_tasks_per_day, ceil(len(eligible_tasks) / len(eligible_days)))

    @staticmethod
    def _validate(request: SprintHorizonRequest, snapshot: SprintHorizonSnapshot) -> None:
        if request.target_slug != snapshot.target_slug:
            raise ValueError("horizon request and snapshot targets must match")
        if request.ends_on > snapshot.config.objective_date - timedelta(days=1):
            raise ValueError("horizon must end by the day before P1")
        if snapshot.projection.as_of > request.starts_on:
            raise ValueError("projection cutoff cannot be after horizon start")

    @staticmethod
    def _task_cycle(
        task: SourcePlanTask, cycles: tuple[SourcePlanCycle, ...]
    ) -> SourcePlanCycle | None:
        if task.source_cycle_id is not None:
            for cycle in cycles:
                if cycle.id == task.source_cycle_id:
                    return cycle
        if task.meta_number is not None:
            for cycle in cycles:
                if cycle.meta_number == task.meta_number and cycle.source_kind == task.source_kind:
                    return cycle
        return None

    @staticmethod
    def _cycle_allows(cycle: SourcePlanCycle, plan_date: date) -> bool:
        return cycle.starts_on <= plan_date <= cycle.ends_on

    @staticmethod
    def _locked_assignment(
        locked: LockedCalendarAssignment,
        items_by_key: dict[str, HorizonItemDraft],
    ) -> HorizonAssignmentDraft:
        if locked.item_key not in items_by_key:
            raise ValueError(f"locked calendar item is missing: {locked.item_key}")
        return HorizonAssignmentDraft(
            item_key=locked.item_key,
            source_plan_task_id=locked.source_plan_task_id,
            kind="ls_execute" if locked.source_plan_task_id is not None else "manual",
            plan_date=locked.plan_date,
            position=locked.position,
            duration_minutes=locked.duration_minutes,
            precision="protected",
            priority_tier="protected",
            reasons=(locked.reason,),
            pinned=True,
            action=None,
            expected_gain_milli=0,
        )

    @staticmethod
    def _next_position(used: set[int]) -> int:
        position = 1
        while position in used:
            position += 1
        return position

    @staticmethod
    def _day_precision(
        plan_date: date,
        *,
        exact_through: date,
        objective_date: date,
        has_locks: bool,
    ) -> str:
        if has_locks or (objective_date - plan_date).days in {1, 2}:
            return "protected"
        return "provisional" if plan_date > exact_through else "exact"

    def _daily_actions(
        self,
        *,
        snapshot: SprintHorizonSnapshot,
        capacity: HorizonDayCapacity,
        ls_minutes: int,
        extra_minutes: int,
        source_tasks: tuple[SourcePlanTask, ...],
        afo_rescues_this_week: int,
        has_scheduled_simulation: bool,
    ) -> tuple[SprintActionDraft, ...]:
        if ls_minutes + extra_minutes < 5:
            return ()
        config = replace(
            snapshot.config,
            ls_budget_minutes=max(15, ls_minutes),
            extra_budget_minutes=extra_minutes,
        )
        return self.daily_engine.generate(
            config=config,
            subjects=snapshot.subjects,
            source_tasks=source_tasks if ls_minutes > 0 else (),
            plan_date=capacity.plan_date,
            energy_level=capacity.energy_level,
            subject_projections={
                item.subject_key: item for item in snapshot.projection.subjects
            },
            projection=snapshot.projection,
            afo_rescues_this_week=afo_rescues_this_week,
            has_scheduled_simulation=has_scheduled_simulation,
        ).actions

    @staticmethod
    def _fit_actions(
        actions: tuple[SprintActionDraft, ...], available_minutes: int
    ) -> tuple[SprintActionDraft, ...]:
        fitted: list[SprintActionDraft] = []
        remaining = available_minutes
        for action in actions:
            if action.recommendation == "defer" or remaining < 5:
                continue
            duration = min(action.duration_minutes, remaining)
            if duration < 5:
                continue
            if duration < action.duration_minutes:
                source_execution = action.source_plan_task_id is not None
                action = replace(
                    action,
                    action_kind="ls_compress" if source_execution else action.action_kind,
                    recommendation="compress" if source_execution else action.recommendation,
                    duration_minutes=duration,
                    rationale=action.rationale + ("Comprimida para respeitar a capacidade restante do dia.",),
                )
            fitted.append(action)
            remaining -= duration
        return tuple(fitted)

    @staticmethod
    def _protected_or_critical(
        action: SprintActionDraft,
        plan_date: date,
        objective_date: date,
        cycle_by_task: dict[int, SourcePlanCycle | None],
    ) -> bool:
        if (objective_date - plan_date).days in {1, 2}:
            return True
        if action.source_plan_task_id is None:
            return False
        cycle = cycle_by_task.get(action.source_plan_task_id)
        return cycle is not None and 0 <= (cycle.ends_on - plan_date).days <= 2

    @staticmethod
    def _priority(
        *,
        action: SprintActionDraft,
        source_task: SourcePlanTask | None,
        plan_date: date,
        objective_date: date,
        cycle_by_task: dict[int, SourcePlanCycle | None],
        normal_index: int,
        high_count: int,
    ) -> tuple[str, str]:
        if (objective_date - plan_date).days in {1, 2}:
            return "protected", "d_minus_protection"
        cycle = cycle_by_task.get(source_task.id) if source_task is not None else None
        if cycle is not None and 0 <= (cycle.ends_on - plan_date).days <= 2:
            return "critical", "cycle_expires_in_two_days"
        if normal_index < high_count:
            return "high", "top_third_frozen_rank"
        return "maintenance", "remaining_frozen_rank"

    @staticmethod
    def _item_for_action(
        *,
        action: SprintActionDraft,
        source_task: SourcePlanTask | None,
        plan_date: date,
        items_by_key: dict[str, HorizonItemDraft],
        source_item_by_id: dict[int, HorizonItemDraft],
        intervention_counts: dict[tuple[date, str, int], int],
    ) -> HorizonItemDraft:
        if source_task is not None:
            existing = source_item_by_id.get(source_task.id)
            if existing is not None:
                return existing
            item_key = f"source-task:{source_task.id}"
            item = HorizonItemDraft(
                item_key=item_key,
                origin="source",
                kind="source_task",
                source_plan_task_id=source_task.id,
                subject_profile_id=action.subject_profile_id,
                title=source_task.description,
                expected_meta_number=source_task.meta_number,
                state="active" if source_task.status == "started" else "pending",
            )
            items_by_key[item_key] = item
            source_item_by_id[source_task.id] = item
            return item

        counter_key = (plan_date, action.action_kind, action.subject_profile_id)
        ordinal = intervention_counts.get(counter_key, 0) + 1
        intervention_counts[counter_key] = ordinal
        item_key = (
            f"intervention:{plan_date.isoformat()}:{action.action_kind}:"
            f"{action.subject_profile_id}:{ordinal}"
        )
        existing = items_by_key.get(item_key)
        if existing is not None:
            return existing
        item = HorizonItemDraft(
            item_key=item_key,
            origin="system",
            kind="intervention",
            source_plan_task_id=None,
            subject_profile_id=action.subject_profile_id,
            title=action.title,
            expected_meta_number=None,
        )
        items_by_key[item_key] = item
        return item
