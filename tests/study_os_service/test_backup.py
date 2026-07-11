from datetime import UTC, datetime, timedelta
from pathlib import Path
import sqlite3

import pytest

import study_os_service.db.backup as backup_module
from study_os_service.db.backup import create_backup, prune_backups
from study_os_service.db.connection import connect_database
from study_os_service.db.migrations import MigrationRunner


def test_create_backup_is_a_readable_consistent_database(tmp_path: Path):
    source = connect_database(tmp_path / "source.sqlite3")
    restored = None
    try:
        MigrationRunner(source).migrate()
        source.execute(
            "INSERT INTO app_settings(key, value_json) VALUES ('active_target', '\"bacen\"')"
        )

        backup_path = create_backup(
            source,
            tmp_path / "backups",
            datetime(2026, 7, 10, 12, 0, tzinfo=UTC),
        )
        restored = connect_database(backup_path)

        assert backup_path.name == "study-os-20260710T120000Z.sqlite3"
        assert (
            restored.execute(
                "SELECT value_json FROM app_settings WHERE key='active_target'"
            ).fetchone()[0]
            == '"bacen"'
        )
        assert restored.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    finally:
        if restored is not None:
            restored.close()
        source.close()


def test_create_backup_refuses_to_overwrite_existing_timestamped_file(tmp_path: Path):
    source = connect_database(tmp_path / "source.sqlite3")
    try:
        MigrationRunner(source).migrate()
        backup_dir = tmp_path / "backups"
        now = datetime(2026, 7, 10, 12, 0, tzinfo=UTC)
        backup_path = create_backup(source, backup_dir, now)
        original_bytes = backup_path.read_bytes()

        with pytest.raises(FileExistsError):
            create_backup(source, backup_dir, now)

        assert backup_path.read_bytes() == original_bytes
    finally:
        source.close()


def test_create_backup_removes_destination_when_integrity_check_fails(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    source = connect_database(tmp_path / "source.sqlite3")
    destination_connections = []
    real_connect = sqlite3.connect

    class IntegrityFailureConnection(sqlite3.Connection):
        def execute(self, statement, parameters=()):
            if statement == "PRAGMA integrity_check":
                class IntegrityResult:
                    def fetchone(self):
                        return ("corrupt",)

                return IntegrityResult()
            return super().execute(statement, parameters)

        def close(self):
            destination_connections.append("closed")
            return super().close()

    def connect_with_integrity_failure(path, **kwargs):
        return real_connect(path, factory=IntegrityFailureConnection, **kwargs)

    monkeypatch.setattr(backup_module.sqlite3, "connect", connect_with_integrity_failure)
    try:
        MigrationRunner(source).migrate()
        backup_path = tmp_path / "backups" / "study-os-20260710T120000Z.sqlite3"

        with pytest.raises(sqlite3.DatabaseError, match="integrity"):
            create_backup(
                source,
                tmp_path / "backups",
                datetime(2026, 7, 10, 12, 0, tzinfo=UTC),
            )

        assert not backup_path.exists()
        assert destination_connections == ["closed"]
    finally:
        source.close()


def _write_snapshot(backup_dir: Path, timestamp: datetime) -> Path:
    path = backup_dir / f"study-os-{timestamp.astimezone(UTC):%Y%m%dT%H%M%SZ}.sqlite3"
    path.touch()
    return path


def test_prune_backups_keeps_newest_daily_days_and_previous_iso_weeks(tmp_path: Path):
    backup_dir = tmp_path / "backups"
    backup_dir.mkdir()
    now = datetime(2026, 7, 10, 23, 0, tzinfo=UTC)

    daily_paths = {}
    for offset in range(30):
        timestamp = now - timedelta(days=offset)
        daily_paths.setdefault(timestamp.date(), []).append(
            _write_snapshot(backup_dir, timestamp.replace(hour=8))
        )
        daily_paths[timestamp.date()].append(
            _write_snapshot(backup_dir, timestamp.replace(hour=18))
        )

    weekly_anchors = [
        datetime(2026, 7, 5, 23, tzinfo=UTC),
        datetime(2026, 6, 28, 23, tzinfo=UTC),
        datetime(2026, 6, 21, 23, tzinfo=UTC),
        datetime(2026, 6, 14, 23, tzinfo=UTC),
        datetime(2026, 6, 7, 23, tzinfo=UTC),
        datetime(2026, 5, 31, 23, tzinfo=UTC),
        datetime(2026, 5, 24, 23, tzinfo=UTC),
        datetime(2026, 5, 17, 23, tzinfo=UTC),
    ]
    anchor_paths = [_write_snapshot(backup_dir, timestamp) for timestamp in weekly_anchors]
    all_snapshot_paths = {
        path for paths in daily_paths.values() for path in paths
    } | set(anchor_paths)
    unrelated_path = backup_dir / "notes.txt"
    unrelated_path.write_text("keep me", encoding="utf-8")

    removed = prune_backups(backup_dir, daily_retention=14, weekly_retention=8, now=now)

    expected_daily = {
        max(paths)
        for date, paths in daily_paths.items()
        if date >= (now - timedelta(days=13)).date()
    }
    expected_weekly = set(anchor_paths)
    expected_daily -= {daily_paths[anchor.date()][-1] for anchor in weekly_anchors[:2]}
    expected_retained = expected_daily | expected_weekly
    expected_removed = all_snapshot_paths - expected_retained

    assert set(removed) == expected_removed
    assert expected_retained <= set(backup_dir.glob("study-os-*.sqlite3"))
    assert unrelated_path.read_text(encoding="utf-8") == "keep me"


def test_prune_backups_ignores_unrecognized_and_future_filenames(tmp_path: Path):
    backup_dir = tmp_path / "backups"
    backup_dir.mkdir()
    now = datetime(2026, 7, 10, 12, 0, tzinfo=UTC)
    recognized = _write_snapshot(backup_dir, now - timedelta(days=20))
    current = _write_snapshot(backup_dir, now - timedelta(days=1))
    future = _write_snapshot(backup_dir, now + timedelta(days=1))
    malformed = backup_dir / "study-os-20260710.sqlite3"
    malformed.touch()

    removed = prune_backups(backup_dir, daily_retention=1, weekly_retention=0, now=now)

    assert removed == [recognized]
    assert current.exists()
    assert future.exists()
    assert malformed.exists()


def test_prune_backups_does_not_extend_weekly_window_across_missing_weeks(tmp_path: Path):
    backup_dir = tmp_path / "backups"
    backup_dir.mkdir()
    now = datetime(2026, 7, 10, 12, 0, tzinfo=UTC)
    recent_week = _write_snapshot(backup_dir, now - timedelta(weeks=1))
    outside_window = _write_snapshot(backup_dir, now - timedelta(weeks=9))

    removed = prune_backups(
        backup_dir,
        daily_retention=0,
        weekly_retention=8,
        now=now,
    )

    assert recent_week.exists()
    assert removed == [outside_window]
    assert not outside_window.exists()
