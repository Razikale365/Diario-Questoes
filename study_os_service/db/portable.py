from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import tempfile
from typing import Any, BinaryIO
import zipfile

from study_os_service.db.backup import create_backup
from study_os_service.db.migrations import MIGRATIONS


ARCHIVE_FORMAT = "study-os-portable"
ARCHIVE_FORMAT_VERSION = 1
MANIFEST_MEMBER = "manifest.json"
DATABASE_MEMBER = "study-os.sqlite3"
ALLOWED_MEMBERS = (MANIFEST_MEMBER, DATABASE_MEMBER)
MAX_MANIFEST_BYTES = 64 * 1024
MAX_DATABASE_BYTES = 2 * 1024 * 1024 * 1024
SUPPORTED_SCHEMA_VERSIONS = frozenset(
    version for version, _statements in MIGRATIONS
)


class PortableArchiveError(ValueError):
    """Raised when an archive cannot be trusted for export or restore."""


@dataclass(frozen=True, slots=True)
class PortableArchiveResult:
    archive_path: Path
    schema_version: int
    database_sha256: str
    database_size: int


@dataclass(frozen=True, slots=True)
class PortableRestoreResult:
    database_path: Path
    schema_version: int
    database_sha256: str
    pre_restore_backup: Path | None


@dataclass(frozen=True, slots=True)
class _ValidatedManifest:
    schema_version: int
    database_sha256: str
    database_size: int


def _is_supported_schema_version(value: object) -> bool:
    return type(value) is int and value in SUPPORTED_SCHEMA_VERSIONS


def _utc(value: datetime | None) -> datetime:
    if value is None:
        return datetime.now(UTC)
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _timestamp(value: datetime) -> str:
    return value.isoformat().replace("+00:00", "Z")


def _canonical_json(value: dict[str, Any]) -> bytes:
    return (
        json.dumps(
            value,
            ensure_ascii=True,
            sort_keys=True,
            separators=(",", ":"),
        )
        + "\n"
    ).encode("ascii")


def _hash_stream(source: BinaryIO, destination: BinaryIO | None = None) -> tuple[str, int]:
    digest = hashlib.sha256()
    size = 0
    while True:
        chunk = source.read(1024 * 1024)
        if not chunk:
            break
        size += len(chunk)
        if size > MAX_DATABASE_BYTES:
            raise PortableArchiveError("portable database exceeds the size limit")
        digest.update(chunk)
        if destination is not None:
            destination.write(chunk)
    return digest.hexdigest(), size


def _hash_file(path: Path) -> tuple[str, int]:
    with path.open("rb") as source:
        return _hash_stream(source)


def inspect_schema_version(connection: sqlite3.Connection) -> int:
    expected_versions = tuple(version for version, _statements in MIGRATIONS)
    try:
        applied_versions = tuple(
            row[0]
            for row in connection.execute(
                "SELECT version FROM schema_migrations ORDER BY version"
            )
        )
    except sqlite3.Error as exc:
        raise PortableArchiveError(
            "database does not contain Study OS migration history"
        ) from exc
    if (
        not applied_versions
        or any(type(version) is not int for version in applied_versions)
        or len(applied_versions) > len(expected_versions)
        or applied_versions != expected_versions[: len(applied_versions)]
    ):
        raise PortableArchiveError(
            "database migration history does not match the supported schema"
        )
    return applied_versions[-1]


def _main_database_path(connection: sqlite3.Connection) -> Path | None:
    row = next(
        (
            item
            for item in connection.execute("PRAGMA database_list")
            if item[1] == "main"
        ),
        None,
    )
    if row is None or not row[2]:
        return None
    return Path(row[2]).resolve()


def _validate_sqlite(path: Path, expected_schema: int) -> None:
    connection = None
    try:
        connection = sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True)
        integrity = connection.execute("PRAGMA integrity_check").fetchone()
        if integrity is None or integrity[0] != "ok":
            detail = "unknown result" if integrity is None else str(integrity[0])
            raise PortableArchiveError(
                f"portable database integrity check failed: {detail}"
            )
        schema_version = inspect_schema_version(connection)
        if schema_version != expected_schema:
            raise PortableArchiveError(
                "portable database schema does not match its manifest"
            )
        foreign_key_error = connection.execute(
            "PRAGMA foreign_key_check"
        ).fetchone()
        if foreign_key_error is not None:
            raise PortableArchiveError(
                "portable database contains foreign-key violations"
            )
    except PortableArchiveError:
        raise
    except sqlite3.Error as exc:
        raise PortableArchiveError("portable database is not valid SQLite") from exc
    finally:
        if connection is not None:
            connection.close()


