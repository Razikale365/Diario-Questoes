from __future__ import annotations

import sqlite3
from typing import Any, Callable

from fastapi import APIRouter, Body, Header, Query, Request
from fastapi.responses import JSONResponse

from study_os_service.domain.strategy import StrategySource, TopicSourceMapping
from study_os_service.repositories.strategy import (
    StrategyMappingVersionConflictError,
    StrategyRepository,
    StrategySourceVersionConflictError,
)
from study_os_service.services.adapters.andrety import adapt_andrety
from study_os_service.services.adapters.estrategia_steps import (
    adapt_estrategia_steps,
)
from study_os_service.services.adapters.ls_trilha import adapt_ls_metas
from study_os_service.services.adapters.tec_incidence import adapt_tec_incidence
from study_os_service.services.strategy_ingestion import (
    StrategyIngestionConflictError,
    StrategyIngestionResult,
    StrategyIngestionService,
    StrategyInputBatch,
)
from study_os_service.services.strategy_workbench import (
    StrategyWorkbench,
    StrategyWorkbenchService,
)


router = APIRouter()


class StrategyApiError(Exception):
    def __init__(self, status_code: int, code: str, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message


async def strategy_api_error_handler(
    _request: Request, exc: StrategyApiError
) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"code": exc.code, "message": exc.message},
    )


def _source_payload(source: StrategySource) -> dict[str, Any]:
    return {
        "id": source.id,
        "targetSlug": source.target_slug,
        "sourceKey": source.source_key,
        "sourceKind": source.source_kind,
        "displayName": source.display_name,
        "trustTier": source.trust_tier,
        "rootId": source.root_id,
        "materialId": source.material_id,
        "externalUrl": source.external_url,
        "externalId": source.external_id,
        "edition": source.edition,
        "active": source.active,
        "notes": source.notes,
        "version": source.version,
    }


def _mapping_payload(mapping: TopicSourceMapping) -> dict[str, Any]:
    return {
        "id": mapping.id,
        "targetSlug": mapping.target_slug,
        "targetTopicId": mapping.target_topic_id,
        "sourceItemId": mapping.source_item_id,
        "sourceTargetSlug": mapping.source_target_slug,
        "transferKind": mapping.transfer_kind,
        "mappingStatus": mapping.mapping_status,
        "confidenceBp": mapping.confidence_bp,
        "primaryEligible": mapping.primary_eligible,
        "manualOverride": mapping.manual_override,
        "notes": mapping.notes,
        "version": mapping.version,
    }


def _result_payload(result: StrategyIngestionResult) -> dict[str, Any]:
    return {
        "source": _source_payload(result.source),
        "runId": result.run.id,
        "idempotencyKey": result.run.idempotency_key,
        "algorithmVersion": result.run.algorithm_version,
        "discoveredCount": result.discovered_count,
        "mappedCount": result.mapped_count,
        "unresolvedCount": result.unresolved_count,
        "unresolved": [dict(item) for item in result.unresolved],
    }


def _workbench_payload(workbench: StrategyWorkbench) -> dict[str, Any]:
    root = workbench.package.root
    return {
        "targetSlug": workbench.target_slug,
        "packageStatus": {
            "state": workbench.package.state,
            "rootId": root.id if root else None,
            "packageName": root.package_name if root else None,
            "packageId": root.package_id if root else None,
            "downloadStatus": root.download_status if root else None,
            "manifestPath": (
                str(root.acquisition_manifest_path)
                if root and root.acquisition_manifest_path
                else None
            ),
            "expectedFileCount": root.expected_file_count if root else None,
            "observedFileCount": root.observed_file_count if root else None,
            "failedItemCount": root.failed_item_count if root else None,
            "validated": workbench.package.validated,
        },
        "items": [
            {
                "sourceItemId": row.item.id,
                "sourceId": row.source.id,
                "sourceTargetSlug": row.source.target_slug,
                "sourceKind": row.source.source_kind,
                "sourceDisplayName": row.source.display_name,
                "trustTier": row.source.trust_tier,
                "edition": row.source.edition,
                "sourceVersion": row.source.version,
                "discipline": row.item.discipline,
                "topicHint": row.item.topic_hint,
                "sourceOrder": row.item.source_order,
                "contentRole": row.item.content_role,
                "lessonId": row.item.lesson_id,
                "materialId": row.item.material_id,
                "externalUrl": row.item.external_url,
                "externalId": row.item.external_id,
                "incidenceBp": row.item.incidence_bp,
                "banca": row.item.banca,
                "itemVersion": row.item.version,
                "resolutionState": row.resolution_state,
                "mappings": [
                    {
                        **_mapping_payload(mapping.mapping),
                        "targetDiscipline": mapping.topic.discipline,
                        "targetTopic": mapping.topic.topic,
                    }
                    for mapping in row.mappings
                ],
            }
            for row in workbench.items
        ],
    }


