from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
import json
import sqlite3
from typing import Any, Mapping, TypedDict, cast

from study_os_service.domain.sprint_evidence import (
    MeasurementType,
    SprintPerformanceObservation,
    TransferScope,
)


class EvidenceImportBatchRecord(TypedDict):
    batch_id: str
    target_slug: str
    origin: str
    payload_hash: str
    item_count: int
    inserted_count: int
    duplicate_count: int
    conflict_count: int
    report: dict[str, Any]
    imported_at: datetime


def _canonical_json(value: Mapping[str, Any]) -> str:
    return json.dumps(
        dict(value),
        ensure_ascii=True,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    )


def _utc_timestamp(value: datetime) -> str:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("timestamp must be timezone-aware")
    return (
        value.astimezone(UTC)
        .isoformat(timespec="microseconds")
        .replace("+00:00", "Z")
    )


def _parse_timestamp(value: str) -> datetime:
    parsed = datetime.fromisoformat(value[:-1] + "+00:00" if value.endswith("Z") else value)
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError("stored timestamp must be timezone-aware")
    return parsed.astimezone(UTC)


def _batch(row: sqlite3.Row) -> EvidenceImportBatchRecord:
    report = json.loads(row["report_json"])
    if not isinstance(report, dict):
        raise ValueError("stored evidence batch report must be an object")
    return {
        "batch_id": row["batch_id"],
        "target_slug": row["target_slug"],
        "origin": row["origin"],
        "payload_hash": row["payload_hash"],
        "item_count": row["item_count"],
        "inserted_count": row["inserted_count"],
        "duplicate_count": row["duplicate_count"],
        "conflict_count": row["conflict_count"],
        "report": report,
        "imported_at": _parse_timestamp(row["imported_at"]),
    }


def _observation(row: sqlite3.Row) -> SprintPerformanceObservation:
    provenance = json.loads(row["provenance_json"])
    if not isinstance(provenance, dict):
        raise ValueError("stored evidence provenance must be an object")
    return SprintPerformanceObservation(
        id=row["id"],
        target_slug=row["target_slug"],
        batch_id=row["batch_id"],
        subject_profile_id=row["subject_profile_id"],
        subject_key=row["subject_key"],
        discipline=row["discipline"],
        topic_hint=row["topic_hint"],
        observed_on=date.fromisoformat(row["observed_on"]),
        origin=row["origin"],
        source_record_id=row["source_record_id"],
        source_revision=row["source_revision"],
        source_updated_at=_parse_timestamp(row["source_updated_at"]),
        measurement_type=cast(MeasurementType, row["measurement_type"]),
        exam_board=row["exam_board"],
        correct_count=row["correct_count"],
        wrong_count=row["wrong_count"],
        doubt_count=row["doubt_count"],
        percentage_bp=row["percentage_bp"],
        transfer_scope=cast(TransferScope, row["transfer_scope"]),
        transferability_bp=row["transferability_bp"],
        content_hash=row["content_hash"],
        provenance=provenance,
    )


