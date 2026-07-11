import json
import os
from pathlib import Path
import subprocess
import sys


REPO_ROOT = Path(__file__).resolve().parents[2]


def _run_cli(data_dir: Path, command: str) -> subprocess.CompletedProcess[str]:
    environment = os.environ.copy()
    environment["STUDY_OS_DATA_DIR"] = str(data_dir)
    return subprocess.run(
        [sys.executable, "-m", "study_os_service.cli", command],
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
    assert payload["schemaVersion"] == 2
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
            "schemaVersion": 2,
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
    assert payload["schemaVersion"] == 2
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