def _ingest(
    request: Request,
    payload: Any,
    idempotency_key: str | None,
    adapter_name: str,
    adapter: Callable[[object], StrategyInputBatch],
) -> dict[str, Any]:
    try:
        if idempotency_key is None or not idempotency_key.strip():
            raise ValueError("Idempotency-Key header is required")
        batch = adapter(payload)
        result = StrategyIngestionService(request.app.state.connection).ingest(
            batch,
            idempotency_key=(
                f"strategy:{adapter_name}:{idempotency_key.strip()}"
            ),
        )
        return _result_payload(result)
    except StrategyIngestionConflictError as exc:
        raise StrategyApiError(
            409, "strategy_ingestion_conflict", str(exc)
        ) from exc
    except KeyError as exc:
        raise StrategyApiError(
            404, "strategy_target_not_found", str(exc).strip("'")
        ) from exc
    except (TypeError, ValueError) as exc:
        raise StrategyApiError(
            422, "invalid_strategy_ingestion", str(exc)
        ) from exc


@router.post("/strategy/ingest/estrategia-steps", status_code=201)
async def ingest_estrategia_steps(
    request: Request,
    payload: Any = Body(...),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> dict[str, Any]:
    return _ingest(
        request,
        payload,
        idempotency_key,
        "estrategia-steps",
        adapt_estrategia_steps,
    )


@router.post("/strategy/ingest/ls", status_code=201)
async def ingest_ls(
    request: Request,
    payload: Any = Body(...),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> dict[str, Any]:
    return _ingest(request, payload, idempotency_key, "ls", adapt_ls_metas)


@router.post("/strategy/ingest/andrety", status_code=201)
async def ingest_andrety(
    request: Request,
    payload: Any = Body(...),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> dict[str, Any]:
    return _ingest(request, payload, idempotency_key, "andrety", adapt_andrety)


@router.post("/strategy/ingest/tec", status_code=201)
async def ingest_tec(
    request: Request,
    payload: Any = Body(...),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> dict[str, Any]:
    return _ingest(request, payload, idempotency_key, "tec", adapt_tec_incidence)


@router.get("/strategy/sources")
async def list_sources(
    request: Request,
    target_slug: str = Query(alias="targetSlug", min_length=1),
) -> dict[str, Any]:
    items = StrategyRepository(request.app.state.connection).list_sources(
        target_slug.strip()
    )
    return {"items": [_source_payload(item) for item in items]}


@router.get("/strategy/mappings")
async def list_mappings(
    request: Request,
    target_slug: str = Query(alias="targetSlug", min_length=1),
    status: str | None = Query(default=None),
) -> dict[str, Any]:
    if status is not None and status not in {"proposed", "approved", "rejected"}:
        raise StrategyApiError(
            422, "invalid_strategy_mapping_status", "invalid mapping status"
        )
    items = StrategyRepository(request.app.state.connection).list_mappings(
        target_slug.strip(), status
    )
    return {"items": [_mapping_payload(item) for item in items]}


@router.get("/strategy/workbench")
async def get_workbench(
    request: Request,
    target_slug: str = Query(alias="targetSlug", min_length=1),
) -> dict[str, Any]:
    try:
        workbench = StrategyWorkbenchService(
            request.app.state.connection
        ).get(target_slug.strip())
    except KeyError as exc:
        raise StrategyApiError(
            404, "strategy_target_not_found", str(exc).strip("'")
        ) from exc
    except ValueError as exc:
        raise StrategyApiError(
            422, "invalid_strategy_workbench", str(exc)
        ) from exc
    return _workbench_payload(workbench)


@router.put("/strategy/source-items/{source_item_id}/mapping")
async def save_source_item_mapping(
    request: Request,
    source_item_id: int,
    payload: dict[str, Any] = Body(...),
) -> dict[str, Any]:
    try:
        mapping = StrategyWorkbenchService(
            request.app.state.connection
        ).save_mapping(
            source_item_id=source_item_id,
            target_slug=payload.get("targetSlug"),
            target_topic_id=payload.get("targetTopicId"),
            expected_version=payload.get("expectedVersion"),
            expected_source_version=payload.get("expectedSourceVersion"),
            source_trust_tier=payload.get("sourceTrustTier"),
            mapping_status=payload.get("mappingStatus"),
            transfer_kind=payload.get("transferKind"),
            confidence_bp=payload.get("confidenceBp"),
            primary_eligible=payload.get("primaryEligible"),
            notes=payload.get("notes"),
        )
    except StrategyMappingVersionConflictError as exc:
        raise StrategyApiError(
            409, "stale_strategy_mapping", str(exc)
        ) from exc
    except StrategySourceVersionConflictError as exc:
        raise StrategyApiError(
            409, "stale_strategy_source", str(exc)
        ) from exc
    except KeyError as exc:
        raise StrategyApiError(
            404, "strategy_mapping_not_found", str(exc).strip("'")
        ) from exc
    except sqlite3.IntegrityError as exc:
        raise StrategyApiError(
            409, "strategy_mapping_conflict", "strategy mapping conflicts with current data"
        ) from exc
    except (TypeError, ValueError) as exc:
        raise StrategyApiError(
            422, "invalid_strategy_mapping", str(exc)
        ) from exc
    return _mapping_payload(mapping)
