from __future__ import annotations

from datetime import date
import json
import sqlite3

from study_os_service.domain.planner import ExamTarget, TargetTopic


class PlannerProfileVersionConflictError(RuntimeError):
    """Raised when an optimistic profile update uses a stale version."""


class TargetTopicMismatchError(RuntimeError):
    """Raised when a topic id is submitted under a different target."""


def _target(row: sqlite3.Row) -> ExamTarget:
    return ExamTarget(
        target_slug=row["target_slug"],
        display_name=row["display_name"],
        institution=row["institution"],
        role=row["role"],
        banca=row["banca"],
        phase=row["phase"],
        deadline=date.fromisoformat(row["deadline"]) if row["deadline"] else None,
        daily_quota=row["daily_quota"],
        priority_score=row["priority_score"],
        source_urls=tuple(json.loads(row["source_urls_json"])),
        notes=row["notes"],
        active=bool(row["active"]),
        version=row["version"],
    )


def _topic(row: sqlite3.Row) -> TargetTopic:
    return TargetTopic(
        id=row["id"],
        target_slug=row["target_slug"],
        discipline=row["discipline"],
        topic=row["topic"],
        coverage_status=row["coverage_status"],
        edital_weight=row["edital_weight"],
        incidence=row["incidence"],
        tier=row["tier"],
        banca_fit=row["banca_fit"],
        overlap_value=row["overlap_value"],
        transfer_kind=row["transfer_kind"],
        source_kind=row["source_kind"],
        lesson_id=row["lesson_id"],
        material_id=row["material_id"],
        tec_source_url=row["tec_source_url"],
        tec_source_id=row["tec_source_id"],
        planned_questions=row["planned_questions"],
        review_debt=row["review_debt"],
        notes=row["notes"],
        active=bool(row["active"]),
        version=row["version"],
    )


