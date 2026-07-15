from __future__ import annotations

from dataclasses import fields, is_dataclass
from datetime import UTC, date, datetime
import json
import sqlite3
from typing import Any, Mapping

from study_os_service.domain.sprint_calendar import SprintHorizonDraft


class CalendarIdempotencyConflictError(RuntimeError):
    pass


class CalendarSupersessionConflictError(RuntimeError):
    pass


class CalendarRunStateError(RuntimeError):
    pass


class CalendarOverrideConflictError(RuntimeError):
    pass


class CalendarItemConflictError(RuntimeError):
    pass


def _timestamp(value: datetime) -> str:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("timestamp must be timezone-aware")
    return value.astimezone(UTC).isoformat(timespec="microseconds").replace(
        "+00:00", "Z"
    )


def _json_value(value: object) -> object:
    if isinstance(value, sqlite3.Row):
        return {key: _json_value(value[key]) for key in value.keys()}
    if is_dataclass(value) and not isinstance(value, type):
        return {
            field.name: _json_value(getattr(value, field.name))
            for field in fields(value)
        }
    if isinstance(value, Mapping):
        return {str(key): _json_value(item) for key, item in value.items()}
    if isinstance(value, (tuple, list, set, frozenset)):
        return [_json_value(item) for item in value]
    if isinstance(value, datetime):
        return _timestamp(value)
    if isinstance(value, date):
        return value.isoformat()
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    raise TypeError(f"calendar value is not JSON serializable: {type(value).__name__}")


def _canonical_json(value: object) -> str:
    return json.dumps(
        _json_value(value),
        ensure_ascii=True,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    )


def _action_json(value: object | None) -> str | None:
    if value is None:
        return None
    payload = _json_value(value)
    if not isinstance(payload, dict):
        raise ValueError("calendar action must serialize to an object")
    return _canonical_json(payload)


