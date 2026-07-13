from pathlib import Path
import re


REPO_ROOT = Path(__file__).resolve().parents[2]


def test_frontend_entrypoints_do_not_require_remote_runtime_assets():
    stylesheet = (REPO_ROOT / "src" / "index.css").read_text(encoding="utf-8")
    document = (REPO_ROOT / "index.html").read_text(encoding="utf-8")

    assert "fonts.googleapis.com" not in stylesheet
    assert "fonts.gstatic.com" not in stylesheet
    assert not re.search(r"@import\s+url\(['\"]https?://", stylesheet, re.I)
    assert not re.search(
        r"<(?:link|script)\b[^>]+(?:href|src)=['\"]https?://",
        document,
        re.I,
    )


def test_windows_startup_hashing_does_not_require_get_file_hash_cmdlet():
    startup = (REPO_ROOT / "scripts" / "start-study-os.ps1").read_text(
        encoding="utf-8"
    )

    assert "Get-FileHash" not in startup
    assert "System.Security.Cryptography.SHA256" in startup
