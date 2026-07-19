from __future__ import annotations

from datetime import UTC, datetime
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import zipfile

import pytest

from study_os_service.db.backup import create_backup
from study_os_service.db.connection import connect_database
from study_os_service.db.migrations import (
    CURRENT_SCHEMA_VERSION,
    MIGRATIONS,
    MigrationRunner,
)
from study_os_service.db.portable import (
    PortableArchiveError,
    create_portable_archive,
    restore_portable_archive,
)
from study_os_service.services.planner_profiles import PlannerProfileService
from study_os_service.services.sprint import SourcePlanService
from study_os_service.services.sprint_calendar import SprintCalendarService
from study_os_service.services.sprint_day import SprintDayService


REPO_ROOT = Path(__file__).resolve().parents[2]
HISTORICAL_SCHEMA_VERSION = MIGRATIONS[-2][0]
HISTORICAL_MIGRATIONS = tuple(
    version for version, _statements in MIGRATIONS
    if version <= HISTORICAL_SCHEMA_VERSION
)
TARGET = "sefaz_ce"
NOW = datetime(2026, 7, 14, 8, 0, tzinfo=UTC)
CALENDAR_STATE_TABLES = (
    "schema_migrations",
    "source_plan_cycles",
    "source_plan_tasks",
    "sprint_day_runs",
    "sprint_actions",
    "sprint_action_question_refs",
    "sprint_evidence_import_batches",
    "sprint_performance_observations",
    "sprint_calendar_runs",
    "sprint_calendar_days",
    "sprint_calendar_items",
    "sprint_calendar_assignments",
    "sprint_calendar_materializations",
    "sprint_calendar_day_overrides",
    "sprint_calendar_item_overrides",
    "task_executions",
)


def _run_cli(data_dir: Path, *arguments: str) -> subprocess.CompletedProcess[str]:
    environment = os.environ.copy()
    environment["STUDY_OS_DATA_DIR"] = str(data_dir)
    return subprocess.run(
        [sys.executable, "-m", "study_os_service.cli", *arguments],
        cwd=REPO_ROOT,
        env=environment,
        text=True,
        capture_output=True,
        check=False,
    )


