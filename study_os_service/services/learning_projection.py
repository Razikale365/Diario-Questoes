from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
import json
import sqlite3
from typing import Mapping

from study_os_service.domain.learning import LearningEvent, TopicLearningState
from study_os_service.domain.planner import PlannerBlock
from study_os_service.domain.sessions import StudySession
from study_os_service.repositories.learning import LearningRepository


_INITIAL_MASTERY = {
    "unread": 0,
    "in_progress": 2500,
    "weak": 3000,
    "stale": 4500,
    "covered": 7000,
    "strong": 8500,
}
_INITIAL_CONFIDENCE = {
    "unread": 0,
    "in_progress": 2000,
    "weak": 2500,
    "stale": 3500,
    "covered": 6500,
    "strong": 8500,
}
_STALE_DAYS = {
    "unread": 0,
    "stale": 0,
    "in_progress": 3,
    "weak": 7,
    "covered": 30,
    "strong": 45,
}


class LearningIdempotencyConflictError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class LearningProjectionResult:
    event: LearningEvent
    state: TopicLearningState | None


def _clamp(value: int) -> int:
    return max(0, min(10000, value))


def project_topic_state(
    target_slug: str,
    topic: Mapping[str, object],
    events: tuple[LearningEvent, ...],
) -> TopicLearningState:
    ordered = tuple(sorted(events, key=lambda item: (item.occurred_at, item.id)))
    if not ordered:
        raise ValueError("at least one learning event is required")
    coverage = str(topic["coverage_status"])
    mastery = _INITIAL_MASTERY[coverage]
    confidence = _INITIAL_CONFIDENCE[coverage]
    debt = _clamp(round(float(topic["review_debt"]) * 100))
    success_streak = 0
    failure_streak = 0
    last_activity = None
    last_success = None

    for event in ordered:
        last_activity = event.occurred_at
        success = False
        failure = False
        if event.event_kind == "theory":
            if event.outcome == "completed":
                mastery = _clamp(mastery + 4000)
                confidence = _clamp(confidence + 1800)
                debt = _clamp(debt - 2000)
                coverage = "strong" if mastery >= 8500 else "covered"
                success = True
            elif event.outcome == "partial":
                mastery = max(mastery, 2500)
                confidence = _clamp(confidence + 300)
                coverage = "in_progress"
            elif event.outcome == "failed":
                mastery = _clamp(mastery - 1000)
                confidence = _clamp(confidence - 800)
                debt = _clamp(debt + 2500)
                coverage = "weak"
                failure = True
            elif event.outcome == "skipped":
                debt = _clamp(debt + 500)
            elif event.outcome == "abandoned":
                debt = _clamp(debt + 250)
                coverage = "in_progress"

        if event.questions_done > 0:
            accuracy = event.correct_count / event.questions_done
            error_debt = (
                event.wrong_count * 250
                + event.doubt_count * 150
                + event.favorite_count * 100
            )
            if event.outcome == "failed" or accuracy < 0.6:
                mastery = _clamp(mastery - 800)
                confidence = _clamp(confidence - 500)
                debt = _clamp(debt + 1500 + error_debt)
                coverage = "weak"
                failure = True
                success = False
            elif accuracy >= 0.8:
                mastery = _clamp(mastery + (2000 if event.event_kind == "review" else 6500))
                confidence = _clamp(confidence + 1500)
                debt = _clamp(debt - (3000 if event.event_kind == "review" else 2000))
                coverage = "strong" if mastery >= 8500 else "covered"
                success = True
            else:
                mastery = _clamp(mastery + 3000)
                confidence = _clamp(confidence + 500)
                debt = _clamp(debt - 500 + error_debt // 4)
                coverage = "covered" if event.questions_done >= 10 else "in_progress"
                success = True

        if event.event_kind != "theory" and event.outcome == "skipped":
            debt = _clamp(debt + 500)
        if (
            event.event_kind != "theory"
            and event.outcome == "failed"
            and event.questions_done == 0
        ):
            debt = _clamp(debt + 2500)
            coverage = "weak"
            failure = True

        if event.outcome == "failed" and event.questions_done == 0:
            failure = True
        if success:
            success_streak += 1
            failure_streak = 0
            last_success = event.occurred_at
        elif failure:
            failure_streak += 1
            success_streak = 0

    activity_day = last_activity.date()
    stale_days = _STALE_DAYS[coverage]
    stale_at = activity_day + timedelta(days=stale_days)
    return TopicLearningState(
        target_slug=target_slug,
        topic_target_slug=str(topic["target_slug"]),
        target_topic_id=int(topic["id"]),
        mastery_bp=mastery,
        confidence_bp=confidence,
        coverage_status=coverage,
        review_debt_bp=debt,
        last_activity_at=last_activity,
        last_success_at=last_success,
        next_review_date=stale_at,
        stale_at=stale_at,
        success_streak=success_streak,
        failure_streak=failure_streak,
        event_cursor=max(event.id for event in ordered),
        version=len(ordered),
    )


class LearningProjectionService:
    def __init__(self, connection: sqlite3.Connection):
        self.connection = connection
        self.repository = LearningRepository(connection)

    def append_event(self, **values) -> LearningProjectionResult:
        self.connection.execute("BEGIN IMMEDIATE")
        try:
            result = self.append_event_in_transaction(**values)
            self.connection.commit()
            return result
        except Exception:
            self.connection.rollback()
            raise

    def append_event_in_transaction(self, **values) -> LearningProjectionResult:
        existing = self.repository.get_event_by_idempotency_key(
            str(values["idempotency_key"])
        )
        source_existing = self.repository.get_event_by_source(
            str(values["source_kind"]), str(values["source_id"])
        )
        prior = existing or source_existing
        if prior is not None:
            if not self._matches(prior, values):
                raise LearningIdempotencyConflictError(
                    "learning identity already belongs to another outcome"
                )
            state = (
                self.repository.get_state(prior.target_slug, prior.target_topic_id)
                if prior.target_topic_id is not None
                else None
            )
            return LearningProjectionResult(prior, state)

        event = self.repository.insert_event(**values)
        if event.target_topic_id is None:
            return LearningProjectionResult(event, None)
        state = self.rebuild_topic_state(event.target_slug, event.target_topic_id)
        return LearningProjectionResult(event, state)

    def rebuild_topic_state(
        self, target_slug: str, target_topic_id: int
    ) -> TopicLearningState:
        topic = self.repository.get_topic(target_topic_id)
        if topic is None:
            raise KeyError(f"target topic {target_topic_id} does not exist")
        events = self.repository.list_events(target_slug, target_topic_id)
        state = project_topic_state(target_slug, topic, events)
        return self.repository.upsert_state(state)

    def record_planner_block(self, block: PlannerBlock) -> LearningProjectionResult:
        context = self.repository.resolve_block_topic(block.id)
        if context is None:
            raise KeyError(f"planner block {block.id} does not exist")
        occurred_at = datetime.fromisoformat(
            context["updated_at"].replace("Z", "+00:00")
        )
        if occurred_at.tzinfo is None:
            occurred_at = occurred_at.replace(tzinfo=UTC)
        candidate_evidence = json.loads(context["evidence_json"]).get(
            "candidateEvidence", {}
        )
        review_queue_item_id = candidate_evidence.get("reviewQueueItemId")
        return self.append_event_in_transaction(
            idempotency_key=f"planner-block:{block.id}:result",
            target_slug=block.target_slug,
            topic_target_slug=context["topic_target_slug"],
            target_topic_id=context["target_topic_id"],
            source_kind="planner_block",
            source_id=str(block.id),
            event_kind=block.block_kind,
            outcome=block.state,
            questions_done=block.questions_done,
            correct_count=block.correct_count,
            wrong_count=block.wrong_count,
            doubt_count=block.doubt_count,
            favorite_count=block.favorite_count,
            elapsed_seconds=0,
            start_page=None,
            end_page=None,
            occurred_at=occurred_at,
            evidence={
                "plannerRunId": block.run_id,
                "plannerBlockId": block.id,
                "candidateId": block.candidate_id,
                "plannedQuestions": block.planned_questions,
                **(
                    {"reviewQueueItemId": review_queue_item_id}
                    if review_queue_item_id is not None
                    else {}
                ),
            },
        )

    def record_study_session(self, session: StudySession) -> LearningProjectionResult:
        context = self.repository.resolve_session_topic(session.id)
        return self.append_event_in_transaction(
            idempotency_key=f"study-session:{session.id}:result",
            target_slug=session.target_slug,
            topic_target_slug=(context["topic_target_slug"] if context else None),
            target_topic_id=(context["target_topic_id"] if context else None),
            source_kind="study_session",
            source_id=str(session.id),
            event_kind="theory",
            outcome=session.outcome,
            questions_done=session.questions_done,
            correct_count=session.correct_count,
            wrong_count=session.wrong_count,
            doubt_count=session.doubt_count,
            favorite_count=session.favorite_count,
            elapsed_seconds=session.elapsed_seconds,
            start_page=session.start_page,
            end_page=session.end_page or session.start_page,
            occurred_at=session.ended_at,
            evidence={
                "sessionId": session.id,
                "lessonId": session.lesson_id,
                "materialId": session.material_id,
                **(
                    {"plannerBlockId": context["planner_block_id"]}
                    if context and context["planner_block_id"] is not None
                    else {}
                ),
            },
        )

    @staticmethod
    def _matches(event: LearningEvent, values: Mapping[str, object]) -> bool:
        return all(
            getattr(event, field) == values[field]
            for field in (
                "idempotency_key",
                "target_slug",
                "topic_target_slug",
                "target_topic_id",
                "source_kind",
                "source_id",
                "event_kind",
                "outcome",
                "questions_done",
                "correct_count",
                "wrong_count",
                "doubt_count",
                "favorite_count",
                "elapsed_seconds",
                "start_page",
                "end_page",
                "occurred_at",
            )
        ) and dict(event.evidence) == dict(values["evidence"])
