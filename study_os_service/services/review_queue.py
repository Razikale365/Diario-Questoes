from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta
import hashlib
import json
import sqlite3

from study_os_service.domain.learning import (
    LearningEvent,
    ReviewQueueItem,
    TopicLearningState,
)
from study_os_service.repositories.learning import LearningRepository
from study_os_service.repositories.review import ReviewQueueRepository
from study_os_service.services.learning_projection import LearningProjectionService


class ReviewQueueNotFoundError(KeyError):
    pass


class ReviewIdempotencyConflictError(RuntimeError):
    pass


class ReviewQueueService:
    def __init__(self, connection: sqlite3.Connection):
        self.connection = connection
        self.learning = LearningProjectionService(connection)
        self.learning_repository = LearningRepository(connection)
        self.repository = ReviewQueueRepository(connection)

    def rebuild(
        self, target_slug: str, as_of: date
    ) -> tuple[ReviewQueueItem, ...]:
        self.connection.execute("BEGIN IMMEDIATE")
        try:
            result = self.rebuild_in_transaction(target_slug, as_of)
            self.connection.commit()
            return result
        except Exception:
            self.connection.rollback()
            raise

    def rebuild_in_transaction(
        self, target_slug: str, as_of: date
    ) -> tuple[ReviewQueueItem, ...]:
        target = self.connection.execute(
            "SELECT * FROM exam_targets WHERE target_slug=? AND active=1",
            (target_slug,),
        ).fetchone()
        if target is None:
            raise KeyError(f"target profile {target_slug} does not exist")
        topics = self.connection.execute(
            """
            SELECT * FROM target_topics
            WHERE active=1 AND (
              target_slug=?
              OR (transfer_kind IN ('shared','partial') AND overlap_value > 0)
            )
            ORDER BY id
            """,
            (target_slug,),
        ).fetchall()
        for topic in topics:
            state = self.learning_repository.get_state(target_slug, topic["id"])
            if state is None and (
                topic["coverage_status"] in {"weak", "stale"}
                or topic["review_debt"] > 0
            ):
                audit = self.learning.append_event_in_transaction(
                    idempotency_key=(
                        f"profile-audit:{target_slug}:{topic['id']}:v{topic['version']}"
                    ),
                    target_slug=target_slug,
                    topic_target_slug=topic["target_slug"],
                    target_topic_id=topic["id"],
                    source_kind="manual",
                    source_id=(
                        f"profile-audit:{target_slug}:{topic['id']}:v{topic['version']}"
                    ),
                    event_kind="coverage_audit",
                    outcome="audited",
                    questions_done=0,
                    correct_count=0,
                    wrong_count=0,
                    doubt_count=0,
                    favorite_count=0,
                    elapsed_seconds=0,
                    start_page=None,
                    end_page=None,
                    occurred_at=datetime.combine(as_of, time(), tzinfo=UTC),
                    evidence={
                        "coverageStatus": topic["coverage_status"],
                        "topicVersion": topic["version"],
                        "reviewDebtBp": round(topic["review_debt"] * 100),
                    },
                )
                state = audit.state
            if state is not None:
                self._upsert_due(target, topic, state, as_of)
        return self.repository.list_open(target_slug)

    def list_open(self, target_slug: str) -> tuple[ReviewQueueItem, ...]:
        return self.repository.list_open(target_slug)

    def defer(
        self,
        item_id: int,
        due_date: date,
        *,
        expected_version: int,
        idempotency_key: str,
    ) -> ReviewQueueItem:
        key = idempotency_key.strip()
        if not key:
            raise ValueError("idempotency key is required")
        request_hash = hashlib.sha256(json.dumps(
            {"itemId": item_id, "dueDate": due_date.isoformat()},
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")).hexdigest()
        self.connection.execute("BEGIN IMMEDIATE")
        try:
            mutation = self.repository.get_mutation(key)
            if mutation is not None:
                if mutation["request_hash"] != request_hash:
                    raise ReviewIdempotencyConflictError(
                        "idempotency key already belongs to another defer request"
                    )
                replayed = self.repository.get(mutation["item_id"])
                if replayed is None:
                    raise RuntimeError("deferred review item no longer exists")
                self.connection.commit()
                return replayed
            current = self.repository.get(item_id)
            if current is None:
                raise ReviewQueueNotFoundError(item_id)
            if due_date <= current.due_date:
                raise ValueError("deferred due date must be later than the current date")
            saved = self.repository.defer(item_id, due_date, expected_version)
            self.repository.insert_mutation(
                idempotency_key=key,
                item_id=item_id,
                request_hash=request_hash,
                result_version=saved.version,
            )
            self.connection.commit()
            return saved
        except Exception:
            self.connection.rollback()
            raise

    def consume_event(
        self, event: LearningEvent, state: TopicLearningState | None
    ) -> ReviewQueueItem | None:
        self.connection.execute("BEGIN IMMEDIATE")
        try:
            result = self.consume_event_in_transaction(event, state)
            self.connection.commit()
            return result
        except Exception:
            self.connection.rollback()
            raise

    def consume_event_in_transaction(
        self, event: LearningEvent, state: TopicLearningState | None
    ) -> ReviewQueueItem | None:
        if event.event_kind != "review" or event.target_topic_id is None:
            return None
        linked_item_id = event.evidence.get("reviewQueueItemId")
        item = (
            self.repository.get(linked_item_id)
            if isinstance(linked_item_id, int) and not isinstance(linked_item_id, bool)
            else self.repository.get_open(event.target_slug, event.target_topic_id)
        )
        if item is None:
            return None
        if (
            item.target_slug != event.target_slug
            or item.target_topic_id != event.target_topic_id
            or item.state not in {"pending", "deferred"}
        ):
            raise ValueError("review event does not match its queue item")
        accuracy = (
            event.correct_count / event.questions_done
            if event.questions_done > 0
            else 0
        )
        if event.outcome == "completed" and accuracy >= 0.8:
            return self.repository.resolve(item.id, event.id, item.version)
        trigger_ids = (*item.trigger_event_ids, event.id)
        projected_debt = state.review_debt_bp if state is not None else item.debt_bp
        if event.outcome == "completed" and accuracy >= 0.6:
            return self.repository.record_attempt(
                item,
                due_date=event.occurred_at.date() + timedelta(days=3),
                state="deferred",
                trigger_event_ids=trigger_ids,
                debt_bp=projected_debt,
            )
        return self.repository.record_attempt(
            item,
            due_date=event.occurred_at.date() + timedelta(days=1),
            state="pending",
            trigger_event_ids=trigger_ids,
            debt_bp=max(projected_debt, item.debt_bp),
        )

    def _upsert_due(self, target, topic, state, as_of: date) -> None:
        stale_at = state.stale_at
        if (
            target["phase"] == "pos_edital"
            and state.last_activity_at is not None
        ):
            deadline_cap = state.last_activity_at.date() + timedelta(days=21)
            stale_at = min(stale_at, deadline_cap) if stale_at else deadline_cap
        stale_due = stale_at is not None and as_of >= stale_at
        weak_due = state.coverage_status in {"weak", "stale"}
        if state.review_debt_bp <= 0 and not stale_due and not weak_due:
            return
        events = self.learning_repository.list_events(target["target_slug"], topic["id"])
        trigger_ids = tuple(event.id for event in events[-10:])
        if not trigger_ids:
            return
        existing = self.repository.get_open(target["target_slug"], topic["id"])
        if existing is not None and existing.state == "deferred":
            if existing.due_date > as_of:
                return
        debt = state.review_debt_bp
        if weak_due:
            debt = max(debt, 2500)
        elif stale_due:
            debt = max(debt, 1500)
        reason = (
            "stale"
            if stale_due and state.review_debt_bp <= 0
            else self._reason(events, stale_due, weak_due)
        )
        questions = 10 if debt >= 7000 else 8 if debt >= 4000 else 5
        self.repository.upsert_open(
            target_slug=target["target_slug"],
            topic_target_slug=topic["target_slug"],
            target_topic_id=topic["id"],
            due_date=(
                min(existing.due_date, as_of)
                if existing is not None and existing.state == "pending"
                else as_of
            ),
            state="pending",
            bounded_questions=questions,
            trigger_event_ids=trigger_ids,
            reason=reason,
            debt_bp=debt,
        )

    @staticmethod
    def _reason(
        events: tuple[LearningEvent, ...], stale_due: bool, weak_due: bool
    ) -> str:
        if any(event.outcome == "failed" for event in events):
            return "failed_block"
        if any(event.wrong_count > 0 or event.doubt_count > 0 for event in events):
            return "recent_errors"
        if any(event.outcome == "skipped" for event in events):
            return "skipped_block"
        if stale_due:
            return "stale"
        if weak_due:
            return "manual_weakness"
        return "review_debt"
