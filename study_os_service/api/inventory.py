from __future__ import annotations

import asyncio
from datetime import datetime
import json
from pathlib import Path
import sqlite3
from typing import Any

from fastapi import APIRouter, Body, Query, Request
from fastapi.responses import FileResponse, JSONResponse

from study_os_service.db.connection import connect_database
from study_os_service.db.migrations import MigrationRunner
from study_os_service.domain.inventory import CoursePackageChoice
from study_os_service.repositories.inventory import (
    CourseRecord,
    CourseRootRecord,
    ImportRunSummary,
    InventoryRepository,
    LessonRecord,
    RootTargetConflictError,
)
from study_os_service.services.inventory import InventoryService


router = APIRouter()


class InventoryApiError(Exception):
    def __init__(self, status_code: int, code: str, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message


async def inventory_api_error_handler(
    _request: Request, exc: InventoryApiError
) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"code": exc.code, "message": exc.message},
    )


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _course_choice_from_payload(payload: dict[str, Any]) -> CoursePackageChoice:
    if "acquisitionMethod" in payload or "downloadStatus" in payload:
        return CoursePackageChoice.from_dict(payload)
    root_value = payload.get("rootPath")
    if not isinstance(root_value, str) or not root_value.strip():
        return CoursePackageChoice.from_dict(payload)
    root_path = Path(root_value).expanduser().resolve()
    manifest_path = root_path / ".study-os-download.json"
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError(
            "rootPath must contain a valid .study-os-download.json manifest"
        ) from exc
    if not isinstance(manifest, dict):
        raise ValueError("downloader manifest must contain a JSON object")
    expected_count = manifest.get("expectedFileCount")
    observed_count = manifest.get("observedFileCount")
    failed_count = manifest.get("failedItemCount")
    status = (
        "validated"
        if expected_count == observed_count and failed_count == 0
        else "downloaded"
    )
    return CoursePackageChoice.from_dict(
        {
            "targetSlug": payload.get("targetSlug"),
            "provider": payload.get("provider") or "Estrategia Concursos",
            "packageName": manifest.get("packageName"),
            "packageId": manifest.get("packageId"),
            "packageUrl": manifest.get("packageUrl"),
            "editionNote": payload.get("editionNote") or "Fresh downloader acquisition",
            "acquisitionMethod": "estrategia_downloader",
            "rootPath": str(root_path),
            "downloadStatus": status,
            "downloaderName": manifest.get("downloaderName"),
            "downloaderVersion": manifest.get("downloaderVersion"),
            "acquisitionId": manifest.get("acquisitionId"),
            "catalogCheckedAt": manifest.get("catalogCheckedAt"),
            "downloadStartedAt": manifest.get("downloadStartedAt"),
            "downloadedAt": manifest.get("downloadedAt"),
            "acquisitionManifestPath": str(manifest_path),
            "expectedFileCount": expected_count,
            "observedFileCount": observed_count,
            "failedItemCount": failed_count,
        }
    )


def _root_payload(root: CourseRootRecord) -> dict[str, Any]:
    return {
        "id": root.id,
        "targetSlug": root.target_slug,
        "provider": root.provider,
        "packageName": root.package_name,
        "packageId": root.package_id,
        "packageUrl": root.package_url,
        "editionNote": root.edition_note,
        "rootPath": str(root.root_path),
        "sourceKind": root.source_kind,
        "acquisitionMethod": root.acquisition_method,
        "downloadStatus": root.download_status,
        "downloaderName": root.downloader_name,
        "downloaderVersion": root.downloader_version,
        "acquisitionId": root.acquisition_id,
        "catalogCheckedAt": _iso(root.catalog_checked_at),
        "downloadStartedAt": _iso(root.download_started_at),
        "downloadedAt": _iso(root.downloaded_at),
        "acquisitionManifestPath": (
            str(root.acquisition_manifest_path)
            if root.acquisition_manifest_path
            else None
        ),
        "expectedFileCount": root.expected_file_count,
        "observedFileCount": root.observed_file_count,
        "failedItemCount": root.failed_item_count,
        "active": root.active,
        "lastScannedAt": _iso(root.last_scanned_at),
        "createdAt": _iso(root.created_at),
        "updatedAt": _iso(root.updated_at),
    }


def _scan_payload(run: ImportRunSummary) -> dict[str, Any]:
    return {
        "id": run.id,
        "rootId": run.root_id,
        "state": run.state,
        "discoveredCount": run.discovered_count,
        "reconciledCount": run.reconciled_count,
        "issueCount": run.issue_count,
        "startedAt": _iso(run.started_at),
        "completedAt": _iso(run.completed_at),
        "errorMessage": run.error_message,
    }


