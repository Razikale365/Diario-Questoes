# Study OS M1 Local Service Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a lightweight local Python service, SQLite migrations and backups, a visible frontend health contract, and one-command Windows startup without disrupting the existing Diario app.

**Architecture:** FastAPI runs on `127.0.0.1:4317`; Vite proxies `/api/v1` to it during development. Python's `sqlite3` module owns a local database under `data/study-os`, and repository/backup code stays independent of HTTP. Existing React tasks and the three pre-existing uncommitted source-ingestion files remain intact.

**Tech Stack:** Python 3.13, FastAPI, Uvicorn, stdlib `sqlite3`, pytest, React 19, TypeScript 5.8, Vite 6.

## Global Constraints

- Work only in `C:\Docker\Diario-Questoes` on `codex/study-os-planner-core`.
- Do not modify Fiscal Brain or Cursos Estratégia.
- No Docker, local LLM, graph database, vector database, OCR, or background worker framework.
- Bind the service only to `127.0.0.1`.
- SQLite is the future Study OS source of truth; localStorage remains unchanged in M1.
- The frontend uses relative `/api/v1` URLs and never embeds an absolute service URL.
- Tests use temporary directories and never write to the real `data/study-os` database.
- Every behavior change follows red-green-refactor and receives a focused commit.
- Preserve the existing uncommitted changes until Task 1 creates their verified save point.

---

## Planned File Structure

```text
pyproject.toml                         Python package and test configuration
study_os_service/
  __init__.py                          package version only
  config.py                            immutable local paths/host/port settings
  app.py                               FastAPI composition and lifespan
  cli.py                               health, initialize, backup commands
  api/
    __init__.py
    health.py                          health response router
  db/
    __init__.py
    connection.py                      configured SQLite connections
    migrations.py                      ordered transactional migrations
    backup.py                          SQLite backup and retention
tests/study_os_service/
  test_config.py
  test_migrations.py
  test_backup.py
  test_health_api.py
  test_cli.py
src/study-os/
  api/client.ts                        error-normalized relative API fetch
  api/health.ts                        health DTO and parser
  api/health.test.ts                   parser contract
  components/ServiceStatus.tsx         compact operational status
scripts/start-study-os.ps1             service/frontend process orchestration
start-app.bat                          delegates to the PowerShell launcher
vite.config.ts                         `/api/v1` development proxy
```

## Task 1: Preserve the Existing Package-Ingestion Experiment

**Files:**
- Existing: `src/components/PlannerArea.tsx`
- Existing: `src/utils/studyPlannerCore.ts`
- Existing: `src/utils/studyPlannerCore.test.ts`

**Interfaces:**
- Consumes: current uncommitted working tree exactly as found after design approval.
- Produces: a clean save-point commit that later service work can supersede without losing the experiment.

- [ ] **Step 1: Run the focused tests**

Run:

```powershell
npx.cmd tsx --test src/utils/studyPlannerCore.test.ts
```

Expected: all Study OS core tests pass, including file inference and source merge tests.

- [ ] **Step 2: Run frontend verification**

Run:

```powershell
npm.cmd run lint
npm.cmd run build
git diff --check
```

Expected: all commands exit 0. Existing Vite bundle-size warnings are allowed.

- [ ] **Step 3: Confirm scope**

Run:

```powershell
git status --short
```

Expected modified paths only:

```text
M src/components/PlannerArea.tsx
M src/utils/studyPlannerCore.test.ts
M src/utils/studyPlannerCore.ts
```

- [ ] **Step 4: Commit the save point**

```powershell
git add -- src/components/PlannerArea.tsx src/utils/studyPlannerCore.test.ts src/utils/studyPlannerCore.ts
git commit -m "feat: ingest study source folders"
```

## Task 2: Python Package and Immutable Settings

**Files:**
- Create: `pyproject.toml`
- Create: `study_os_service/__init__.py`
- Create: `study_os_service/config.py`
- Create: `tests/study_os_service/test_config.py`

**Interfaces:**
- Produces: `StudyOsSettings.from_environment(repo_root: Path | None = None) -> StudyOsSettings`.
- Produces settings fields: `repo_root`, `data_dir`, `database_path`, `backup_dir`, `host`, `port`, `backup_daily_retention`, `backup_weekly_retention`.

