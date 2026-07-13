from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
import hashlib
import json
import sqlite3
import unicodedata
from typing import Any

from study_os_service.services.learning_projection import (
    LearningIdempotencyConflictError,
    LearningProjectionService,
)


_ITEM_KEYS = {
    "sourceItemId",
    "targetTopicId",
    "discipline",
    "topic",
    "eventKind",
    "occurredAt",
    "sourceDate",
    "questionsDone",
    "correctCount",
    "wrongCount",
    "doubtCount",
    "favoriteCount",
}


class LearningImportConflictError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class LearningImportRejection:
    source_item_id: str
    code: str
    message: str


@dataclass(frozen=True, slots=True)
class LearningImportResult:
    target_slug: str
    batch_id: str
    imported_count: int
    rejected: tuple[LearningImportRejection, ...]

    @property
    def rejected_count(self) -> int:
        return len(self.rejected)


def _normalize(value: str) -> str:
    decomposed = unicodedata.normalize("NFD", value)
    return " ".join(
        "".join(character for character in decomposed if not unicodedata.combining(character))
        .casefold()
        .split()
    )


def _result_payload(result: LearningImportResult) -> dict[str, Any]:
    return {
        "targetSlug": result.target_slug,
        "batchId": result.batch_id,
        "importedCount": result.imported_count,
        "rejectedCount": result.rejected_count,
        "rejected": [
            {
                "sourceItemId": item.source_item_id,
                "code": item.code,
                "message": item.message,
            }
            for item in result.rejected
        ],
    }


def _result(value: dict[str, Any]) -> LearningImportResult:
    return LearningImportResult(
        target_slug=value["targetSlug"],
        batch_id=value["batchId"],
        imported_count=value["importedCount"],
        rejected=tuple(
            LearningImportRejection(
                source_item_id=item["sourceItemId"],
                code=item["code"],
                message=item["message"],
            )
            for item in value["rejected"]
        ),
    )


