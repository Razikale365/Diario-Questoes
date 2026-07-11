from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI

from study_os_service.api.health import router as health_router
from study_os_service.config import StudyOsSettings
from study_os_service.db.connection import connect_database
from study_os_service.db.migrations import MigrationRunner


def create_app(settings: StudyOsSettings | None = None) -> FastAPI:
    resolved_settings = settings or StudyOsSettings.from_environment()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        resolved_settings.data_dir.mkdir(parents=True, exist_ok=True)
        resolved_settings.backup_dir.mkdir(parents=True, exist_ok=True)
        connection = connect_database(resolved_settings.database_path)
        app.state.connection = connection
        try:
            app.state.schema_version = MigrationRunner(connection).migrate()
            yield
        finally:
            connection.close()
            app.state.connection = None

    app = FastAPI(title="Study OS Local Service", lifespan=lifespan)
    app.state.settings = resolved_settings
    app.include_router(health_router, prefix="/api/v1")
    return app
