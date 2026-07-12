from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]


def test_start_script_reinstalls_dependencies_when_pyproject_changes():
    script = (REPO_ROOT / "scripts" / "start-study-os.ps1").read_text(
        encoding="utf-8"
    )

    assert "$dependencyStamp" in script
    assert "Get-FileHash" in script
    assert "study-os-pyproject.sha256" in script
    assert "Set-Content -LiteralPath $dependencyStamp" in script
    assert "-not $SkipInstall -and $installedDependencyHash -ne $dependencyHash" in script