def _install_migration_prefix(path: Path, schema_version: int) -> None:
    connection = connect_database(path)
    try:
        connection.execute(
            """
            CREATE TABLE schema_migrations (
              version INTEGER PRIMARY KEY,
              applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        for version, statements in MIGRATIONS:
            if version > schema_version:
                break
            for statement in statements:
                connection.execute(statement)
            connection.execute(
                "INSERT INTO schema_migrations (version) VALUES (?)",
                (version,),
            )
        if schema_version == HISTORICAL_SCHEMA_VERSION:
            connection.execute(
                """
                INSERT INTO app_settings (key, value_json, version)
                VALUES ('historical-export-marker', 'true', 1)
                """
            )
    finally:
        connection.close()


def _install_real_migration_history(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path)
    try:
        connection.execute(
            """
            CREATE TABLE schema_migrations (
              version REAL PRIMARY KEY,
              applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        connection.executemany(
            "INSERT INTO schema_migrations (version) VALUES (?)",
            ((float(version),) for version, _statements in MIGRATIONS),
        )
        connection.commit()
        stored = tuple(
            row[0]
            for row in connection.execute(
                "SELECT version FROM schema_migrations ORDER BY version"
            )
        )
        assert stored
        assert all(type(version) is float for version in stored)
    finally:
        connection.close()


def _assert_valid_historical_database(path: Path) -> None:
    connection = sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True)
    try:
        assert connection.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
        assert tuple(
            row[0]
            for row in connection.execute(
                "SELECT version FROM schema_migrations ORDER BY version"
            )
        ) == HISTORICAL_MIGRATIONS
        assert connection.execute(
            "SELECT value_json FROM app_settings WHERE key='historical-export-marker'"
        ).fetchone()[0] == "true"
        assert connection.execute(
            """
            SELECT COUNT(*) FROM sqlite_master
                WHERE type='table' AND name='task_executions'
            """
        ).fetchone()[0] == 0
    finally:
        connection.close()


def _source_task_identities(connection: sqlite3.Connection) -> tuple[tuple, ...]:
    return tuple(
        tuple(row)
        for row in connection.execute(
            """
            SELECT id, target_slug, source_kind, external_task_id,
                   plan_label, meta_number, source_order
            FROM source_plan_tasks
            ORDER BY id
            """
        )
    )


def _database_snapshot(connection: sqlite3.Connection) -> dict[str, tuple]:
    return {
        table: tuple(
            tuple(row)
            for row in connection.execute(f'SELECT * FROM "{table}" ORDER BY rowid')
        )
        for table in CALENDAR_STATE_TABLES
    }


def _bootstrap_calendar_database(
    tmp_path: Path,
) -> tuple[sqlite3.Connection, Path, tuple[tuple, ...]]:
    database_path = tmp_path / "source" / "study-os.sqlite3"
    connection = connect_database(database_path)
    assert MigrationRunner(connection).migrate() == CURRENT_SCHEMA_VERSION
    PlannerProfileService(connection).seed((TARGET,))
    imported = SourcePlanService(connection).import_tasks(
        {
            "targetSlug": TARGET,
            "sourceKind": "ls",
            "planLabel": "Meta 47",
            "metaNumber": 47,
            "cycle": {
                "releasedAt": "2026-07-11T11:00:00Z",
                "startsOn": "2026-07-14",
                "endsOn": "2026-07-17",
            },
            "tasks": [
                {
                    "externalTaskId": "durability-meta-47-lte",
                    "scheduledDate": "2026-07-14",
                    "sourceOrder": 1,
                    "discipline": "Legis. Tribut. Estadual (ICMS)",
                    "topicHint": "ICMS Ceara",
                    "taskKind": "questions",
                    "description": "Resolver bateria LS",
                    "estimatedMinutes": 60,
                    "relevance": 10,
                    "status": "pending",
                }
            ],
        },
        idempotency_key="durability-meta-47",
    )
    assert imported["createdCount"] == 1
    return connection, database_path, _source_task_identities(connection)


def _preview_payload(expected_run_id: int | None) -> dict[str, object]:
    return {
        "targetSlug": TARGET,
        "startDate": "2026-07-14",
        "endDate": "2026-07-20",
        "expectedRunId": expected_run_id,
        "mode": "reflow_open",
        "maxTasksPerDay": 4,
        "hoursPerDay": 4,
    }


def _create_apply_pin_complete_and_draft(
    connection: sqlite3.Connection,
) -> dict[str, object]:
    calendar = SprintCalendarService(connection, clock=lambda: NOW)
    first = calendar.preview(
        _preview_payload(None),
        idempotency_key="durability-preview-1",
    )
    source_item = next(
        item for item in first["items"] if item["sourcePlanTaskId"] is not None
    )
    assert any(item["kind"] == "future_cycle_capacity" for item in first["items"])
    first_run_id = first["run"]["id"]
    calendar.apply(
        first_run_id,
        {
            "expectedRunId": None,
            "expectedOverrideVersions": first["overrideVersions"],
        },
        idempotency_key="durability-apply-1",
    )

    pin = calendar.update_item_override(
        {
            "targetSlug": TARGET,
            "itemId": source_item["id"],
            "planDate": "2026-07-14",
            "startTime": "08:00",
            "position": 1,
            "durationMinutes": 60,
            "pinned": True,
            "expectedVersion": None,
        }
    )
    manual = calendar.create_manual_item(
        {
            "targetSlug": TARGET,
            "title": "Revisar erros do caderno",
            "planDate": "2026-07-15",
            "startTime": "09:00",
            "position": 1,
            "durationMinutes": 35,
        },
        idempotency_key="durability-manual-item",
    )
    assert pin["pinned"] is True
    assert manual["override"]["pinned"] is True

    day_service = SprintDayService(connection)
    day = day_service.generate(
        {
            "targetSlug": TARGET,
            "date": "2026-07-14",
            "energyLevel": 3,
        },
        idempotency_key="durability-day-14",
        refresh=False,
    )
    action = next(
        item
        for item in day["actions"]
        if item["sourcePlanTaskId"] == source_item["sourcePlanTaskId"]
    )
    completed = day_service.update_action(
        action["id"],
        {
            "expectedVersion": action["version"],
            "decision": "accepted",
            "state": "completed",
            "actualMinutes": 55,
            "questionsDone": 10,
            "correctCount": 8,
            "wrongCount": 2,
            "doubtCount": 1,
            "energyAfter": 3,
            "questionRefs": [],
        },
        idempotency_key="durability-complete-source",
    )
    assert completed["state"] == "completed"

    second = calendar.preview(
        _preview_payload(first_run_id),
        idempotency_key="durability-preview-2",
    )
    second_run_id = second["run"]["id"]
    calendar.apply(
        second_run_id,
        {
            "expectedRunId": first_run_id,
            "expectedOverrideVersions": second["overrideVersions"],
        },
        idempotency_key="durability-apply-2",
    )
    draft = calendar.preview(
        _preview_payload(second_run_id),
        idempotency_key="durability-preview-3",
    )
    assert draft["run"]["decision"] == "draft"
    assert calendar.get_head(TARGET)["run"]["id"] == second_run_id
    return {
        "first_run_id": first_run_id,
        "second_run_id": second_run_id,
        "draft_run_id": draft["run"]["id"],
        "source_item_id": source_item["id"],
        "source_task_id": source_item["sourcePlanTaskId"],
        "manual_item_id": manual["item"]["id"],
        "action_id": action["id"],
    }


def _assert_calendar_state(
    connection: sqlite3.Connection,
    expected: dict[str, object],
    source_identities: tuple[tuple, ...],
) -> None:
    assert connection.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
    assert tuple(
        row[0]
        for row in connection.execute(
            "SELECT version FROM schema_migrations ORDER BY version"
        )
    ) == tuple(version for version, _statements in MIGRATIONS)
    assert _source_task_identities(connection) == source_identities

    first_run_id = expected["first_run_id"]
    second_run_id = expected["second_run_id"]
    draft_run_id = expected["draft_run_id"]
    applied = [
        tuple(row)
        for row in connection.execute(
            """
            SELECT id, base_applied_run_id, supersedes_run_id
            FROM sprint_calendar_runs
            WHERE decision='applied'
            ORDER BY id
            """
        )
    ]
    assert applied == [
        (first_run_id, None, None),
        (second_run_id, first_run_id, first_run_id),
    ]
    draft = connection.execute(
        """
        SELECT decision, base_applied_run_id, supersedes_run_id
        FROM sprint_calendar_runs WHERE id=?
        """,
        (draft_run_id,),
    ).fetchone()
    assert tuple(draft) == ("draft", second_run_id, None)
    calendar = SprintCalendarService(connection, clock=lambda: NOW)
    assert calendar.get_head(TARGET)["run"]["id"] == second_run_id
    assert calendar.get_run(draft_run_id)["run"]["decision"] == "draft"

    source_item = connection.execute(
        """
        SELECT kind, source_plan_task_id, state, completed_at
        FROM sprint_calendar_items WHERE id=?
        """,
        (expected["source_item_id"],),
    ).fetchone()
    assert source_item["kind"] == "source_task"
    assert source_item["source_plan_task_id"] == expected["source_task_id"]
    assert source_item["state"] == "completed"
    assert source_item["completed_at"] is not None
    assert connection.execute(
        "SELECT status FROM source_plan_tasks WHERE id=?",
        (expected["source_task_id"],),
    ).fetchone()[0] == "completed"
    manual_item = connection.execute(
        """
        SELECT origin, kind, source_plan_task_id, state
        FROM sprint_calendar_items WHERE id=?
        """,
        (expected["manual_item_id"],),
    ).fetchone()
    assert tuple(manual_item) == ("manual", "manual", None, "pending")
    overrides = {
        row["item_id"]: (row["pinned"], row["active"])
        for row in connection.execute(
            """
            SELECT item_id, pinned, active
            FROM sprint_calendar_item_overrides
            WHERE target_slug=?
            """,
            (TARGET,),
        )
    }
    assert overrides[expected["source_item_id"]] == (1, 1)
    assert overrides[expected["manual_item_id"]] == (1, 1)
    head_assignments = {
        row["item_id"]: row["pinned_snapshot"]
        for row in connection.execute(
            """
            SELECT item_id, pinned_snapshot
            FROM sprint_calendar_assignments WHERE run_id=?
            """,
            (second_run_id,),
        )
    }
    assert head_assignments[expected["source_item_id"]] == 1
    assert head_assignments[expected["manual_item_id"]] == 1

    placeholders = tuple(
        connection.execute(
            """
            SELECT item.source_plan_task_id, item.subject_profile_id,
                   assignment.precision, assignment.action_json,
                   assignment.expected_gain_milli, materialization.id
            FROM sprint_calendar_items AS item
            JOIN sprint_calendar_assignments AS assignment
              ON assignment.item_id=item.id
            LEFT JOIN sprint_calendar_materializations AS materialization
              ON materialization.assignment_id=assignment.id
            WHERE item.kind='future_cycle_capacity'
            """
        )
    )
    assert placeholders
    assert all(
        tuple(row) == (None, None, "provisional", None, 0, None)
        for row in placeholders
    )
    materializations = tuple(
        connection.execute(
            """
            SELECT item.kind, item.source_plan_task_id,
                   action.source_plan_task_id, action.id
            FROM sprint_calendar_materializations AS materialization
            JOIN sprint_calendar_assignments AS assignment
              ON assignment.id=materialization.assignment_id
            JOIN sprint_calendar_items AS item ON item.id=assignment.item_id
            JOIN sprint_actions AS action
              ON action.id=materialization.sprint_action_id
            """
        )
    )
    assert [tuple(row) for row in materializations] == [
        (
            "source_task",
            expected["source_task_id"],
            expected["source_task_id"],
            expected["action_id"],
        )
    ]
    evidence = tuple(
        connection.execute(
            """
            SELECT observation.origin, action.id, action.source_plan_task_id
            FROM sprint_performance_observations AS observation
            JOIN sprint_actions AS action
              ON observation.source_record_id='sprint-action:' || action.id
            ORDER BY observation.id
            """
        )
    )
    assert [tuple(row) for row in evidence] == [
        ("sprint_action", expected["action_id"], expected["source_task_id"])
    ]


def test_cli_backup_snapshots_v12_without_migrating_source(tmp_path: Path):
    data_dir = tmp_path / "backup-source"
    database_path = data_dir / "study-os.sqlite3"
    _install_migration_prefix(database_path, HISTORICAL_SCHEMA_VERSION)

    result = _run_cli(data_dir, "backup")

    assert result.returncode == 0, result.stderr
    assert result.stderr == ""
    payload = json.loads(result.stdout)
    assert payload["schemaVersion"] == HISTORICAL_SCHEMA_VERSION
    _assert_valid_historical_database(database_path)
    _assert_valid_historical_database(Path(payload["createdPath"]))


def test_cli_export_round_trips_v12_without_migrating_source(tmp_path: Path):
    data_dir = tmp_path / "export-source"
    database_path = data_dir / "study-os.sqlite3"
    archive_path = tmp_path / "exports" / "pre-ledger-v12.zip"
    restored_path = tmp_path / "restored" / "study-os.sqlite3"
    _install_migration_prefix(database_path, HISTORICAL_SCHEMA_VERSION)

    result = _run_cli(data_dir, "export", "--output", str(archive_path))

    assert result.returncode == 0, result.stderr
    assert result.stderr == ""
    payload = json.loads(result.stdout)
    assert payload["schemaVersion"] == HISTORICAL_SCHEMA_VERSION
    _assert_valid_historical_database(database_path)
    with zipfile.ZipFile(archive_path, "r") as archive:
        manifest = json.loads(archive.read("manifest.json"))
    assert manifest["schemaVersion"] == HISTORICAL_SCHEMA_VERSION
    restored = restore_portable_archive(
        archive_path,
        restored_path,
        tmp_path / "restored" / "backups",
    )
    assert restored.schema_version == HISTORICAL_SCHEMA_VERSION
    _assert_valid_historical_database(restored_path)


@pytest.mark.parametrize("history", ["gap", "future"])
def test_portable_export_rejects_unknown_or_future_schema_history(
    tmp_path: Path,
    history: str,
):
    database_path = tmp_path / f"{history}.sqlite3"
    _install_migration_prefix(database_path, HISTORICAL_SCHEMA_VERSION)
    connection = connect_database(database_path)
    try:
        if history == "gap":
            connection.execute(
                "DELETE FROM schema_migrations WHERE version=?",
                (HISTORICAL_SCHEMA_VERSION - 1,),
            )
            requested_version = HISTORICAL_SCHEMA_VERSION
        else:
            connection.execute(
                "INSERT INTO schema_migrations (version) VALUES (?)",
                (CURRENT_SCHEMA_VERSION + 1,),
            )
            requested_version = HISTORICAL_SCHEMA_VERSION

        with pytest.raises(PortableArchiveError):
            create_portable_archive(
                connection,
                tmp_path / f"{history}.zip",
                requested_version,
            )
    finally:
        connection.close()


@pytest.mark.parametrize("command", ["backup", "export"])
def test_cli_snapshot_commands_reject_real_migration_history(
    tmp_path: Path,
    command: str,
):
    data_dir = tmp_path / command
    database_path = data_dir / "study-os.sqlite3"
    archive_path = tmp_path / "real-history.zip"
    _install_real_migration_history(database_path)
    arguments = (
        ("export", "--output", str(archive_path))
        if command == "export"
        else ("backup",)
    )

    result = _run_cli(data_dir, *arguments)

    assert result.returncode == 1
    assert result.stdout == ""
    diagnostic = json.loads(result.stderr)
    assert diagnostic["errorType"] == "PortableArchiveError"
    assert "migration history" in diagnostic["message"]
    assert not archive_path.exists()
    assert not any((data_dir / "backups").glob("*.sqlite3"))


@pytest.mark.parametrize(
    ("stored_version", "requested_version"),
    [
        (MIGRATIONS[0][0], True),
        (HISTORICAL_SCHEMA_VERSION, float(HISTORICAL_SCHEMA_VERSION)),
    ],
)
def test_portable_export_rejects_non_integer_schema_versions(
    tmp_path: Path,
    stored_version: int,
    requested_version: object,
):
    database_path = tmp_path / "typed-schema.sqlite3"
    _install_migration_prefix(database_path, stored_version)
    connection = connect_database(database_path)
    try:
        with pytest.raises(PortableArchiveError, match="unsupported"):
            create_portable_archive(
                connection,
                tmp_path / "typed-schema.zip",
                requested_version,  # type: ignore[arg-type]
            )
    finally:
        connection.close()


def test_portable_restore_rejects_non_integer_manifest_schema(tmp_path: Path):
    database_path = tmp_path / "source.sqlite3"
    valid_archive = tmp_path / "valid.zip"
    invalid_archive = tmp_path / "invalid.zip"
    _install_migration_prefix(database_path, HISTORICAL_SCHEMA_VERSION)
    connection = connect_database(database_path)
    try:
        create_portable_archive(
            connection,
            valid_archive,
            HISTORICAL_SCHEMA_VERSION,
        )
    finally:
        connection.close()

    with zipfile.ZipFile(valid_archive, "r") as source:
        manifest = json.loads(source.read("manifest.json"))
        database_bytes = source.read("study-os.sqlite3")
    manifest["schemaVersion"] = float(HISTORICAL_SCHEMA_VERSION)
    with zipfile.ZipFile(invalid_archive, "w", zipfile.ZIP_DEFLATED) as invalid:
        invalid.writestr(
            "manifest.json",
            json.dumps(
                manifest,
                ensure_ascii=True,
                sort_keys=True,
                separators=(",", ":"),
            ) + "\n",
        )
        invalid.writestr("study-os.sqlite3", database_bytes)

    with pytest.raises(PortableArchiveError, match="unsupported"):
        restore_portable_archive(
            invalid_archive,
            tmp_path / "restored.sqlite3",
            tmp_path / "backups",
        )


def test_calendar_survives_restart_online_backup_and_portable_restore(
    tmp_path: Path,
):
    source, database_path, source_identities = _bootstrap_calendar_database(tmp_path)
    expected = _create_apply_pin_complete_and_draft(source)
    _assert_calendar_state(source, expected, source_identities)
    expected_snapshot = _database_snapshot(source)
    source.close()

    restarted = connect_database(database_path)
    _assert_calendar_state(restarted, expected, source_identities)
    assert _database_snapshot(restarted) == expected_snapshot
    backup_path = create_backup(
        restarted,
        tmp_path / "online-backups",
        now=datetime(2026, 7, 14, 20, 0, tzinfo=UTC),
    )
    archive = create_portable_archive(
        restarted,
        tmp_path / "exports" / "calendar-v12.zip",
        CURRENT_SCHEMA_VERSION,
        now=datetime(2026, 7, 14, 20, 5, tzinfo=UTC),
    )
    assert _database_snapshot(restarted) == expected_snapshot
    restarted.close()

    backup = sqlite3.connect(f"file:{backup_path.as_posix()}?mode=ro", uri=True)
    backup.row_factory = sqlite3.Row
    try:
        _assert_calendar_state(backup, expected, source_identities)
        assert _database_snapshot(backup) == expected_snapshot
    finally:
        backup.close()

    restored_path = tmp_path / "portable-restored" / "study-os.sqlite3"
    restored_result = restore_portable_archive(
        archive.archive_path,
        restored_path,
        tmp_path / "portable-restored" / "backups",
        now=datetime(2026, 7, 14, 20, 10, tzinfo=UTC),
    )
    assert restored_result.schema_version == CURRENT_SCHEMA_VERSION
    assert restored_result.pre_restore_backup is None
    restored = connect_database(restored_path)
    try:
        _assert_calendar_state(restored, expected, source_identities)
        assert _database_snapshot(restored) == expected_snapshot
    finally:
        restored.close()


def test_calendar_durability_invariant_rejects_nonprovisional_placeholder(
    tmp_path: Path,
):
    source, _database_path, source_identities = _bootstrap_calendar_database(tmp_path)
    try:
        expected = _create_apply_pin_complete_and_draft(source)
        changed = source.execute(
            """
            UPDATE sprint_calendar_assignments
            SET precision='protected'
            WHERE id=(
              SELECT assignment.id
              FROM sprint_calendar_assignments AS assignment
              JOIN sprint_calendar_items AS item ON item.id=assignment.item_id
              WHERE item.kind='future_cycle_capacity'
              ORDER BY assignment.id
              LIMIT 1
            )
            """
        )
        assert changed.rowcount == 1

        with pytest.raises(AssertionError):
            _assert_calendar_state(source, expected, source_identities)
    finally:
        source.close()
