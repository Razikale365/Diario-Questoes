from __future__ import annotations

from study_os_service.services.adapters._common import (
    fingerprint,
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


def adapt_ls_metas(payload: object) -> StrategyInputBatch:
    value = object_payload(payload)
    strict_fields(
        value,
        {
            "sourceTargetSlug",
            "targetSlug",
            "sourceKey",
            "displayName",
            "edition",
            "notes",
            "externalUrl",
            "externalId",
            "metas",
        },
        "LS payload",
    )
    source_target = required_text(value, "sourceTargetSlug")
    target = required_text(value, "targetSlug")
    adapted = []
    for item in rows(value, "metas"):
        strict_fields(
            item,
            {
                "taskId",
                "order",
                "discipline",
                "topicHint",
                "targetTopicId",
                "taskKind",
                "metadata",
            },
            "LS meta",
        )
        task_id = required_text(item, "taskId")
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
                    {"taskId": task_id, "sourceKey": value.get("sourceKey")}
                ),
                target_topic_id=optional_id(item, "targetTopicId"),
                external_id=task_id,
                provenance=dict(metadata)
                | {
                    "taskId": task_id,
                    "taskKind": optional_text(item, "taskKind"),
                    "sourceTargetSlug": source_target,
                },
            )
        )
    return StrategyInputBatch(
        source_target_slug=source_target,
        target_slug=target,
        source_key=required_text(value, "sourceKey"),
        source_kind="ls",
        display_name=required_text(value, "displayName"),
        trust_tier=6,
        edition=optional_text(value, "edition"),
        notes=optional_text(value, "notes"),
        rows=tuple(adapted),
        external_url=value.get("externalUrl"),
        external_id=value.get("externalId"),
    )
