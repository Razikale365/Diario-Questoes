import json
from pathlib import Path

import pytest

from study_os_service.db.connection import connect_database
from study_os_service.db.migrations import MigrationRunner
from study_os_service.domain.cutover import LegacyBrowserBundle
from study_os_service.repositories.cutover import (
    CutoverRepository,
    MigrationReplayConflictError,
)
from study_os_service.services.legacy_migration import LegacyMigrationService
from study_os_service.services.preferences import PreferenceService


FIXTURE = (
    Path(__file__).parent
    / "fixtures"
    / "cutover"
    / "browser_bundle_v1.json"
)


def bundle() -> LegacyBrowserBundle:
    return LegacyBrowserBundle.from_payload(
        json.loads(FIXTURE.read_text(encoding="utf-8"))
    )


def snapshot(connection) -> dict[str, int]:
    tables = (
        "exam_targets",
        "target_topics",
        "strategy_sources",
        "strategy_source_items",
        "strategy_ingestion_runs",
        "learning_events",
        "learning_import_runs",
        "legacy_migration_runs",
        "legacy_id_mappings",
    )
    return {
        table: connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        for table in tables
    }


def test_legacy_bundle_imports_every_safe_stage_and_replays_exactly(tmp_path: Path):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        MigrationRunner(connection).migrate()
        service = LegacyMigrationService(connection)
        value = bundle()

        first = service.import_bundle(
            value,
            migration_key="browser-cutover:a1",
        )
        first_snapshot = snapshot(connection)
        replay = service.import_bundle(
            value,
            migration_key="browser-cutover:a1",
        )

        assert replay == first
        assert snapshot(connection) == first_snapshot
        assert first.run.state == "completed"
        assert first.run.stage == "completed"
        assert first.report == {
            "activeTargetSlug": "rfb_auditor",
            "coverageRowsImported": 1,
            "learningItemsImported": 1,
            "learningItemsRejected": 0,
            "legacyIdsRecorded": 5,
            "lsTasksImported": 1,
            "sourceSignalsImported": 1,
            "strategyRunIds": first.report["strategyRunIds"],
            "targetsImported": 1,
        }
        assert len(first.report["strategyRunIds"]) == 2
        assert first_snapshot["strategy_sources"] == 2
        assert first_snapshot["strategy_source_items"] == 2
        assert first_snapshot["learning_events"] == 1
        assert first_snapshot["legacy_migration_runs"] == 1
        assert first_snapshot["legacy_id_mappings"] == 5
        assert PreferenceService(connection).get_active_target().target_slug == "rfb_auditor"

        profile = connection.execute(
            "SELECT priority_score FROM exam_targets WHERE target_slug='rfb_auditor'"
        ).fetchone()
        topic = connection.execute(
            """
            SELECT coverage_status, edital_weight, incidence, review_debt
            FROM target_topics
            WHERE target_slug='rfb_auditor'
              AND discipline='Direito Tributario'
              AND topic='Credito tributario'
            """
        ).fetchone()
        assert profile["priority_score"] == 88
        assert dict(topic) == {
            "coverage_status": "weak",
            "edital_weight": 2.0,
            "incidence": 78.0,
            "review_debt": 70.0,
        }
    finally:
        connection.close()


def test_legacy_migration_key_rejects_changed_bundle(tmp_path: Path):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        MigrationRunner(connection).migrate()
        service = LegacyMigrationService(connection)
        first = bundle()
        changed_payload = first.to_payload()
        changed_payload["targetProfiles"][0]["priorityScore"] = 89
        changed = LegacyBrowserBundle.from_payload(changed_payload)

        service.import_bundle(first, migration_key="browser-cutover:conflict")
        with pytest.raises(MigrationReplayConflictError, match="different payload"):
            service.import_bundle(
                changed,
                migration_key="browser-cutover:conflict",
            )
    finally:
        connection.close()


def test_failed_strategy_stage_resumes_without_reapplying_profiles(
    tmp_path: Path, monkeypatch
):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        MigrationRunner(connection).migrate()
        value = bundle()
        service = LegacyMigrationService(connection)
        original = LegacyMigrationService._import_strategy

        def fail_strategy(*_args, **_kwargs):
            raise RuntimeError("strategy stage unavailable")

        monkeypatch.setattr(LegacyMigrationService, "_import_strategy", fail_strategy)
        with pytest.raises(RuntimeError, match="strategy stage unavailable"):
            service.import_bundle(value, migration_key="browser-cutover:resume")

        failed = CutoverRepository(connection).get_migration_by_key(
            "browser-cutover:resume"
        )
        assert failed is not None
        assert failed.state == "failed"
        assert failed.stage == "strategy"
        profile_version = connection.execute(
            "SELECT version FROM exam_targets WHERE target_slug='rfb_auditor'"
        ).fetchone()[0]
        topic_version = connection.execute(
            """
            SELECT version FROM target_topics
            WHERE target_slug='rfb_auditor'
              AND discipline='Direito Tributario'
              AND topic='Credito tributario'
            """
        ).fetchone()[0]

        monkeypatch.setattr(LegacyMigrationService, "_import_strategy", original)
        completed = service.import_bundle(
            value,
            migration_key="browser-cutover:resume",
        )

        assert completed.run.state == "completed"
        assert connection.execute(
            "SELECT version FROM exam_targets WHERE target_slug='rfb_auditor'"
        ).fetchone()[0] == profile_version
        assert connection.execute(
            """
            SELECT version FROM target_topics
            WHERE target_slug='rfb_auditor'
              AND discipline='Direito Tributario'
              AND topic='Credito tributario'
            """
        ).fetchone()[0] == topic_version
        assert snapshot(connection)["legacy_id_mappings"] == 5
    finally:
        connection.close()
