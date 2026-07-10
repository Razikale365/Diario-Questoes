from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path
import re
import sqlite3


_BACKUP_NAME = re.compile(r"study-os-(\d{8}T\d{6}Z)\.sqlite3")
_BACKUP_TIMESTAMP_FORMAT = "%Y%m%dT%H%M%SZ"


def _as_utc(value: datetime | None) -> datetime:
    if value is None:
        return datetime.now(UTC)
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _parse_backup_timestamp(path: Path) -> datetime | None:
    match = _BACKUP_NAME.fullmatch(path.name)
    if match is None:
        return None
    try:
        return datetime.strptime(
            match.group(1), _BACKUP_TIMESTAMP_FORMAT
        ).replace(tzinfo=UTC)
    except ValueError:
        return None


def create_backup(
    source: sqlite3.Connection,
    backup_dir: Path,
    now: datetime | None = None,
) -> Path:
    timestamp = _as_utc(now)
    backup_dir.mkdir(parents=True, exist_ok=True)
    backup_path = backup_dir / f"study-os-{timestamp:%Y%m%dT%H%M%SZ}.sqlite3"

    source.execute("PRAGMA wal_checkpoint(FULL)")
    backup_path.touch(exist_ok=False)

    destination = None
    succeeded = False
    try:
        destination = sqlite3.connect(backup_path)
        source.backup(destination)
        integrity = destination.execute("PRAGMA integrity_check").fetchone()
        if integrity is None or integrity[0] != "ok":
            detail = "unknown result" if integrity is None else str(integrity[0])
            raise sqlite3.DatabaseError(f"Backup integrity check failed: {detail}")
        succeeded = True
        return backup_path
    finally:
        if destination is not None:
            destination.close()
        if not succeeded:
            backup_path.unlink(missing_ok=True)


def prune_backups(
    backup_dir: Path,
    daily_retention: int,
    weekly_retention: int,
    now: datetime | None = None,
) -> list[Path]:
    if daily_retention < 0 or weekly_retention < 0:
        raise ValueError("retention values must be non-negative")
    if not backup_dir.exists():
        return []

    cutoff = _as_utc(now)
    recognized = []
    for path in backup_dir.iterdir():
        if not path.is_file():
            continue
        timestamp = _parse_backup_timestamp(path)
        if timestamp is not None and timestamp <= cutoff:
            recognized.append((timestamp, path))

    retained = set()
    by_day = defaultdict(list)
    by_week = defaultdict(list)
    for timestamp, path in recognized:
        by_day[timestamp.date()].append((timestamp, path))
        iso = timestamp.isocalendar()
        by_week[(iso.year, iso.week)].append((timestamp, path))

    for day in sorted(by_day, reverse=True)[:daily_retention]:
        retained.add(max(by_day[day])[1])

    current_week = cutoff.isocalendar()
    previous_weeks = sorted(
        (
            week
            for week in by_week
            if week < (current_week.year, current_week.week)
        ),
        reverse=True,
    )
    for week in previous_weeks[:weekly_retention]:
        retained.add(max(by_week[week])[1])

    removed = [
        path
        for _, path in sorted(recognized)
        if path not in retained
    ]
    for path in removed:
        path.unlink()
    return removed