- [ ] **Step 1: Write the failing settings test**

```python
from pathlib import Path

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
```

- [ ] **Step 2: Verify the test fails**

Run:

```powershell
python -m pytest tests/study_os_service/test_config.py -q
```

Expected: import failure because `study_os_service.config` does not exist.

- [ ] **Step 3: Add package configuration**

Create `pyproject.toml` with:

```toml
[build-system]
requires = ["setuptools>=75"]
build-backend = "setuptools.build_meta"

[project]
name = "diario-study-os-service"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
  "fastapi>=0.115,<1",
  "uvicorn>=0.34,<1",
]

[project.optional-dependencies]
dev = [
  "httpx>=0.27,<1",
  "pytest>=8,<10",
]

[tool.pytest.ini_options]
testpaths = ["tests/study_os_service"]
pythonpath = ["."]
```

Create `study_os_service/__init__.py`:

```python
__version__ = "0.1.0"
```

- [ ] **Step 4: Implement immutable settings**

```python
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
```

- [ ] **Step 5: Run tests and commit**

```powershell
python -m pytest tests/study_os_service/test_config.py -q
git add -- pyproject.toml study_os_service/__init__.py study_os_service/config.py tests/study_os_service/test_config.py
git commit -m "feat: add Study OS service settings"
```

Expected: 2 tests pass.

## Task 3: SQLite Connections and Transactional Migrations

**Files:**
- Create: `study_os_service/db/__init__.py`
- Create: `study_os_service/db/connection.py`
- Create: `study_os_service/db/migrations.py`
- Create: `tests/study_os_service/test_migrations.py`

**Interfaces:**
- Produces: `connect_database(path: Path) -> sqlite3.Connection`.
- Produces: `MigrationRunner(connection).migrate() -> int` returning the current schema version.
- Produces schema version 1 tables: `schema_migrations`, `app_settings`, `app_events`.

- [ ] **Step 1: Write failing migration tests**

```python
from pathlib import Path

from study_os_service.db.connection import connect_database
from study_os_service.db.migrations import MigrationRunner


def test_migrate_initializes_foundation_schema_idempotently(tmp_path: Path):
    connection = connect_database(tmp_path / "study.sqlite3")
    runner = MigrationRunner(connection)

    assert runner.migrate() == 1
    assert runner.migrate() == 1

    tables = {
        row["name"]
        for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")
    }
    assert {"schema_migrations", "app_settings", "app_events"} <= tables
    assert connection.execute("PRAGMA foreign_keys").fetchone()[0] == 1
    assert connection.execute("PRAGMA journal_mode").fetchone()[0].lower() == "wal"
```

- [ ] **Step 2: Verify RED**

```powershell
python -m pytest tests/study_os_service/test_migrations.py -q
```

Expected: import failure for the missing DB modules.

- [ ] **Step 3: Implement configured connections**

`connect_database` must:

```python
def connect_database(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path, timeout=5.0, isolation_level=None)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys=ON")
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA busy_timeout=5000")
    return connection
```

- [ ] **Step 4: Implement ordered migration 1**

`MigrationRunner` must open `BEGIN IMMEDIATE`, create the migration table, apply unapplied migrations in order, insert the version only after success, commit, and roll back on error. Migration 1 creates:

```sql
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS app_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info','warning','error')),
  message TEXT NOT NULL,
  context_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

- [ ] **Step 5: Run tests and commit**

```powershell
python -m pytest tests/study_os_service/test_migrations.py -q
git add -- study_os_service/db tests/study_os_service/test_migrations.py
git commit -m "feat: initialize Study OS SQLite schema"
```

## Task 4: Safe SQLite Backup and Retention

**Files:**
- Create: `study_os_service/db/backup.py`
- Create: `tests/study_os_service/test_backup.py`

**Interfaces:**
- Produces: `create_backup(source: sqlite3.Connection, backup_dir: Path, now: datetime | None = None) -> Path`.
- Produces: `prune_backups(backup_dir: Path, daily_retention: int, weekly_retention: int, now: datetime | None = None) -> list[Path]`.

- [ ] **Step 1: Write failing backup tests**

```python
from datetime import UTC, datetime
from pathlib import Path

