from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Body, Header, Request
from fastapi.responses import JSONResponse

from study_os_service.domain.cutover import LegacyBrowserBundle
from study_os_service.repositories.cutover import (
    CutoverRepository,
    LegacyIdConflictError,
    MigrationReplayConflictError,
    MigrationRunRecord,
    MigrationVersionConflictError,
)
from study_os_service.services.legacy_migration import LegacyMigrationService
from study_os_service.services.preferences import (
    ActiveTargetNotFoundError,
    ActiveTargetPreference,
    InactiveTargetError,
    NoActiveTargetError,
    PreferenceService,
    PreferenceVersionConflictError,
)


router = APIRouter()


class CutoverApiError(Exception):
    def __init__(self, status_code: int, code: str, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message


async def cutover_api_error_handler(
    _request: Request, exc: CutoverApiError
) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"code": exc.code, "message": exc.message},
    )


def _iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _preference_payload(value: ActiveTargetPreference) -> dict[str, Any]:
    return {
        "targetSlug": value.target_slug,
        "version": value.version,
        "updatedAt": _iso(value.updated_at),
    }


def _migration_payload(value: MigrationRunRecord) -> dict[str, Any]:
    return {
        "id": value.id,
        "migrationKey": value.migration_key,
        "schema": value.schema_name,
        "payloadHash": value.payload_hash,
        "state": value.state,
        "stage": value.stage,
        "version": value.version,
        "createdAt": _iso(value.created_at),
        "updatedAt": _iso(value.updated_at),
        "completedAt": _iso(value.completed_at),
    }


def _migration_key(value: str | None) -> str:
    if value is None or not value.strip():
        raise CutoverApiError(
            422,
            "missing_idempotency_key",
            "Idempotency-Key header is required",
        )
    normalized = value.strip()
    if len(normalized) > 200 or any(ord(character) < 32 for character in normalized):
        raise CutoverApiError(
            422,
            "invalid_idempotency_key",
            "Idempotency-Key must contain at most 200 printable characters",
        )
    return normalized


@router.get("/cutover/status")
async def cutover_status(request: Request) -> dict[str, Any]:
    repository = CutoverRepository(request.app.state.connection)
    try:
        preference = PreferenceService(
            request.app.state.connection
        ).get_active_target()
    except NoActiveTargetError:
        preference = None
    return {
        "schemaVersion": request.app.state.schema_version,
        "ownership": "sqlite",
        "activeTarget": (
            _preference_payload(preference) if preference is not None else None
        ),
        "migrations": [
            _migration_payload(item) for item in repository.list_migrations()
        ],
        "legacyMappingCount": repository.count_all_legacy_ids(),
    }


@router.put("/preferences/active-target")
async def update_active_target(
    request: Request,
    payload: Any = Body(...),
) -> dict[str, Any]:
    if not isinstance(payload, dict) or set(payload) != {"targetSlug", "version"}:
        raise CutoverApiError(
            422,
            "invalid_active_target_preference",
            "body must contain exactly targetSlug and version",
        )
    target_slug = payload.get("targetSlug")
    version = payload.get("version")
    if not isinstance(target_slug, str) or not target_slug.strip():
        raise CutoverApiError(
            422,
            "invalid_active_target_preference",
            "targetSlug must be a non-empty string",
        )
    if isinstance(version, bool) or not isinstance(version, int) or version < 1:
        raise CutoverApiError(
            422,
            "invalid_active_target_preference",
            "version must be a positive integer",
        )
    try:
        preference = PreferenceService(
            request.app.state.connection
        ).set_active_target(target_slug, expected_version=version)
    except ActiveTargetNotFoundError as exc:
        raise CutoverApiError(
            404,
            "active_target_not_found",
            f"target profile {target_slug.strip()} does not exist",
        ) from exc
    except InactiveTargetError as exc:
        raise CutoverApiError(409, "inactive_active_target", str(exc)) from exc
    except PreferenceVersionConflictError as exc:
        raise CutoverApiError(409, "stale_active_target", str(exc)) from exc
    except NoActiveTargetError as exc:
        raise CutoverApiError(409, "no_active_target", str(exc)) from exc
    except ValueError as exc:
        raise CutoverApiError(
            422, "invalid_active_target_preference", str(exc)
        ) from exc
    return _preference_payload(preference)


@router.post("/cutover/browser-migration", status_code=201)
async def migrate_browser_state(
    request: Request,
    payload: Any = Body(...),
    idempotency_key: str | None = Header(
        default=None,
        alias="Idempotency-Key",
    ),
) -> dict[str, Any]:
    key = _migration_key(idempotency_key)
    if not isinstance(payload, dict):
        raise CutoverApiError(
            422,
            "invalid_browser_migration",
            "browser migration body must be an object",
        )
    try:
        bundle = LegacyBrowserBundle.from_payload(payload)
        result = LegacyMigrationService(
            request.app.state.connection
        ).import_bundle(bundle, migration_key=key)
    except (TypeError, ValueError) as exc:
        raise CutoverApiError(
            422, "invalid_browser_migration", str(exc)
        ) from exc
    except MigrationReplayConflictError as exc:
        raise CutoverApiError(
            409,
            "migration_replay_conflict",
            "idempotency key already belongs to a different migration payload",
        ) from exc
    except LegacyIdConflictError as exc:
        raise CutoverApiError(
            409,
            "legacy_mapping_conflict",
            "legacy metadata already maps to a different Study OS record",
        ) from exc
    except MigrationVersionConflictError as exc:
        raise CutoverApiError(
            409,
            "migration_state_conflict",
            "browser migration state changed; refresh status and retry",
        ) from exc
    return {
        "migration": _migration_payload(result.run),
        "report": result.report,
    }
