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


def adapt_estrategia_steps(payload: object) -> StrategyInputBatch:
    value = object_payload(payload)
    strict_fields(
        value,
        {
            "sourceTargetSlug",
            "targetSlug",
            "sourceKey",
            "sourceKind",
            "displayName",
            "edition",
            "notes",
            "rootId",
            "materialId",
            "externalUrl",
            "externalId",
            "steps",
        },
        "Estrategia step payload",
    )
    source_kind = required_text(value, "sourceKind")
    if source_kind not in {"passo", "trilha"}:
        raise ValueError("sourceKind must be passo or trilha")
    source_target = required_text(value, "sourceTargetSlug")
    target = required_text(value, "targetSlug")
    adapted = []
    for item in rows(value, "steps"):
        strict_fields(
            item,
            {
                "stepNumber",
                "discipline",
                "topicHint",
                "targetTopicId",
                "revisionEmphasis",
                "lessonId",
                "materialId",
                "externalId",
                "metadata",
            },
            "Estrategia step",
        )
        order = non_negative_order(item, "stepNumber")
        discipline = required_text(item, "discipline")
        topic_hint = required_text(item, "topicHint")
        metadata = item.get("metadata") or {}
        if not isinstance(metadata, dict):
            raise ValueError("metadata must be an object")
        provenance = dict(metadata) | {
            "stepNumber": order,
            "revisionEmphasis": optional_text(item, "revisionEmphasis"),
            "sourceKind": source_kind,
        }
        adapted.append(
            StrategyInputRow(
                discipline=discipline,
                topic_hint=topic_hint,
                source_order=order,
                content_role=(
                    "review_support" if source_kind == "passo" else "schedule_advice"
                ),
                source_fingerprint=fingerprint(
                    {
                        "kind": source_kind,
                        "order": order,
                        "discipline": discipline,
                        "topicHint": topic_hint,
                        "lessonId": item.get("lessonId"),
                        "materialId": item.get("materialId"),
                    }
                ),
                target_topic_id=optional_id(item, "targetTopicId"),
                lesson_id=optional_id(item, "lessonId"),
                material_id=optional_id(item, "materialId"),
                external_id=(
                    optional_text(item, "externalId") or f"step-{order}"
                ),
                provenance=provenance,
            )
        )
    return StrategyInputBatch(
        source_target_slug=source_target,
        target_slug=target,
        source_key=required_text(value, "sourceKey"),
        source_kind=source_kind,
        display_name=required_text(value, "displayName"),
        trust_tier=7 if source_kind == "passo" else 6,
        edition=optional_text(value, "edition"),
        notes=optional_text(value, "notes"),
        rows=tuple(adapted),
        root_id=optional_id(value, "rootId"),
        material_id=optional_id(value, "materialId"),
        external_url=value.get("externalUrl"),
        external_id=value.get("externalId"),
    )
