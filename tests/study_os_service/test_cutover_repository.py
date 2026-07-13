from pathlib import Path

import pytest

from study_os_service.db.connection import connect_database
from study_os_service.db.migrations import MigrationRunner
from study_os_service.repositories.cutover import (
    CutoverRepository,
    LegacyIdConflictError,
    MigrationReplayConflictError,
    MigrationVersionConflictError,
)


def test_migration_run_replays_resumes_and_completes_with_versions(tmp_path: Path):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        MigrationRunner(connection).migrate()
        repository = CutoverRepository(connection)

        started = repository.begin_migration(
            migration_key="browser:abc",
            schema_name="study-os.browser-migration.v1",
            payload_hash="a" * 64,
        )
        replay = repository.begin_migration(
            migration_key="browser:abc",
            schema_name="study-os.browser-migration.v1",
            payload_hash="a" * 64,
        )

        assert replay == started
        assert started.state == "running"
        assert started.stage == "accepted"
        assert started.version == 1

        failed = repository.fail_migration(
            started.id,
            stage="profiles",
            error_code="profile_import_failed",
            error_message="profile import stopped",
            report={"profilesImported": 1},
            expected_version=started.version,
        )
        assert failed.state == "failed"
        assert failed.report == {"profilesImported": 1}
        resumed = repository.resume_migration(
            failed.id,
            stage="profiles",
            expected_version=failed.version,
        )
        completed = repository.complete_migration(
            resumed.id,
            report={"profilesImported": 2, "tasksImported": 3},
            expected_version=resumed.version,
        )

        assert resumed.state == "running"
        assert completed.state == "completed"
        assert completed.stage == "completed"
        assert completed.completed_at is not None
        assert completed.report == {"profilesImported": 2, "tasksImported": 3}

        with pytest.raises(MigrationReplayConflictError, match="different payload"):
            repository.begin_migration(
                migration_key="browser:abc",
                schema_name="study-os.browser-migration.v1",
                payload_hash="b" * 64,
            )
        with pytest.raises(MigrationVersionConflictError, match="has changed"):
            repository.resume_migration(
                failed.id,
                stage="profiles",
                expected_version=failed.version,
            )
    finally:
        connection.close()


def test_legacy_id_mapping_is_exactly_idempotent(tmp_path: Path):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        MigrationRunner(connection).migrate()
        repository = CutoverRepository(connection)
        run = repository.begin_migration(
            migration_key="browser:ids",
            schema_name="study-os.browser-migration.v1",
            payload_hash="c" * 64,
        )

        first = repository.record_legacy_id(
            migration_run_id=run.id,
            record_kind="ls_task",
            legacy_id="task-29",
            target_type="strategy_source_item",
            target_ref="17",
            metadata={"targetSlug": "sefaz_ce"},
        )
        replay = repository.record_legacy_id(
            migration_run_id=run.id,
            record_kind="ls_task",
            legacy_id="task-29",
            target_type="strategy_source_item",
            target_ref="17",
            metadata={"targetSlug": "sefaz_ce"},
        )
        later_run = repository.begin_migration(
            migration_key="browser:ids-later",
            schema_name="study-os.browser-migration.v1",
            payload_hash="d" * 64,
        )
        later_replay = repository.record_legacy_id(
            migration_run_id=later_run.id,
            record_kind="ls_task",
            legacy_id="task-29",
            target_type="strategy_source_item",
            target_ref="17",
            metadata={"targetSlug": "sefaz_ce"},
        )

        assert replay == first
        assert later_replay == first
        assert repository.get_legacy_id("ls_task", "task-29") == first
        assert repository.count_legacy_ids(run.id) == 1

        with pytest.raises(LegacyIdConflictError, match="already maps"):
            repository.record_legacy_id(
                migration_run_id=run.id,
                record_kind="ls_task",
                legacy_id="task-29",
                target_type="strategy_source_item",
                target_ref="18",
                metadata={"targetSlug": "sefaz_ce"},
            )
    finally:
        connection.close()
