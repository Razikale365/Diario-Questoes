from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime
import sqlite3
from typing import Mapping

from study_os_service.domain.sprint import SourcePlanTask
from study_os_service.domain.sprint_evidence import (
    SourcePlanBacklogCandidate,
    SourcePlanCycle,
    SubjectProjection,
)
from study_os_service.repositories.sprint import SprintRepository


class SourcePlanCycleConflictError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class SourcePlanEligibility:
    task: SourcePlanTask
    cycle: SourcePlanCycle | None
    backlog: SourcePlanBacklogCandidate | None


def _timestamp(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError("cycle releasedAt must be timezone-aware")
    return parsed.astimezone(UTC)


def _timestamp_text(value: datetime) -> str:
    return value.astimezone(UTC).isoformat(timespec="microseconds").replace(
        "+00:00", "Z"
    )


def _cycle(row: sqlite3.Row) -> SourcePlanCycle:
    return SourcePlanCycle(
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


def _backlog(row: sqlite3.Row) -> SourcePlanBacklogCandidate:
    return SourcePlanBacklogCandidate(
        id=row["id"],
        target_slug=row["target_slug"],
        source_cycle_id=row["source_cycle_id"],
        source_plan_task_id=row["source_plan_task_id"],
        reason=row["reason"],
        return_score_milli=row["return_score_milli"],
        state=row["state"],
        discovered_on=date.fromisoformat(row["discovered_on"]),
        recovered_on=(
            date.fromisoformat(row["recovered_on"])
            if row["recovered_on"]
            else None
        ),
    )


def cycle_document(cycle: SourcePlanCycle | None) -> dict[str, object] | None:
    if cycle is None:
        return None
    return {
        "id": cycle.id,
        "sourceKind": cycle.source_kind,
        "planLabel": cycle.plan_label,
        "metaNumber": cycle.meta_number,
        "releasedAt": _timestamp_text(cycle.released_at),
        "startsOn": cycle.starts_on.isoformat(),
        "endsOn": cycle.ends_on.isoformat(),
        "version": cycle.version,
    }


def backlog_document(
    backlog: SourcePlanBacklogCandidate | None,
) -> dict[str, object] | None:
    if backlog is None:
        return None
    return {
        "id": backlog.id,
        "reason": backlog.reason,
        "returnScoreMilli": backlog.return_score_milli,
        "state": backlog.state,
        "discoveredOn": backlog.discovered_on.isoformat(),
        "recoveredOn": (
            backlog.recovered_on.isoformat() if backlog.recovered_on else None
        ),
    }


class SourcePlanCycleService:
    def __init__(self, connection: sqlite3.Connection):
        self.connection = connection
        self.repository = SprintRepository(connection)

    def upsert_in_transaction(
        self,
        *,
        target_slug: str,
        source_kind: str,
        plan_label: str,
        meta_number: int | None,
        released_at: datetime,
        starts_on: date,
        ends_on: date,
    ) -> SourcePlanCycle:
        if not self.connection.in_transaction:
            raise RuntimeError("caller must own an active cycle transaction")
        existing = self.connection.execute(
            """
            SELECT * FROM source_plan_cycles
            WHERE target_slug=? AND source_kind=? AND plan_label=?
            """,
            (target_slug, source_kind, plan_label),
        ).fetchone()
        values = (
            meta_number,
            _timestamp_text(released_at),
            starts_on.isoformat(),
            ends_on.isoformat(),
        )
        if existing is not None:
            current = (
                existing["meta_number"],
                existing["released_at"],
                existing["starts_on"],
                existing["ends_on"],
            )
            if current != values:
                raise SourcePlanCycleConflictError(
                    "source plan cycle was reimported with different dates"
                )
            return _cycle(existing)
        cursor = self.connection.execute(
            """
            INSERT INTO source_plan_cycles (
              target_slug, source_kind, plan_label, meta_number,
              released_at, starts_on, ends_on
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (target_slug, source_kind, plan_label, *values),
        )
        saved = self.connection.execute(
            "SELECT * FROM source_plan_cycles WHERE id=?", (cursor.lastrowid,)
        ).fetchone()
        if saved is None:
            raise RuntimeError("inserted source cycle disappeared")
        return _cycle(saved)

    def context_for_task(
        self, task: SourcePlanTask
    ) -> tuple[SourcePlanCycle | None, SourcePlanBacklogCandidate | None]:
        cycle = None
        if task.source_cycle_id is not None:
            row = self.connection.execute(
                "SELECT * FROM source_plan_cycles WHERE id=?",
                (task.source_cycle_id,),
            ).fetchone()
            cycle = _cycle(row) if row is not None else None
        row = self.connection.execute(
            "SELECT * FROM source_plan_backlog_candidates WHERE source_plan_task_id=?",
            (task.id,),
        ).fetchone()
        return cycle, (_backlog(row) if row is not None else None)

    def eligible_tasks(
        self,
        target_slug: str,
        plan_date: date,
        projections: Mapping[str, SubjectProjection],
    ) -> tuple[SourcePlanEligibility, ...]:
        started_transaction = not self.connection.in_transaction
        if started_transaction:
            self.connection.execute("BEGIN IMMEDIATE")
        try:
            profiles = {
                row["subject_key"]: row
                for row in self.connection.execute(
                    """
                    SELECT subject_key, target_low_bp
                    FROM exam_subject_profiles WHERE target_slug=? AND active=1
                    """,
                    (target_slug,),
                )
            }
            tasks = self.repository.list_source_tasks(
                target_slug, include_inactive=True
            )
            eligible: list[SourcePlanEligibility] = []
            for task in tasks:
                if task.status not in {"pending", "started"}:
                    continue
                cycle, backlog = self.context_for_task(task)
                if cycle is None:
                    if task.scheduled_date == plan_date:
                        eligible.append(SourcePlanEligibility(task, None, backlog))
                    continue
                if cycle.starts_on <= plan_date <= cycle.ends_on:
                    if task.scheduled_date is None or task.scheduled_date <= plan_date:
                        eligible.append(SourcePlanEligibility(task, cycle, backlog))
                    continue
                if cycle.ends_on >= plan_date:
                    continue
                score = self._return_score(task, profiles, projections)
                if backlog is None:
                    self.connection.execute(
                        """
                        INSERT OR IGNORE INTO source_plan_backlog_candidates (
                          target_slug, source_cycle_id, source_plan_task_id,
                          reason, return_score_milli, state, discovered_on
                        ) VALUES (?, ?, ?, 'cycle_closed_pending', ?, 'candidate', ?)
                        """,
                        (
                            target_slug,
                            cycle.id,
                            task.id,
                            score,
                            plan_date.isoformat(),
                        ),
                    )
                    _cycle_again, backlog = self.context_for_task(task)
                if (
                    backlog is not None
                    and backlog.state == "candidate"
                    and backlog.return_score_milli >= 1000
                ):
                    eligible.append(SourcePlanEligibility(task, cycle, backlog))
            if started_transaction:
                self.connection.commit()
            return tuple(eligible)
        except Exception:
            if started_transaction and self.connection.in_transaction:
                self.connection.rollback()
            raise

    @staticmethod
    def _return_score(
        task: SourcePlanTask,
        profiles: Mapping[str, sqlite3.Row],
        projections: Mapping[str, SubjectProjection],
    ) -> int:
        if task.subject_key not in profiles or task.subject_key not in projections:
            return 0
        profile = profiles[task.subject_key]
        projection = projections[task.subject_key]
        weighted_points = projection.question_count * projection.question_weight
        gap = max(250, profile["target_low_bp"] - projection.estimate_bp)
        gap += min(1000, projection.fragility_bp // 10)
        relevance = 0.5 + task.relevance / 20
        return max(0, round(weighted_points * gap / 10000 * relevance * 1000))

    def list_backlog(
        self, target_slug: str, *, include_all: bool = False
    ) -> tuple[SourcePlanBacklogCandidate, ...]:
        clause = "" if include_all else "AND state='candidate'"
        rows = self.connection.execute(
            f"""
            SELECT * FROM source_plan_backlog_candidates
            WHERE target_slug=? {clause}
            ORDER BY return_score_milli DESC, id
            """,
            (target_slug,),
        )
        return tuple(_backlog(row) for row in rows)

    def mark_recovered_in_transaction(
        self, source_plan_task_id: int, recovered_on: date
    ) -> None:
        if not self.connection.in_transaction:
            raise RuntimeError("caller must own an active cycle transaction")
        self.connection.execute(
            """
            UPDATE source_plan_backlog_candidates
            SET state='recovered', recovered_on=?,
                updated_at=STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW')
            WHERE source_plan_task_id=? AND state='candidate'
            """,
            (recovered_on.isoformat(), source_plan_task_id),
        )
