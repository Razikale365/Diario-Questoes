from __future__ import annotations

from study_os_service.services.adapters._common import (
    fingerprint,
    iso_date,
    non_negative_order,
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


def adapt_andrety(payload: object) -> StrategyInputBatch:
    value = object_payload(payload)
    strict_fields(
        value,
        {
            "targetSlug",
            "sourceKey",
            "displayName",
            "sourceDate",
            "sourceVersion",
            "notes",
            "externalUrl",
            "externalId",
            "rows",
        },
        "Andrety payload",
    )
    target = required_text(value, "targetSlug")
    source_date = iso_date(value, "sourceDate")
    source_version = required_text(value, "sourceVersion")
    adapted = []
    for item in rows(value, "rows"):
        strict_fields(
            item,
            {
                "order",
                "discipline",
                "topicHint",
                "targetTopicId",
                "advice",
                "metadata",
            },
            "Andrety row",
        )
        order = non_negative_order(item, "order")
        discipline = required_text(item, "discipline")
        topic_hint = required_text(item, "topicHint")
        metadata = item.get("metadata") or {}
        if not isinstance(metadata, dict):
            raise ValueError("metadata must be an object")
        adapted.append(
            StrategyInputRow(
                discipline=discipline,
                topic_hint=topic_hint,
                source_order=order,
                content_role="schedule_advice",
                source_fingerprint=fingerprint(
                    {
                        "sourceVersion": source_version,
                        "order": order,
                        "discipline": discipline,
                        "topicHint": topic_hint,
                    }
                ),
                target_topic_id=optional_id(item, "targetTopicId"),
                provenance=dict(metadata)
                | {
                    "sourceDate": source_date,
                    "sourceVersion": source_version,
                    "advice": optional_text(item, "advice"),
                },
            )
        )
    return StrategyInputBatch(
        source_target_slug=target,
        target_slug=target,
        source_key=required_text(value, "sourceKey"),
        source_kind="andrety",
        display_name=required_text(value, "displayName"),
        trust_tier=6,
        edition=f"{source_version} ({source_date})",
        notes=optional_text(value, "notes"),
        rows=tuple(adapted),
        external_url=value.get("externalUrl"),
        external_id=value.get("externalId"),
    )
