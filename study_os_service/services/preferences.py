from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
import json
import sqlite3


ACTIVE_TARGET_KEY = "study_os.active_target_slug"


class ActiveTargetNotFoundError(KeyError):
    """Raised when a requested target profile does not exist."""


class InactiveTargetError(ValueError):
    """Raised when a requested target profile is inactive."""


class NoActiveTargetError(RuntimeError):
    """Raised when no target can own Study OS commands."""


class PreferenceVersionConflictError(RuntimeError):
    """Raised when a preference update uses a stale version."""


@dataclass(frozen=True, slots=True)
class ActiveTargetPreference:
    target_slug: str
    version: int
    updated_at: datetime


def _timestamp(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed.astimezone(UTC)


@contextmanager
def _transaction(connection: sqlite3.Connection) -> Iterator[None]:
    owns_transaction = not connection.in_transaction
    if owns_transaction:
        connection.execute("BEGIN IMMEDIATE")
    try:
        yield
        if owns_transaction:
            connection.commit()
    except Exception:
        if owns_transaction:
            connection.rollback()
        raise


class PreferenceService:
    def __init__(self, connection: sqlite3.Connection):
        self.connection = connection

    def get_active_target(self) -> ActiveTargetPreference:
        with _transaction(self.connection):
            return self._get_active_target()

    def _get_active_target(self) -> ActiveTargetPreference:
        row = self.connection.execute(
            "SELECT value_json, version, updated_at FROM app_settings WHERE key=?",
            (ACTIVE_TARGET_KEY,),
        ).fetchone()
        if row is not None:
            target_slug = self._target_slug(row["value_json"])
            if target_slug is not None and self._is_active(target_slug):
                return ActiveTargetPreference(
                    target_slug=target_slug,
                    version=row["version"],
                    updated_at=_timestamp(row["updated_at"]),
                )

        fallback = self.connection.execute(
            """
            SELECT target_slug FROM exam_targets
            WHERE active=1
            ORDER BY priority_score DESC, target_slug
            LIMIT 1
            """
        ).fetchone()
        if fallback is None:
            raise NoActiveTargetError("no active target profile exists")
        target_slug = fallback["target_slug"]
        value_json = json.dumps(target_slug, ensure_ascii=True)
        if row is None:
            self.connection.execute(
                """
                INSERT INTO app_settings (key, value_json, version)
                VALUES (?, ?, 1)
                """,
                (ACTIVE_TARGET_KEY, value_json),
            )
        else:
            self.connection.execute(
                """
                UPDATE app_settings SET
                  value_json=?, version=version+1,
                  updated_at=STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW')
                WHERE key=?
                """,
                (value_json, ACTIVE_TARGET_KEY),
            )
        saved = self.connection.execute(
            "SELECT value_json, version, updated_at FROM app_settings WHERE key=?",
            (ACTIVE_TARGET_KEY,),
        ).fetchone()
        if saved is None:
            raise RuntimeError("active target preference disappeared")
        return ActiveTargetPreference(
            target_slug=target_slug,
            version=saved["version"],
            updated_at=_timestamp(saved["updated_at"]),
        )

    def set_active_target(
        self, target_slug: str, *, expected_version: int
    ) -> ActiveTargetPreference:
        normalized = target_slug.strip()
        if not normalized:
            raise ValueError("target slug is required")
        if (
            isinstance(expected_version, bool)
            or not isinstance(expected_version, int)
            or expected_version < 1
        ):
            raise ValueError("expected version must be a positive integer")
        with _transaction(self.connection):
            target = self.connection.execute(
                "SELECT active FROM exam_targets WHERE target_slug=?",
                (normalized,),
            ).fetchone()
            if target is None:
                raise ActiveTargetNotFoundError(
                    f"target profile {normalized} does not exist"
                )
            if not target["active"]:
                raise InactiveTargetError(
                    f"target profile {normalized} is inactive"
                )

            current = self._get_active_target()
            if current.version != expected_version:
                raise PreferenceVersionConflictError(
                    "active target preference has changed"
                )
            if current.target_slug == normalized:
                return current
            cursor = self.connection.execute(
                """
                UPDATE app_settings SET
                  value_json=?, version=version+1,
                  updated_at=STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW')
                WHERE key=? AND version=?
                """,
                (
                    json.dumps(normalized, ensure_ascii=True),
                    ACTIVE_TARGET_KEY,
                    expected_version,
                ),
            )
            if cursor.rowcount != 1:
                raise PreferenceVersionConflictError(
                    "active target preference has changed"
                )
            return self._get_active_target()

    def _is_active(self, target_slug: str) -> bool:
        row = self.connection.execute(
            "SELECT active FROM exam_targets WHERE target_slug=?",
            (target_slug,),
        ).fetchone()
        return bool(row and row["active"])

    @staticmethod
    def _target_slug(value_json: str) -> str | None:
        try:
            value = json.loads(value_json)
        except (TypeError, json.JSONDecodeError):
            return None
        return value.strip() if isinstance(value, str) and value.strip() else None
