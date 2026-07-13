from __future__ import annotations

from pathlib import Path

import pytest

from study_os_service.db.connection import connect_database
from study_os_service.db.migrations import MigrationRunner
from study_os_service.services.adapters.andrety import adapt_andrety
from study_os_service.services.adapters.estrategia_steps import (
    adapt_estrategia_steps,
)
from study_os_service.services.adapters.ls_trilha import adapt_ls_metas
from study_os_service.services.adapters.tec_incidence import adapt_tec_incidence
from study_os_service.services.planner_profiles import PlannerProfileService
from study_os_service.services.strategy_ingestion import (
    StrategyIngestionConflictError,
    StrategyIngestionService,
)


def _database(tmp_path: Path, *targets: str):
    connection = connect_database(tmp_path / "study.sqlite3")
    MigrationRunner(connection).migrate()
    PlannerProfileService(connection).seed(tuple(targets))
    return connection


def _topic_id(connection, target: str, discipline: str, topic: str) -> int:
    return connection.execute(
        """
        SELECT id FROM target_topics
        WHERE target_slug=? AND discipline=? AND topic=?
        """,
        (target, discipline, topic),
    ).fetchone()[0]


def test_estrategia_steps_retain_order_and_revision_advice(tmp_path: Path):
    connection = _database(tmp_path, "rfb_auditor")
    try:
        credit_id = _topic_id(
            connection, "rfb_auditor", "Direito Tributario", "Credito tributario"
        )
        batch = adapt_estrategia_steps(
            {
                "sourceTargetSlug": "rfb_auditor",
                "targetSlug": "rfb_auditor",
                "sourceKey": "passo-direito-2026",
                "sourceKind": "passo",
                "displayName": "Passo Estrategico Direito Tributario",
                "edition": "2026.2",
                "steps": [
                    {
                        "stepNumber": 2,
                        "discipline": "Direito Tributario",
                        "topicHint": "Credito tributario",
                        "targetTopicId": credit_id,
                        "revisionEmphasis": "questoes erradas",
                        "lessonId": None,
                        "materialId": None,
                    },
                    {
                        "stepNumber": 5,
                        "discipline": "Direito Tributario",
                        "topicHint": "Obrigacao tributaria",
                        "revisionEmphasis": "lei seca",
                    },
                ],
            }
        )

        result = StrategyIngestionService(connection).ingest(
            batch, idempotency_key="passo-import-1"
        )

        assert result.discovered_count == 2
        assert result.mapped_count == 1
        assert result.unresolved_count == 1
        items = connection.execute(
            """
            SELECT source_order, content_role, provenance_json
            FROM strategy_source_items ORDER BY source_order
            """
        ).fetchall()
        assert [row["source_order"] for row in items] == [2, 5]
        assert {row["content_role"] for row in items} == {"review_support"}
        assert "revisionEmphasis" in items[0]["provenance_json"]
        mapping = connection.execute(
            "SELECT mapping_status, primary_eligible FROM topic_source_mappings"
        ).fetchone()
        assert dict(mapping) == {
            "mapping_status": "approved",
            "primary_eligible": 0,
        }
    finally:
        connection.close()


def test_ls_mismatch_stays_proposed_and_preserves_task_link(tmp_path: Path):
    connection = _database(
        tmp_path, "rfb_auditor", "bacen_economia_financas"
    )
    try:
        target_topic_id = _topic_id(
            connection,
            "bacen_economia_financas",
            "Estatistica e Econometria",
            "Inferencia, regressao e series temporais",
        )
        batch = adapt_ls_metas(
            {
                "sourceTargetSlug": "rfb_auditor",
                "targetSlug": "bacen_economia_financas",
                "sourceKey": "ls-rfb-meta-46",
                "displayName": "LS RFB Meta 46",
                "edition": "2026-07-13",
                "metas": [
                    {
                        "taskId": "ls-46-7",
                        "order": 7,
                        "discipline": "Estatistica e Econometria",
                        "topicHint": "Inferencia, regressao e series temporais",
                        "targetTopicId": target_topic_id,
                        "taskKind": "questoes",
                    }
                ],
            }
        )

        result = StrategyIngestionService(connection).ingest(
            batch, idempotency_key="ls-import-1"
        )

        assert result.mapped_count == 0
        assert result.unresolved_count == 1
        mapping = connection.execute(
            """
            SELECT transfer_kind, mapping_status, primary_eligible
            FROM topic_source_mappings
            """
        ).fetchone()
        assert dict(mapping) == {
            "transfer_kind": "shared",
            "mapping_status": "proposed",
            "primary_eligible": 0,
        }
        item = connection.execute(
            "SELECT external_id, provenance_json FROM strategy_source_items"
        ).fetchone()
        assert item["external_id"] == "ls-46-7"
        assert '"taskId":"ls-46-7"' in item["provenance_json"]
    finally:
        connection.close()


