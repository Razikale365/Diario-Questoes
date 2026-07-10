from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True, slots=True)
class StudyOsSettings:
    repo_root: Path
    data_dir: Path
    database_path: Path
    backup_dir: Path
    host: str = "127.0.0.1"
    port: int = 4317
    backup_daily_retention: int = 14
    backup_weekly_retention: int = 8

    @classmethod
    def from_environment(cls, repo_root: Path | None = None) -> "StudyOsSettings":
        root = (repo_root or Path(__file__).resolve().parents[1]).resolve()
        data_dir = Path(os.getenv("STUDY_OS_DATA_DIR", root / "data" / "study-os")).resolve()
        port = int(os.getenv("STUDY_OS_PORT", "4317"))
        if not 1024 <= port <= 65535:
            raise ValueError("STUDY_OS_PORT must be between 1024 and 65535")
        return cls(
            repo_root=root,
            data_dir=data_dir,
            database_path=data_dir / "study-os.sqlite3",
            backup_dir=data_dir / "backups",
            port=port,
        )
