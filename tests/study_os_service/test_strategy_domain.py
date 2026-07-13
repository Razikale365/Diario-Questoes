from dataclasses import replace
from datetime import UTC, datetime

import pytest

from study_os_service.domain.strategy import (
    SourceChoiceRow,
    StrategySource,
    StrategySourceItem,
    TopicSourceMapping,
)


NOW = datetime(2026, 7, 13, 12, tzinfo=UTC)


def source_values(**overrides):
    values = {
        "id": 1,
        "target_slug": "rfb_auditor",
        "source_key": "estrategia-249654-regular",
        "source_kind": "course",
        "display_name": "Estrategia RFB regular",
        "trust_tier": 10,
        "root_id": 2,
        "material_id": None,
        "external_url": "https://www.estrategiaconcursos.com.br/app/dashboard/pacote/249654",
        "external_id": "249654",
        "edition": "2026-07 fresh",
        "active": True,
        "notes": "",
        "version": 1,
        "created_at": NOW,
        "updated_at": NOW,
    }
    values.update(overrides)
    return values


def item_values(**overrides):
    values = {
        "id": 10,
        "source_id": 1,
        "target_slug": "rfb_auditor",
        "discipline": "Direito Tributario",
        "topic_hint": "Obrigacao tributaria",
        "source_order": 4,
        "content_role": "primary_theory",
        "lesson_id": 20,
        "material_id": 30,
        "external_url": None,
        "external_id": None,
        "incidence_bp": 8200,
        "banca": "FGV",
        "provenance": {
            "packageId": "249654",
            "lessonNumber": 4,
            "extractorVersion": "m6-v1",
        },
        "source_fingerprint": "course-20-material-30",
        "active": True,
        "version": 1,
        "created_at": NOW,
        "updated_at": NOW,
    }
    values.update(overrides)
    return values


def test_strategy_source_and_item_validate_trust_identity_and_safe_metadata():
    source = StrategySource(**source_values())
    item = StrategySourceItem(**item_values())

    assert source.source_kind == "course"
    assert item.content_role == "primary_theory"
    assert item.provenance["packageId"] == "249654"

    with pytest.raises(ValueError, match="trust tier"):
        StrategySource(**source_values(trust_tier=11))
    with pytest.raises(ValueError, match="source kind"):
        StrategySource(**source_values(source_kind="telegram"))
    with pytest.raises(ValueError, match="proprietary"):
        StrategySourceItem(**item_values(
            provenance={"questionText": "paid question body"}
        ))
    with pytest.raises(ValueError, match="proprietary"):
        StrategySourceItem(**item_values(
            provenance={"nested": {"correctAnswer": "A"}}
        ))


def test_topic_mapping_requires_explicit_transfer_and_approved_primary_source():
    mapping = TopicSourceMapping(
        id=1,
        target_slug="rfb_auditor",
        target_topic_id=7,
        source_item_id=10,
        source_target_slug="rfb_auditor",
        transfer_kind="target_specific",
        mapping_status="approved",
        confidence_bp=9400,
        primary_eligible=True,
        manual_override=False,
        notes="",
        version=1,
        created_at=NOW,
        updated_at=NOW,
    )

    assert mapping.primary_eligible is True
    with pytest.raises(ValueError, match="target-specific"):
        replace(mapping, source_target_slug="bacen_economia_financas")
    with pytest.raises(ValueError, match="approved"):
        replace(mapping, mapping_status="proposed")


def test_source_choice_row_requires_auditable_decision_state():
    chosen = SourceChoiceRow(
        id=1,
        run_id=5,
        target_slug="rfb_auditor",
        source_item_id=10,
        target_fit_bp=10000,
        transfer_confidence_bp=9400,
        trust_bp=10000,
        freshness_bp=9000,
        order_readiness_bp=8000,
        strategy_alignment_bp=6000,
        material_availability_bp=10000,
        low_trust_penalty_bp=0,
        mismatch_penalty_bp=0,
        final_score=62400,
        chosen=True,
        displaced_by_row_id=None,
        stop_reason=None,
        evidence={"algorithmVersion": "m6-source-v1"},
    )
    assert chosen.chosen is True

    with pytest.raises(ValueError, match="displaced"):
        replace(chosen, id=2, chosen=False)
    with pytest.raises(ValueError, match="proprietary"):
        replace(chosen, evidence={"alternatives": ["paid option"]})