class SprintCalendarRepository:
    def __init__(self, connection: sqlite3.Connection):
        self.connection = connection

    def _require_transaction(self) -> None:
        if not self.connection.in_transaction:
            raise RuntimeError("caller must own an active calendar transaction")

    def get_head(self, target_slug: str) -> sqlite3.Row | None:
        return self.connection.execute(
            """
            SELECT run.* FROM sprint_calendar_runs AS run
            WHERE run.target_slug=? AND run.decision='applied'
              AND NOT EXISTS (
                SELECT 1 FROM sprint_calendar_runs AS child
                WHERE child.supersedes_run_id=run.id
                  AND child.decision='applied'
              )
            ORDER BY run.id DESC
            LIMIT 1
            """,
            (target_slug,),
        ).fetchone()

    def get_run(self, run_id: int) -> sqlite3.Row | None:
        return self.connection.execute(
            "SELECT * FROM sprint_calendar_runs WHERE id=?", (run_id,)
        ).fetchone()

    def get_run_by_idempotency(self, key: str) -> sqlite3.Row | None:
        return self.connection.execute(
            "SELECT * FROM sprint_calendar_runs WHERE idempotency_key=?", (key,)
        ).fetchone()

    def get_item(self, item_id: int) -> sqlite3.Row | None:
        return self.connection.execute(
            "SELECT * FROM sprint_calendar_items WHERE id=?", (item_id,)
        ).fetchone()

    def list_days(self, run_id: int) -> tuple[sqlite3.Row, ...]:
        return tuple(
            self.connection.execute(
                """
                SELECT * FROM sprint_calendar_days
                WHERE run_id=?
                ORDER BY plan_date
                """,
                (run_id,),
            )
        )

    def list_items(self, run_id: int) -> tuple[sqlite3.Row, ...]:
        return tuple(
            self.connection.execute(
                """
                SELECT item.* FROM sprint_calendar_items AS item
                JOIN sprint_calendar_assignments AS assignment
                  ON assignment.item_id=item.id
                 AND assignment.target_slug=item.target_slug
                WHERE assignment.run_id=?
                ORDER BY item.id
                """,
                (run_id,),
            )
        )

    def list_assignments(self, run_id: int) -> tuple[sqlite3.Row, ...]:
        return tuple(
            self.connection.execute(
                """
                SELECT assignment.*, item.item_key, item.kind,
                       item.source_plan_task_id, item.subject_profile_id,
                       item.title, item.state
                FROM sprint_calendar_assignments AS assignment
                JOIN sprint_calendar_items AS item
                  ON item.id=assignment.item_id
                 AND item.target_slug=assignment.target_slug
                WHERE assignment.run_id=?
                ORDER BY assignment.plan_date, assignment.position
                """,
                (run_id,),
            )
        )

    def list_day_overrides(self, target_slug: str) -> tuple[sqlite3.Row, ...]:
        return tuple(
            self.connection.execute(
                """
                SELECT * FROM sprint_calendar_day_overrides
                WHERE target_slug=? AND active=1
                ORDER BY CASE scope_kind
                           WHEN 'date' THEN 1
                           WHEN 'weekday' THEN 2
                           ELSE 3
                         END,
                         scope_value
                """,
                (target_slug,),
            )
        )

    def list_item_overrides(self, target_slug: str) -> tuple[sqlite3.Row, ...]:
        return tuple(
            self.connection.execute(
                """
                SELECT * FROM sprint_calendar_item_overrides
                WHERE target_slug=? AND active=1
                ORDER BY plan_date, position, item_id
                """,
                (target_slug,),
            )
        )

    def executable_assignments_for_date(
        self, target_slug: str, plan_date: date
    ) -> tuple[sqlite3.Row, ...]:
        head = self.get_head(target_slug)
        if head is None:
            return ()
        return tuple(
            self.connection.execute(
                """
                SELECT assignment.id AS assignment_id,
                       assignment.run_id AS calendar_run_id,
                       assignment.plan_date, assignment.position,
                       assignment.duration_minutes, assignment.precision,
                       assignment.priority_tier, assignment.action_json,
                       item.id AS item_id, item.source_plan_task_id,
                       item.subject_profile_id, item.item_key, item.state
                FROM sprint_calendar_assignments AS assignment
                JOIN sprint_calendar_items AS item
                  ON item.id=assignment.item_id
                 AND item.target_slug=assignment.target_slug
                WHERE assignment.run_id=? AND assignment.plan_date=?
                  AND item.kind='source_task'
                  AND item.source_plan_task_id IS NOT NULL
                  AND item.state IN ('pending','active','failed')
                  AND assignment.action_json IS NOT NULL
                ORDER BY assignment.position, assignment.id
                """,
                (head["id"], plan_date.isoformat()),
            )
        )

    def insert_materialization_in_transaction(
        self,
        *,
        assignment_id: int,
        sprint_day_run_id: int,
        sprint_action_id: int,
    ) -> sqlite3.Row:
        self._require_transaction()
        assignment = self.connection.execute(
            """
            SELECT assignment.*, item.source_plan_task_id
            FROM sprint_calendar_assignments AS assignment
            JOIN sprint_calendar_items AS item
              ON item.id=assignment.item_id
             AND item.target_slug=assignment.target_slug
            WHERE assignment.id=?
            """,
            (assignment_id,),
        ).fetchone()
        action = self.connection.execute(
            """
            SELECT action.*, run.plan_date
            FROM sprint_actions AS action
            JOIN sprint_day_runs AS run ON run.id=action.run_id
            WHERE action.id=? AND action.run_id=?
            """,
            (sprint_action_id, sprint_day_run_id),
        ).fetchone()
        if assignment is None or action is None:
            raise CalendarItemConflictError(
                "calendar materialization identity was not found"
            )
        if (
            assignment["target_slug"] != action["target_slug"]
            or assignment["plan_date"] != action["plan_date"]
            or assignment["source_plan_task_id"]
            != action["source_plan_task_id"]
        ):
            raise CalendarItemConflictError(
                "calendar materialization does not match the daily action"
            )
        existing = self.connection.execute(
            """
            SELECT * FROM sprint_calendar_materializations
            WHERE assignment_id=?
            """,
            (assignment_id,),
        ).fetchone()
        if existing is not None:
            return existing
        cursor = self.connection.execute(
            """
            INSERT INTO sprint_calendar_materializations (
              target_slug, assignment_id, sprint_day_run_id, sprint_action_id
            ) VALUES (?, ?, ?, ?)
            """,
            (
                action["target_slug"],
                assignment_id,
                sprint_day_run_id,
                sprint_action_id,
            ),
        )
        saved = self.connection.execute(
            "SELECT * FROM sprint_calendar_materializations WHERE id=?",
            (cursor.lastrowid,),
        ).fetchone()
        if saved is None:
            raise RuntimeError("calendar materialization was not visible")
        return saved

    def _insert_or_get_item(
        self, target_slug: str, item: object
    ) -> sqlite3.Row:
        self.connection.execute(
            """
            INSERT OR IGNORE INTO sprint_calendar_items (
              target_slug, item_key, origin, kind, source_plan_task_id,
              subject_profile_id, title, expected_meta_number, state,
              result_json, completed_at, version
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                target_slug,
                item.item_key,
                item.origin,
                item.kind,
                item.source_plan_task_id,
                item.subject_profile_id,
                item.title,
                item.expected_meta_number,
                item.state,
                _canonical_json(item.result),
                _timestamp(item.completed_at) if item.completed_at else None,
                item.version,
            ),
        )
        row = self.connection.execute(
            """
            SELECT * FROM sprint_calendar_items
            WHERE target_slug=? AND item_key=?
            """,
            (target_slug, item.item_key),
        ).fetchone()
        if row is None:
            raise CalendarItemConflictError(
                f"calendar item identity conflicts with {item.item_key}"
            )
        identity = (
            row["origin"],
            row["kind"],
            row["source_plan_task_id"],
            row["subject_profile_id"],
        )
        expected = (
            item.origin,
            item.kind,
            item.source_plan_task_id,
            item.subject_profile_id,
        )
        if identity != expected:
            raise CalendarItemConflictError(
                f"calendar item identity changed for {item.item_key}"
            )
        return row

    def insert_preview_in_transaction(
        self,
        *,
        idempotency_key: str,
        request_hash: str,
        input_hash: str,
        base_applied_run_id: int | None,
        draft: SprintHorizonDraft,
        projection_snapshot: Mapping[str, Any],
        capacity_snapshot: Mapping[str, Any],
    ) -> sqlite3.Row:
        self._require_transaction()
        existing = self.get_run_by_idempotency(idempotency_key)
        if existing is not None:
            if (
                existing["request_hash"] == request_hash
                and existing["input_hash"] == input_hash
            ):
                return existing
            raise CalendarIdempotencyConflictError(
                "calendar idempotency key was reused with different input"
            )

        cursor = self.connection.execute(
            """
            INSERT INTO sprint_calendar_runs (
              idempotency_key, target_slug, window_start, window_end,
              planning_cutoff, exact_through, algorithm_version,
              request_hash, input_hash, base_applied_run_id, supersedes_run_id,
              decision, status, warnings_json, shortfalls_json,
              projection_snapshot_json, capacity_snapshot_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'draft', ?, ?, ?, ?, ?)
            """,
            (
                idempotency_key,
                draft.target_slug,
                draft.starts_on.isoformat(),
                draft.ends_on.isoformat(),
                _timestamp(draft.planning_cutoff),
                draft.exact_through.isoformat(),
                draft.algorithm_version,
                request_hash,
                input_hash,
                base_applied_run_id,
                "shortfall" if draft.shortfalls else "generated",
                _canonical_json(draft.warnings),
                _canonical_json(draft.shortfalls),
                _canonical_json(projection_snapshot),
                _canonical_json(capacity_snapshot),
            ),
        )
        run_id = cursor.lastrowid
        if run_id is None:
            raise RuntimeError("calendar preview did not produce a run id")

        item_by_key = {
            item.item_key: self._insert_or_get_item(draft.target_slug, item)
            for item in draft.items
        }
        for day in draft.days:
            capacity = day.capacity
            self.connection.execute(
                """
                INSERT INTO sprint_calendar_days (
                  run_id, target_slug, plan_date, precision,
                  availability_source, available, available_minutes,
                  ls_minutes, extra_minutes, reserved_minutes,
                  overage_minutes, energy_level, confidence_bp, warnings_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    run_id,
                    draft.target_slug,
                    day.plan_date.isoformat(),
                    day.precision,
                    capacity.origin,
                    int(capacity.available),
                    capacity.total_minutes,
                    capacity.ls_minutes,
                    capacity.extra_minutes,
                    day.reserved_minutes,
                    day.overage_minutes,
                    capacity.energy_level,
                    capacity.confidence_bp,
                    _canonical_json(day.warnings),
                ),
            )
            for assignment in day.assignments:
                item = item_by_key.get(assignment.item_key)
                if item is None:
                    raise CalendarItemConflictError(
                        f"assignment item is missing: {assignment.item_key}"
                    )
                replaced_id = None
                if assignment.replaces_placeholder_item_key is not None:
                    replaced = item_by_key.get(
                        assignment.replaces_placeholder_item_key
                    )
                    if replaced is None or replaced["kind"] != "future_cycle_capacity":
                        raise CalendarItemConflictError(
                            "replacement must name a future cycle placeholder"
                        )
                    if (
                        item["kind"] != "source_task"
                        or item["source_plan_task_id"] is None
                    ):
                        raise CalendarItemConflictError(
                            "only a released source task can replace a placeholder"
                        )
                    replaced_id = replaced["id"]
                self.connection.execute(
                    """
                    INSERT INTO sprint_calendar_assignments (
                      run_id, target_slug, item_id, plan_date, position,
                      duration_minutes, precision, priority_tier, reason_json,
                      pinned_snapshot, action_json, expected_gain_milli,
                      replaces_placeholder_item_id
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        run_id,
                        draft.target_slug,
                        item["id"],
                        assignment.plan_date.isoformat(),
                        assignment.position,
                        assignment.duration_minutes,
                        assignment.precision,
                        assignment.priority_tier,
                        _canonical_json(assignment.reasons),
                        int(assignment.pinned),
                        _action_json(assignment.action),
                        assignment.expected_gain_milli,
                        replaced_id,
                    ),
                )

        saved = self.get_run(run_id)
        if saved is None:
            raise RuntimeError("inserted calendar preview was not visible")
        return saved

    def apply_run_in_transaction(
        self, run_id: int, expected_head_id: int | None
    ) -> sqlite3.Row:
        self._require_transaction()
        run = self.get_run(run_id)
        if run is None:
            raise CalendarRunStateError("calendar draft was not found")
        head = self.get_head(run["target_slug"])
        actual_head_id = head["id"] if head is not None else None
        if actual_head_id != expected_head_id:
            raise CalendarSupersessionConflictError("calendar head changed")
        if run["base_applied_run_id"] != expected_head_id:
            raise CalendarSupersessionConflictError("calendar base head changed")
        cursor = self.connection.execute(
            """
            UPDATE sprint_calendar_runs
            SET decision='applied',
                applied_at=STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW'),
                supersedes_run_id=?, version=version+1
            WHERE id=? AND decision='draft'
            """,
            (expected_head_id, run_id),
        )
        if cursor.rowcount != 1:
            raise CalendarRunStateError("calendar draft is not applicable")
        saved = self.get_run(run_id)
        if saved is None:
            raise RuntimeError("applied calendar run was not visible")
        return saved

    def upsert_day_override(
        self,
        *,
        target_slug: str,
        scope_kind: str,
        scope_value: str,
        availability: str,
        ls_minutes: int | None,
        extra_minutes: int | None,
        energy_level: int | None,
        expected_version: int | None,
    ) -> sqlite3.Row:
        self._require_transaction()
        current = self.connection.execute(
            """
            SELECT * FROM sprint_calendar_day_overrides
            WHERE target_slug=? AND scope_kind=? AND scope_value=? AND active=1
            """,
            (target_slug, scope_kind, scope_value),
        ).fetchone()
        if current is None:
            if expected_version is not None:
                raise CalendarOverrideConflictError("calendar override changed")
            cursor = self.connection.execute(
                """
                INSERT INTO sprint_calendar_day_overrides (
                  target_slug, scope_kind, scope_value, availability,
                  ls_minutes, extra_minutes, energy_level
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    target_slug,
                    scope_kind,
                    scope_value,
                    availability,
                    ls_minutes,
                    extra_minutes,
                    energy_level,
                ),
            )
            override_id = cursor.lastrowid
        else:
            if expected_version != current["version"]:
                raise CalendarOverrideConflictError("calendar override changed")
            cursor = self.connection.execute(
                """
                UPDATE sprint_calendar_day_overrides
                SET availability=?, ls_minutes=?, extra_minutes=?,
                    energy_level=?, version=version+1,
                    updated_at=STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW')
                WHERE id=? AND active=1 AND version=?
                """,
                (
                    availability,
                    ls_minutes,
                    extra_minutes,
                    energy_level,
                    current["id"],
                    expected_version,
                ),
            )
            if cursor.rowcount != 1:
                raise CalendarOverrideConflictError("calendar override changed")
            override_id = current["id"]
        saved = self.connection.execute(
            "SELECT * FROM sprint_calendar_day_overrides WHERE id=?",
            (override_id,),
        ).fetchone()
        if saved is None:
            raise RuntimeError("saved calendar day override was not visible")
        return saved

    def upsert_item_override(
        self,
        *,
        target_slug: str,
        item_id: int,
        plan_date: str,
        start_time: str | None,
        position: int | None,
        duration_minutes: int | None,
        pinned: bool,
        expected_version: int | None,
    ) -> sqlite3.Row:
        self._require_transaction()
        current = self.connection.execute(
            """
            SELECT * FROM sprint_calendar_item_overrides
            WHERE target_slug=? AND item_id=? AND active=1
            """,
            (target_slug, item_id),
        ).fetchone()
        if current is None:
            if expected_version is not None:
                raise CalendarOverrideConflictError("calendar override changed")
            cursor = self.connection.execute(
                """
                INSERT INTO sprint_calendar_item_overrides (
                  target_slug, item_id, plan_date, start_time, position,
                  duration_minutes, pinned, active
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    target_slug,
                    item_id,
                    plan_date,
                    start_time,
                    position,
                    duration_minutes,
                    int(pinned),
                    int(pinned),
                ),
            )
            override_id = cursor.lastrowid
        else:
            if expected_version != current["version"]:
                raise CalendarOverrideConflictError("calendar override changed")
            cursor = self.connection.execute(
                """
                UPDATE sprint_calendar_item_overrides
                SET plan_date=?, start_time=?, position=?, duration_minutes=?,
                    pinned=?, active=?, version=version+1,
                    updated_at=STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW')
                WHERE id=? AND active=1 AND version=?
                """,
                (
                    plan_date,
                    start_time,
                    position,
                    duration_minutes,
                    int(pinned),
                    int(pinned),
                    current["id"],
                    expected_version,
                ),
            )
            if cursor.rowcount != 1:
                raise CalendarOverrideConflictError("calendar override changed")
            override_id = current["id"]
        saved = self.connection.execute(
            "SELECT * FROM sprint_calendar_item_overrides WHERE id=?",
            (override_id,),
        ).fetchone()
        if saved is None:
            raise RuntimeError("saved calendar item override was not visible")
        return saved

    def complete_item_for_source_in_transaction(
        self,
        source_task_id: int,
        *,
        result: Mapping[str, Any] | sqlite3.Row,
        completed_at: datetime | str,
    ) -> sqlite3.Row | None:
        self._require_transaction()
        stored_at = (
            _timestamp(completed_at)
            if isinstance(completed_at, datetime)
            else completed_at
        )
        cursor = self.connection.execute(
            """
            UPDATE sprint_calendar_items
            SET state='completed', result_json=?, completed_at=?,
                version=version+1,
                updated_at=STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW')
            WHERE source_plan_task_id=? AND kind='source_task'
              AND state NOT IN ('ignored','archived')
            """,
            (_canonical_json(result), stored_at, source_task_id),
        )
        if cursor.rowcount == 0:
            return None
        return self.connection.execute(
            """
            SELECT * FROM sprint_calendar_items
            WHERE source_plan_task_id=?
            """,
            (source_task_id,),
        ).fetchone()

    def fail_item_for_source_in_transaction(
        self,
        source_task_id: int,
        *,
        result: Mapping[str, Any] | sqlite3.Row,
    ) -> sqlite3.Row | None:
        self._require_transaction()
        cursor = self.connection.execute(
            """
            UPDATE sprint_calendar_items
            SET state='failed', result_json=?, completed_at=NULL,
                version=version+1,
                updated_at=STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW')
            WHERE source_plan_task_id=? AND kind='source_task'
              AND state NOT IN ('ignored','archived','completed')
            """,
            (_canonical_json(result), source_task_id),
        )
        if cursor.rowcount == 0:
            return None
        return self.connection.execute(
            """
            SELECT * FROM sprint_calendar_items
            WHERE source_plan_task_id=?
            """,
            (source_task_id,),
        ).fetchone()