from study_os_service.db.backup import create_backup
from study_os_service.db.connection import connect_database
from study_os_service.db.migrations import MigrationRunner


def test_create_backup_is_a_readable_consistent_database(tmp_path: Path):
    source = connect_database(tmp_path / "source.sqlite3")
    MigrationRunner(source).migrate()
    source.execute("INSERT INTO app_settings(key, value_json) VALUES ('active_target', '\"bacen\"')")

    backup_path = create_backup(source, tmp_path / "backups", datetime(2026, 7, 10, 12, 0, tzinfo=UTC))
    restored = connect_database(backup_path)

    assert backup_path.name == "study-os-20260710T120000Z.sqlite3"
    assert restored.execute("SELECT value_json FROM app_settings WHERE key='active_target'").fetchone()[0] == '"bacen"'
    assert restored.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
```

- [ ] **Step 2: Verify RED**

```powershell
python -m pytest tests/study_os_service/test_backup.py -q
```

- [ ] **Step 3: Implement backup using `Connection.backup`**

The implementation must checkpoint the source, create the destination directory, reject overwriting an existing timestamped file, use `source.backup(destination)`, close the destination in `finally`, and run `PRAGMA integrity_check` before returning.

- [ ] **Step 4: Add retention tests and implementation**

Create fixture files spanning 30 days and assert that the newest 14 daily snapshots plus the newest snapshot from each of the previous 8 ISO weeks survive. Files outside both sets are returned by `prune_backups` and removed.

- [ ] **Step 5: Run tests and commit**

```powershell
python -m pytest tests/study_os_service/test_backup.py -q
git add -- study_os_service/db/backup.py tests/study_os_service/test_backup.py
git commit -m "feat: add Study OS SQLite backups"
```

## Task 5: FastAPI Lifespan and Health Contract

**Files:**
- Create: `study_os_service/api/__init__.py`
- Create: `study_os_service/api/health.py`
- Create: `study_os_service/app.py`
- Create: `tests/study_os_service/test_health_api.py`

**Interfaces:**
- Produces: `create_app(settings: StudyOsSettings | None = None) -> FastAPI`.
- Produces `GET /api/v1/health` response:

```json
{
  "status": "ok",
  "serviceVersion": "0.1.0",
  "schemaVersion": 1,
  "database": "ok",
  "backup": "missing",
  "configuredRoots": 0
}
```

- [ ] **Step 1: Write failing API test**

```python
from fastapi.testclient import TestClient

from study_os_service.app import create_app
from study_os_service.config import StudyOsSettings


def test_health_initializes_database_and_reports_contract(tmp_path):
    settings = StudyOsSettings.from_environment(tmp_path)
    with TestClient(create_app(settings)) as client:
        response = client.get("/api/v1/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "serviceVersion": "0.1.0",
        "schemaVersion": 1,
        "database": "ok",
        "backup": "missing",
        "configuredRoots": 0,
    }
    assert settings.database_path.exists()
