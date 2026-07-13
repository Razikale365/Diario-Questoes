from __future__ import annotations

from datetime import UTC, datetime
import hashlib
import json
from pathlib import Path
import sqlite3
import zipfile

import pytest

from study_os_service.db.connection import connect_database
from study_os_service.db.migrations import CURRENT_SCHEMA_VERSION, MigrationRunner
from study_os_service.db.portable import (
    PortableArchiveError,
    create_portable_archive,
    restore_portable_archive,
)
from study_os_service.services.planner_profiles import PlannerProfileService
from study_os_service.services.preferences import PreferenceService


FIXED_NOW = datetime(2026, 7, 13, 18, 0, tzinfo=UTC)


def _seed_database(path: Path, target_slug: str = "rfb_auditor") -> None:
    connection = connect_database(path)
    try:
        MigrationRunner(connection).migrate()
        PlannerProfileService(connection).seed((target_slug,))
        PreferenceService(connection).get_active_target()
    finally:
        connection.close()


def _dump(path: Path) -> str:
    connection = sqlite3.connect(path)
    try:
        return "\n".join(connection.iterdump())
    finally:
        connection.close()


def _create_archive(source_path: Path, archive_path: Path):
    connection = connect_database(source_path)
    try:
        return create_portable_archive(
            connection,
            archive_path,
            CURRENT_SCHEMA_VERSION,
            now=FIXED_NOW,
        )
    finally:
        connection.close()


def _rewrite_archive(
    source: Path,
    destination: Path,
    *,
    manifest_update=None,
    database_bytes: bytes | None = None,
    extra_members: dict[str, bytes] | None = None,
) -> None:
    with zipfile.ZipFile(source, "r") as archive:
        manifest = json.loads(archive.read("manifest.json"))
        stored_database = archive.read("study-os.sqlite3")
    payload = stored_database if database_bytes is None else database_bytes
    if database_bytes is not None:
        manifest["database"]["size"] = len(payload)
        manifest["database"]["sha256"] = hashlib.sha256(payload).hexdigest()
    if manifest_update is not None:
        manifest_update(manifest)
    with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(
            "manifest.json",
            json.dumps(
                manifest,
                ensure_ascii=True,
                sort_keys=True,
                separators=(",", ":"),
            ) + "\n",
        )
        archive.writestr("study-os.sqlite3", payload)
        for name, content in (extra_members or {}).items():
            archive.writestr(name, content)


def test_portable_archive_has_canonical_manifest_checksum_and_only_safe_members(
    tmp_path: Path,
):
    database_path = tmp_path / "source" / "study-os.sqlite3"
    archive_path = tmp_path / "exports" / "study-os-export.zip"
    _seed_database(database_path)

    result = _create_archive(database_path, archive_path)

    assert result.archive_path == archive_path.resolve()
    with zipfile.ZipFile(archive_path, "r") as archive:
        assert archive.namelist() == ["manifest.json", "study-os.sqlite3"]
        manifest_bytes = archive.read("manifest.json")
        database_bytes = archive.read("study-os.sqlite3")
    manifest = json.loads(manifest_bytes)
    assert manifest == {
        "createdAt": "2026-07-13T18:00:00Z",
        "database": {
            "member": "study-os.sqlite3",
            "sha256": hashlib.sha256(database_bytes).hexdigest(),
            "size": len(database_bytes),
        },
        "format": "study-os-portable",
        "formatVersion": 1,
        "schemaVersion": CURRENT_SCHEMA_VERSION,
    }
    assert manifest_bytes == (
        json.dumps(
            manifest,
            ensure_ascii=True,
            sort_keys=True,
            separators=(",", ":"),
        ) + "\n"
    ).encode("ascii")
    assert b"do-not-export-paid-question-content" not in database_bytes
    assert not any(name.lower().endswith(".pdf") for name in archive.namelist())

    extracted = tmp_path / "archive.sqlite3"
    extracted.write_bytes(database_bytes)
    connection = sqlite3.connect(extracted)
    try:
        assert connection.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert connection.execute(
            "SELECT MAX(version) FROM schema_migrations"
        ).fetchone()[0] == CURRENT_SCHEMA_VERSION
    finally:
        connection.close()