class SprintEvidenceRepository:
    def __init__(self, connection: sqlite3.Connection):
        self.connection = connection

    def _require_transaction(self) -> None:
        if not self.connection.in_transaction:
            raise RuntimeError("caller must own an active evidence transaction")

    def get_batch(self, batch_id: str) -> EvidenceImportBatchRecord | None:
        row = self.connection.execute(
            "SELECT * FROM sprint_evidence_import_batches WHERE batch_id=?",
            (batch_id,),
        ).fetchone()
        return _batch(row) if row is not None else None

    def create_batch_in_transaction(
        self,
        *,
        batch_id: str,
        target_slug: str,
        origin: str,
        payload_hash: str,
        item_count: int,
        imported_at: datetime | None = None,
    ) -> EvidenceImportBatchRecord:
        self._require_transaction()
        self.connection.execute(
            """
            INSERT INTO sprint_evidence_import_batches (
              batch_id, target_slug, origin, payload_hash, item_count,
              inserted_count, duplicate_count, conflict_count,
              report_json, imported_at
            ) VALUES (?, ?, ?, ?, ?, 0, 0, 0, '{}', ?)
            """,
            (
                batch_id,
                target_slug,
                origin,
                payload_hash,
                item_count,
                _utc_timestamp(imported_at or datetime.now(UTC)),
            ),
        )
        saved = self.get_batch(batch_id)
        if saved is None:
            raise RuntimeError("inserted evidence batch was not visible")
        return saved

    def finalize_batch_in_transaction(
        self,
        batch_id: str,
        *,
        inserted_count: int,
        duplicate_count: int,
        conflict_count: int,
        report: Mapping[str, Any],
    ) -> EvidenceImportBatchRecord:
        self._require_transaction()
        cursor = self.connection.execute(
            """
            UPDATE sprint_evidence_import_batches
            SET inserted_count=?, duplicate_count=?, conflict_count=?, report_json=?
            WHERE batch_id=?
            """,
            (
                inserted_count,
                duplicate_count,
                conflict_count,
                _canonical_json(report),
                batch_id,
            ),
        )
        if cursor.rowcount != 1:
            raise RuntimeError("evidence batch was not found during finalization")
        saved = self.get_batch(batch_id)
        if saved is None:
            raise RuntimeError("finalized evidence batch was not visible")
        return saved

    def find_revision(
        self,
        target_slug: str,
        origin: str,
        source_record_id: str,
        source_revision: str,
    ) -> SprintPerformanceObservation | None:
        row = self.connection.execute(
            """
            SELECT * FROM sprint_performance_observations
            WHERE target_slug=? AND origin=?
              AND source_record_id=? AND source_revision=?
            LIMIT 1
            """,
            (target_slug, origin, source_record_id, source_revision),
        ).fetchone()
        return _observation(row) if row is not None else None

    def append_observation_in_transaction(
        self,
        observation: SprintPerformanceObservation,
    ) -> SprintPerformanceObservation:
        self._require_transaction()
        if not isinstance(observation, SprintPerformanceObservation):
            raise TypeError("observation must be a SprintPerformanceObservation")
        cursor = self.connection.execute(
            """
            INSERT INTO sprint_performance_observations (
              target_slug, batch_id, subject_profile_id, subject_key,
              discipline, topic_hint, observed_on, origin,
              source_record_id, source_revision, source_updated_at,
              measurement_type, exam_board, correct_count, wrong_count,
              doubt_count, percentage_bp, transfer_scope, transferability_bp,
              content_hash, provenance_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                observation.target_slug,
                observation.batch_id,
                observation.subject_profile_id,
                observation.subject_key,
                observation.discipline,
                observation.topic_hint,
                observation.observed_on.isoformat(),
                observation.origin,
                observation.source_record_id,
                observation.source_revision,
                _utc_timestamp(observation.source_updated_at),
                observation.measurement_type,
                observation.exam_board,
                observation.correct_count,
                observation.wrong_count,
                observation.doubt_count,
                observation.percentage_bp,
                observation.transfer_scope,
                observation.transferability_bp,
                observation.content_hash,
                _canonical_json(observation.provenance),
                _utc_timestamp(datetime.now(UTC)),
            ),
        )
        row = self.connection.execute(
            "SELECT * FROM sprint_performance_observations WHERE id=?",
            (cursor.lastrowid,),
        ).fetchone()
        if row is None:
            raise RuntimeError("inserted evidence observation was not visible")
        return _observation(row)

    def list_observations(
        self,
        target_slug: str,
    ) -> tuple[SprintPerformanceObservation, ...]:
        rows = self.connection.execute(
            """
            SELECT * FROM sprint_performance_observations
            WHERE target_slug=?
            ORDER BY observed_on DESC, source_updated_at DESC, id DESC
            """,
            (target_slug,),
        )
        return tuple(_observation(row) for row in rows)

    def list_latest_observations(
        self,
        target_slug: str,
        as_of: date,
    ) -> tuple[SprintPerformanceObservation, ...]:
        learned_before = f"{(as_of + timedelta(days=1)).isoformat()}T00:00:00.000000Z"
        rows = self.connection.execute(
            """
            WITH ranked AS (
              SELECT sprint_performance_observations.*,
                     ROW_NUMBER() OVER (
                       PARTITION BY target_slug, origin, source_record_id
                       ORDER BY source_updated_at DESC, id DESC
                     ) AS revision_rank
              FROM sprint_performance_observations
              WHERE target_slug=? AND observed_on<=? AND source_updated_at<?
            )
            SELECT * FROM ranked
            WHERE revision_rank=1
            ORDER BY subject_key, observed_on DESC, source_updated_at DESC, id DESC
            """,
            (target_slug, as_of.isoformat(), learned_before),
        )
        return tuple(_observation(row) for row in rows)
