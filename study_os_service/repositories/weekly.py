from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
import json
import sqlite3
from typing import Mapping

from study_os_service.domain.weekly import PlannerWeekRun, PlannerWeekSlot


def _datetime(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed.astimezone(UTC)


def _run(row: sqlite3.Row) -> PlannerWeekRun:
    return PlannerWeekRun(
        id=row["id"],
        idempotency_key=row["idempotency_key"],
        target_slug=row["target_slug"],
        week_start=date.fromisoformat(row["week_start"]),
        phase=row["phase"],
        algorithm_version=row["algorithm_version"],
        request_hash=row["request_hash"],
        input_hash=row["input_hash"],
        supersedes_week_run_id=row["supersedes_week_run_id"],
        status=row["status"],
        shortfall_count=row["shortfall_count"],
        shortfall_reasons=tuple(json.loads(row["shortfall_reasons_json"])),
        generated_at=_datetime(row["generated_at"]),
    )


def _slot(row: sqlite3.Row) -> PlannerWeekSlot:
    return PlannerWeekSlot(
        id=row["id"],
        week_run_id=row["week_run_id"],
        target_slug=row["target_slug"],
        scheduled_date=date.fromisoformat(row["scheduled_date"]),
        position=row["position"],
        candidate_key=row["candidate_key"],
        topic_target_slug=row["topic_target_slug"],
        target_topic_id=row["target_topic_id"],
        block_kind=row["block_kind"],
        duration_minutes=row["duration_minutes"],
        planned_questions=row["planned_questions"],
        score=json.loads(row["score_json"]),
        evidence=json.loads(row["evidence_json"]),
        state=row["state"],
        day_run_id=row["day_run_id"],
        day_block_id=row["day_block_id"],
    )


class WeeklyRepository:
    def __init__(self, connection: sqlite3.Connection):
        self.connection = connection

    def get_run(self, run_id: int) -> PlannerWeekRun | None:
        row = self.connection.execute(
            "SELECT * FROM planner_week_runs WHERE id=?", (run_id,)
        ).fetchone()
        return _run(row) if row else None

    def get_run_by_idempotency_key(self, key: str) -> PlannerWeekRun | None:
        row = self.connection.execute(
            "SELECT * FROM planner_week_runs WHERE idempotency_key=?", (key,)
        ).fetchone()
        return _run(row) if row else None

    def get_latest_run(
        self, target_slug: str, week_start: date
    ) -> PlannerWeekRun | None:
        row = self.connection.execute(
            """
            SELECT * FROM planner_week_runs
            WHERE target_slug=? AND week_start=? ORDER BY id DESC LIMIT 1
            """,
            (target_slug, week_start.isoformat()),
        ).fetchone()
        return _run(row) if row else None

    def create_run(
        self,
        *,
        idempotency_key: str,
        target_slug: str,
        week_start: date,
        phase: str,
        algorithm_version: str,
        request_hash: str,
        input_hash: str,
        supersedes_week_run_id: int | None,
        status: str,
        shortfall_reasons: tuple[str, ...],
        generated_at: datetime,
    ) -> PlannerWeekRun:
        cursor = self.connection.execute(
            """
            INSERT INTO planner_week_runs (
              idempotency_key, target_slug, week_start, phase,
              algorithm_version, request_hash, input_hash,
              supersedes_week_run_id, status, shortfall_count,
              shortfall_reasons_json, generated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                idempotency_key,
                target_slug,
                week_start.isoformat(),
                phase,
                algorithm_version,
                request_hash,
                input_hash,
                supersedes_week_run_id,
                status,
                len(shortfall_reasons),
                json.dumps(shortfall_reasons, separators=(",", ":")),
                generated_at.astimezone(UTC).isoformat(),
            ),
        )
        saved = self.get_run(cursor.lastrowid)
        if saved is None:
            raise RuntimeError("weekly run insert did not return a row")
        return saved

    def insert_slot(
        self,
        *,
        week_run_id: int,
        target_slug: str,
        scheduled_date: date,
        position: int,
        candidate_key: str,
        topic_target_slug: str,
        target_topic_id: int,
        block_kind: str,
        duration_minutes: int,
        planned_questions: int,
        score: Mapping[str, object],
        evidence: Mapping[str, object],
    ) -> PlannerWeekSlot:
        cursor = self.connection.execute(
            """
            INSERT INTO planner_week_slots (
              week_run_id, target_slug, scheduled_date, position,
              candidate_key, topic_target_slug, target_topic_id, block_kind,
              duration_minutes, planned_questions, score_json, evidence_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                week_run_id,
                target_slug,
                scheduled_date.isoformat(),
                position,
                candidate_key,
                topic_target_slug,
                target_topic_id,
                block_kind,
                duration_minutes,
                planned_questions,
                json.dumps(dict(score), sort_keys=True, separators=(",", ":")),
                json.dumps(dict(evidence), sort_keys=True, separators=(",", ":")),
            ),
        )
        saved = self.get_slot(cursor.lastrowid)
        if saved is None:
            raise RuntimeError("weekly slot insert did not return a row")
        return saved

    def get_slot(self, slot_id: int) -> PlannerWeekSlot | None:
        row = self.connection.execute(
            "SELECT * FROM planner_week_slots WHERE id=?", (slot_id,)
        ).fetchone()
        return _slot(row) if row else None

    def list_slots(self, week_run_id: int) -> tuple[PlannerWeekSlot, ...]:
        rows = self.connection.execute(
            """
            SELECT * FROM planner_week_slots WHERE week_run_id=?
            ORDER BY scheduled_date, position, id
            """,
            (week_run_id,),
        ).fetchall()
        return tuple(_slot(row) for row in rows)

    def latest_slots_for_date(
        self, target_slug: str, scheduled_date: date
    ) -> tuple[PlannerWeekSlot, ...]:
        monday = scheduled_date - timedelta(days=scheduled_date.weekday())
        run = self.get_latest_run(target_slug, monday)
        if run is None:
            return ()
        return tuple(
            slot
            for slot in self.list_slots(run.id)
            if slot.scheduled_date == scheduled_date
        )

    def link_slot(
        self, slot_id: int, *, day_run_id: int, day_block_id: int
    ) -> PlannerWeekSlot:
        current = self.get_slot(slot_id)
        if current is None:
            raise KeyError(f"weekly slot {slot_id} does not exist")
        if current.state == "materialized":
            return current
        cursor = self.connection.execute(
            """
            UPDATE planner_week_slots SET
              state='materialized', day_run_id=?, day_block_id=?
            WHERE id=? AND state='forecast'
            """,
            (day_run_id, day_block_id, slot_id),
        )
        if cursor.rowcount != 1:
            raise RuntimeError("weekly slot could not be materialized")
        saved = self.get_slot(slot_id)
        if saved is None:
            raise RuntimeError("materialized weekly slot did not return a row")
        return saved
