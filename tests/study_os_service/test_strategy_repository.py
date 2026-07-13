from pathlib import Path

import pytest

from study_os_service.db.connection import connect_database
from study_os_service.db.migrations import MigrationRunner
from study_os_service.repositories.strategy import StrategyRepository
from study_os_service.services.planner_profiles import PlannerProfileService


def test_repository_round_trips_sources_items_mappings_and_choice_rows(tmp_path: Path):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        MigrationRunner(connection).migrate()
        PlannerProfileService(connection).seed(("rfb_auditor",))
        topic_id = connection.execute(
            "SELECT id FROM target_topics WHERE target_slug='rfb_auditor' ORDER BY id LIMIT 1"
        ).fetchone()[0]
        repository = StrategyRepository(connection)
        source = repository.create_source(
            target_slug="rfb_auditor",
            source_key="manual-guide-2026",
            source_kind="andrety",
            display_name="Guia Andrety",
            trust_tier=6,
            root_id=None,
            material_id=None,
            external_url=None,
            external_id="andrety-2026",
            edition="2026",
            notes="",
        )
        item = repository.insert_source_item(
            source_id=source.id,
            target_slug=source.target_slug,
            discipline="Direito Tributario",
            topic_hint="Obrigacao tributaria",
            source_order=1,
            content_role="schedule_advice",
            lesson_id=None,
            material_id=None,
            external_url=None,
            external_id="andrety-row-1",
            incidence_bp=0,
            banca="",
            provenance={"sourceDate": "2026-07-13", "importBatchId": "batch-1"},
            source_fingerprint="andrety-row-1",
        )
        mapping = repository.insert_mapping(
            target_slug="rfb_auditor",
            target_topic_id=topic_id,
            source_item_id=item.id,
            source_target_slug=item.target_slug,
            transfer_kind="target_specific",
            mapping_status="proposed",
            confidence_bp=7200,
            primary_eligible=False,
            manual_override=False,
            notes="",
        )
        run = repository.insert_choice_run(
            idempotency_key="choice-run-1",
            target_slug="rfb_auditor",
            target_topic_id=topic_id,
            block_kind="theory",
            algorithm_version="m6-source-v1",
            input_hash="input-hash",
            status="chosen",
            shortfall_reason=None,
        )
        chosen = repository.insert_choice_row(
            run_id=run.id,
            target_slug=run.target_slug,
            source_item_id=item.id,
            target_fit_bp=10000,
            transfer_confidence_bp=7200,
            trust_bp=6000,
            freshness_bp=9000,
            order_readiness_bp=10000,
            strategy_alignment_bp=8000,
            material_availability_bp=0,
            low_trust_penalty_bp=1000,
            mismatch_penalty_bp=0,
            final_score=49200,
            chosen=True,
            displaced_by_row_id=None,
            stop_reason=None,
            evidence={"algorithmVersion": "m6-source-v1"},
        )
        connection.commit()

        assert repository.get_source(source.id) == source
        assert repository.list_sources("rfb_auditor") == (source,)
        assert repository.list_source_items(source.id) == (item,)
        assert repository.list_mappings("rfb_auditor") == (mapping,)
        assert repository.get_choice_run_by_key("choice-run-1") == run
        assert repository.list_choice_rows(run.id) == (chosen,)
    finally:
        connection.close()


def test_repository_rejects_proprietary_metadata_before_writing(tmp_path: Path):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        MigrationRunner(connection).migrate()
        PlannerProfileService(connection).seed(("rfb_auditor",))
        repository = StrategyRepository(connection)
        source = repository.create_source(
            target_slug="rfb_auditor",
            source_key="tec-source",
            source_kind="tec",
            display_name="TEC incidence",
            trust_tier=8,
            root_id=None,
            material_id=None,
            external_url="https://www.tecconcursos.com.br/questoes/cadernos",
            external_id="tec",
            edition="2026",
            notes="",
        )

        with pytest.raises(ValueError, match="proprietary"):
            repository.insert_source_item(
                source_id=source.id,
                target_slug=source.target_slug,
                discipline="Direito Tributario",
                topic_hint="Obrigacao tributaria",
                source_order=1,
                content_role="incidence_signal",
                lesson_id=None,
                material_id=None,
                external_url=None,
                external_id="tec-row-1",
                incidence_bp=8000,
                banca="FGV",
                provenance={"statement": "paid question"},
                source_fingerprint="tec-row-1",
            )

        assert repository.list_source_items(source.id) == ()
    finally:
        connection.close()