def _course_payload(
    connection: sqlite3.Connection, course: CourseRecord
) -> dict[str, Any]:
    counts = connection.execute(
        """
        SELECT
          (SELECT COUNT(*) FROM lessons
           WHERE course_id=? AND available=1) AS lesson_count,
          (SELECT COUNT(*) FROM materials
           WHERE course_id=? AND available=1) AS material_count,
          (SELECT COUNT(*) FROM import_issues
           WHERE root_id=? AND state='open'
             AND (relative_path=? OR relative_path LIKE ?)) AS issue_count
        """,
        (
            course.id,
            course.id,
            course.root_id,
            course.relative_path,
            f"{course.relative_path}/%",
        ),
    ).fetchone()
    return {
        "id": course.id,
        "rootId": course.root_id,
        "targetSlug": course.target_slug,
        "displayName": course.display_name,
        "provider": course.provider,
        "relativePath": course.relative_path,
        "active": course.active,
        "scanState": course.scan_state,
        "lastScannedAt": _iso(course.last_scanned_at),
        "lessonCount": counts["lesson_count"],
        "materialCount": counts["material_count"],
        "issueCount": counts["issue_count"],
    }


def _lesson_payload(
    connection: sqlite3.Connection, lesson: LessonRecord
) -> dict[str, Any]:
    discipline = None
    if lesson.discipline_id is not None:
        row = connection.execute(
            "SELECT canonical_name FROM disciplines WHERE id=?",
            (lesson.discipline_id,),
        ).fetchone()
        discipline = row["canonical_name"] if row else None
    material_count = connection.execute(
        "SELECT COUNT(*) FROM materials WHERE lesson_id=? AND available=1",
        (lesson.id,),
    ).fetchone()[0]
    return {
        "id": lesson.id,
        "courseId": lesson.course_id,
        "disciplineId": lesson.discipline_id,
        "disciplineName": discipline,
        "lessonNumber": lesson.lesson_number,
        "title": lesson.title,
        "sequenceIndex": lesson.sequence_index,
        "status": lesson.status,
        "estimatedMinutes": lesson.estimated_minutes,
        "available": lesson.available,
        "mappingSource": lesson.mapping_source,
        "materialCount": material_count,
    }


def _material_payload(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "courseId": row["course_id"],
        "lessonId": row["lesson_id"],
        "relativePath": row["relative_path"],
        "kind": row["kind"],
        "sizeBytes": row["size_bytes"],
        "modifiedAt": row["modified_at"],
        "contentHash": row["content_hash"],
        "pageCount": row["page_count"],
        "pageOffset": row["page_offset"],
        "available": bool(row["available"]),
        "isPrimary": bool(row["is_primary"]),
        "primarySelection": row["primary_selection"],
        "trustLevel": row["trust_level"],
        "fileUrl": f"/api/v1/materials/{row['id']}/file",
    }


def _get_lesson(
    connection: sqlite3.Connection,
    lesson_id: int,
    target_slug: str | None,
) -> LessonRecord | None:
    parameters: list[object] = [lesson_id]
    target_clause = ""
    if target_slug is not None:
        target_clause = " AND roots.target_slug=?"
        parameters.append(target_slug)
    row = connection.execute(
        f"""
        SELECT lessons.*
        FROM lessons
        JOIN courses ON courses.id=lessons.course_id
        JOIN course_roots AS roots ON roots.id=courses.root_id
        WHERE lessons.id=?{target_clause}
        """,
        parameters,
    ).fetchone()
    if row is None:
        return None
    return LessonRecord(
        id=row["id"],
        course_id=row["course_id"],
        discipline_id=row["discipline_id"],
        lesson_number=row["lesson_number"],
        title=row["title"],
        sequence_index=row["sequence_index"],
        status=row["status"],
        estimated_minutes=row["estimated_minutes"],
        available=bool(row["available"]),
        mapping_source=row["mapping_source"],
    )


def _scan_worker(
    database_path: Path,
    root_id: int,
    run_id: int,
    scanner,
) -> None:
    connection = connect_database(database_path)
    try:
        MigrationRunner(connection).migrate()
        repository = InventoryRepository(connection)
        try:
            InventoryService(repository, scanner=scanner).scan_and_reconcile(
                root_id, run_id=run_id
            )
        except Exception as exc:
            repository.fail_import_run(run_id, str(exc))
    finally:
        connection.close()


def _schedule_scan(request: Request, root_id: int, run_id: int) -> None:
    app = request.app
    scanner = app.state.inventory_scanner

    async def run() -> None:
        try:
            await asyncio.to_thread(
                _scan_worker,
                app.state.settings.database_path,
                root_id,
                run_id,
                scanner,
            )
        except Exception as exc:
            InventoryRepository(app.state.connection).fail_import_run(run_id, str(exc))

    task = asyncio.create_task(run())
    app.state.scan_tasks.add(task)
    task.add_done_callback(app.state.scan_tasks.discard)


