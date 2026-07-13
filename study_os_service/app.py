from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI

from study_os_service.api.health import router as health_router
from study_os_service.api.planner import (
    PlannerApiError,
    planner_api_error_handler,
    router as planner_router,
)
from study_os_service.api.inventory import (
    InventoryApiError,
    inventory_api_error_handler,
    router as inventory_router,
)
from study_os_service.api.sessions import router as sessions_router
from study_os_service.api.review import (
    ReviewApiError,
    review_api_error_handler,
    router as review_router,
)
from study_os_service.api.learning import (
    LearningApiError,
    learning_api_error_handler,
    router as learning_router,
)
from study_os_service.api.planner_profiles import (
    PlannerProfileApiError,
    planner_profile_api_error_handler,
    router as planner_profiles_router,
)
from study_os_service.api.strategy import (
    StrategyApiError,
    strategy_api_error_handler,
    router as strategy_router,
)
from study_os_service.config import StudyOsSettings
from study_os_service.db.connection import connect_database
from study_os_service.db.migrations import MigrationRunner
from study_os_service.ingest.course_scanner import scan_course_root


def create_app(settings: StudyOsSettings | None = None) -> FastAPI:
    resolved_settings = settings or StudyOsSettings.from_environment()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        resolved_settings.data_dir.mkdir(parents=True, exist_ok=True)
        resolved_settings.backup_dir.mkdir(parents=True, exist_ok=True)
        connection = connect_database(resolved_settings.database_path)
        app.state.connection = connection
        app.state.scan_tasks = set()
        try:
            app.state.schema_version = MigrationRunner(connection).migrate()
            yield
        finally:
            tasks = tuple(app.state.scan_tasks)
            if tasks:
                await asyncio.gather(*tasks, return_exceptions=True)
            connection.close()
            app.state.connection = None

    app = FastAPI(title="Study OS Local Service", lifespan=lifespan)
    app.state.settings = resolved_settings
    app.state.inventory_scanner = scan_course_root
    app.add_exception_handler(InventoryApiError, inventory_api_error_handler)
    app.add_exception_handler(
        PlannerProfileApiError, planner_profile_api_error_handler
    )
    app.add_exception_handler(PlannerApiError, planner_api_error_handler)
    app.add_exception_handler(ReviewApiError, review_api_error_handler)
    app.add_exception_handler(LearningApiError, learning_api_error_handler)
    app.add_exception_handler(StrategyApiError, strategy_api_error_handler)
    app.include_router(health_router, prefix="/api/v1")
    app.include_router(inventory_router, prefix="/api/v1")
    app.include_router(sessions_router, prefix="/api/v1")
    app.include_router(planner_profiles_router, prefix="/api/v1")
    app.include_router(planner_router, prefix="/api/v1")
    app.include_router(review_router, prefix="/api/v1")
    app.include_router(learning_router, prefix="/api/v1")
    app.include_router(strategy_router, prefix="/api/v1")
    return app