def _online_snapshot(source: sqlite3.Connection, path: Path, schema_version: int) -> None:
    destination = None
    try:
        destination = sqlite3.connect(path)
        source.backup(destination)
    finally:
        if destination is not None:
            destination.close()
    _validate_sqlite(path, schema_version)


def create_portable_archive(
    connection: sqlite3.Connection,
    destination: Path,
    schema_version: int,
    *,
    now: datetime | None = None,
) -> PortableArchiveResult:
    if not _is_supported_schema_version(schema_version):
        raise PortableArchiveError(
            f"unsupported Study OS schema version {schema_version}"
        )
    actual_schema = inspect_schema_version(connection)
    if actual_schema != schema_version:
        raise PortableArchiveError("database schema does not match export request")

    resolved = destination.expanduser().resolve()
    source_path = _main_database_path(connection)
    if source_path is not None and resolved == source_path:
        raise PortableArchiveError(
            "portable archive output cannot be the Study OS database path"
        )
    resolved.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(
        prefix=".study-os-export-",
        dir=resolved.parent,
    ) as temporary_directory:
        temporary_root = Path(temporary_directory)
        snapshot_path = temporary_root / DATABASE_MEMBER
        _online_snapshot(connection, snapshot_path, schema_version)
        database_hash, database_size = _hash_file(snapshot_path)
        manifest = {
            "format": ARCHIVE_FORMAT,
            "formatVersion": ARCHIVE_FORMAT_VERSION,
            "createdAt": _timestamp(_utc(now)),
            "schemaVersion": schema_version,
            "database": {
                "member": DATABASE_MEMBER,
                "sha256": database_hash,
                "size": database_size,
            },
        }
        temporary_archive = temporary_root / "portable.zip"
        with zipfile.ZipFile(
            temporary_archive,
            "w",
            compression=zipfile.ZIP_DEFLATED,
            compresslevel=6,
        ) as archive:
            archive.writestr(MANIFEST_MEMBER, _canonical_json(manifest))
            archive.write(snapshot_path, DATABASE_MEMBER)
        os.replace(temporary_archive, resolved)

    return PortableArchiveResult(
        archive_path=resolved,
        schema_version=schema_version,
        database_sha256=database_hash,
        database_size=database_size,
    )


def _manifest(archive: zipfile.ZipFile) -> _ValidatedManifest:
    infos = archive.infolist()
    names = [info.filename for info in infos]
    if len(names) != len(ALLOWED_MEMBERS) or set(names) != set(ALLOWED_MEMBERS):
        raise PortableArchiveError(
            "portable archive must contain only manifest.json and study-os.sqlite3"
        )
    if any(info.is_dir() or "/" in info.filename or "\\" in info.filename for info in infos):
        raise PortableArchiveError("portable archive contains an unsafe member")
    by_name = {info.filename: info for info in infos}
    manifest_info = by_name[MANIFEST_MEMBER]
    database_info = by_name[DATABASE_MEMBER]
    if manifest_info.file_size > MAX_MANIFEST_BYTES:
        raise PortableArchiveError("portable manifest exceeds the size limit")
    if database_info.file_size > MAX_DATABASE_BYTES:
        raise PortableArchiveError("portable database exceeds the size limit")
    try:
        manifest_bytes = archive.read(MANIFEST_MEMBER)
        payload = json.loads(manifest_bytes.decode("ascii"))
    except (UnicodeDecodeError, json.JSONDecodeError, zipfile.BadZipFile) as exc:
        raise PortableArchiveError("portable manifest is not valid canonical JSON") from exc
    if not isinstance(payload, dict) or set(payload) != {
        "format",
        "formatVersion",
        "createdAt",
        "schemaVersion",
        "database",
    }:
        raise PortableArchiveError("portable manifest has unsupported fields")
    database = payload.get("database")
    if not isinstance(database, dict) or set(database) != {
        "member",
        "sha256",
        "size",
    }:
        raise PortableArchiveError("portable database manifest is invalid")
    if manifest_bytes != _canonical_json(payload):
        raise PortableArchiveError("portable manifest is not canonical")
    if payload.get("format") != ARCHIVE_FORMAT or payload.get("formatVersion") != 1:
        raise PortableArchiveError("unsupported portable archive format")
    created_at = payload.get("createdAt")
    if not isinstance(created_at, str) or not created_at.endswith("Z"):
        raise PortableArchiveError("portable manifest timestamp must be UTC")
    try:
        datetime.fromisoformat(created_at.replace("Z", "+00:00"))
    except ValueError as exc:
        raise PortableArchiveError("portable manifest timestamp is invalid") from exc
    schema_version = payload.get("schemaVersion")
    if not _is_supported_schema_version(schema_version):
        raise PortableArchiveError(
            f"unsupported Study OS schema version {schema_version}"
        )
    database_hash = database.get("sha256")
    database_size = database.get("size")
    if database.get("member") != DATABASE_MEMBER:
        raise PortableArchiveError("portable database member is invalid")
    if not isinstance(database_hash, str) or not re.fullmatch(
        r"[a-f0-9]{64}", database_hash
    ):
        raise PortableArchiveError("portable database checksum is invalid")
    if (
        isinstance(database_size, bool)
        or not isinstance(database_size, int)
        or database_size < 1
        or database_size != database_info.file_size
    ):
        raise PortableArchiveError("portable database size is invalid")
    return _ValidatedManifest(
        schema_version=schema_version,
        database_sha256=database_hash,
        database_size=database_size,
    )


