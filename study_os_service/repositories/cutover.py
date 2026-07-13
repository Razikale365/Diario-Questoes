from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
import json
import sqlite3
from typing import Any, Literal, Mapping


MigrationState = Literal["running", "completed", "failed"]


class MigrationReplayConflictError(RuntimeError):
    """Raised when a migration key is replayed with different input."""


class MigrationVersionConflictError(RuntimeError):
    """Raised when a migration transition uses a stale version."""


class LegacyIdConflictError(RuntimeError):
    """Raised when a legacy identity is remapped to another record."""


@dataclass(frozen=True, slots=True)
class MigrationRunRecord:
    id: int
    migration_key: str
    schema_name: str
    payload_hash: str
    state: MigrationState
    stage: str
    report: dict[str, Any]
    error_code: str | None
    error_message: str | None
    version: int
    created_at: datetime
    updated_at: datetime
    completed_at: datetime | None


@dataclass(frozen=True, slots=True)
class LegacyIdRecord:
    id: int
    migration_run_id: int
    record_kind: str
    legacy_id: str
    target_type: str
    target_ref: str
    metadata: dict[str, Any]
    created_at: datetime


def _canonical_json(value: Mapping[str, Any]) -> str:
    return json.dumps(
        value,
        ensure_ascii=True,
        sort_keys=True,
        separators=(",", ":"),
    )


def _timestamp(value: str | None) -> datetime | None:
    if value is None:
        return None
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed.astimezone(UTC)


def _run(row: sqlite3.Row) -> MigrationRunRecord:
    return MigrationRunRecord(
        id=row["id"],
        migration_key=row["migration_key"],
        schema_name=row["schema_name"],
        payload_hash=row["payload_hash"],
        state=row["state"],
        stage=row["stage"],
        report=dict(json.loads(row["report_json"])),
        error_code=row["error_code"],
        error_message=row["error_message"],
        version=row["version"],
        created_at=_timestamp(row["created_at"]),
        updated_at=_timestamp(row["updated_at"]),
        completed_at=_timestamp(row["completed_at"]),
    )


def _legacy_id(row: sqlite3.Row) -> LegacyIdRecord:
    return LegacyIdRecord(
        id=row["id"],
        migration_run_id=row["migration_run_id"],
        record_kind=row["record_kind"],
        legacy_id=row["legacy_id"],
        target_type=row["target_type"],
        target_ref=row["target_ref"],
        metadata=dict(json.loads(row["metadata_json"])),
        created_at=_timestamp(row["created_at"]),
    )


