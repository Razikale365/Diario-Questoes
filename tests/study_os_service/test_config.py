from dataclasses import FrozenInstanceError
from pathlib import Path

import pytest

from study_os_service.config import StudyOsSettings


def test_settings_default_to_repo_local_data_and_loopback(tmp_path: Path, monkeypatch):
    monkeypatch.delenv("STUDY_OS_DATA_DIR", raising=False)
    monkeypatch.delenv("STUDY_OS_PORT", raising=False)

    settings = StudyOsSettings.from_environment(tmp_path)

    assert settings.repo_root == tmp_path.resolve()
    assert settings.data_dir == tmp_path.resolve() / "data" / "study-os"
    assert settings.database_path == settings.data_dir / "study-os.sqlite3"
    assert settings.backup_dir == settings.data_dir / "backups"
    assert settings.host == "127.0.0.1"
    assert settings.port == 4317
    assert settings.backup_daily_retention == 14
    assert settings.backup_weekly_retention == 8


def test_settings_allow_data_directory_and_port_override(tmp_path: Path, monkeypatch):
    custom = tmp_path / "custom-data"
    monkeypatch.setenv("STUDY_OS_DATA_DIR", str(custom))
    monkeypatch.setenv("STUDY_OS_PORT", "5123")

    settings = StudyOsSettings.from_environment(tmp_path)

    assert settings.data_dir == custom.resolve()
    assert settings.port == 5123


def test_settings_remain_loopback_only(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("STUDY_OS_HOST", "0.0.0.0")

    settings = StudyOsSettings.from_environment(tmp_path)

    assert settings.host == "127.0.0.1"


@pytest.mark.parametrize("port", ["1023", "65536"])
def test_settings_reject_ports_outside_user_range(tmp_path: Path, monkeypatch, port: str):
    monkeypatch.setenv("STUDY_OS_PORT", port)

    with pytest.raises(ValueError, match="between 1024 and 65535"):
        StudyOsSettings.from_environment(tmp_path)


def test_settings_are_immutable(tmp_path: Path):
    settings = StudyOsSettings.from_environment(tmp_path)

    with pytest.raises(FrozenInstanceError):
        settings.port = 5123  # type: ignore[misc]
