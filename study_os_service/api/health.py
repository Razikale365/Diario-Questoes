from fastapi import APIRouter, Request

from study_os_service import __version__


router = APIRouter()


@router.get("/health")
async def health(request: Request) -> dict[str, str | int]:
    state = request.app.state
    database_result = state.connection.execute("PRAGMA quick_check").fetchone()
    database_status = "ok" if database_result and database_result[0] == "ok" else "error"
    backup_status = (
        "ok"
        if any(state.settings.backup_dir.glob("study-os-*.sqlite3"))
        else "missing"
    )
    return {
        "status": "ok" if database_status == "ok" else "error",
        "serviceVersion": __version__,
        "schemaVersion": state.schema_version,
        "database": database_status,
        "backup": backup_status,
        "configuredRoots": 0,
    }