class LearningImportService:
    def __init__(self, connection: sqlite3.Connection):
        self.connection = connection
        self.learning = LearningProjectionService(connection)

    def import_aggregates(
        self,
        *,
        target_slug: str,
        batch_id: str | None,
        items: list[dict[str, Any]],
        idempotency_key: str,
    ) -> LearningImportResult:
        target = target_slug.strip()
        key = idempotency_key.strip()
        batch = (batch_id or key).strip()
        if not target or not key or not batch:
            raise ValueError("target, batch, and idempotency key are required")
        if not isinstance(items, list) or not items:
            raise ValueError("items must be a non-empty array")
        if len(items) > 10000:
            raise ValueError("aggregate import is limited to 10000 rows")
        for item in items:
            if not isinstance(item, dict):
                raise ValueError("every aggregate item must be an object")
            unsupported = sorted(set(item) - _ITEM_KEYS)
            if unsupported:
                raise ValueError(
                    "unsupported or proprietary aggregate fields: "
                    + ", ".join(unsupported)
                )
        request_hash = hashlib.sha256(json.dumps(
            {"targetSlug": target, "batchId": batch, "items": items},
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=True,
        ).encode("utf-8")).hexdigest()

        self.connection.execute("BEGIN IMMEDIATE")
        try:
            existing = self.connection.execute(
                "SELECT * FROM learning_import_runs WHERE idempotency_key=?",
                (key,),
            ).fetchone()
            if existing is not None:
                if existing["request_hash"] != request_hash:
                    raise LearningImportConflictError(
                        "idempotency key already belongs to another import"
                    )
                result = _result(json.loads(existing["result_json"]))
                self.connection.commit()
                return result
            profile = self.connection.execute(
                "SELECT target_slug FROM exam_targets WHERE target_slug=? AND active=1",
                (target,),
            ).fetchone()
            if profile is None:
                raise KeyError(f"target profile {target} does not exist")
            topics = self.connection.execute(
                "SELECT * FROM target_topics WHERE target_slug=? AND active=1 ORDER BY id",
                (target,),
            ).fetchall()
            imported_count = 0
            rejected: list[LearningImportRejection] = []
            for raw in items:
                source_id = self._text(raw.get("sourceItemId"), "sourceItemId")
                topic = self._resolve_topic(raw, topics)
                if topic is None:
                    rejected.append(LearningImportRejection(
                        source_item_id=source_id,
                        code="topic_unmapped",
                        message="No unique target topic matched this aggregate row.",
                    ))
                    continue
                event_kind = raw.get("eventKind")
                if event_kind not in {"questions", "review"}:
                    raise ValueError("eventKind must be questions or review")
                occurred_at = self._datetime(raw.get("occurredAt"))
                source_date = raw.get("sourceDate")
                if source_date is not None:
                    if not isinstance(source_date, str):
                        raise ValueError("sourceDate must use YYYY-MM-DD")
                    date.fromisoformat(source_date)
                counts = {
                    key_name: self._count(raw.get(key_name), key_name)
                    for key_name in (
                        "questionsDone",
                        "correctCount",
                        "wrongCount",
                        "doubtCount",
                        "favoriteCount",
                    )
                }
                event_identity = f"legacy:{target}:{source_id}"
                try:
                    self.learning.append_event_in_transaction(
                        idempotency_key=event_identity,
                        target_slug=target,
                        topic_target_slug=topic["target_slug"],
                        target_topic_id=topic["id"],
                        source_kind="legacy_aggregate",
                        source_id=event_identity,
                        event_kind=event_kind,
                        outcome="imported",
                        questions_done=counts["questionsDone"],
                        correct_count=counts["correctCount"],
                        wrong_count=counts["wrongCount"],
                        doubt_count=counts["doubtCount"],
                        favorite_count=counts["favoriteCount"],
                        elapsed_seconds=0,
                        start_page=None,
                        end_page=None,
                        occurred_at=occurred_at,
                        evidence={
                            "importSourceItemId": source_id,
                            **({"sourceDate": source_date} if source_date else {}),
                        },
                    )
                except LearningIdempotencyConflictError as exc:
                    raise LearningImportConflictError(str(exc)) from exc
                imported_count += 1
            result = LearningImportResult(
                target_slug=target,
                batch_id=batch,
                imported_count=imported_count,
                rejected=tuple(rejected),
            )
            payload = _result_payload(result)
            self.connection.execute(
                """
                INSERT INTO learning_import_runs (
                  idempotency_key, target_slug, request_hash, result_json
                ) VALUES (?, ?, ?, ?)
                """,
                (
                    key,
                    target,
                    request_hash,
                    json.dumps(payload, sort_keys=True, separators=(",", ":")),
                ),
            )
            self.connection.commit()
            return result
        except Exception:
            self.connection.rollback()
            raise

    @staticmethod
    def _resolve_topic(raw: dict[str, Any], topics):
        topic_id = raw.get("targetTopicId")
        if topic_id is not None:
            if isinstance(topic_id, bool) or not isinstance(topic_id, int) or topic_id < 1:
                raise ValueError("targetTopicId must be a positive integer")
            return next((topic for topic in topics if topic["id"] == topic_id), None)
        discipline = raw.get("discipline")
        topic_name = raw.get("topic")
        if not isinstance(discipline, str) or not isinstance(topic_name, str):
            return None
        matches = [
            topic
            for topic in topics
            if _normalize(topic["discipline"]) == _normalize(discipline)
            and _normalize(topic["topic"]) == _normalize(topic_name)
        ]
        return matches[0] if len(matches) == 1 else None

    @staticmethod
    def _text(value: Any, label: str) -> str:
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f"{label} is required")
        return value.strip()

    @staticmethod
    def _count(value: Any, label: str) -> int:
        if isinstance(value, bool) or not isinstance(value, int) or value < 0:
            raise ValueError(f"{label} must be a non-negative integer")
        return value

    @staticmethod
    def _datetime(value: Any) -> datetime:
        if not isinstance(value, str):
            raise ValueError("occurredAt must be an ISO timestamp")
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None or parsed.utcoffset() is None:
            raise ValueError("occurredAt must include a timezone")
        return parsed


learning_import_payload = _result_payload