@router.get("/setup/status")
async def setup_status(request: Request) -> dict[str, int | bool]:
    connection = request.app.state.connection
    configured_roots = connection.execute(
        "SELECT COUNT(*) FROM course_roots"
    ).fetchone()[0]
    active_scans = connection.execute(
        "SELECT COUNT(*) FROM import_runs WHERE state IN ('queued','running')"
    ).fetchone()[0]
    course_count = connection.execute("SELECT COUNT(*) FROM courses").fetchone()[0]
    material_count = connection.execute("SELECT COUNT(*) FROM materials").fetchone()[0]
    return {
        "configuredRoots": configured_roots,
        "activeScans": active_scans,
        "courseCount": course_count,
        "materialCount": material_count,
        "needsPackageSetup": configured_roots == 0,
    }


@router.get("/course-roots")
async def list_course_roots(
    request: Request,
    target_slug: str | None = Query(None, alias="targetSlug"),
    active_only: bool = Query(False, alias="activeOnly"),
) -> dict[str, Any]:
    roots = InventoryRepository(request.app.state.connection).list_roots(
        target_slug=target_slug,
        active_only=active_only,
    )
    return {"total": len(roots), "items": [_root_payload(root) for root in roots]}


@router.post("/course-roots", status_code=201)
async def register_course_root(
    request: Request, payload: dict[str, Any] = Body(...)
) -> dict[str, Any]:
    try:
        choice = await asyncio.to_thread(_course_choice_from_payload, payload)
        repository = InventoryRepository(request.app.state.connection)
        root_id = repository.register_root(choice)
    except RootTargetConflictError as exc:
        raise InventoryApiError(409, "course_root_conflict", str(exc)) from exc
    except (OSError, TypeError, ValueError) as exc:
        raise InventoryApiError(422, "invalid_course_root", str(exc)) from exc
    root = repository.get_root(root_id)
    if root is None:
        raise InventoryApiError(500, "course_root_missing", "Registered course root disappeared")
    return _root_payload(root)


@router.post("/scans", status_code=202)
async def create_scan(
    request: Request, payload: dict[str, Any] = Body(...)
) -> dict[str, Any]:
    root_id = payload.get("rootId")
    if isinstance(root_id, bool) or not isinstance(root_id, int) or root_id < 1:
        raise InventoryApiError(422, "invalid_scan", "rootId must be a positive integer")
    repository = InventoryRepository(request.app.state.connection)
    if repository.get_root(root_id) is None:
        raise InventoryApiError(
            404,
            "course_root_not_found",
            f"Course root {root_id} was not found",
        )
    active = repository.get_active_import_run(root_id)
    if active is not None:
        return _scan_payload(active)
    run_id = repository.create_import_run(root_id)
    run = repository.get_import_run(run_id)
    if run is None:
        raise InventoryApiError(500, "scan_missing", "Queued scan disappeared")
    _schedule_scan(request, root_id, run_id)
    return _scan_payload(run)


@router.get("/scans/{run_id}")
async def get_scan(request: Request, run_id: int) -> dict[str, Any]:
    run = InventoryRepository(request.app.state.connection).get_import_run(run_id)
    if run is None:
        raise InventoryApiError(404, "scan_not_found", f"Scan {run_id} was not found")
    return _scan_payload(run)


@router.get("/courses")
async def list_courses(
    request: Request,
    target_slug: str | None = Query(None, alias="targetSlug"),
    root_id: int | None = Query(None, alias="rootId", ge=1),
    active_only: bool = Query(False, alias="activeOnly"),
) -> dict[str, Any]:
    connection = request.app.state.connection
    courses = InventoryRepository(connection).list_courses(
        target_slug=target_slug,
        root_id=root_id,
        active_only=active_only,
    )
    return {
        "total": len(courses),
        "items": [_course_payload(connection, course) for course in courses],
    }


@router.get("/courses/{course_id}/lessons")
async def list_course_lessons(
    request: Request,
    course_id: int,
    target_slug: str | None = Query(None, alias="targetSlug"),
    limit: int = Query(50, ge=1, le=250),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    connection = request.app.state.connection
    parameters: list[object] = [course_id]
    target_clause = ""
    if target_slug is not None:
        target_clause = " AND roots.target_slug=?"
        parameters.append(target_slug)
    exists = connection.execute(
        f"""
        SELECT courses.id
        FROM courses
        JOIN course_roots AS roots ON roots.id=courses.root_id
        WHERE courses.id=?{target_clause}
        """,
        parameters,
    ).fetchone()
    if exists is None:
        raise InventoryApiError(404, "course_not_found", f"Course {course_id} was not found")
    total = connection.execute(
        "SELECT COUNT(*) FROM lessons WHERE course_id=?", (course_id,)
    ).fetchone()[0]
    page = InventoryRepository(connection).list_lessons(
        course_id, limit=limit, offset=offset
    )
    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "items": [_lesson_payload(connection, lesson) for lesson in page],
    }


