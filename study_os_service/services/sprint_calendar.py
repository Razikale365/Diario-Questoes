from __future__ import annotations

from dataclasses import fields, is_dataclass, replace
from datetime import UTC, date, datetime, timedelta
import hashlib
import json
import sqlite3
from typing import Any, Callable, Mapping

from study_os_service.domain.sprint_calendar import (
    CapacityDefaults,
    CapacityObservation,
    CapacityOverride,
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
from study_os_service.repositories.sprint import SprintRepository
from study_os_service.repositories.sprint_calendar import (
    CalendarIdempotencyConflictError,
    CalendarOverrideConflictError,
    CalendarRunStateError,
    CalendarSupersessionConflictError,
    SprintCalendarRepository,
)
from study_os_service.services.sprint import SprintProfileService
from study_os_service.services.sprint_capacity import suggest_horizon_capacities
from study_os_service.services.sprint_horizon_engine import SprintHorizonEngine
from study_os_service.services.sprint_projection import (
    SprintProjectionService,
    projection_document,
)


CalendarDocument = dict[str, Any]


def _json_ready(value: object) -> object:
    if is_dataclass(value) and not isinstance(value, type):
        return {
            field.name: _json_ready(getattr(value, field.name))
            for field in fields(value)
        }
    if isinstance(value, Mapping):
        return {str(key): _json_ready(item) for key, item in value.items()}
    if isinstance(value, (tuple, list, set, frozenset)):
        return [_json_ready(item) for item in value]
    if isinstance(value, datetime):
        return _timestamp_text(value)
    if isinstance(value, date):
        return value.isoformat()
    return value


def _canonical_json(value: object) -> str:
    return json.dumps(
        _json_ready(value),
        ensure_ascii=True,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    )


def _hash(value: object) -> str:
    return hashlib.sha256(_canonical_json(value).encode("utf-8")).hexdigest()


def _required_text(value: object, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{label} is required")
    return value.strip()


def _optional_integer(value: object, label: str) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise ValueError(f"{label} must be a positive integer or null")
    return value


def _date(value: object, label: str) -> date:
    if not isinstance(value, str):
        raise ValueError(f"{label} must use YYYY-MM-DD")
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError(f"{label} must use YYYY-MM-DD") from exc


def _timestamp(value: str | None) -> datetime | None:
    if value is None:
        return None
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError("stored calendar timestamp must be timezone-aware")
    return parsed.astimezone(UTC)


def _timestamp_text(value: datetime) -> str:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("calendar clock must be timezone-aware")
    return value.astimezone(UTC).isoformat(timespec="microseconds").replace(
        "+00:00", "Z"
    )


def _json_object(value: str) -> dict[str, Any]:
    parsed = json.loads(value)
    if not isinstance(parsed, dict):
        raise ValueError("stored calendar JSON must be an object")
    return parsed


def _json_array(value: str) -> list[Any]:
    parsed = json.loads(value)
    if not isinstance(parsed, list):
        raise ValueError("stored calendar JSON must be an array")
    return parsed


class SprintCalendarService:
    preview_modes = {"reflow_open", "fill_open", "restore_run"}

    def __init__(
        self,
        connection: sqlite3.Connection,
        *,
        clock: Callable[[], datetime] | None = None,
        engine: SprintHorizonEngine | None = None,
    ):
        self.connection = connection
        self.repository = SprintCalendarRepository(connection)
        self.sprint_repository = SprintRepository(connection)
        self.engine = engine or SprintHorizonEngine()
        self.clock = clock or (lambda: datetime.now(UTC))

    def preview(
        self, payload: Mapping[str, Any], *, idempotency_key: str
    ) -> CalendarDocument:
        prepared = self._prepare_preview(payload, idempotency_key)
        target_slug = prepared["target_slug"]
        starts_on = prepared["starts_on"]
        planning_cutoff = prepared["planning_cutoff"]

        config, subjects = SprintProfileService(self.connection).bootstrap(
            target_slug
        )
        self._validate_window(starts_on, prepared["ends_on"], config.objective_date)
        projection = SprintProjectionService(self.connection).project(
            target_slug,
            min(starts_on, planning_cutoff.date()),
        )

        self.connection.execute("BEGIN IMMEDIATE")
        try:
            existing = self.repository.get_run_by_idempotency(
                prepared["storage_key"]
            )
            if existing is not None:
                if existing["request_hash"] != prepared["request_hash"]:
                    raise CalendarIdempotencyConflictError(
                        "calendar idempotency key was reused with another payload"
                    )
                response = self._calendar_document(existing, include_diff=True)
                self.connection.commit()
                return response | {"replayed": True}

            self._require_head(target_slug, prepared["expected_run_id"])
            tasks = self.sprint_repository.list_source_tasks(
                target_slug, include_inactive=True
            )
            cycles = self._list_cycles(target_slug)
            stable_items = self._stable_items(target_slug)
            locked_assignments = self._locked_assignments(
                target_slug=target_slug,
                starts_on=starts_on,
                ends_on=prepared["ends_on"],
                mode=prepared["mode"],
                planning_date=planning_cutoff.date(),
            )
            observations = self._capacity_observations(target_slug, starts_on)
            overrides = self._capacity_overrides(target_slug)
            previous = self._previous_capacities(target_slug)
            dates = tuple(
                starts_on + timedelta(days=offset)
                for offset in range(
                    (prepared["ends_on"] - starts_on).days + 1
                )
            )
            capacities = suggest_horizon_capacities(
                dates=dates,
                defaults=CapacityDefaults(
                    ls_minutes=config.ls_budget_minutes,
                    extra_minutes=config.extra_budget_minutes,
                    energy_level=3,
                ),
                observations=observations,
                overrides=overrides,
                previous=previous,
            )
            override_versions = self._override_versions(target_slug)
            snapshot = SprintHorizonSnapshot(
                target_slug=target_slug,
                planning_cutoff=planning_cutoff,
                config=config,
                subjects=subjects,
                projection=projection,
                source_tasks=tasks,
                cycles=cycles,
                stable_items=stable_items,
                locked_assignments=locked_assignments,
                capacity_observations=observations,
                override_versions=override_versions,
            )
            request = SprintHorizonRequest(
                target_slug=target_slug,
                starts_on=starts_on,
                ends_on=prepared["ends_on"],
                capacities=capacities,
            )
            draft = self.engine.plan(request=request, snapshot=snapshot)
            if prepared["mode"] == "restore_run":
                draft = self._restore_draft(
                    draft, prepared["restore_run_id"], tasks
                )

            projection_snapshot = projection_document(projection)
            capacity_snapshot = {
                "defaults": {
                    "lsMinutes": config.ls_budget_minutes,
                    "extraMinutes": config.extra_budget_minutes,
                    "energyLevel": 3,
                },
                "days": [self._capacity_value(item) for item in capacities],
                "overrideVersions": override_versions,
            }
            input_hash = self._input_hash(
                config=config,
                subjects=subjects,
                projection_snapshot=projection_snapshot,
                tasks=tasks,
                cycles=cycles,
                stable_items=stable_items,
                locked_assignments=locked_assignments,
                capacity_snapshot=capacity_snapshot,
                planning_cutoff=planning_cutoff,
            )
            saved = self.repository.insert_preview_in_transaction(
                idempotency_key=prepared["storage_key"],
                request_hash=prepared["request_hash"],
                input_hash=input_hash,
                base_applied_run_id=prepared["expected_run_id"],
                draft=draft,
                projection_snapshot=projection_snapshot,
                capacity_snapshot=capacity_snapshot,
            )
            response = self._calendar_document(saved, include_diff=True)
            self.connection.commit()
            return response | {"replayed": False}
        except Exception:
            self.connection.rollback()
            raise

    def apply(
        self,
        run_id: int,
        payload: Mapping[str, Any],
        *,
        idempotency_key: str,
    ) -> CalendarDocument:
        if isinstance(run_id, bool) or not isinstance(run_id, int) or run_id < 1:
            raise ValueError("calendar run id must be a positive integer")
        if not isinstance(payload, Mapping):
            raise ValueError("calendar apply payload must be an object")
        key = _required_text(idempotency_key, "Idempotency-Key")
        expected_head = _optional_integer(
            payload.get("expectedRunId"), "expected run id"
        )
        expected_overrides = self._version_map(
            payload.get("expectedOverrideVersions", {})
        )
        payload_hash = _hash({"runId": run_id, "payload": dict(payload)})
        receipt_key = f"calendar-apply:{key}"

        self.connection.execute("BEGIN IMMEDIATE")
        try:
            receipt = self.sprint_repository.get_receipt(receipt_key)
            if receipt is not None:
                if receipt["payload_hash"] != payload_hash:
                    raise CalendarIdempotencyConflictError(
                        "calendar apply key was reused with another payload"
                    )
                response = _json_object(receipt["response_json"])
                self.connection.commit()
                return response | {"replayed": True}

            run = self.repository.get_run(run_id)
            if run is None:
                raise CalendarRunStateError("calendar draft was not found")
            snapshot = _json_object(run["capacity_snapshot_json"])
            preview_versions = self._version_map(
                snapshot.get("overrideVersions", {})
            )
            if expected_overrides != preview_versions:
                raise CalendarOverrideConflictError(
                    "calendar override versions do not match the preview"
                )
            if self._override_versions(run["target_slug"]) != expected_overrides:
                raise CalendarOverrideConflictError("calendar override changed")

            applied = self.repository.apply_run_in_transaction(
                run_id, expected_head
            )
            response = self._calendar_document(applied, include_diff=True) | {
                "undoRunId": expected_head,
                "replayed": False,
            }
            self.sprint_repository.save_receipt(
                idempotency_key=receipt_key,
                mutation_kind="calendar_apply",
                target_slug=applied["target_slug"],
                entity_ref=str(run_id),
                payload_hash=payload_hash,
                response=response,
            )
            self.connection.commit()
            return response
        except Exception:
            self.connection.rollback()
            raise

    def get_head(
        self, target_slug: str, start_date: date | None = None
    ) -> CalendarDocument | None:
        del start_date
        row = self.repository.get_head(_required_text(target_slug, "target"))
        if row is None:
            return None
        return self._calendar_document(row, include_diff=True) | {
            "replayed": False
        }

    def get_run(self, run_id: int) -> CalendarDocument | None:
        row = self.repository.get_run(run_id)
        if row is None:
            return None
        return self._calendar_document(row, include_diff=True) | {
            "replayed": False
        }

    def update_day_override(
        self, payload: Mapping[str, Any]
    ) -> dict[str, Any]:
        if not isinstance(payload, Mapping):
            raise ValueError("calendar day override must be an object")
        target_slug = _required_text(payload.get("targetSlug"), "target")
        scope_kind = _required_text(payload.get("scopeKind"), "scope kind")
        scope_value = _required_text(payload.get("scopeValue"), "scope value")
        availability = _required_text(
            payload.get("availability"), "availability"
        )
        if scope_kind not in {"date", "weekday", "global"}:
            raise ValueError("invalid calendar override scope")
        if availability not in {"default", "available", "unavailable"}:
            raise ValueError("invalid calendar availability")
        ls_minutes = self._bounded_optional(
            payload.get("lsMinutes"), "LS minutes", 0, 720
        )
        extra_minutes = self._bounded_optional(
            payload.get("extraMinutes"), "extra minutes", 0, 240
        )
        energy_level = self._bounded_optional(
            payload.get("energyLevel"), "energy level", 1, 5
        )
        expected_version = _optional_integer(
            payload.get("expectedVersion"), "expected version"
        )
        self.connection.execute("BEGIN IMMEDIATE")
        try:
            saved = self.repository.upsert_day_override(
                target_slug=target_slug,
                scope_kind=scope_kind,
                scope_value=scope_value,
                availability=availability,
                ls_minutes=ls_minutes,
                extra_minutes=extra_minutes,
                energy_level=energy_level,
                expected_version=expected_version,
            )
            response = self._day_override_document(saved)
            self.connection.commit()
            return response
        except Exception:
            self.connection.rollback()
            raise

    def update_item_override(
        self, payload: Mapping[str, Any]
    ) -> dict[str, Any]:
        if not isinstance(payload, Mapping):
            raise ValueError("calendar item override must be an object")
        target_slug = _required_text(payload.get("targetSlug"), "target")
        item_id = _optional_integer(payload.get("itemId"), "item id")
        if item_id is None:
            raise ValueError("item id is required")
        plan_date = _date(payload.get("planDate"), "plan date").isoformat()
        start_time = payload.get("startTime")
        if start_time is not None:
            start_time = _required_text(start_time, "start time")
        position = self._bounded_optional(
            payload.get("position"), "position", 1, 10_000
        )
        duration = self._bounded_optional(
            payload.get("durationMinutes"), "duration minutes", 1, 720
        )
        pinned = payload.get("pinned", True)
        if not isinstance(pinned, bool):
            raise ValueError("pinned must be boolean")
        expected_version = _optional_integer(
            payload.get("expectedVersion"), "expected version"
        )
        self.connection.execute("BEGIN IMMEDIATE")
        try:
            item = self.repository.get_item(item_id)
            if item is None or item["target_slug"] != target_slug:
                raise CalendarRunStateError("calendar item was not found")
            saved = self.repository.upsert_item_override(
                target_slug=target_slug,
                item_id=item_id,
                plan_date=plan_date,
                start_time=start_time,
                position=position,
                duration_minutes=duration,
                pinned=pinned,
                expected_version=expected_version,
            )
            response = self._item_override_document(saved)
            self.connection.commit()
            return response
        except Exception:
            self.connection.rollback()
            raise

    def create_manual_item(
        self,
        payload: Mapping[str, Any],
        *,
        idempotency_key: str,
    ) -> dict[str, Any]:
        if not isinstance(payload, Mapping):
            raise ValueError("manual calendar item must be an object")
        key = _required_text(idempotency_key, "Idempotency-Key")
        target_slug = _required_text(payload.get("targetSlug"), "target")
        title = _required_text(payload.get("title"), "title")
        plan_date = _date(payload.get("planDate"), "plan date").isoformat()
        start_time = payload.get("startTime")
        if start_time is not None:
            start_time = _required_text(start_time, "start time")
        duration = self._bounded_optional(
            payload.get("durationMinutes"), "duration minutes", 1, 720
        )
        if duration is None:
            raise ValueError("duration minutes are required")
        position = self._bounded_optional(
            payload.get("position"), "position", 1, 10_000
        )
        request_hash = _hash(dict(payload))
        receipt_key = f"calendar-manual:{key}"

        self.connection.execute("BEGIN IMMEDIATE")
        try:
            receipt = self.sprint_repository.get_receipt(receipt_key)
            if receipt is not None:
                if receipt["payload_hash"] != request_hash:
                    raise CalendarIdempotencyConflictError(
                        "manual item key was reused with another payload"
                    )
                response = _json_object(receipt["response_json"])
                self.connection.commit()
                return response | {"replayed": True}
            if not self.sprint_repository.target_exists(target_slug):
                raise CalendarRunStateError("calendar target was not found")
            temporary_key = f"manual:pending:{request_hash[:24]}"
            cursor = self.connection.execute(
                """
                INSERT INTO sprint_calendar_items (
                  target_slug, item_key, origin, kind, title, state
                ) VALUES (?, ?, 'manual', 'manual', ?, 'pending')
                """,
                (target_slug, temporary_key, title),
            )
            item_id = cursor.lastrowid
            if item_id is None:
                raise RuntimeError("manual calendar item did not produce an id")
            self.connection.execute(
                """
                UPDATE sprint_calendar_items SET item_key=? WHERE id=?
                """,
                (f"manual:{item_id}", item_id),
            )
            override = self.repository.upsert_item_override(
                target_slug=target_slug,
                item_id=item_id,
                plan_date=plan_date,
                start_time=start_time,
                position=position,
                duration_minutes=duration,
                pinned=True,
                expected_version=None,
            )
            item = self.repository.get_item(item_id)
            if item is None:
                raise RuntimeError("manual calendar item was not visible")
            response = {
                "item": self._item_document(item),
                "override": self._item_override_document(override),
                "replayed": False,
            }
            self.sprint_repository.save_receipt(
                idempotency_key=receipt_key,
                mutation_kind="calendar_manual_item",
                target_slug=target_slug,
                entity_ref=str(item_id),
                payload_hash=request_hash,
                response=response,
            )
            self.connection.commit()
            return response
        except Exception:
            self.connection.rollback()
            raise

    @staticmethod
    def _bounded_optional(
        value: object,
        label: str,
        minimum: int,
        maximum: int,
    ) -> int | None:
        if value is None:
            return None
        if (
            isinstance(value, bool)
            or not isinstance(value, int)
            or not minimum <= value <= maximum
        ):
            raise ValueError(f"{label} must be between {minimum} and {maximum}")
        return value

    @staticmethod
    def _day_override_document(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"],
            "targetSlug": row["target_slug"],
            "scopeKind": row["scope_kind"],
            "scopeValue": row["scope_value"],
            "availability": row["availability"],
            "lsMinutes": row["ls_minutes"],
            "extraMinutes": row["extra_minutes"],
            "energyLevel": row["energy_level"],
            "active": bool(row["active"]),
            "version": row["version"],
        }

    @staticmethod
    def _item_override_document(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"],
            "targetSlug": row["target_slug"],
            "itemId": row["item_id"],
            "planDate": row["plan_date"],
            "startTime": row["start_time"],
            "position": row["position"],
            "durationMinutes": row["duration_minutes"],
            "pinned": bool(row["pinned"]),
            "active": bool(row["active"]),
            "version": row["version"],
        }

    def _prepare_preview(
        self, payload: Mapping[str, Any], idempotency_key: str
    ) -> dict[str, Any]:
        if not isinstance(payload, Mapping):
            raise ValueError("calendar preview payload must be an object")
        key = _required_text(idempotency_key, "Idempotency-Key")
        target_slug = _required_text(payload.get("targetSlug"), "target")
        starts_on = _date(payload.get("startDate"), "start date")
        ends_on = _date(payload.get("endDate"), "end date")
        expected_run_id = _optional_integer(
            payload.get("expectedRunId"), "expected run id"
        )
        mode = _required_text(payload.get("mode"), "preview mode")
        if mode not in self.preview_modes:
            raise ValueError("invalid calendar preview mode")
        restore_run_id = _optional_integer(
            payload.get("restoreRunId"), "restore run id"
        )
        if (mode == "restore_run") != (restore_run_id is not None):
            raise ValueError(
                "restoreRunId is required exactly for restore_run mode"
            )
        now = self.clock()
        planning_cutoff = datetime.fromisoformat(_timestamp_text(now))
        canonical_payload = {
            "targetSlug": target_slug,
            "startDate": starts_on.isoformat(),
            "endDate": ends_on.isoformat(),
            "expectedRunId": expected_run_id,
            "mode": mode,
            "restoreRunId": restore_run_id,
        }
        return {
            "target_slug": target_slug,
            "starts_on": starts_on,
            "ends_on": ends_on,
            "expected_run_id": expected_run_id,
            "mode": mode,
            "restore_run_id": restore_run_id,
            "planning_cutoff": planning_cutoff,
            "request_hash": _hash(canonical_payload),
            "storage_key": f"calendar-preview:{key}",
        }

    @staticmethod
    def _validate_window(starts_on: date, ends_on: date, objective: date) -> None:
        day_count = (ends_on - starts_on).days + 1
        if not 1 <= day_count <= 15:
            raise ValueError("calendar window must contain between 1 and 15 days")
        if ends_on > objective - timedelta(days=1):
            raise ValueError("calendar window must end by the day before P1")

    def _require_head(
        self, target_slug: str, expected_run_id: int | None
    ) -> None:
        head = self.repository.get_head(target_slug)
        actual = head["id"] if head is not None else None
        if actual != expected_run_id:
            raise CalendarSupersessionConflictError("calendar head changed")

    def _list_cycles(self, target_slug: str) -> tuple[SourcePlanCycle, ...]:
        rows = self.connection.execute(
            """
            SELECT * FROM source_plan_cycles
            WHERE target_slug=?
            ORDER BY starts_on, ends_on, id
            """,
            (target_slug,),
        )
        return tuple(
            SourcePlanCycle(
                id=row["id"],
                target_slug=row["target_slug"],
                source_kind=row["source_kind"],
                plan_label=row["plan_label"],
                meta_number=row["meta_number"],
                released_at=_timestamp(row["released_at"]),
                starts_on=date.fromisoformat(row["starts_on"]),
                ends_on=date.fromisoformat(row["ends_on"]),
                version=row["version"],
            )
            for row in rows
        )

    def _stable_items(self, target_slug: str) -> tuple[HorizonItemDraft, ...]:
        rows = self.connection.execute(
            """
            SELECT * FROM sprint_calendar_items
            WHERE target_slug=?
            ORDER BY id
            """,
            (target_slug,),
        )
        return tuple(
            HorizonItemDraft(
                item_key=row["item_key"],
                origin=row["origin"],
                kind=row["kind"],
                source_plan_task_id=row["source_plan_task_id"],
                subject_profile_id=row["subject_profile_id"],
                title=row["title"],
                expected_meta_number=row["expected_meta_number"],
                state=row["state"],
                result=_json_object(row["result_json"]),
                completed_at=_timestamp(row["completed_at"]),
                version=row["version"],
            )
            for row in rows
        )

    def _locked_assignments(
        self,
        *,
        target_slug: str,
        starts_on: date,
        ends_on: date,
        mode: str,
        planning_date: date,
    ) -> tuple[LockedCalendarAssignment, ...]:
        head = self.repository.get_head(target_slug)
        override_rows = self.repository.list_item_overrides(target_slug)
        overrides = {
            row["item_id"]: row
            for row in override_rows
        }
        rows = (
            tuple(
                self.connection.execute(
                    """
                    SELECT assignment.*, item.item_key, item.kind, item.state,
                           item.source_plan_task_id,
                           source.status AS source_status
                    FROM sprint_calendar_assignments AS assignment
                    JOIN sprint_calendar_items AS item
                      ON item.id=assignment.item_id
                     AND item.target_slug=assignment.target_slug
                    LEFT JOIN source_plan_tasks AS source
                      ON source.id=item.source_plan_task_id
                    WHERE assignment.run_id=?
                    ORDER BY assignment.plan_date, assignment.position
                    """,
                    (head["id"],),
                )
            )
            if head is not None
            else ()
        )
        candidates: list[dict[str, Any]] = []
        assigned_item_ids: set[int] = set()
        for row in rows:
            assigned_item_ids.add(row["item_id"])
            original_date = date.fromisoformat(row["plan_date"])
            override = overrides.get(row["item_id"])
            plan_date = (
                date.fromisoformat(override["plan_date"])
                if override is not None
                else original_date
            )
            fixed = (
                original_date < planning_date
                or row["state"] in {"completed", "active"}
                or row["source_status"] == "started"
                or row["kind"] == "manual"
                or bool(row["pinned_snapshot"])
                or override is not None
                or mode == "fill_open"
            )
            if not fixed or not starts_on <= plan_date <= ends_on:
                continue
            candidates.append(
                {
                    "item_key": row["item_key"],
                    "plan_date": plan_date,
                    "position": (
                        override["position"]
                        if override is not None and override["position"] is not None
                        else row["position"]
                    ),
                    "duration": (
                        override["duration_minutes"]
                        if override is not None
                        and override["duration_minutes"] is not None
                        else row["duration_minutes"]
                    ),
                    "source_id": row["source_plan_task_id"],
                    "state": row["state"],
                    "reason": (
                        "manual_pin"
                        if override is not None
                        else "preserved_calendar_assignment"
                    ),
                }
            )
        for override in override_rows:
            if override["item_id"] in assigned_item_ids:
                continue
            item = self.repository.get_item(override["item_id"])
            if item is None or item["target_slug"] != target_slug:
                raise CalendarRunStateError("pinned calendar item was not found")
            plan_date = date.fromisoformat(override["plan_date"])
            if not starts_on <= plan_date <= ends_on:
                continue
            candidates.append(
                {
                    "item_key": item["item_key"],
                    "plan_date": plan_date,
                    "position": override["position"] or 1,
                    "duration": override["duration_minutes"] or 30,
                    "source_id": item["source_plan_task_id"],
                    "state": item["state"],
                    "reason": "manual_pin",
                }
            )
        used: dict[date, set[int]] = {}
        locked: list[LockedCalendarAssignment] = []
        for item in candidates:
            occupied = used.setdefault(item["plan_date"], set())
            position = item["position"] or 1
            while position in occupied:
                position += 1
            occupied.add(position)
            locked.append(
                LockedCalendarAssignment(
                    item_key=item["item_key"],
                    plan_date=item["plan_date"],
                    position=position,
                    duration_minutes=item["duration"],
                    precision="protected",
                    priority_tier="protected",
                    source_plan_task_id=item["source_id"],
                    reason=item["reason"],
                    state=item["state"],
                )
            )
        return tuple(locked)

    def _capacity_observations(
        self, target_slug: str, starts_on: date
    ) -> tuple[CapacityObservation, ...]:
        rows = self.connection.execute(
            """
            SELECT run.plan_date, run.ls_budget_minutes,
                   run.extra_budget_minutes, run.energy_level,
                   COUNT(action.id) AS scheduled_actions,
                   SUM(CASE WHEN action.state='completed' THEN 1 ELSE 0 END)
                     AS completed_actions,
                   COALESCE(SUM(CASE WHEN action.state='completed'
                                     THEN COALESCE(action.actual_minutes,
                                                   action.duration_minutes)
                                     ELSE 0 END), 0) AS actual_minutes
            FROM sprint_day_runs AS run
            LEFT JOIN sprint_actions AS action ON action.run_id=run.id
            WHERE run.target_slug=? AND run.plan_date>=? AND run.plan_date<?
            GROUP BY run.id
            ORDER BY run.plan_date
            """,
            (
                target_slug,
                (starts_on - timedelta(days=14)).isoformat(),
                starts_on.isoformat(),
            ),
        )
        return tuple(
            CapacityObservation(
                plan_date=date.fromisoformat(row["plan_date"]),
                planned_minutes=(
                    row["ls_budget_minutes"] + row["extra_budget_minutes"]
                ),
                actual_minutes=row["actual_minutes"],
                scheduled_actions=row["scheduled_actions"],
                completed_actions=row["completed_actions"],
                energy_level=row["energy_level"],
                result_bearing=row["completed_actions"] > 0,
                available=True,
            )
            for row in rows
        )

    def _capacity_overrides(
        self, target_slug: str
    ) -> tuple[CapacityOverride, ...]:
        values: list[CapacityOverride] = []
        for row in self.repository.list_day_overrides(target_slug):
            scope_value: date | int | None
            if row["scope_kind"] == "date":
                scope_value = date.fromisoformat(row["scope_value"])
            elif row["scope_kind"] == "weekday":
                scope_value = int(row["scope_value"])
            else:
                scope_value = None
            values.append(
                CapacityOverride(
                    scope_kind=row["scope_kind"],
                    scope_value=scope_value,
                    availability=row["availability"],
                    ls_minutes=row["ls_minutes"],
                    extra_minutes=row["extra_minutes"],
                    energy_level=row["energy_level"],
                    version=row["version"],
                )
            )
        return tuple(values)

    def _previous_capacities(
        self, target_slug: str
    ) -> dict[date, HorizonDayCapacity]:
        head = self.repository.get_head(target_slug)
        if head is None:
            return {}
        return {
            date.fromisoformat(row["plan_date"]): HorizonDayCapacity(
                plan_date=date.fromisoformat(row["plan_date"]),
                ls_minutes=row["ls_minutes"],
                extra_minutes=row["extra_minutes"],
                energy_level=row["energy_level"],
                available=bool(row["available"]),
                origin=row["availability_source"],
                confidence_bp=row["confidence_bp"],
            )
            for row in self.repository.list_days(head["id"])
        }

    def _override_versions(self, target_slug: str) -> dict[str, int]:
        versions = {
            f"day:{row['scope_kind']}:{row['scope_value']}": row["version"]
            for row in self.repository.list_day_overrides(target_slug)
        }
        versions.update(
            {
                f"item:{row['item_id']}": row["version"]
                for row in self.repository.list_item_overrides(target_slug)
            }
        )
        return versions

    @staticmethod
    def _version_map(value: object) -> dict[str, int]:
        if not isinstance(value, Mapping):
            raise ValueError("override versions must be an object")
        result: dict[str, int] = {}
        for key, version in value.items():
            if (
                not isinstance(key, str)
                or not key
                or isinstance(version, bool)
                or not isinstance(version, int)
                or version < 1
            ):
                raise ValueError("override versions contain an invalid entry")
            result[key] = version
        return result

    @staticmethod
    def _capacity_value(item: HorizonDayCapacity) -> dict[str, Any]:
        return {
            "date": item.plan_date.isoformat(),
            "lsMinutes": item.ls_minutes,
            "extraMinutes": item.extra_minutes,
            "energyLevel": item.energy_level,
            "available": item.available,
            "origin": item.origin,
            "confidenceBp": item.confidence_bp,
        }

    def _input_hash(
        self,
        *,
        config: object,
        subjects: tuple[object, ...],
        projection_snapshot: Mapping[str, Any],
        tasks: tuple[object, ...],
        cycles: tuple[SourcePlanCycle, ...],
        stable_items: tuple[HorizonItemDraft, ...],
        locked_assignments: tuple[LockedCalendarAssignment, ...],
        capacity_snapshot: Mapping[str, Any],
        planning_cutoff: datetime,
    ) -> str:
        return _hash(
            {
                "algorithmVersion": self.engine.algorithm_version,
                "config": _json_ready(config),
                "subjects": [_json_ready(item) for item in subjects],
                "projection": projection_snapshot,
                "tasks": [_json_ready(item) for item in tasks],
                "cycles": [_json_ready(item) for item in cycles],
                "stableItems": [_json_ready(item) for item in stable_items],
                "locks": [_json_ready(item) for item in locked_assignments],
                "capacity": capacity_snapshot,
                "planningCutoff": _timestamp_text(planning_cutoff),
            }
        )

    def _restore_draft(
        self,
        current: SprintHorizonDraft,
        restore_run_id: int | None,
        source_tasks: tuple[object, ...],
    ) -> SprintHorizonDraft:
        if restore_run_id is None:
            raise ValueError("restore run id is required")
        historical = self.repository.get_run(restore_run_id)
        if (
            historical is None
            or historical["target_slug"] != current.target_slug
            or historical["decision"] != "applied"
        ):
            raise CalendarRunStateError(
                "restore run must be an applied calendar for this target"
            )
        eligible_source_ids = {
            item.id
            for item in source_tasks
            if item.status not in {"ignored", "archived"}
        }
        item_by_key = {item.item_key: item for item in current.items}
        item_by_id = {
            row["id"]: row for row in self.repository.list_items(restore_run_id)
        }
        replacement_key_by_id = {
            row["id"]: row["item_key"] for row in item_by_id.values()
        }
        historical_by_date: dict[date, list[HorizonAssignmentDraft]] = {}
        for row in self.repository.list_assignments(restore_run_id):
            plan_date = date.fromisoformat(row["plan_date"])
            if not current.starts_on <= plan_date <= current.ends_on:
                continue
            item = item_by_id[row["item_id"]]
            if item["state"] in {"ignored", "archived"}:
                continue
            if (
                item["source_plan_task_id"] is not None
                and item["source_plan_task_id"] not in eligible_source_ids
            ):
                continue
            action = (
                _json_object(row["action_json"])
                if row["action_json"] is not None
                else None
            )
            kind = (
                action.get("action_kind", "ls_execute")
                if action is not None
                else (
                    "future_cycle_capacity"
                    if item["kind"] == "future_cycle_capacity"
                    else "manual"
                )
            )
            historical_by_date.setdefault(plan_date, []).append(
                HorizonAssignmentDraft(
                    item_key=item["item_key"],
                    source_plan_task_id=item["source_plan_task_id"],
                    kind=kind,
                    plan_date=plan_date,
                    position=row["position"],
                    duration_minutes=row["duration_minutes"],
                    precision=row["precision"],
                    priority_tier=row["priority_tier"],
                    reasons=tuple(_json_array(row["reason_json"])),
                    pinned=bool(row["pinned_snapshot"]),
                    action=action,
                    expected_gain_milli=row["expected_gain_milli"],
                    replaces_placeholder_item_key=replacement_key_by_id.get(
                        row["replaces_placeholder_item_id"]
                    ),
                )
            )
            if item["item_key"] not in item_by_key:
                item_by_key[item["item_key"]] = HorizonItemDraft(
                    item_key=item["item_key"],
                    origin=item["origin"],
                    kind=item["kind"],
                    source_plan_task_id=item["source_plan_task_id"],
                    subject_profile_id=item["subject_profile_id"],
                    title=item["title"],
                    expected_meta_number=item["expected_meta_number"],
                    state=item["state"],
                    result=_json_object(item["result_json"]),
                    completed_at=_timestamp(item["completed_at"]),
                    version=item["version"],
                )

        days: list[HorizonDayDraft] = []
        shortfalls = list(current.shortfalls)
        for day in current.days:
            restored = historical_by_date.get(day.plan_date)
            if restored is None:
                days.append(day)
                continue
            protected = [
                item
                for item in day.assignments
                if item.precision == "protected"
                and item.item_key not in {row.item_key for row in restored}
            ]
            merged = sorted((*restored, *protected), key=lambda item: item.position)
            occupied: set[int] = set()
            normalized: list[HorizonAssignmentDraft] = []
            for item in merged:
                position = item.position
                while position in occupied:
                    position += 1
                occupied.add(position)
                normalized.append(replace(item, position=position))
            restored_day = HorizonDayDraft(
                plan_date=day.plan_date,
                precision=(
                    "protected"
                    if any(item.precision == "protected" for item in normalized)
                    else day.precision
                ),
                capacity=day.capacity,
                assignments=tuple(normalized),
                warnings=day.warnings,
            )
            if restored_day.overage_minutes:
                shortfalls.append(
                    f"over_capacity:{day.plan_date.isoformat()}:"
                    f"{restored_day.overage_minutes}"
                )
            days.append(restored_day)
        return replace(
            current,
            days=tuple(days),
            items=tuple(item_by_key.values()),
            warnings=current.warnings + (f"restored_from_run:{restore_run_id}",),
            shortfalls=tuple(dict.fromkeys(shortfalls)),
        )

    def _calendar_document(
        self, run: sqlite3.Row, *, include_diff: bool
    ) -> CalendarDocument:
        days = self.repository.list_days(run["id"])
        items = self.repository.list_items(run["id"])
        assignments = self.repository.list_assignments(run["id"])
        capacity_snapshot = _json_object(run["capacity_snapshot_json"])
        document: CalendarDocument = {
            "run": {
                "id": run["id"],
                "targetSlug": run["target_slug"],
                "windowStart": run["window_start"],
                "windowEnd": run["window_end"],
                "planningCutoff": run["planning_cutoff"],
                "exactThrough": run["exact_through"],
                "algorithmVersion": run["algorithm_version"],
                "requestHash": run["request_hash"],
                "inputHash": run["input_hash"],
                "baseAppliedRunId": run["base_applied_run_id"],
                "supersedesRunId": run["supersedes_run_id"],
                "decision": run["decision"],
                "status": run["status"],
                "warnings": _json_array(run["warnings_json"]),
                "shortfalls": _json_array(run["shortfalls_json"]),
                "version": run["version"],
                "generatedAt": run["generated_at"],
                "appliedAt": run["applied_at"],
            },
            "days": [
                {
                    "id": row["id"],
                    "date": row["plan_date"],
                    "precision": row["precision"],
                    "availabilitySource": row["availability_source"],
                    "available": bool(row["available"]),
                    "availableMinutes": row["available_minutes"],
                    "lsMinutes": row["ls_minutes"],
                    "extraMinutes": row["extra_minutes"],
                    "reservedMinutes": row["reserved_minutes"],
                    "overageMinutes": row["overage_minutes"],
                    "energyLevel": row["energy_level"],
                    "confidenceBp": row["confidence_bp"],
                    "warnings": _json_array(row["warnings_json"]),
                }
                for row in days
            ],
            "items": [self._item_document(row) for row in items],
            "assignments": [
                {
                    "id": row["id"],
                    "itemId": row["item_id"],
                    "date": row["plan_date"],
                    "position": row["position"],
                    "durationMinutes": row["duration_minutes"],
                    "precision": row["precision"],
                    "priorityTier": row["priority_tier"],
                    "reasons": _json_array(row["reason_json"]),
                    "pinned": bool(row["pinned_snapshot"]),
                    "action": (
                        _json_object(row["action_json"])
                        if row["action_json"] is not None
                        else None
                    ),
                    "expectedGainMilli": row["expected_gain_milli"],
                    "replacesPlaceholderItemId": row[
                        "replaces_placeholder_item_id"
                    ],
                }
                for row in assignments
            ],
            "overrideVersions": self._version_map(
                capacity_snapshot.get("overrideVersions", {})
            ),
        }
        if include_diff:
            document["diff"] = self._diff_document(run, items, assignments)
        return document

    @staticmethod
    def _item_document(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"],
            "itemKey": row["item_key"],
            "origin": row["origin"],
            "kind": row["kind"],
            "sourcePlanTaskId": row["source_plan_task_id"],
            "subjectProfileId": row["subject_profile_id"],
            "title": row["title"],
            "expectedMetaNumber": row["expected_meta_number"],
            "state": row["state"],
            "result": _json_object(row["result_json"]),
            "completedAt": row["completed_at"],
            "version": row["version"],
        }

    def _diff_document(
        self,
        run: sqlite3.Row,
        items: tuple[sqlite3.Row, ...],
        assignments: tuple[sqlite3.Row, ...],
    ) -> dict[str, int]:
        previous = (
            self.repository.list_assignments(run["base_applied_run_id"])
            if run["base_applied_run_id"] is not None
            else ()
        )
        old_by_item = {row["item_id"]: row for row in previous}
        new_by_item = {row["item_id"]: row for row in assignments}
        preserved = sum(
            1
            for item_id, row in new_by_item.items()
            if item_id in old_by_item
            and old_by_item[item_id]["plan_date"] == row["plan_date"]
            and old_by_item[item_id]["position"] == row["position"]
        )
        moved = sum(
            1
            for item_id, row in new_by_item.items()
            if item_id in old_by_item
            and (
                old_by_item[item_id]["plan_date"] != row["plan_date"]
                or old_by_item[item_id]["position"] != row["position"]
            )
        )
        return {
            "added": len(set(new_by_item) - set(old_by_item)),
            "moved": moved,
            "preserved": preserved,
            "completed": sum(row["state"] == "completed" for row in items),
            "removed": len(set(old_by_item) - set(new_by_item)),
            "noSpace": len(_json_array(run["shortfalls_json"])),
            "placeholderReplacements": sum(
                row["replaces_placeholder_item_id"] is not None
                for row in assignments
            ),
        }
