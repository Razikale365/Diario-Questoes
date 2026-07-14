from datetime import UTC, datetime
import json
from pathlib import Path

from fastapi.testclient import TestClient

from scripts.import_sprint_evidence import main
from study_os_service.app import create_app
from study_os_service.config import StudyOsSettings


def test_cli_is_dry_run_by_default_then_commits_and_replays(
    tmp_path: Path,
    monkeypatch,
    capsys,
):
    settings = StudyOsSettings.from_environment(tmp_path)
    with TestClient(create_app(settings)) as client:
        assert client.post(
            "/api/v1/planner/targets/seed",
            json={"targetSlugs": ["sefaz_ce"]},
        ).status_code == 201
    source = tmp_path / "aggregate.json"
    source.write_text(
        json.dumps(
            [
                {
                    "id": "task-1",
                    "date": "2026-07-14",
                    "discipline": "Economia",
                    "blocks": [
                        {
                            "id": "block-1",
                            "questions": [
                                {"isCorrect": True, "hasDoubt": False},
                                {"isCorrect": False, "hasDoubt": True},
                            ],
                        }
                    ],
                }
            ]
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("STUDY_OS_DATA_DIR", str(settings.data_dir))
    base = [
        "--format",
        "diario-backup",
        "--input",
        str(source),
        "--target-slug",
        "sefaz_ce",
        "--batch-id",
        "cli-aggregate-test",
        "--snapshot-at",
        "2026-07-14T12:00:00Z",
    ]

    assert main(base) == 0
    dry = json.loads(capsys.readouterr().out)
    assert dry["dryRun"] is True
    assert main(base + ["--commit"]) == 0
    committed = json.loads(capsys.readouterr().out)
    assert committed["insertedCount"] == 1
    assert main(base + ["--commit"]) == 0
    replayed = json.loads(capsys.readouterr().out)
    assert replayed["replayed"] is True
