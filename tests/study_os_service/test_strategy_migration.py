from pathlib import Path
import sqlite3

import pytest

from study_os_service.db.connection import connect_database
from study_os_service.db.migrations import (
    CURRENT_SCHEMA_VERSION,
    MIGRATIONS,
    MigrationRunner,
)
from study_os_service.services.planner_profiles import PlannerProfileService


STRATEGY_TABLES = {
    "strategy_sources",
    "strategy_source_items",
    "topic_source_mappings",
    "strategy_ingestion_runs",
    "source_choice_runs",
    "source_choice_rows",
}


def install_version_seven(connection: sqlite3.Connection) -> None:
    connection.execute("BEGIN IMMEDIATE")
    connection.execute(
        """
        CREATE TABLE schema_migrations (
          version INTEGER PRIMARY KEY,
          applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    for version, statements in MIGRATIONS:
        if version > 7:
            break
        for statement in statements:
            connection.execute(statement)
        connection.execute(
            "INSERT INTO schema_migrations (version) VALUES (?)", (version,)
        )
    connection.commit()


def table_names(connection: sqlite3.Connection) -> set[str]:
    return {
        row["name"]
        for row in connection.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        )
    }


def test_version_seven_upgrades_to_strategy_schema_without_row_loss(tmp_path: Path):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        install_version_seven(connection)
        PlannerProfileService(connection).seed(("rfb_auditor",))
        topic_count = connection.execute(
            "SELECT COUNT(*) FROM target_topics"
        ).fetchone()[0]
        connection.execute(
            """
            INSERT INTO learning_events (
              idempotency_key, target_slug, topic_target_slug, target_topic_id,
              source_kind, source_id, event_kind, outcome, questions_done,
              correct_count, wrong_count, occurred_at
            ) SELECT 'm6-preserve', target_slug, target_slug, id,
              'legacy_aggregate', 'm6-preserve', 'questions', 'imported',
              10, 7, 3, '2026-07-13T12:00:00+00:00'
            FROM target_topics WHERE target_slug='rfb_auditor' ORDER BY id LIMIT 1
            """
        )
        connection.commit()

        assert MigrationRunner(connection).migrate() == CURRENT_SCHEMA_VERSION
        assert CURRENT_SCHEMA_VERSION == 11
        assert STRATEGY_TABLES <= table_names(connection)
        assert connection.execute(
            "SELECT COUNT(*) FROM target_topics"
        ).fetchone()[0] == topic_count
        assert connection.execute(
            "SELECT COUNT(*) FROM learning_events WHERE idempotency_key='m6-preserve'"
        ).fetchone()[0] == 1
    finally:
        connection.close()


def test_schema_enforces_target_mapping_and_single_chosen_source(tmp_path: Path):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        MigrationRunner(connection).migrate()
        PlannerProfileService(connection).seed(("rfb_auditor", "bacen_economia_financas"))
        topic_id = connection.execute(
            "SELECT id FROM target_topics WHERE target_slug='rfb_auditor' ORDER BY id LIMIT 1"
        ).fetchone()[0]
        source_id = connection.execute(
            """
            INSERT INTO strategy_sources (
              target_slug, source_key, source_kind, display_name, trust_tier
            ) VALUES ('rfb_auditor','course-249654','course','RFB regular',10)
            """
        ).lastrowid
        item_id = connection.execute(
            """
            INSERT INTO strategy_source_items (
              source_id, target_slug, discipline, topic_hint, source_order,
              content_role, incidence_bp, provenance_json, source_fingerprint
            ) VALUES (?, 'rfb_auditor', 'Direito Tributario',
              'Obrigacao tributaria', 1, 'schedule_advice', 8000,
              '{"packageId":"249654"}', 'item-1')
            """,
            (source_id,),
        ).lastrowid
        connection.execute(
            """
            INSERT INTO topic_source_mappings (
              target_slug, target_topic_id, source_item_id, source_target_slug,
              transfer_kind, mapping_status, confidence_bp, primary_eligible
            ) VALUES ('rfb_auditor', ?, ?, 'rfb_auditor',
              'target_specific', 'approved', 9000, 0)
            """,
            (topic_id, item_id),
        )
        run_id = connection.execute(
            """
            INSERT INTO source_choice_runs (
              idempotency_key, target_slug, target_topic_id, block_kind,
              algorithm_version, input_hash
            ) VALUES ('choice-1','rfb_auditor',?,'theory','m6-v1','hash')
            """,
            (topic_id,),
        ).lastrowid
        connection.execute(
            """
            INSERT INTO source_choice_rows (
              run_id, target_slug, source_item_id, target_fit_bp,
              transfer_confidence_bp, trust_bp, freshness_bp,
              order_readiness_bp, strategy_alignment_bp,
              material_availability_bp, low_trust_penalty_bp,
              mismatch_penalty_bp, final_score, chosen, evidence_json
            ) VALUES (?, 'rfb_auditor', ?, 10000, 9000, 10000, 9000,
              8000, 5000, 10000, 0, 0, 61000, 1, '{}')
            """,
            (run_id, item_id),
        )

        connection.execute(
            "UPDATE topic_source_mappings SET primary_eligible=1"
        )
        with pytest.raises(sqlite3.IntegrityError, match="CHECK"):
            connection.execute(
                """
                INSERT INTO topic_source_mappings (
                  target_slug, target_topic_id, source_item_id,
                  source_target_slug, transfer_kind, mapping_status,
                  confidence_bp, primary_eligible
                ) VALUES ('bacen_economia_financas', ?, ?, 'rfb_auditor',
                  'target_specific', 'approved', 9000, 1)
                """,
                (topic_id, item_id),
            )
        with pytest.raises(sqlite3.IntegrityError, match="CHECK"):
            connection.execute(
                "UPDATE topic_source_mappings SET mapping_status='proposed'"
            )
        with pytest.raises(sqlite3.IntegrityError, match="UNIQUE"):
            connection.execute(
                """
                INSERT INTO source_choice_rows (
                  run_id, target_slug, source_item_id, target_fit_bp,
                  transfer_confidence_bp, trust_bp, freshness_bp,
                  order_readiness_bp, strategy_alignment_bp,
                  material_availability_bp, low_trust_penalty_bp,
                  mismatch_penalty_bp, final_score, chosen, evidence_json
                ) VALUES (?, 'rfb_auditor', ?, 1, 1, 1, 1, 1, 1, 1, 0, 0, 7, 1, '{}')
                """,
                (run_id, item_id),
            )
    finally:
        connection.close()


def test_migration_eight_rolls_back_all_strategy_tables(tmp_path: Path):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        install_version_seven(connection)
        connection.executescript(
            """
            CREATE TRIGGER reject_version_eight
            BEFORE INSERT ON schema_migrations
            WHEN NEW.version = 8
            BEGIN
              SELECT RAISE(ABORT, 'migration eight rejected');
            END;
            """
        )

        with pytest.raises(sqlite3.IntegrityError, match="migration eight rejected"):
            MigrationRunner(connection).migrate()

        assert not (STRATEGY_TABLES & table_names(connection))
        assert connection.execute(
            "SELECT MAX(version) FROM schema_migrations"
        ).fetchone()[0] == 7
    finally:
        connection.close()