```

- [ ] **Step 2: Verify RED**

```powershell
python -m pytest tests/study_os_service/test_health_api.py -q
```

- [ ] **Step 3: Implement lifespan-owned resources**

`create_app` must store settings, connection, and schema version on `app.state`. Lifespan creates directories, opens the connection, migrates, and closes the connection on shutdown. The health router reads state only; it does not open a second connection.

- [ ] **Step 4: Reject non-loopback production binding in CLI/config tests**

Add a test proving `StudyOsSettings.host` cannot be overridden through the environment. The service remains loopback-only.

- [ ] **Step 5: Run tests and commit**

```powershell
python -m pytest tests/study_os_service/test_health_api.py tests/study_os_service/test_config.py -q
git add -- study_os_service/api study_os_service/app.py tests/study_os_service/test_health_api.py tests/study_os_service/test_config.py
git commit -m "feat: expose Study OS service health"
```

## Task 6: Diagnostic CLI

**Files:**
- Create: `study_os_service/cli.py`
- Create: `tests/study_os_service/test_cli.py`

**Interfaces:**
- Produces commands: `initialize`, `health`, and `backup`.
- Produces process exit 0 on success and JSON on stdout; diagnostics go to stderr.

- [ ] **Step 1: Write failing CLI tests**

Use `subprocess.run` with `STUDY_OS_DATA_DIR` pointed at `tmp_path`. Assert:

```python
result = subprocess.run(
    [sys.executable, "-m", "study_os_service.cli", "initialize"],
    cwd=repo_root,
    env=environment,
    text=True,
    capture_output=True,
    check=False,
)
assert result.returncode == 0
assert json.loads(result.stdout)["schemaVersion"] == 1
```

The backup test runs `backup` after `initialize` and asserts the reported path exists under the temporary backup directory.

- [ ] **Step 2: Verify RED**

```powershell
python -m pytest tests/study_os_service/test_cli.py -q
```

- [ ] **Step 3: Implement argparse commands**

All commands load `StudyOsSettings.from_environment()`. `initialize` migrates and closes. `health` runs `PRAGMA integrity_check` and reports schema/database paths. `backup` migrates, creates a backup, prunes retention, and reports created/pruned paths.

- [ ] **Step 4: Run tests and commit**

```powershell
python -m pytest tests/study_os_service/test_cli.py -q
git add -- study_os_service/cli.py tests/study_os_service/test_cli.py
git commit -m "feat: add Study OS diagnostic CLI"
```

## Task 7: Typed Frontend Health Client and Visible Status

**Files:**
- Create: `src/study-os/api/client.ts`
- Create: `src/study-os/api/health.ts`
- Create: `src/study-os/api/health.test.ts`
- Create: `src/study-os/components/ServiceStatus.tsx`
- Modify: `src/components/PlannerArea.tsx`

**Interfaces:**
- Produces: `parseStudyOsHealth(value: unknown) -> StudyOsHealth`.
- Produces: `fetchStudyOsHealth(signal?: AbortSignal) -> Promise<StudyOsHealth>` using `/api/v1/health`.
- Produces: `<ServiceStatus />` with `Conectado`, `Iniciando`, or `Indisponível` states.

- [ ] **Step 1: Write failing DTO parser tests**

```typescript
import assert from 'node:assert/strict';
import test from 'node:test';

import { parseStudyOsHealth } from './health';

test('parseStudyOsHealth accepts the service contract', () => {
  assert.deepEqual(parseStudyOsHealth({
    status: 'ok',
    serviceVersion: '0.1.0',
    schemaVersion: 1,
    database: 'ok',
    backup: 'missing',
    configuredRoots: 0,
  }), {
    status: 'ok',
    serviceVersion: '0.1.0',
    schemaVersion: 1,
    database: 'ok',
    backup: 'missing',
    configuredRoots: 0,
  });
});

test('parseStudyOsHealth rejects malformed responses', () => {
  assert.throws(() => parseStudyOsHealth({ status: 'ok' }), /health response/i);
});
```

- [ ] **Step 2: Verify RED**

```powershell
npx.cmd tsx --test src/study-os/api/health.test.ts
```

- [ ] **Step 3: Implement client and parser**

`requestJson` in `client.ts` uses relative URLs, checks `response.ok`, attempts a structured `{code,message}` error, and throws `StudyOsApiError`. `fetchStudyOsHealth` calls `requestJson('/api/v1/health')` and parses the result.

- [ ] **Step 4: Implement status component**

`ServiceStatus` fetches once on mount with an AbortController. It renders a compact status badge and schema version. It does not poll in M1. Integrate it in the Study OS generator header without moving existing planner state.

- [ ] **Step 5: Verify and commit**

```powershell
npx.cmd tsx --test src/study-os/api/health.test.ts
npm.cmd run lint
git add -- src/study-os src/components/PlannerArea.tsx
git commit -m "feat: show Study OS service status"
```

## Task 8: Vite Proxy and One-Command Windows Startup

**Files:**
- Modify: `vite.config.ts`
- Create: `scripts/start-study-os.ps1`
- Modify: `start-app.bat`
- Modify: `.gitignore`

**Interfaces:**
- Vite proxies `/api/v1` and `/files` to `http://127.0.0.1:4317`.
- `start-app.bat` invokes the PowerShell launcher.
- Launcher creates `.venv-study-os` only when absent, installs `.[dev]` only on first creation, starts Uvicorn hidden, waits for health, opens the browser, runs Vite in the foreground, and stops the service in `finally`.

