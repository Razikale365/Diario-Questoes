from pathlib import Path

import pytest

from study_os_service.db.connection import connect_database
from study_os_service.db.migrations import MigrationRunner
from study_os_service.services.planner_profiles import PlannerProfileService
from study_os_service.services.preferences import (
    ActiveTargetNotFoundError,
    InactiveTargetError,
    NoActiveTargetError,
    PreferenceVersionConflictError,
    PreferenceService,
)


def test_active_target_defaults_persists_and_repairs_inactive_choice(tmp_path: Path):
    database_path = tmp_path / "study.sqlite3"
    connection = connect_database(database_path)
    try:
        MigrationRunner(connection).migrate()
        PlannerProfileService(connection).seed(
            ("rfb_auditor", "bacen_economia_financas")
        )
        connection.execute(
            """
            UPDATE exam_targets SET priority_score=90, active=1
            WHERE target_slug IN ('rfb_auditor','bacen_economia_financas')
            """
        )
        service = PreferenceService(connection)

        initial = service.get_active_target()
        saved = service.set_active_target(
            "rfb_auditor", expected_version=initial.version
        )
        replay = service.set_active_target(
            "rfb_auditor", expected_version=saved.version
        )

        assert initial.target_slug == "bacen_economia_financas"
        assert initial.version == 1
        assert saved.target_slug == "rfb_auditor"
        assert saved.version == 2
        assert replay == saved

        connection.execute(
            "UPDATE exam_targets SET active=0 WHERE target_slug='rfb_auditor'"
        )
        repaired = service.get_active_target()
        assert repaired.target_slug == "bacen_economia_financas"
        assert repaired.version == 3
    finally:
        connection.close()

    restarted = connect_database(database_path)
    try:
        MigrationRunner(restarted).migrate()
        persisted = PreferenceService(restarted).get_active_target()
        assert persisted.target_slug == "bacen_economia_financas"
        assert persisted.version == 3
    finally:
        restarted.close()


def test_active_target_rejects_missing_inactive_and_stale_updates(tmp_path: Path):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        MigrationRunner(connection).migrate()
        PlannerProfileService(connection).seed(
            ("rfb_auditor", "bacen_economia_financas")
        )
        connection.execute(
            """
            UPDATE exam_targets SET active=0
            WHERE target_slug='bacen_economia_financas'
            """
        )
        service = PreferenceService(connection)
        current = service.get_active_target()

        with pytest.raises(ActiveTargetNotFoundError, match="does not exist"):
            service.set_active_target("missing", expected_version=current.version)
        with pytest.raises(InactiveTargetError, match="is inactive"):
            service.set_active_target(
                "bacen_economia_financas", expected_version=current.version
            )
        with pytest.raises(PreferenceVersionConflictError, match="has changed"):
            service.set_active_target(
                "rfb_auditor", expected_version=current.version + 1
            )
    finally:
        connection.close()


def test_active_target_requires_at_least_one_active_profile(tmp_path: Path):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        MigrationRunner(connection).migrate()

        with pytest.raises(NoActiveTargetError, match="no active target"):
            PreferenceService(connection).get_active_target()
    finally:
        connection.close()
