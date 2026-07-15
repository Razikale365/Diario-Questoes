from __future__ import annotations

import argparse
import json
from pathlib import Path
import sqlite3
import sys
from typing import Any, Callable

from study_os_service.config import StudyOsSettings
from study_os_service.db.backup import create_backup, prune_backups
from study_os_service.db.connection import connect_database
from study_os_service.db.migrations import MigrationRunner
from study_os_service.db.portable import (
    create_portable_archive,
    inspect_schema_version,
    restore_portable_archive,
)


Command = Callable[[StudyOsSettings], dict[str, Any]]


def _initialize(settings: StudyOsSettings) -> dict[str, Any]:
    connection = connect_database(settings.database_path)
    try:
        schema_version = MigrationRunner(connection).migrate()
    finally:
        connection.close()
    return {
        "status": "ok",
        "schemaVersion": schema_version,
        "databasePath": str(settings.database_path),
    }


def _health(settings: StudyOsSettings) -> dict[str, Any]:
    connection = connect_database(settings.database_path)
    try:
        schema_version = MigrationRunner(connection).migrate()
        integrity = connection.execute("PRAGMA integrity_check").fetchone()
        database_status = "ok" if integrity and integrity[0] == "ok" else "error"
        if database_status != "ok":
            detail = "unknown result" if integrity is None else str(integrity[0])
            raise sqlite3.DatabaseError(f"Database integrity check failed: {detail}")
    finally:
        connection.close()
    return {
        "status": "ok",
        "schemaVersion": schema_version,
        "database": database_status,
        "databasePath": str(settings.database_path),
    }


def _backup(settings: StudyOsSettings) -> dict[str, Any]:
    connection = connect_database(settings.database_path)
    try:
        schema_version = inspect_schema_version(connection)
        created_path = create_backup(connection, settings.backup_dir)
    finally:
        connection.close()
    pruned_paths = prune_backups(
        settings.backup_dir,
        daily_retention=settings.backup_daily_retention,
        weekly_retention=settings.backup_weekly_retention,
    )
    return {
        "status": "ok",
        "schemaVersion": schema_version,
        "createdPath": str(created_path.resolve()),
        "prunedPaths": [str(path.resolve()) for path in pruned_paths],
    }


def _export(settings: StudyOsSettings, output: Path) -> dict[str, Any]:
    connection = connect_database(settings.database_path)
    try:
        schema_version = inspect_schema_version(connection)
        result = create_portable_archive(connection, output, schema_version)
    finally:
        connection.close()
    return {
        "status": "ok",
        "schemaVersion": result.schema_version,
        "archivePath": str(result.archive_path),
        "databaseSha256": result.database_sha256,
        "databaseSize": result.database_size,
    }


def _restore(settings: StudyOsSettings, source: Path) -> dict[str, Any]:
    result = restore_portable_archive(
        source,
        settings.database_path,
        settings.backup_dir,
    )
    return {
        "status": "ok",
        "schemaVersion": result.schema_version,
        "databasePath": str(result.database_path),
        "databaseSha256": result.database_sha256,
        "preRestoreBackup": (
            str(result.pre_restore_backup)
            if result.pre_restore_backup is not None
            else None
        ),
    }


COMMANDS: dict[str, Command] = {
    "initialize": _initialize,
    "health": _health,
    "backup": _backup,
}


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="study-os")
    commands = parser.add_subparsers(dest="command", required=True)
    for name in COMMANDS:
        commands.add_parser(name)
    export_parser = commands.add_parser("export")
    export_parser.add_argument("--output", type=Path, required=True)
    restore_parser = commands.add_parser("restore")
    restore_parser.add_argument("--from", dest="source", type=Path, required=True)
    return parser


def main(argv: list[str] | None = None) -> int:
    arguments = _parser().parse_args(argv)
    try:
        settings = StudyOsSettings.from_environment()
        if arguments.command == "export":
            payload = _export(settings, arguments.output)
        elif arguments.command == "restore":
            payload = _restore(settings, arguments.source)
        else:
            payload = COMMANDS[arguments.command](settings)
    except (OSError, sqlite3.Error, ValueError) as error:
        diagnostic = {
            "status": "error",
            "errorType": type(error).__name__,
            "message": str(error),
        }
        print(json.dumps(diagnostic, ensure_ascii=True), file=sys.stderr)
        return 1
    print(json.dumps(payload, ensure_ascii=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
