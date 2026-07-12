from __future__ import annotations

from datetime import UTC, date, datetime
import json
import sqlite3

from study_os_service.domain.learning import ReviewQueueItem


class ReviewQueueVersionConflictError(RuntimeError):
    pass


def _datetime(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed.astimezone(UTC)


def _item(row: sqlite3.Row) -> ReviewQueueItem:
    return ReviewQueueItem(
        id=row["id"],
        target_slug=row["target_slug"],
        topic_target_slug=row["topic_target_slug"],
        target_topic_id=row["target_topic_id"],
        due_date=date.fromisoformat(row["due_date"]),
        state=row["state"],
        bounded_questions=row["bounded_questions"],
        trigger_event_ids=tuple(json.loads(row["trigger_event_ids_json"])),
        reason=row["reason"],
        debt_bp=row["debt_bp"],
        attempt_count=row["attempt_count"],
        resolved_event_id=row["resolved_event_id"],
        version=row["version"],
        created_at=_datetime(row["created_at"]),
        updated_at=_datetime(row["updated_at"]),
    )


class ReviewQueueRepository:
    def __init__(self, connection: sqlite3.Connection):
        self.connection = connection

    def get(self, item_id: int) -> ReviewQueueItem | None:
        row = self.connection.execute(
            "SELECT * FROM review_queue_items WHERE id=?", (item_id,)
        ).fetchone()
        return _item(row) if row else None

    def get_open(
        self, target_slug: str, target_topic_id: int
    ) -> ReviewQueueItem | None:
        row = self.connection.execute(
            """
            SELECT * FROM review_queue_items
            WHERE target_slug=? AND target_topic_id=?
              AND state IN ('pending','deferred')
            ORDER BY id DESC LIMIT 1
            """,
            (target_slug, target_topic_id),
        ).fetchone()
        return _item(row) if row else None

    def list_open(self, target_slug: str) -> tuple[ReviewQueueItem, ...]:
        rows = self.connection.execute(
            """
            SELECT * FROM review_queue_items
            WHERE target_slug=? AND state IN ('pending','deferred')
            ORDER BY due_date, debt_bp DESC, id
            """,
            (target_slug,),
        ).fetchall()
        return tuple(_item(row) for row in rows)

    def get_mutation(self, idempotency_key: str) -> sqlite3.Row | None:
        return self.connection.execute(
            "SELECT * FROM review_queue_mutations WHERE idempotency_key=?",
            (idempotency_key,),
        ).fetchone()

    def insert_mutation(
        self,
        *,
        idempotency_key: str,
        item_id: int,
        request_hash: str,
        result_version: int,
    ) -> None:
        self.connection.execute(
            """
            INSERT INTO review_queue_mutations (
              idempotency_key, action_kind, item_id, request_hash, result_version
            ) VALUES (?, 'defer', ?, ?, ?)
            """,
            (idempotency_key, item_id, request_hash, result_version),
        )

    def upsert_open(
        self,
        *,
        target_slug: str,
        topic_target_slug: str,
        target_topic_id: int,
        due_date: date,
        state: str,
        bounded_questions: int,
        trigger_event_ids: tuple[int, ...],
        reason: str,
        debt_bp: int,
    ) -> ReviewQueueItem:
        existing = self.get_open(target_slug, target_topic_id)
        trigger_json = json.dumps(
            sorted(set(trigger_event_ids)), separators=(",", ":")
        )
        if existing is not None:
            if (
                existing.due_date == due_date
                and existing.state == state
                and existing.bounded_questions == bounded_questions
                and existing.trigger_event_ids == tuple(json.loads(trigger_json))
                and existing.reason == reason
                and existing.debt_bp == debt_bp
            ):
                return existing
            self.connection.execute(
                """
                UPDATE review_queue_items SET
                  due_date=?, state=?, bounded_questions=?,
                  trigger_event_ids_json=?, reason=?, debt_bp=?,
                  version=version+1,
                  updated_at=STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW')
                WHERE id=?
                """,
                (
                    due_date.isoformat(),
                    state,
                    bounded_questions,
                    trigger_json,
                    reason,
                    debt_bp,
                    existing.id,
                ),
            )
            saved = self.get(existing.id)
            if saved is None:
                raise RuntimeError("updated review queue item did not return a row")
            return saved
        cursor = self.connection.execute(
            """
            INSERT INTO review_queue_items (
              target_slug, topic_target_slug, target_topic_id, due_date,
              state, bounded_questions, trigger_event_ids_json, reason,
              debt_bp
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                target_slug,
                topic_target_slug,
                target_topic_id,
                due_date.isoformat(),
                state,
                bounded_questions,
                trigger_json,
                reason,
                debt_bp,
            ),
        )
        saved = self.get(cursor.lastrowid)
        if saved is None:
            raise RuntimeError("review queue insert did not return a row")
        return saved

    def defer(
        self, item_id: int, due_date: date, expected_version: int
    ) -> ReviewQueueItem:
        cursor = self.connection.execute(
            """
            UPDATE review_queue_items SET
              due_date=?, state='deferred', version=version+1,
              updated_at=STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW')
            WHERE id=? AND version=? AND state IN ('pending','deferred')
            """,
            (due_date.isoformat(), item_id, expected_version),
        )
        if cursor.rowcount != 1:
            raise ReviewQueueVersionConflictError(
                "review item changed or is no longer open"
            )
        saved = self.get(item_id)
        if saved is None:
            raise RuntimeError("deferred review item did not return a row")
        return saved

    def resolve(
        self, item_id: int, event_id: int, expected_version: int
    ) -> ReviewQueueItem:
        cursor = self.connection.execute(
            """
            UPDATE review_queue_items SET
              state='resolved', resolved_event_id=?, attempt_count=attempt_count+1,
              version=version+1,
              updated_at=STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW')
            WHERE id=? AND version=? AND state IN ('pending','deferred')
            """,
            (event_id, item_id, expected_version),
        )
        if cursor.rowcount != 1:
            raise ReviewQueueVersionConflictError(
                "review item changed or is no longer open"
            )
        saved = self.get(item_id)
        if saved is None:
            raise RuntimeError("resolved review item did not return a row")
        return saved

    def record_attempt(
        self,
        item: ReviewQueueItem,
        *,
        due_date: date,
        state: str,
        trigger_event_ids: tuple[int, ...],
        debt_bp: int,
    ) -> ReviewQueueItem:
        cursor = self.connection.execute(
            """
            UPDATE review_queue_items SET
              due_date=?, state=?, trigger_event_ids_json=?, debt_bp=?,
              attempt_count=attempt_count+1, version=version+1,
              updated_at=STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW')
            WHERE id=? AND version=? AND state IN ('pending','deferred')
            """,
            (
                due_date.isoformat(),
                state,
                json.dumps(sorted(set(trigger_event_ids)), separators=(",", ":")),
                debt_bp,
                item.id,
                item.version,
            ),
        )
        if cursor.rowcount != 1:
            raise ReviewQueueVersionConflictError("review item changed")
        saved = self.get(item.id)
        if saved is None:
            raise RuntimeError("review attempt did not return a row")
        return saved
