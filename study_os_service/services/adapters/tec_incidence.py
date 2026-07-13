from __future__ import annotations

from study_os_service.services.adapters._common import (
    fingerprint,
    iso_date,
    object_payload,
    optional_id,
    optional_text,
    required_text,
    rows,
    strict_fields,
)
from study_os_service.services.strategy_ingestion import (
    StrategyInputBatch,
    StrategyInputRow,
)


def _incidence_bp(value: object) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError("incidence must be a number from 0 to 100")
    if value < 0 or value > 100:
        raise ValueError("incidence must be a number from 0 to 100")
    return round(float(value) * 100)


def adapt_tec_incidence(payload: object) -> StrategyInputBatch:
    value = object_payload(payload)
    strict_fields(
        value,
        {
            "targetSlug",
            "sourceKey",
            "displayName",
            "banca",
            "checkedAt",
            "notes",
            "externalUrl",
            "externalId",
            "cadernos",
        },
        "TEC payload",
    )
    target = required_text(value, "targetSlug")
    checked_at = iso_date(value, "checkedAt")
    banca = optional_text(value, "banca")
    adapted = []
    for order, item in enumerate(rows(value, "cadernos")):
        strict_fields(
            item,
            {
                "discipline",
                "topicHint",
                "targetTopicId",
                "incidence",
                "cadernoId",
                "cadernoUrl",
                "metadata",
            },
            "TEC caderno",
        )
        discipline = required_text(item, "discipline")
        topic_hint = required_text(item, "topicHint")
        caderno_id = required_text(item, "cadernoId")
        caderno_url = required_text(item, "cadernoUrl")
        metadata = item.get("metadata") or {}
        if not isinstance(metadata, dict):
            raise ValueError("metadata must be an object")
        adapted.append(
            StrategyInputRow(
                discipline=discipline,
                topic_hint=topic_hint,
                source_order=order,
                content_role="incidence_signal",
                source_fingerprint=fingerprint(
                    {
                        "cadernoId": caderno_id,
                        "discipline": discipline,
                        "topicHint": topic_hint,
                    }
                ),
                target_topic_id=optional_id(item, "targetTopicId"),
                external_url=caderno_url,
                external_id=caderno_id,
                incidence_bp=_incidence_bp(item.get("incidence")),
                banca=banca,
                provenance=dict(metadata)
                | {
                    "aggregateOnly": True,
                    "cadernoId": caderno_id,
                    "checkedAt": checked_at,
                },
            )
        )
    return StrategyInputBatch(
        source_target_slug=target,
        target_slug=target,
        source_key=required_text(value, "sourceKey"),
        source_kind="tec",
        display_name=required_text(value, "displayName"),
        trust_tier=9,
        edition=checked_at,
        notes=optional_text(value, "notes"),
        rows=tuple(adapted),
        external_url=value.get("externalUrl"),
        external_id=value.get("externalId"),
    )
