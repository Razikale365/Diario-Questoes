from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import date
import json
from pathlib import Path
import sqlite3
from typing import Any

from study_os_service.domain.planner import ExamTarget, TargetTopic
from study_os_service.repositories.planner_profiles import (
    PlannerProfileRepository,
    TargetTopicMismatchError,
)


DEFAULT_SEED_PATH = (
    Path(__file__).resolve().parent.parent / "data" / "planner_seed_profiles.json"
)


class TargetProfileNotFoundError(KeyError):
    pass


class TargetTopicNotFoundError(KeyError):
    pass


@dataclass(frozen=True, slots=True)
class SeedResult:
    targets_seeded: int
    topics_seeded: int
    target_slugs: tuple[str, ...]


def _required_positive_int(value: Any, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise ValueError(f"{label} must be a positive integer")
    return value


def _optional_date(value: Any, label: str) -> date | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError(f"{label} must use YYYY-MM-DD")
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError(f"{label} must use YYYY-MM-DD") from exc


def _target_from_seed(payload: dict[str, Any]) -> ExamTarget:
    return ExamTarget(
        target_slug=payload.get("targetSlug"),
        display_name=payload.get("displayName"),
        institution=payload.get("institution"),
        role=payload.get("role"),
        banca=payload.get("banca"),
        phase=payload.get("phase"),
        deadline=_optional_date(payload.get("deadline"), "deadline"),
        daily_quota=payload.get("dailyQuota", 4),
        priority_score=payload.get("priorityScore", 50),
        source_urls=tuple(payload.get("sourceUrls", ())),
        notes=payload.get("notes", ""),
        active=payload.get("active", True),
        version=1,
    )


def _new_topic(target_slug: str, payload: dict[str, Any]) -> TargetTopic:
    return TargetTopic(
        id=1,
        target_slug=target_slug,
        discipline=payload.get("discipline"),
        topic=payload.get("topic"),
        coverage_status=payload.get("coverageStatus", "unread"),
        edital_weight=payload.get("editalWeight", 1),
        incidence=payload.get("incidence", 0),
        tier=payload.get("tier", 3),
        banca_fit=payload.get("bancaFit", 0),
        overlap_value=payload.get("overlapValue", 0),
        transfer_kind=payload.get("transferKind", "target_specific"),
        source_kind=payload.get("sourceKind", "manual"),
        lesson_id=payload.get("lessonId"),
        material_id=payload.get("materialId"),
        tec_source_url=payload.get("tecSourceUrl"),
        tec_source_id=payload.get("tecSourceId"),
        planned_questions=payload.get("plannedQuestions", 20),
        review_debt=payload.get("reviewDebt", 0),
        notes=payload.get("notes", ""),
        active=payload.get("active", True),
        version=1,
    )


class PlannerProfileService:
    def __init__(
        self,
        connection: sqlite3.Connection,
        *,
        seed_path: Path = DEFAULT_SEED_PATH,
    ):
        self.connection = connection
        self.repository = PlannerProfileRepository(connection)
        self.seed_path = seed_path

    def list_targets(self) -> tuple[ExamTarget, ...]:
        return self.repository.list_targets()

    def list_topics(self, target_slug: str) -> tuple[TargetTopic, ...]:
        target = self.repository.get_target(target_slug)
        if target is None:
            raise TargetProfileNotFoundError(target_slug)
        return self.repository.list_topics(target.target_slug)

    def seed(self, target_slugs: tuple[str, ...] | None = None) -> SeedResult:
        targets = self._load_seed_targets()
        available = {payload["targetSlug"] for payload in targets}
        requested = tuple(
            dict.fromkeys(
                tuple(sorted(available)) if target_slugs is None else target_slugs
            )
        )
        unknown = sorted(set(requested) - available)
        if unknown:
            raise ValueError(f"unknown target seeds: {', '.join(unknown)}")

        selected = [payload for payload in targets if payload["targetSlug"] in requested]
        validated: list[tuple[ExamTarget, tuple[TargetTopic, ...]]] = []
        for payload in selected:
            target = _target_from_seed(payload)
            topics_payload = payload.get("topics")
            if not isinstance(topics_payload, list):
                raise ValueError(f"target seed {target.target_slug} requires topics")
            defaults = {
                "tecSourceUrl": payload.get("defaultTecSourceUrl"),
            }
            topics = tuple(
                _new_topic(target.target_slug, defaults | item)
                for item in topics_payload
            )
            validated.append((target, topics))

        targets_seeded = 0
        topics_seeded = 0
        self.connection.execute("BEGIN IMMEDIATE")
        try:
            for target, topics in validated:
                targets_seeded += int(self.repository.insert_target_if_missing(target))
                for topic in topics:
                    topics_seeded += int(
                        self.repository.insert_topic_if_missing(topic)
                    )
            self.connection.commit()
        except Exception:
            self.connection.rollback()
            raise
        return SeedResult(targets_seeded, topics_seeded, requested)

    def update_target(self, payload: dict[str, Any]) -> ExamTarget:
        target_slug = payload.get("targetSlug")
        if not isinstance(target_slug, str) or not target_slug.strip():
            raise ValueError("target is required")
        current = self.repository.get_target(target_slug.strip())
        if current is None:
            raise TargetProfileNotFoundError(target_slug.strip())
        expected_version = _required_positive_int(
            payload.get("expectedVersion"), "expected version"
        )
        deadline = (
            _optional_date(payload["deadline"], "deadline")
            if "deadline" in payload
            else current.deadline
        )
        source_urls = (
            tuple(payload["sourceUrls"])
            if "sourceUrls" in payload
            else current.source_urls
        )
        candidate = replace(
            current,
            display_name=payload.get("displayName", current.display_name),
            institution=payload.get("institution", current.institution),
            role=payload.get("role", current.role),
            banca=payload.get("banca", current.banca),
            phase=payload.get("phase", current.phase),
            deadline=deadline,
            daily_quota=payload.get("dailyQuota", current.daily_quota),
            priority_score=payload.get("priorityScore", current.priority_score),
            source_urls=source_urls,
            notes=payload.get("notes", current.notes),
            active=payload.get("active", current.active),
        )
        self.connection.execute("BEGIN IMMEDIATE")
        try:
            saved = self.repository.update_target(
                candidate, expected_version=expected_version
            )
            self.connection.commit()
            return saved
        except Exception:
            self.connection.rollback()
            raise

    def update_topics(
        self, target_slug: str, items: list[dict[str, Any]]
    ) -> tuple[TargetTopic, ...]:
        target = self.repository.get_target(target_slug)
        if target is None:
            raise TargetProfileNotFoundError(target_slug)
        if not items:
            raise ValueError("at least one target topic is required")

        prepared: list[tuple[TargetTopic, int | None]] = []
        seen_ids: set[int] = set()
        for payload in items:
            if not isinstance(payload, dict):
                raise ValueError("each target topic must be an object")
            topic_id = payload.get("id")
            if topic_id is None:
                prepared.append((_new_topic(target.target_slug, payload), None))
                continue
            topic_id = _required_positive_int(topic_id, "target topic id")
            if topic_id in seen_ids:
                raise ValueError(f"target topic {topic_id} appears more than once")
            seen_ids.add(topic_id)
            current = self.repository.get_topic(topic_id)
            if current is None:
                raise TargetTopicNotFoundError(topic_id)
            if current.target_slug != target.target_slug:
                raise TargetTopicMismatchError(
                    f"target topic {topic_id} belongs to {current.target_slug}"
                )
            expected_version = _required_positive_int(
                payload.get("expectedVersion"), "expected version"
            )
            prepared.append((self._merge_topic(current, payload), expected_version))

        saved_topics: list[TargetTopic] = []
        self.connection.execute("BEGIN IMMEDIATE")
        try:
            for topic, expected_version in prepared:
                if expected_version is None:
                    saved_topics.append(self.repository.insert_topic(topic))
                else:
                    saved_topics.append(
                        self.repository.update_topic(
                            target.target_slug,
                            topic,
                            expected_version=expected_version,
                        )
                    )
            self.connection.commit()
        except Exception:
            self.connection.rollback()
            raise
        return tuple(saved_topics)

    @staticmethod
    def _merge_topic(
        current: TargetTopic, payload: dict[str, Any]
    ) -> TargetTopic:
        return replace(
            current,
            discipline=payload.get("discipline", current.discipline),
            topic=payload.get("topic", current.topic),
            coverage_status=payload.get("coverageStatus", current.coverage_status),
            edital_weight=payload.get("editalWeight", current.edital_weight),
            incidence=payload.get("incidence", current.incidence),
            tier=payload.get("tier", current.tier),
            banca_fit=payload.get("bancaFit", current.banca_fit),
            overlap_value=payload.get("overlapValue", current.overlap_value),
            transfer_kind=payload.get("transferKind", current.transfer_kind),
            source_kind=payload.get("sourceKind", current.source_kind),
            lesson_id=payload.get("lessonId", current.lesson_id),
            material_id=payload.get("materialId", current.material_id),
            tec_source_url=payload.get("tecSourceUrl", current.tec_source_url),
            tec_source_id=payload.get("tecSourceId", current.tec_source_id),
            planned_questions=payload.get(
                "plannedQuestions", current.planned_questions
            ),
            review_debt=payload.get("reviewDebt", current.review_debt),
            notes=payload.get("notes", current.notes),
            active=payload.get("active", current.active),
        )

    def _load_seed_targets(self) -> list[dict[str, Any]]:
        try:
            document = json.loads(self.seed_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise ValueError("planner seed catalog is unavailable or invalid") from exc
        if not isinstance(document, dict) or not isinstance(document.get("targets"), list):
            raise ValueError("planner seed catalog requires a targets array")
        if not all(isinstance(item, dict) for item in document["targets"]):
            raise ValueError("planner seed targets must be objects")
        return document["targets"]
