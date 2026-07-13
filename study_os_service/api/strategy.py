from __future__ import annotations

from typing import Any, Callable

from fastapi import APIRouter, Body, Header, Query, Request
from fastapi.responses import JSONResponse

from study_os_service.domain.strategy import StrategySource, TopicSourceMapping
from study_os_service.repositories.strategy import StrategyRepository
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
