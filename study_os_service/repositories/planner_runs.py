from __future__ import annotations

from datetime import UTC, date, datetime
import json
import sqlite3
from typing import Any, Mapping

from study_os_service.domain.planner import (
    PlannerBlock,
    PlannerCandidate,
    PlannerRun,
    ScoreBreakdown,
)


class PlannerBlockVersionConflictError(RuntimeError):
    pass


class PlannerBlockExecutionConflictError(RuntimeError):
    pass


def _datetime(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed


def _run(row: sqlite3.Row) -> PlannerRun:
    return PlannerRun(
        id=row["id"],
        idempotency_key=row["idempotency_key"],
        target_slug=row["target_slug"],
        plan_date=date.fromisoformat(row["plan_date"]),
        phase=row["phase"],
        daily_quota=row["daily_quota"],
        time_budget_minutes=row["time_budget_minutes"],
        algorithm_version=row["algorithm_version"],
        input_hash=row["input_hash"],
        supersedes_run_id=row["supersedes_run_id"],
        status=row["status"],
        shortfall_count=row["shortfall_count"],
        shortfall_reasons=tuple(json.loads(row["shortfall_reasons_json"])),
        generated_at=_datetime(row["generated_at"]),
    )


def _candidate(row: sqlite3.Row) -> PlannerCandidate:
    return PlannerCandidate(
        id=row["id"],
        run_id=row["run_id"],
        candidate_key=row["candidate_key"],
        target_slug=row["target_slug"],
        discipline=row["discipline"],
        topic=row["topic"],
        block_kind=row["block_kind"],
        source_kind=row["source_kind"],
        target_topic_id=row["target_topic_id"],
        lesson_id=row["lesson_id"],
        material_id=row["material_id"],
        duration_minutes=row["duration_minutes"],
        planned_questions=row["planned_questions"],
        score=ScoreBreakdown(
            weakness=row["weakness"],
            incidence=row["incidence"],
            tier=row["tier"],
            coverage_need=row["coverage_need"],
            review_debt=row["review_debt"],
            ls_alignment=row["ls_alignment"],
            target_fit=row["target_fit"],
            overlap_value=row["overlap_value"],
            deadline_pressure=row["deadline_pressure"],
            banca_fit=row["banca_fit"],
            edital_weight=row["edital_weight"],
            balance_penalty=row["balance_penalty"],
            low_trust_penalty=row["low_trust_penalty"],
            final_score=row["final_score"],
            weekly_alignment=row["weekly_alignment"],
        ),
        chosen_position=row["chosen_position"],
        displaced_by_candidate_key=row["displaced_by_candidate_key"],
        stop_reason=row["stop_reason"],
        evidence=json.loads(row["evidence_json"]),
        adaptation_reason=row["adaptation_reason"],
    )


def _block(row: sqlite3.Row) -> PlannerBlock:
    return PlannerBlock(
        id=row["id"],
        run_id=row["run_id"],
        candidate_id=row["candidate_id"],
        target_slug=row["target_slug"],
        scheduled_date=date.fromisoformat(row["scheduled_date"]),
        position=row["position"],
        block_kind=row["block_kind"],
        title=row["title"],
        duration_minutes=row["duration_minutes"],
        planned_questions=row["planned_questions"],
        state=row["state"],
        execution_session_id=row["execution_session_id"],
        questions_done=row["questions_done"],
        correct_count=row["correct_count"],
        wrong_count=row["wrong_count"],
        doubt_count=row["doubt_count"],
        favorite_count=row["favorite_count"],
        version=row["version"],
    )


class PlannerRunRepository:
    def __init__(self, connection: sqlite3.Connection):
        self.connection = connection

    def get_run(self, run_id: int) -> PlannerRun | None:
        row = self.connection.execute(
            "SELECT * FROM planner_runs WHERE id=?", (run_id,)
        ).fetchone()
        return _run(row) if row else None

    def get_run_by_idempotency_key(self, key: str) -> PlannerRun | None:
        row = self.connection.execute(
            "SELECT * FROM planner_runs WHERE idempotency_key=?", (key,)
        ).fetchone()
        return _run(row) if row else None

    def get_latest_run(self, target_slug: str, plan_date: date) -> PlannerRun | None:
        row = self.connection.execute(
            """
            SELECT * FROM planner_runs
            WHERE target_slug=? AND plan_date=?
            ORDER BY id DESC LIMIT 1
            """,
            (target_slug, plan_date.isoformat()),
        ).fetchone()
        return _run(row) if row else None

    def create_run(
        self,
        *,
        idempotency_key: str,
        target_slug: str,
        plan_date: date,
        phase: str,
        daily_quota: int,
        time_budget_minutes: int,
        algorithm_version: str,
        input_hash: str,
        supersedes_run_id: int | None,
        status: str,
        shortfall_reasons: tuple[str, ...],
        generated_at: datetime,
    ) -> PlannerRun:
        cursor = self.connection.execute(
            """
            INSERT INTO planner_runs (
              idempotency_key, target_slug, plan_date, phase, daily_quota,
              time_budget_minutes, algorithm_version, input_hash,
              supersedes_run_id, status, shortfall_count,
              shortfall_reasons_json, generated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                idempotency_key,
                target_slug,
                plan_date.isoformat(),
                phase,
                daily_quota,
                time_budget_minutes,
                algorithm_version,
                input_hash,
                supersedes_run_id,
                status,
                len(shortfall_reasons),
                json.dumps(shortfall_reasons, ensure_ascii=True),
                generated_at.astimezone(UTC).isoformat(),
            ),
        )
        saved = self.get_run(cursor.lastrowid)
        if saved is None:
            raise RuntimeError("inserted planner run disappeared")
        return saved

    def insert_candidate(self, values: Mapping[str, Any]) -> PlannerCandidate:
        cursor = self.connection.execute(
            """
            INSERT INTO planner_candidates (
              run_id, candidate_key, target_slug, discipline, topic,
              block_kind, source_kind, target_topic_id, lesson_id, material_id,
              duration_minutes, planned_questions, weakness, incidence, tier,
              coverage_need, review_debt, ls_alignment, target_fit,
              overlap_value, deadline_pressure, banca_fit, edital_weight,
              balance_penalty, low_trust_penalty, final_score,
              chosen_position, displaced_by_candidate_key, stop_reason,
              evidence_json, weekly_alignment, adaptation_reason
            ) VALUES (
              :run_id, :candidate_key, :target_slug, :discipline, :topic,
              :block_kind, :source_kind, :target_topic_id, :lesson_id, :material_id,
              :duration_minutes, :planned_questions, :weakness, :incidence, :tier,
              :coverage_need, :review_debt, :ls_alignment, :target_fit,
              :overlap_value, :deadline_pressure, :banca_fit, :edital_weight,
              :balance_penalty, :low_trust_penalty, :final_score,
              :chosen_position, :displaced_by_candidate_key, :stop_reason,
              :evidence_json, :weekly_alignment, :adaptation_reason
            )
            """,
            dict(values),
        )
        saved = self.get_candidate(cursor.lastrowid)
        if saved is None:
            raise RuntimeError("inserted planner candidate disappeared")
        return saved

    def get_candidate(self, candidate_id: int) -> PlannerCandidate | None:
        row = self.connection.execute(
            "SELECT * FROM planner_candidates WHERE id=?", (candidate_id,)
        ).fetchone()
        return _candidate(row) if row else None

    def list_candidates(self, run_id: int) -> tuple[PlannerCandidate, ...]:
        rows = self.connection.execute(
            """
            SELECT * FROM planner_candidates WHERE run_id=?
            ORDER BY CASE WHEN chosen_position IS NULL THEN 1 ELSE 0 END,
                     chosen_position, final_score DESC, candidate_key
            """,
            (run_id,),
        )
        return tuple(_candidate(row) for row in rows)

    def insert_block(
        self,
        *,
        run_id: int,
        candidate_id: int,
        target_slug: str,
        scheduled_date: date,
        position: int,
        block_kind: str,
        title: str,
        duration_minutes: int,
        planned_questions: int,
    ) -> PlannerBlock:
        cursor = self.connection.execute(
            """
            INSERT INTO planner_blocks (
              run_id, candidate_id, target_slug, scheduled_date, position,
              block_kind, title, duration_minutes, planned_questions
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                run_id,
                candidate_id,
                target_slug,
                scheduled_date.isoformat(),
                position,
                block_kind,
                title,
                duration_minutes,
                planned_questions,
            ),
        )
        saved = self.get_block(cursor.lastrowid)
        if saved is None:
            raise RuntimeError("inserted planner block disappeared")
        return saved

    def get_block(self, block_id: int) -> PlannerBlock | None:
        row = self.connection.execute(
            "SELECT * FROM planner_blocks WHERE id=?", (block_id,)
        ).fetchone()
        return _block(row) if row else None

    def get_block_with_candidate(
        self, block_id: int
    ) -> tuple[PlannerBlock, PlannerCandidate] | None:
        block = self.get_block(block_id)
        if block is None:
            return None
        candidate = self.get_candidate(block.candidate_id)
        if candidate is None:
            raise RuntimeError("planner block candidate disappeared")
        return block, candidate

    def get_block_by_execution_session(
        self, session_id: int
    ) -> PlannerBlock | None:
        row = self.connection.execute(
            "SELECT * FROM planner_blocks WHERE execution_session_id=?",
            (session_id,),
        ).fetchone()
        return _block(row) if row else None

    def claim_theory_block(
        self,
        block_id: int,
        *,
        session_id: int,
        expected_version: int,
    ) -> PlannerBlock:
        cursor = self.connection.execute(
            """
            UPDATE planner_blocks SET
              execution_session_id=?, state='active', version=version+1,
              updated_at=CURRENT_TIMESTAMP
            WHERE id=? AND version=? AND block_kind='theory'
              AND state IN ('pending','active')
            """,
            (session_id, block_id, expected_version),
        )
        if cursor.rowcount != 1:
            raise PlannerBlockExecutionConflictError(
                f"planner block {block_id} changed before session claim"
            )
        saved = self.get_block(block_id)
        if saved is None:
            raise RuntimeError("claimed planner block disappeared")
        return saved

    def transition_block_for_session(
        self,
        session_id: int,
        *,
        state: str,
    ) -> PlannerBlock | None:
        current = self.get_block_by_execution_session(session_id)
        if current is None:
            return None
        cursor = self.connection.execute(
            """
            UPDATE planner_blocks SET state=?, version=version+1,
              updated_at=CURRENT_TIMESTAMP
            WHERE id=? AND execution_session_id=? AND state='active'
              AND version=?
            """,
            (state, current.id, session_id, current.version),
        )
        if cursor.rowcount != 1:
            raise PlannerBlockExecutionConflictError(
                f"planner block {current.id} changed before session result"
            )
        return self.get_block(current.id)

    def list_blocks(self, run_id: int) -> tuple[PlannerBlock, ...]:
        rows = self.connection.execute(
            "SELECT * FROM planner_blocks WHERE run_id=? ORDER BY position",
            (run_id,),
        )
        return tuple(_block(row) for row in rows)

    def update_block_result(
        self,
        block_id: int,
        *,
        state: str,
        questions_done: int,
        correct_count: int,
        wrong_count: int,
        doubt_count: int,
        favorite_count: int,
        expected_version: int,
    ) -> PlannerBlock:
        cursor = self.connection.execute(
            """
            UPDATE planner_blocks SET
              state=?, questions_done=?, correct_count=?, wrong_count=?,
              doubt_count=?, favorite_count=?, version=version+1,
              updated_at=CURRENT_TIMESTAMP
            WHERE id=? AND version=? AND state IN ('pending','active')
            """,
            (
                state,
                questions_done,
                correct_count,
                wrong_count,
                doubt_count,
                favorite_count,
                block_id,
                expected_version,
            ),
        )
        if cursor.rowcount != 1:
            raise PlannerBlockVersionConflictError(
                f"planner block {block_id} has changed or is already finished"
            )
        saved = self.get_block(block_id)
        if saved is None:
            raise RuntimeError("updated planner block disappeared")
        return saved
