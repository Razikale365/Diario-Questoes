from __future__ import annotations

from datetime import UTC, datetime
import json
import sqlite3
from typing import Mapping

from study_os_service.domain.learning import LearningEvent, TopicLearningState


def _datetime(value: str | None) -> datetime | None:
    if value is None:
        return None
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed.astimezone(UTC)


def _event(row: sqlite3.Row) -> LearningEvent:
    return LearningEvent(
        id=row["id"],
        idempotency_key=row["idempotency_key"],
        target_slug=row["target_slug"],
        topic_target_slug=row["topic_target_slug"],
        target_topic_id=row["target_topic_id"],
        source_kind=row["source_kind"],
        source_id=row["source_id"],
        event_kind=row["event_kind"],
        outcome=row["outcome"],
        questions_done=row["questions_done"],
        correct_count=row["correct_count"],
        wrong_count=row["wrong_count"],
        doubt_count=row["doubt_count"],
        favorite_count=row["favorite_count"],
        elapsed_seconds=row["elapsed_seconds"],
        start_page=row["start_page"],
        end_page=row["end_page"],
        occurred_at=_datetime(row["occurred_at"]),
        evidence=json.loads(row["evidence_json"]),
        created_at=_datetime(row["created_at"]),
    )


def _state(row: sqlite3.Row) -> TopicLearningState:
    from datetime import date

    return TopicLearningState(
        target_slug=row["target_slug"],
        topic_target_slug=row["topic_target_slug"],
        target_topic_id=row["target_topic_id"],
        mastery_bp=row["mastery_bp"],
        confidence_bp=row["confidence_bp"],
        coverage_status=row["coverage_status"],
        review_debt_bp=row["review_debt_bp"],
        last_activity_at=_datetime(row["last_activity_at"]),
        last_success_at=_datetime(row["last_success_at"]),
        next_review_date=(
            date.fromisoformat(row["next_review_date"])
            if row["next_review_date"] is not None
            else None
        ),
        stale_at=(
            date.fromisoformat(row["stale_at"])
            if row["stale_at"] is not None
            else None
        ),
        success_streak=row["success_streak"],
        failure_streak=row["failure_streak"],
        event_cursor=row["event_cursor"],
        version=row["version"],
    )