def test_andrety_requires_dated_versioned_advice():
    payload = {
        "targetSlug": "rfb_auditor",
        "sourceKey": "andrety-rfb",
        "displayName": "Guia Andrety",
        "rows": [],
    }

    with pytest.raises(ValueError, match="sourceDate"):
        adapt_andrety(payload)

    payload["sourceDate"] = "2026-07-13"
    with pytest.raises(ValueError, match="sourceVersion"):
        adapt_andrety(payload)


@pytest.mark.parametrize(
    "forbidden",
    [
        {"question": "texto pago"},
        {"metadata": {"alternatives": ["A", "B"]}},
        {"metadata": {"nested": {"gabarito": "A"}}},
    ],
)
def test_tec_adapter_fails_closed_on_proprietary_question_fields(forbidden: dict):
    payload = {
        "targetSlug": "rfb_auditor",
        "sourceKey": "tec-rfb-2026",
        "displayName": "TEC incidencia RFB",
        "banca": "FGV",
        "checkedAt": "2026-07-13",
        "cadernos": [
            {
                "discipline": "Direito Tributario",
                "topicHint": "Credito tributario",
                "incidence": 87.5,
                "cadernoId": "tec-123",
                "cadernoUrl": "https://www.tecconcursos.com.br/questoes/cadernos/123",
            }
            | forbidden
        ],
    }

    with pytest.raises(ValueError, match="proprietary|unsupported"):
        adapt_tec_incidence(payload)


def test_tec_aggregate_is_idempotent_and_changed_retry_conflicts(tmp_path: Path):
    connection = _database(tmp_path, "rfb_auditor")
    try:
        topic_id = _topic_id(
            connection, "rfb_auditor", "Direito Tributario", "Credito tributario"
        )
        payload = {
            "targetSlug": "rfb_auditor",
            "sourceKey": "tec-rfb-2026",
            "displayName": "TEC incidencia RFB",
            "banca": "FGV",
            "checkedAt": "2026-07-13",
            "cadernos": [
                {
                    "discipline": "Direito Tributario",
                    "topicHint": "Credito tributario",
                    "targetTopicId": topic_id,
                    "incidence": 87.5,
                    "cadernoId": "tec-123",
                    "cadernoUrl": "https://www.tecconcursos.com.br/questoes/cadernos/123",
                }
            ],
        }
        service = StrategyIngestionService(connection)
        first = service.ingest(
            adapt_tec_incidence(payload), idempotency_key="tec-import-1"
        )
        replay = service.ingest(
            adapt_tec_incidence(payload), idempotency_key="tec-import-1"
        )

        assert replay == first
        item = connection.execute(
            """
            SELECT incidence_bp, content_role, external_id
            FROM strategy_source_items
            """
        ).fetchone()
        assert dict(item) == {
            "incidence_bp": 8750,
            "content_role": "incidence_signal",
            "external_id": "tec-123",
        }
        assert connection.execute(
            "SELECT COUNT(*) FROM strategy_ingestion_runs"
        ).fetchone()[0] == 1

        payload["cadernos"][0]["incidence"] = 92
        with pytest.raises(StrategyIngestionConflictError, match="different payload"):
            service.ingest(
                adapt_tec_incidence(payload), idempotency_key="tec-import-1"
            )
        assert connection.execute(
            "SELECT incidence_bp FROM strategy_source_items"
        ).fetchone()[0] == 8750
    finally:
        connection.close()