def test_portable_restore_round_trips_and_backs_up_existing_database(tmp_path: Path):
    source = tmp_path / "source" / "study-os.sqlite3"
    destination = tmp_path / "destination" / "study-os.sqlite3"
    backup_dir = tmp_path / "destination" / "backups"
    archive = tmp_path / "portable.zip"
    _seed_database(source, "rfb_auditor")
    _seed_database(destination, "bacen_economia_financas")
    source_dump = _dump(source)
    previous_dump = _dump(destination)
    _create_archive(source, archive)

    result = restore_portable_archive(
        archive,
        destination,
        backup_dir,
        now=FIXED_NOW,
    )

    assert result.database_path == destination.resolve()
    assert result.schema_version == CURRENT_SCHEMA_VERSION
    assert result.pre_restore_backup is not None
    assert result.pre_restore_backup.exists()
    assert _dump(destination) == source_dump
    assert _dump(result.pre_restore_backup) == previous_dump


@pytest.mark.parametrize("failure", ["checksum", "schema", "corrupt", "traversal"])
def test_portable_restore_rejects_invalid_archive_without_touching_destination(
    tmp_path: Path,
    failure: str,
):
    source = tmp_path / "source.sqlite3"
    destination = tmp_path / "destination.sqlite3"
    original = tmp_path / "original.zip"
    invalid = tmp_path / f"{failure}.zip"
    _seed_database(source, "rfb_auditor")
    _seed_database(destination, "bacen_economia_financas")
    before = _dump(destination)
    _create_archive(source, original)

    if failure == "checksum":
        _rewrite_archive(
            original,
            invalid,
            manifest_update=lambda manifest: manifest["database"].update(
                {"sha256": "0" * 64}
            ),
        )
    elif failure == "schema":
        _rewrite_archive(
            original,
            invalid,
            manifest_update=lambda manifest: manifest.update({"schemaVersion": 999}),
        )
    elif failure == "corrupt":
        _rewrite_archive(original, invalid, database_bytes=b"not a sqlite database")
    else:
        _rewrite_archive(
            original,
            invalid,
            extra_members={"../escaped.txt": b"must not escape"},
        )

    with pytest.raises(PortableArchiveError):
        restore_portable_archive(
            invalid,
            destination,
            tmp_path / "backups",
            now=FIXED_NOW,
        )

    assert _dump(destination) == before
    assert not (tmp_path.parent / "escaped.txt").exists()
    assert not (tmp_path / "escaped.txt").exists()
    assert list((tmp_path / "backups").glob("*.sqlite3")) == []


def test_portable_restore_rolls_back_when_atomic_replacement_fails(
    tmp_path: Path,
    monkeypatch,
):
    import study_os_service.db.portable as portable

    source = tmp_path / "source.sqlite3"
    destination = tmp_path / "destination.sqlite3"
    archive = tmp_path / "portable.zip"
    _seed_database(source, "rfb_auditor")
    _seed_database(destination, "bacen_economia_financas")
    before = _dump(destination)
    _create_archive(source, archive)
    original_replace = portable.os.replace
    raised = False

    def replace_then_fail(source_path, destination_path):
        nonlocal raised
        original_replace(source_path, destination_path)
        if Path(destination_path) == destination and not raised:
            raised = True
            raise OSError("simulated replacement failure")

    monkeypatch.setattr(portable.os, "replace", replace_then_fail)

    with pytest.raises(OSError, match="simulated replacement failure"):
        restore_portable_archive(
            archive,
            destination,
            tmp_path / "backups",
            now=FIXED_NOW,
        )

    assert _dump(destination) == before
    assert len(list((tmp_path / "backups").glob("*.sqlite3"))) == 1


def test_portable_operations_reject_using_the_database_as_the_archive_path(
    tmp_path: Path,
):
    database_path = tmp_path / "study-os.sqlite3"
    _seed_database(database_path)
    before = _dump(database_path)
    connection = connect_database(database_path)
    try:
        with pytest.raises(PortableArchiveError, match="database path"):
            create_portable_archive(
                connection,
                database_path,
                CURRENT_SCHEMA_VERSION,
                now=FIXED_NOW,
            )
    finally:
        connection.close()

    assert _dump(database_path) == before