class LearningRepository:
    def __init__(self, connection: sqlite3.Connection):
        self.connection = connection

    def get_event_by_idempotency_key(self, key: str) -> LearningEvent | None:
        row = self.connection.execute(
            "SELECT * FROM learning_events WHERE idempotency_key=?", (key,)
        ).fetchone()
        return _event(row) if row else None

    def get_event_by_source(
        self, source_kind: str, source_id: str
    ) -> LearningEvent | None:
        row = self.connection.execute(
            "SELECT * FROM learning_events WHERE source_kind=? AND source_id=?",
            (source_kind, source_id),
        ).fetchone()
        return _event(row) if row else None

    def insert_event(
        self,
        *,
        idempotency_key: str,
        target_slug: str,
        topic_target_slug: str | None,
        target_topic_id: int | None,
        source_kind: str,
        source_id: str,
        event_kind: str,
        outcome: str,
        questions_done: int,
        correct_count: int,
        wrong_count: int,
        doubt_count: int,
        favorite_count: int,
        elapsed_seconds: int,
        start_page: int | None,
        end_page: int | None,
        occurred_at: datetime,
        evidence: Mapping[str, object],
    ) -> LearningEvent:
        created_at = datetime.now(UTC)
        validated = LearningEvent(
            id=1,
            idempotency_key=idempotency_key,
            target_slug=target_slug,
            topic_target_slug=topic_target_slug,
            target_topic_id=target_topic_id,
            source_kind=source_kind,
            source_id=source_id,
            event_kind=event_kind,
            outcome=outcome,
            questions_done=questions_done,
            correct_count=correct_count,
            wrong_count=wrong_count,
            doubt_count=doubt_count,
            favorite_count=favorite_count,
            elapsed_seconds=elapsed_seconds,
            start_page=start_page,
            end_page=end_page,
            occurred_at=occurred_at,
            evidence=evidence,
            created_at=created_at,
        )
        cursor = self.connection.execute(
            """
            INSERT INTO learning_events (
              idempotency_key, target_slug, topic_target_slug, target_topic_id,
              source_kind, source_id, event_kind, outcome, questions_done,
              correct_count, wrong_count, doubt_count, favorite_count,
              elapsed_seconds, start_page, end_page, occurred_at,
              evidence_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                validated.idempotency_key,
                validated.target_slug,
                validated.topic_target_slug,
                validated.target_topic_id,
                validated.source_kind,
                validated.source_id,
                validated.event_kind,
                validated.outcome,
                validated.questions_done,
                validated.correct_count,
                validated.wrong_count,
                validated.doubt_count,
                validated.favorite_count,
                validated.elapsed_seconds,
                validated.start_page,
                validated.end_page,
                validated.occurred_at.isoformat(),
                json.dumps(dict(validated.evidence), sort_keys=True, separators=(",", ":")),
                validated.created_at.isoformat(),
            ),
        )
        saved = self.get_event(cursor.lastrowid)
        if saved is None:
            raise RuntimeError("learning event insert did not return a row")
        return saved

    def get_event(self, event_id: int) -> LearningEvent | None:
        row = self.connection.execute(
            "SELECT * FROM learning_events WHERE id=?", (event_id,)
        ).fetchone()
        return _event(row) if row else None

    def list_events(
        self, target_slug: str, target_topic_id: int
    ) -> tuple[LearningEvent, ...]:
        rows = self.connection.execute(
            """
            SELECT * FROM learning_events
            WHERE target_slug=? AND target_topic_id=?
            ORDER BY occurred_at, id
            """,
            (target_slug, target_topic_id),
        ).fetchall()
        return tuple(_event(row) for row in rows)

    def get_topic(self, target_topic_id: int) -> sqlite3.Row | None:
        return self.connection.execute(
            "SELECT * FROM target_topics WHERE id=?", (target_topic_id,)
        ).fetchone()

    def get_state(
        self, target_slug: str, target_topic_id: int
    ) -> TopicLearningState | None:
        row = self.connection.execute(
            """
            SELECT * FROM topic_learning_states
            WHERE target_slug=? AND target_topic_id=?
            """,
            (target_slug, target_topic_id),
        ).fetchone()
        return _state(row) if row else None

    def upsert_state(self, state: TopicLearningState) -> TopicLearningState:
        self.connection.execute(
            """
            INSERT INTO topic_learning_states (
              target_slug, topic_target_slug, target_topic_id, mastery_bp,
              confidence_bp, coverage_status, review_debt_bp,
              last_activity_at, last_success_at, next_review_date, stale_at,
              success_streak, failure_streak, event_cursor, version, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(target_slug, target_topic_id) DO UPDATE SET
              topic_target_slug=excluded.topic_target_slug,
              mastery_bp=excluded.mastery_bp,
              confidence_bp=excluded.confidence_bp,
              coverage_status=excluded.coverage_status,
              review_debt_bp=excluded.review_debt_bp,
              last_activity_at=excluded.last_activity_at,
              last_success_at=excluded.last_success_at,
              next_review_date=excluded.next_review_date,
              stale_at=excluded.stale_at,
              success_streak=excluded.success_streak,
              failure_streak=excluded.failure_streak,
              event_cursor=excluded.event_cursor,
              version=excluded.version,
              updated_at=excluded.updated_at
            """,
            (
                state.target_slug,
                state.topic_target_slug,
                state.target_topic_id,
                state.mastery_bp,
                state.confidence_bp,
                state.coverage_status,
                state.review_debt_bp,
                state.last_activity_at.isoformat() if state.last_activity_at else None,
                state.last_success_at.isoformat() if state.last_success_at else None,
                state.next_review_date.isoformat() if state.next_review_date else None,
                state.stale_at.isoformat() if state.stale_at else None,
                state.success_streak,
                state.failure_streak,
                state.event_cursor,
                state.version,
                datetime.now(UTC).isoformat(),
            ),
        )
        saved = self.get_state(state.target_slug, state.target_topic_id)
        if saved is None:
            raise RuntimeError("topic learning state upsert did not return a row")
        return saved

    def resolve_block_topic(self, block_id: int) -> sqlite3.Row | None:
        return self.connection.execute(
            """
            SELECT blocks.id AS block_id, blocks.run_id, blocks.candidate_id,
                   blocks.updated_at,
                   candidates.target_topic_id, candidates.evidence_json,
                   topics.target_slug AS topic_target_slug
            FROM planner_blocks AS blocks
            JOIN planner_candidates AS candidates ON candidates.id=blocks.candidate_id
            LEFT JOIN target_topics AS topics ON topics.id=candidates.target_topic_id
            WHERE blocks.id=?
            """,
            (block_id,),
        ).fetchone()

    def resolve_session_topic(self, session_id: int) -> sqlite3.Row | None:
        linked = self.connection.execute(
            """
            SELECT candidates.target_topic_id,
                   topics.target_slug AS topic_target_slug,
                   blocks.id AS planner_block_id
            FROM planner_blocks AS blocks
            JOIN planner_candidates AS candidates ON candidates.id=blocks.candidate_id
            LEFT JOIN target_topics AS topics ON topics.id=candidates.target_topic_id
            WHERE blocks.execution_session_id=?
            """,
            (session_id,),
        ).fetchone()
        if linked is not None:
            return linked
        return self.connection.execute(
            """
            SELECT topics.id AS target_topic_id,
                   topics.target_slug AS topic_target_slug,
                   NULL AS planner_block_id
            FROM study_sessions AS sessions
            JOIN target_topics AS topics ON topics.active=1 AND (
              topics.material_id=sessions.material_id
              OR (topics.material_id IS NULL AND topics.lesson_id=sessions.lesson_id)
            )
            WHERE sessions.id=?
            ORDER BY (topics.target_slug=sessions.target_slug) DESC,
                     (topics.material_id=sessions.material_id) DESC,
                     topics.id
            LIMIT 1
            """,
            (session_id,),
        ).fetchone()