class CutoverRepository:
    def __init__(self, connection: sqlite3.Connection):
        self.connection = connection

    def get_migration(self, run_id: int) -> MigrationRunRecord | None:
        row = self.connection.execute(
            "SELECT * FROM legacy_migration_runs WHERE id=?", (run_id,)
        ).fetchone()
        return _run(row) if row else None

    def get_migration_by_key(self, migration_key: str) -> MigrationRunRecord | None:
        row = self.connection.execute(
            "SELECT * FROM legacy_migration_runs WHERE migration_key=?",
            (migration_key,),
        ).fetchone()
        return _run(row) if row else None

    def begin_migration(
        self,
        *,
        migration_key: str,
        schema_name: str,
        payload_hash: str,
    ) -> MigrationRunRecord:
        existing = self.get_migration_by_key(migration_key)
        if existing is not None:
            if (
                existing.schema_name != schema_name
                or existing.payload_hash != payload_hash
            ):
                raise MigrationReplayConflictError(
                    f"migration {migration_key} already exists with a different payload"
                )
            return existing
        try:
            cursor = self.connection.execute(
                """
                INSERT INTO legacy_migration_runs (
                  migration_key, schema_name, payload_hash, state, stage
                ) VALUES (?, ?, ?, 'running', 'accepted')
                """,
                (migration_key, schema_name, payload_hash),
            )
        except sqlite3.IntegrityError:
            existing = self.get_migration_by_key(migration_key)
            if existing is None:
                raise
            if (
                existing.schema_name != schema_name
                or existing.payload_hash != payload_hash
            ):
                raise MigrationReplayConflictError(
                    f"migration {migration_key} already exists with a different payload"
                )
            return existing
        saved = self.get_migration(cursor.lastrowid)
        if saved is None:
            raise RuntimeError("created migration run disappeared")
        return saved

    def update_stage(
        self,
        run_id: int,
        *,
        stage: str,
        report: Mapping[str, Any],
        expected_version: int,
    ) -> MigrationRunRecord:
        return self._transition(
            run_id,
            state="running",
            stage=stage,
            report=report,
            error_code=None,
            error_message=None,
            expected_version=expected_version,
            required_state="running",
        )

    def fail_migration(
        self,
        run_id: int,
        *,
        stage: str,
        error_code: str,
        error_message: str,
        report: Mapping[str, Any],
        expected_version: int,
    ) -> MigrationRunRecord:
        return self._transition(
            run_id,
            state="failed",
            stage=stage,
            report=report,
            error_code=error_code,
            error_message=error_message,
            expected_version=expected_version,
            required_state="running",
        )

    def resume_migration(
        self,
        run_id: int,
        *,
        stage: str,
        expected_version: int,
    ) -> MigrationRunRecord:
        current = self.get_migration(run_id)
        if current is None:
            raise KeyError(f"migration run {run_id} does not exist")
        return self._transition(
            run_id,
            state="running",
            stage=stage,
            report=current.report,
            error_code=None,
            error_message=None,
            expected_version=expected_version,
            required_state="failed",
        )

    def complete_migration(
        self,
        run_id: int,
        *,
        report: Mapping[str, Any],
        expected_version: int,
    ) -> MigrationRunRecord:
        return self._transition(
            run_id,
            state="completed",
            stage="completed",
            report=report,
            error_code=None,
            error_message=None,
            expected_version=expected_version,
            required_state="running",
        )

    def _transition(
        self,
        run_id: int,
        *,
        state: MigrationState,
        stage: str,
        report: Mapping[str, Any],
        error_code: str | None,
        error_message: str | None,
        expected_version: int,
        required_state: MigrationState,
    ) -> MigrationRunRecord:
        completed_sql = (
            "STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW')"
            if state == "completed"
            else "NULL"
        )
        cursor = self.connection.execute(
            f"""
            UPDATE legacy_migration_runs SET
              state=?, stage=?, report_json=?, error_code=?, error_message=?,
              version=version+1,
              updated_at=STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW'),
              completed_at={completed_sql}
            WHERE id=? AND state=? AND version=?
            """,
            (
                state,
                stage,
                _canonical_json(report),
                error_code,
                error_message,
                run_id,
                required_state,
                expected_version,
            ),
        )
        if cursor.rowcount != 1:
            raise MigrationVersionConflictError(
                f"migration run {run_id} has changed"
            )
        saved = self.get_migration(run_id)
        if saved is None:
            raise RuntimeError("updated migration run disappeared")
        return saved

    def get_legacy_id(
        self, record_kind: str, legacy_id: str
    ) -> LegacyIdRecord | None:
        row = self.connection.execute(
            """
            SELECT * FROM legacy_id_mappings
            WHERE record_kind=? AND legacy_id=?
            """,
            (record_kind, legacy_id),
        ).fetchone()
        return _legacy_id(row) if row else None

    def record_legacy_id(
        self,
        *,
        migration_run_id: int,
        record_kind: str,
        legacy_id: str,
        target_type: str,
        target_ref: str,
        metadata: Mapping[str, Any],
    ) -> LegacyIdRecord:
        existing = self.get_legacy_id(record_kind, legacy_id)
        expected = (
            target_type,
            target_ref,
            dict(metadata),
        )
        if existing is not None:
            actual = (
                existing.target_type,
                existing.target_ref,
                existing.metadata,
            )
            if actual != expected:
                raise LegacyIdConflictError(
                    f"{record_kind} {legacy_id} already maps to "
                    f"{existing.target_type} {existing.target_ref}"
                )
            return existing
        try:
            cursor = self.connection.execute(
                """
                INSERT INTO legacy_id_mappings (
                  migration_run_id, record_kind, legacy_id,
                  target_type, target_ref, metadata_json
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    migration_run_id,
                    record_kind,
                    legacy_id,
                    target_type,
                    target_ref,
                    _canonical_json(metadata),
                ),
            )
        except sqlite3.IntegrityError:
            existing = self.get_legacy_id(record_kind, legacy_id)
            if existing is None:
                raise
            actual = (
                existing.target_type,
                existing.target_ref,
                existing.metadata,
            )
            if actual != expected:
                raise LegacyIdConflictError(
                    f"{record_kind} {legacy_id} already maps to "
                    f"{existing.target_type} {existing.target_ref}"
                )
            return existing
        row = self.connection.execute(
            "SELECT * FROM legacy_id_mappings WHERE id=?", (cursor.lastrowid,)
        ).fetchone()
        if row is None:
            raise RuntimeError("created legacy ID mapping disappeared")
        return _legacy_id(row)

    def count_legacy_ids(self, migration_run_id: int) -> int:
        return self.connection.execute(
            """
            SELECT COUNT(*) FROM legacy_id_mappings
            WHERE migration_run_id=?
            """,
            (migration_run_id,),
        ).fetchone()[0]