@router.get("/lessons/{lesson_id}")
async def get_lesson(
    request: Request,
    lesson_id: int,
    target_slug: str | None = Query(None, alias="targetSlug"),
) -> dict[str, Any]:
    connection = request.app.state.connection
    lesson = _get_lesson(connection, lesson_id, target_slug)
    if lesson is None:
        raise InventoryApiError(404, "lesson_not_found", f"Lesson {lesson_id} was not found")
    materials = connection.execute(
        """
        SELECT * FROM materials
        WHERE lesson_id=?
        ORDER BY is_primary DESC, trust_level DESC, id
        """,
        (lesson_id,),
    ).fetchall()
    return _lesson_payload(connection, lesson) | {
        "materials": [_material_payload(row) for row in materials]
    }


@router.put("/lessons/{lesson_id}/mapping")
async def update_lesson_mapping(
    request: Request,
    lesson_id: int,
    payload: dict[str, Any] = Body(...),
) -> dict[str, Any]:
    target_slug = payload.get("targetSlug")
    discipline_name = payload.get("disciplineName")
    title = payload.get("title")
    if not isinstance(target_slug, str) or not target_slug.strip():
        raise InventoryApiError(422, "invalid_lesson_mapping", "targetSlug is required")
    if not isinstance(discipline_name, str) or not discipline_name.strip():
        raise InventoryApiError(
            422, "invalid_lesson_mapping", "disciplineName is required"
        )
    if not isinstance(title, str) or not title.strip():
        raise InventoryApiError(422, "invalid_lesson_mapping", "title is required")
    connection = request.app.state.connection
    lesson = _get_lesson(connection, lesson_id, target_slug.strip())
    if lesson is None:
        raise InventoryApiError(404, "lesson_not_found", f"Lesson {lesson_id} was not found")
    repository = InventoryRepository(connection)
    connection.execute("BEGIN IMMEDIATE")
    try:
        discipline_id = repository.ensure_discipline(discipline_name)
        connection.execute(
            """
            UPDATE lessons
            SET discipline_id=?, title=?, mapping_source='manual',
                updated_at=CURRENT_TIMESTAMP
            WHERE id=?
            """,
            (discipline_id, title.strip(), lesson_id),
        )
        connection.execute(
            """
            INSERT INTO course_disciplines (
              course_id, discipline_id, display_order, active
            ) VALUES (?, ?, 0, 1)
            ON CONFLICT(course_id, discipline_id)
            DO UPDATE SET active=1
            """,
            (lesson.course_id, discipline_id),
        )
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    updated = _get_lesson(connection, lesson_id, target_slug.strip())
    if updated is None:
        raise InventoryApiError(500, "lesson_missing", "Mapped lesson disappeared")
    return _lesson_payload(connection, updated)


@router.get("/materials/{material_id}/file")
async def get_material_file(
    request: Request,
    material_id: int,
    target_slug: str | None = Query(None, alias="targetSlug"),
) -> FileResponse:
    parameters: list[object] = [material_id]
    target_clause = ""
    if target_slug is not None:
        target_clause = " AND roots.target_slug=?"
        parameters.append(target_slug)
    row = request.app.state.connection.execute(
        f"""
        SELECT materials.*, roots.root_path
        FROM materials
        JOIN courses ON courses.id=materials.course_id
        JOIN course_roots AS roots ON roots.id=courses.root_id
        WHERE materials.id=?{target_clause}
        """,
        parameters,
    ).fetchone()
    if row is None or not bool(row["available"]):
        raise InventoryApiError(
            404, "material_not_found", f"Material {material_id} was not found"
        )
    root_path = Path(row["root_path"]).expanduser().resolve()
    file_path = Path(row["absolute_path"]).expanduser().resolve()
    try:
        file_path.relative_to(root_path)
    except ValueError as exc:
        raise InventoryApiError(
            409,
            "material_path_invalid",
            "Material path is outside its registered course root",
        ) from exc
    if file_path.suffix.casefold() != ".pdf":
        raise InventoryApiError(409, "material_path_invalid", "Material is not a PDF")
    if not file_path.is_file():
        raise InventoryApiError(
            404, "material_file_not_found", "Material file is no longer available"
        )
    return FileResponse(
        file_path,
        media_type="application/pdf",
        filename=file_path.name,
        content_disposition_type="inline",
    )
