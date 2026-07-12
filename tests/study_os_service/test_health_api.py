from fastapi.testclient import TestClient

from study_os_service.app import create_app
from study_os_service.config import StudyOsSettings
from study_os_service.db.migrations import CURRENT_SCHEMA_VERSION


def test_health_initializes_database_and_reports_contract(tmp_path):
    settings = StudyOsSettings.from_environment(tmp_path)
    app = create_app(settings)

    with TestClient(app) as client:
        response = client.get("/api/v1/health")

        assert app.state.settings is settings
        assert app.state.schema_version == CURRENT_SCHEMA_VERSION

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "serviceVersion": "0.1.0",
        "schemaVersion": CURRENT_SCHEMA_VERSION,
        "database": "ok",
        "backup": "missing",
        "configuredRoots": 0,
    }
    assert settings.database_path.exists()
    assert app.state.connection is None