def _stage_archive_database(
    archive_path: Path,
    staged_path: Path,
) -> _ValidatedManifest:
    try:
        with zipfile.ZipFile(archive_path, "r") as archive:
            manifest = _manifest(archive)
            with archive.open(DATABASE_MEMBER, "r") as source, staged_path.open(
                "xb"
            ) as destination:
                actual_hash, actual_size = _hash_stream(source, destination)
    except PortableArchiveError:
        raise
    except (OSError, zipfile.BadZipFile, RuntimeError) as exc:
        raise PortableArchiveError("portable archive cannot be read safely") from exc
    if actual_size != manifest.database_size:
        raise PortableArchiveError("portable database size does not match manifest")
    if actual_hash != manifest.database_sha256:
        raise PortableArchiveError("portable database checksum does not match manifest")
    _validate_sqlite(staged_path, manifest.schema_version)
    return manifest


def _backup_existing_database(
    database_path: Path,
    backup_dir: Path,
    now: datetime,
) -> Path:
    source = None
    try:
        source = sqlite3.connect(database_path)
        return create_backup(source, backup_dir, now=now)
    finally:
        if source is not None:
            source.close()


def restore_portable_archive(
    archive_path: Path,
    database_path: Path,
    backup_dir: Path,
    *,
    now: datetime | None = None,
) -> PortableRestoreResult:
    source_archive = archive_path.expanduser().resolve(strict=True)
    destination = database_path.expanduser().resolve()
    resolved_backup_dir = backup_dir.expanduser().resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)
    timestamp = _utc(now)
    pre_restore_backup: Path | None = None
    rollback_path: Path | None = None

    with tempfile.TemporaryDirectory(
        prefix=".study-os-restore-",
        dir=destination.parent,
    ) as temporary_directory:
        staged_path = Path(temporary_directory) / DATABASE_MEMBER
        manifest = _stage_archive_database(source_archive, staged_path)

        if destination.exists():
            pre_restore_backup = _backup_existing_database(
                destination,
                resolved_backup_dir,
                timestamp,
            )
            rollback_path = Path(temporary_directory) / "rollback.sqlite3"
            shutil.copyfile(pre_restore_backup, rollback_path)

        replacement_started = False
        try:
            replacement_started = True
            os.replace(staged_path, destination)
            for suffix in ("-wal", "-shm"):
                Path(f"{destination}{suffix}").unlink(missing_ok=True)
            _validate_sqlite(destination, manifest.schema_version)
        except Exception:
            if replacement_started:
                if rollback_path is not None and rollback_path.exists():
                    os.replace(rollback_path, destination)
                elif destination.exists():
                    destination.unlink()
            raise

    return PortableRestoreResult(
        database_path=destination,
        schema_version=manifest.schema_version,
        database_sha256=manifest.database_sha256,
        pre_restore_backup=pre_restore_backup,
    )
