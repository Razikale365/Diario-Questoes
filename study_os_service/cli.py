from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from typing import Any, Callable

from study_os_service.config import StudyOsSettings
from study_os_service.db.backup import create_backup, prune_backups
from study_os_service.db.connection import connect_database
from study_os_service.db.migrations import MigrationRunner


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
        schema_version = MigrationRunner(connection).migrate()
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


COMMANDS: dict[str, Command] = {
    "initialize": _initialize,
    "health": _health,
    "backup": _backup,
}


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="study-os")
    parser.add_argument("command", choices=tuple(COMMANDS))
    return parser


def main(argv: list[str] | None = None) -> int:
    arguments = _parser().parse_args(argv)
    try:
        payload = COMMANDS[arguments.command](StudyOsSettings.from_environment())
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