class PlannerProfileRepository:
    def __init__(self, connection: sqlite3.Connection):
        self.connection = connection

    def list_targets(self) -> tuple[ExamTarget, ...]:
        rows = self.connection.execute(
            """
            SELECT * FROM exam_targets
            ORDER BY active DESC, priority_score DESC, target_slug
            """
        )
        return tuple(_target(row) for row in rows)

    def get_target(self, target_slug: str) -> ExamTarget | None:
        row = self.connection.execute(
            "SELECT * FROM exam_targets WHERE target_slug=?", (target_slug,)
        ).fetchone()
        return _target(row) if row else None

    def insert_target_if_missing(self, target: ExamTarget) -> bool:
        cursor = self.connection.execute(
            """
            INSERT OR IGNORE INTO exam_targets (
              target_slug, display_name, institution, role, banca, phase,
              deadline, daily_quota, priority_score, source_urls_json,
              notes, active, version
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                target.target_slug,
                target.display_name,
                target.institution,
                target.role,
                target.banca,
                target.phase,
                target.deadline.isoformat() if target.deadline else None,
                target.daily_quota,
                target.priority_score,
                json.dumps(target.source_urls, ensure_ascii=True),
                target.notes,
                int(target.active),
                target.version,
            ),
        )
        return cursor.rowcount == 1

    def update_target(
        self, target: ExamTarget, *, expected_version: int
    ) -> ExamTarget:
        cursor = self.connection.execute(
            """
            UPDATE exam_targets SET
              display_name=?, institution=?, role=?, banca=?, phase=?,
              deadline=?, daily_quota=?, priority_score=?, source_urls_json=?,
              notes=?, active=?, version=version+1, updated_at=CURRENT_TIMESTAMP
            WHERE target_slug=? AND version=?
            """,
            (
                target.display_name,
                target.institution,
                target.role,
                target.banca,
                target.phase,
                target.deadline.isoformat() if target.deadline else None,
                target.daily_quota,
                target.priority_score,
                json.dumps(target.source_urls, ensure_ascii=True),
                target.notes,
                int(target.active),
                target.target_slug,
                expected_version,
            ),
        )
        if cursor.rowcount != 1:
            raise PlannerProfileVersionConflictError(
                f"target profile {target.target_slug} has changed"
            )
        saved = self.get_target(target.target_slug)
        if saved is None:
            raise RuntimeError("updated target profile disappeared")
        return saved

    def list_topics(self, target_slug: str) -> tuple[TargetTopic, ...]:
        rows = self.connection.execute(
            """
            SELECT * FROM target_topics WHERE target_slug=?
            ORDER BY active DESC, tier, discipline COLLATE NOCASE,
                     topic COLLATE NOCASE, id
            """,
            (target_slug,),
        )
        return tuple(_topic(row) for row in rows)

    def get_topic(self, topic_id: int) -> TargetTopic | None:
        row = self.connection.execute(
            "SELECT * FROM target_topics WHERE id=?", (topic_id,)
        ).fetchone()
        return _topic(row) if row else None

    def insert_topic_if_missing(self, topic: TargetTopic) -> bool:
        cursor = self.connection.execute(
            """
            INSERT OR IGNORE INTO target_topics (
              target_slug, discipline, topic, coverage_status, edital_weight,
              incidence, tier, banca_fit, overlap_value, transfer_kind,
              source_kind, lesson_id, material_id, tec_source_url,
              tec_source_id, planned_questions, review_debt, notes,
              active, version
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            self._topic_values(topic),
        )
        return cursor.rowcount == 1

    def insert_topic(self, topic: TargetTopic) -> TargetTopic:
        cursor = self.connection.execute(
            """
            INSERT INTO target_topics (
              target_slug, discipline, topic, coverage_status, edital_weight,
              incidence, tier, banca_fit, overlap_value, transfer_kind,
              source_kind, lesson_id, material_id, tec_source_url,
              tec_source_id, planned_questions, review_debt, notes,
              active, version
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            self._topic_values(topic),
        )
        saved = self.get_topic(cursor.lastrowid)
        if saved is None:
            raise RuntimeError("inserted target topic disappeared")
        return saved

    def update_topic(
        self,
        target_slug: str,
        topic: TargetTopic,
        *,
        expected_version: int,
    ) -> TargetTopic:
        current = self.get_topic(topic.id)
        if current is None:
            raise KeyError(f"target topic {topic.id} does not exist")
        if current.target_slug != target_slug:
            raise TargetTopicMismatchError(
                f"target topic {topic.id} belongs to {current.target_slug}"
            )
        cursor = self.connection.execute(
            """
            UPDATE target_topics SET
              discipline=?, topic=?, coverage_status=?, edital_weight=?,
              incidence=?, tier=?, banca_fit=?, overlap_value=?,
              transfer_kind=?, source_kind=?, lesson_id=?, material_id=?,
              tec_source_url=?, tec_source_id=?, planned_questions=?,
              review_debt=?, notes=?, active=?, version=version+1,
              updated_at=CURRENT_TIMESTAMP
            WHERE id=? AND target_slug=? AND version=?
            """,
            (
                topic.discipline,
                topic.topic,
                topic.coverage_status,
                topic.edital_weight,
                topic.incidence,
                topic.tier,
                topic.banca_fit,
                topic.overlap_value,
                topic.transfer_kind,
                topic.source_kind,
                topic.lesson_id,
                topic.material_id,
                topic.tec_source_url,
                topic.tec_source_id,
                topic.planned_questions,
                topic.review_debt,
                topic.notes,
                int(topic.active),
                topic.id,
                target_slug,
                expected_version,
            ),
        )
        if cursor.rowcount != 1:
            raise PlannerProfileVersionConflictError(
                f"target topic {topic.id} has changed"
            )
        saved = self.get_topic(topic.id)
        if saved is None:
            raise RuntimeError("updated target topic disappeared")
        return saved

    @staticmethod
    def _topic_values(topic: TargetTopic) -> tuple[object, ...]:
        return (
            topic.target_slug,
            topic.discipline,
            topic.topic,
            topic.coverage_status,
            topic.edital_weight,
            topic.incidence,
            topic.tier,
            topic.banca_fit,
            topic.overlap_value,
            topic.transfer_kind,
            topic.source_kind,
            topic.lesson_id,
            topic.material_id,
            topic.tec_source_url,
            topic.tec_source_id,
            topic.planned_questions,
            topic.review_debt,
            topic.notes,
            int(topic.active),
            topic.version,
        )
