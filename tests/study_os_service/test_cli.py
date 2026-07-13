import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys

from study_os_service.db.migrations import CURRENT_SCHEMA_VERSION


REPO_ROOT = Path(__file__).resolve().parents[2]


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


def test_initialize_creates_database_and_reports_schema(tmp_path: Path):
    data_dir = tmp_path / "study-os"

    result = _run_cli(data_dir, "initialize")

    payload = json.loads(result.stdout)
    assert result.returncode == 0
    assert result.stderr == ""
    assert payload["status"] == "ok"
    assert payload["schemaVersion"] == CURRENT_SCHEMA_VERSION
    assert Path(payload["databasePath"]) == data_dir / "study-os.sqlite3"
    assert Path(payload["databasePath"]).exists()


def test_health_checks_initialized_database_integrity(tmp_path: Path):
    data_dir = tmp_path / "study-os"
    assert _run_cli(data_dir, "initialize").returncode == 0

    result = _run_cli(data_dir, "health")

    payload = json.loads(result.stdout)
    assert result.returncode == 0
    assert result.stderr == ""
    assert payload == {
        "status": "ok",
        "schemaVersion": CURRENT_SCHEMA_VERSION,
        "database": "ok",
        "databasePath": str((data_dir / "study-os.sqlite3").resolve()),
    }


def test_backup_creates_readable_snapshot_under_backup_directory(tmp_path: Path):
    data_dir = tmp_path / "study-os"
    assert _run_cli(data_dir, "initialize").returncode == 0

    result = _run_cli(data_dir, "backup")

    payload = json.loads(result.stdout)
    created_path = Path(payload["createdPath"])
    assert result.returncode == 0
    assert result.stderr == ""
    assert payload["status"] == "ok"
    assert payload["schemaVersion"] == CURRENT_SCHEMA_VERSION
    assert created_path.parent == (data_dir / "backups").resolve()
    assert created_path.exists()
    assert payload["prunedPaths"] == []


def test_cli_writes_structured_diagnostics_to_stderr(tmp_path: Path):
    environment = os.environ.copy()
    environment["STUDY_OS_DATA_DIR"] = str(tmp_path / "study-os")
    environment["STUDY_OS_PORT"] = "invalid"

    result = subprocess.run(
        [sys.executable, "-m", "study_os_service.cli", "health"],
        cwd=REPO_ROOT,
        env=environment,
        text=True,
        capture_output=True,
        check=False,
    )

    diagnostic = json.loads(result.stderr)
    assert result.returncode == 1
    assert result.stdout == ""
    assert diagnostic["status"] == "error"
    assert diagnostic["errorType"] == "ValueError"


def test_cli_exports_and_restores_the_command_layer_with_pre_restore_backup(
    tmp_path: Path,
):
    data_dir = tmp_path / "study-os"
    archive_path = tmp_path / "exports" / "portable.zip"
    assert _run_cli(data_dir, "initialize").returncode == 0

    exported = _run_cli(data_dir, "export", "--output", str(archive_path))
    export_payload = json.loads(exported.stdout)

    assert exported.returncode == 0
    assert exported.stderr == ""
    assert export_payload["status"] == "ok"
    assert export_payload["schemaVersion"] == CURRENT_SCHEMA_VERSION
    assert Path(export_payload["archivePath"]) == archive_path.resolve()
    assert len(export_payload["databaseSha256"]) == 64
    assert export_payload["databaseSize"] > 0

    database_path = data_dir / "study-os.sqlite3"
    connection = sqlite3.connect(database_path)
    try:
        connection.execute(
            """
            INSERT INTO app_settings (key, value_json, version)
            VALUES ('post-export-marker', 'true', 1)
            """
        )
        connection.commit()
    finally:
        connection.close()

    restored = _run_cli(data_dir, "restore", "--from", str(archive_path))
    restore_payload = json.loads(restored.stdout)

    assert restored.returncode == 0
    assert restored.stderr == ""
    assert restore_payload["status"] == "ok"
    assert restore_payload["schemaVersion"] == CURRENT_SCHEMA_VERSION
    assert Path(restore_payload["databasePath"]) == database_path.resolve()
    backup_path = Path(restore_payload["preRestoreBackup"])
    assert backup_path.exists()

    restored_connection = sqlite3.connect(database_path)
    backup_connection = sqlite3.connect(backup_path)
    try:
        assert restored_connection.execute(
            "SELECT COUNT(*) FROM app_settings WHERE key='post-export-marker'"
        ).fetchone()[0] == 0
        assert backup_connection.execute(
            "SELECT COUNT(*) FROM app_settings WHERE key='post-export-marker'"
        ).fetchone()[0] == 1
    finally:
        restored_connection.close()
        backup_connection.close()


def test_cli_restore_reports_invalid_archive_as_structured_error(tmp_path: Path):
    data_dir = tmp_path / "study-os"
    invalid_archive = tmp_path / "invalid.zip"
    invalid_archive.write_bytes(b"not a zip")
    assert _run_cli(data_dir, "initialize").returncode == 0

    result = _run_cli(
        data_dir,
        "restore",
        "--from",
        str(invalid_archive),
    )

    assert result.returncode == 1
    assert result.stdout == ""
    diagnostic = json.loads(result.stderr)
    assert diagnostic["status"] == "error"
    assert diagnostic["errorType"] == "PortableArchiveError"
    assert "not a zip" not in diagnostic["message"]