- [ ] **Step 1: Add the Vite proxy**

```typescript
proxy: {
  '/api/v1': 'http://127.0.0.1:4317',
  '/files': 'http://127.0.0.1:4317',
},
```

- [ ] **Step 2: Add launcher parameters and prerequisites**

`scripts/start-study-os.ps1` accepts:

```powershell
param(
  [switch]$NoBrowser,
  [switch]$SkipInstall
)
```

It resolves the repository root from `$PSScriptRoot`, uses `.venv-study-os\Scripts\python.exe`, and fails with a clear message if `python` or `npm.cmd` is unavailable.

- [ ] **Step 3: Implement service lifecycle**

Start Uvicorn with:

```powershell
$service = Start-Process -FilePath $venvPython `
  -ArgumentList @('-m','uvicorn','study_os_service.app:create_app','--factory','--host','127.0.0.1','--port','4317') `
  -WorkingDirectory $repoRoot `
  -WindowStyle Hidden `
  -PassThru
```

Poll `http://127.0.0.1:4317/api/v1/health` for up to 30 seconds. If health never succeeds, stop the service and exit nonzero. Run `npm.cmd run dev` in the foreground. The `finally` block stops only the recorded service PID.

- [ ] **Step 4: Delegate from batch file**

```bat
@echo off
setlocal
cd /d "%~dp0"
title Study OS
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-study-os.ps1"
pause
```

Add `.venv-study-os/` and `data/study-os/` to `.gitignore`.

- [ ] **Step 5: Run startup smoke without browser**

In one terminal:

```powershell
.\scripts\start-study-os.ps1 -NoBrowser
```

Expected: health succeeds, Vite starts on port 3000, and stopping Vite also stops the service. Confirm `http://localhost:3000/api/v1/health` returns the contract through the Vite proxy.

- [ ] **Step 6: Verify and commit**

```powershell
python -m pytest tests/study_os_service -q
npm.cmd test
npm.cmd run lint
npm.cmd run build
git diff --check
git add -- vite.config.ts scripts/start-study-os.ps1 start-app.bat .gitignore
git commit -m "feat: start Study OS frontend and service together"
```

## Task 9: M1 End-to-End Gate

**Files:**
- Modify only if verification exposes a tested defect.

**Interfaces:**
- Proves the M1 acceptance contract before moving to the course inventory milestone.

- [ ] **Step 1: Run all automated checks**

```powershell
python -m pytest tests/study_os_service -q
npm.cmd test
npm.cmd run lint
npm.cmd run build
git diff --check
```

Expected: zero failures. Existing Vite chunk warnings are allowed and recorded.

- [ ] **Step 2: Run service/API smoke**

Start Uvicorn using the project virtual environment, request `/api/v1/health`, request the same endpoint through Vite proxy, run CLI backup, and verify the backup with `PRAGMA integrity_check`.

- [ ] **Step 3: Run browser smoke**

Open Planner de Metas and Study OS. Verify:

- service badge says `Conectado`;
- schema version is 1;
- existing target selector and planner controls still render;
- no new console errors appear;
- desktop and mobile widths do not overlap.

- [ ] **Step 4: Record milestone state**

Create `docs/superpowers/plans/2026-07-10-study-os-m2-course-inventory.md` from M2 of the approved design before changing scanner code. The M2 plan must use fixtures reproducing the audited real package names and the same TDD/commit gates.

## Self-Review Results

- Spec coverage: M1 startup, service, SQLite, backup, health visibility, and offline/local constraints are covered.
- Scope boundary: course inventory, sessions, planner replacement, review, TEC, and migration remain in M2-M7 and are not smuggled into M1.
- Placeholder scan: no implementation placeholders are present; every M1 behavior has files, interfaces, tests, commands, and expected results.
- Type consistency: `StudyOsSettings`, `connect_database`, `MigrationRunner`, `create_backup`, `create_app`, and the health DTO names are consistent across tasks.
- Preservation: Task 1 commits the pre-existing uncommitted source-ingestion experiment before new service files are added.
