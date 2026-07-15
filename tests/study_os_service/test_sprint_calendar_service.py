from datetime import UTC, datetime
from pathlib import Path

import pytest

from study_os_service.db.connection import connect_database
from study_os_service.db.migrations import MigrationRunner
from study_os_service.repositories.sprint_calendar import (
    CalendarOverrideConflictError,
    CalendarSupersessionConflictError,
)
from study_os_service.services.sprint import SourcePlanService, SprintProfileService
from study_os_service.services.sprint_calendar import SprintCalendarService


NOW = datetime(2026, 7, 15, 12, tzinfo=UTC)


def connection(tmp_path: Path):
    database = connect_database(tmp_path / "study.sqlite3")
    MigrationRunner(database).migrate()
    database.execute(
        """
        INSERT INTO exam_targets (
          target_slug,display_name,institution,role,banca,phase,deadline
        ) VALUES ('sefaz_ce','SEFAZ CE','SEFAZ CE','Auditor','FCC',
                  'pos_edital','2026-08-01')
        """
    )
    database.commit()
    SprintProfileService(database).bootstrap("sefaz_ce")
    return database


def import_cycle(
    database,
    *,
    meta: int,
    released_at: str,
    starts_on: str,
    ends_on: str,
    external_id: str,
    scheduled_date: str,
):
    return SourcePlanService(database).import_tasks(
        {
            "targetSlug": "sefaz_ce",
            "sourceKind": "ls",
            "planLabel": f"Meta {meta}",
            "metaNumber": meta,
            "cycle": {
                "releasedAt": released_at,
                "startsOn": starts_on,
                "endsOn": ends_on,
            },
            "tasks": [
                {
                    "externalTaskId": external_id,
                    "scheduledDate": scheduled_date,
                    "sourceOrder": 1,
                    "discipline": "Legis. Tribut. Estadual (ICMS)",
                    "topicHint": f"Conteudo da Meta {meta}",
                    "taskKind": "questions",
                    "description": f"Resolver tarefa {meta}",
                    "estimatedMinutes": 60,
                    "relevance": 10,
                    "status": "pending",
                }
            ],
        },
        idempotency_key=f"import-meta-{meta}-{external_id}",
    )


def payload(expected_run_id=None, mode="reflow_open", restore_run_id=None):
    document = {
        "targetSlug": "sefaz_ce",
        "startDate": "2026-07-15",
        "endDate": "2026-07-20",
        "expectedRunId": expected_run_id,
        "mode": mode,
    }
    if restore_run_id is not None:
        document["restoreRunId"] = restore_run_id
    return document


def seeded_service(database, *, now=NOW):
    import_cycle(
        database,
        meta=47,
        released_at="2026-07-11T11:00:00Z",
        starts_on="2026-07-11",
        ends_on="2026-07-17",
        external_id="meta-47-lte",
        scheduled_date="2026-07-15",
    )
    return SprintCalendarService(database, clock=lambda: now)


def test_preview_is_draft_and_replay_is_exact(tmp_path: Path):
    database = connection(tmp_path)
    try:
        service = seeded_service(database)
        first = service.preview(payload(), idempotency_key="preview-1")
        replay = service.preview(payload(), idempotency_key="preview-1")

        assert first["run"]["decision"] == "draft"
        assert first["replayed"] is False
        assert replay == first | {"replayed": True}
        assert service.get_head("sefaz_ce") is None
        placeholders = [
            item for item in first["items"] if item["kind"] == "future_cycle_capacity"
        ]
        assert placeholders
        assert all(item["sourcePlanTaskId"] is None for item in placeholders)
        placeholder_ids = {item["id"] for item in placeholders}
        assert all(
            assignment["action"] is None
            for assignment in first["assignments"]
            if assignment["itemId"] in placeholder_ids
        )
    finally:
        database.close()


def test_new_ls_meta_changes_only_a_new_preview(tmp_path: Path):
    database = connection(tmp_path)
    try:
        service = seeded_service(database)
        first = service.preview(payload(), idempotency_key="before-meta")
        applied = service.apply(
            first["run"]["id"],
            {"expectedRunId": None, "expectedOverrideVersions": {}},
            idempotency_key="apply-before-meta",
        )
        applied_id = applied["run"]["id"]

        import_cycle(
            database,
            meta=48,
            released_at="2026-07-15T11:30:00Z",
            starts_on="2026-07-18",
            ends_on="2026-07-20",
            external_id="meta-48-lte",
            scheduled_date="2026-07-18",
        )
        assert service.get_head("sefaz_ce")["run"]["id"] == applied_id

        refreshed = service.preview(
            payload(applied_id), idempotency_key="after-meta"
        )
        assert refreshed["diff"]["placeholderReplacements"] > 0
        assert any(
            item["sourcePlanTaskId"] is not None
            and item["expectedMetaNumber"] == 48
            for item in refreshed["items"]
        )
        assert service.get_head("sefaz_ce")["run"]["id"] == applied_id
    finally:
        database.close()


def test_preview_rejects_a_stale_expected_head(tmp_path: Path):
    database = connection(tmp_path)
    try:
        service = seeded_service(database)
        first = service.preview(payload(), idempotency_key="preview-first")
        service.apply(
            first["run"]["id"],
            {"expectedRunId": None, "expectedOverrideVersions": {}},
            idempotency_key="apply-first",
        )

        with pytest.raises(CalendarSupersessionConflictError, match="head changed"):
            service.preview(payload(None), idempotency_key="stale-preview")
    finally:
        database.close()


def test_future_released_cycle_is_not_exact_before_the_frozen_cutoff(tmp_path: Path):
    database = connection(tmp_path)
    try:
        service = seeded_service(database)
        import_cycle(
            database,
            meta=48,
            released_at="2026-07-17T11:00:00Z",
            starts_on="2026-07-18",
            ends_on="2026-07-20",
            external_id="future-meta-48-lte",
            scheduled_date="2026-07-18",
        )
        preview = service.preview(payload(), idempotency_key="frozen-cutoff")

        assert preview["run"]["planningCutoff"] == "2026-07-15T12:00:00.000000Z"
        assert any(day["precision"] == "provisional" for day in preview["days"])
        assert not any(
            item["expectedMetaNumber"] == 48
            and item["kind"] == "source_task"
            for item in preview["items"]
        )
    finally:
        database.close()


def test_undo_is_a_new_restore_preview_not_history_mutation(tmp_path: Path):
    database = connection(tmp_path)
    try:
        service = seeded_service(database)
        old_preview = service.preview(payload(), idempotency_key="old-preview")
        old = service.apply(
            old_preview["run"]["id"],
            {"expectedRunId": None, "expectedOverrideVersions": {}},
            idempotency_key="old-apply",
        )
        current_preview = service.preview(
            payload(old["run"]["id"]), idempotency_key="current-preview"
        )
        current = service.apply(
            current_preview["run"]["id"],
            {
                "expectedRunId": old["run"]["id"],
                "expectedOverrideVersions": {},
            },
            idempotency_key="current-apply",
        )

        restored = service.preview(
            payload(
                current["run"]["id"],
                mode="restore_run",
                restore_run_id=old["run"]["id"],
            ),
            idempotency_key="restore-preview",
        )

        assert restored["run"]["decision"] == "draft"
        assert restored["run"]["baseAppliedRunId"] == current["run"]["id"]
        assert service.get_run(old["run"]["id"])["run"]["decision"] == "applied"
    finally:
        database.close()


def test_day_override_is_versioned_and_stales_an_older_preview(tmp_path: Path):
    database = connection(tmp_path)
    try:
        service = seeded_service(database)
        preview = service.preview(payload(), idempotency_key="before-override")
        override = service.update_day_override(
            {
                "targetSlug": "sefaz_ce",
                "scopeKind": "date",
                "scopeValue": "2026-07-16",
                "availability": "available",
                "lsMinutes": 180,
                "extraMinutes": 30,
                "energyLevel": 4,
                "expectedVersion": None,
            }
        )
        assert override["version"] == 1

        with pytest.raises(CalendarOverrideConflictError, match="override"):
            service.apply(
                preview["run"]["id"],
                {"expectedRunId": None, "expectedOverrideVersions": {}},
                idempotency_key="stale-override-apply",
            )

        refreshed = service.preview(payload(), idempotency_key="after-override")
        day = next(row for row in refreshed["days"] if row["date"] == "2026-07-16")
        assert (day["lsMinutes"], day["extraMinutes"], day["energyLevel"]) == (
            180,
            30,
            4,
        )
        assert day["availabilitySource"] == "manual_date"
    finally:
        database.close()


def test_manual_item_is_pinned_into_the_next_preview(tmp_path: Path):
    database = connection(tmp_path)
    try:
        service = seeded_service(database)
        created = service.create_manual_item(
            {
                "targetSlug": "sefaz_ce",
                "title": "Revisar erros da LS",
                "planDate": "2026-07-16",
                "startTime": "08:30",
                "durationMinutes": 35,
            },
            idempotency_key="manual-review",
        )
        assert created["item"]["kind"] == "manual"
        assert created["override"]["pinned"] is True

        preview = service.preview(payload(), idempotency_key="with-manual")
        item = next(
            row for row in preview["items"] if row["title"] == "Revisar erros da LS"
        )
        assignment = next(
            row for row in preview["assignments"] if row["itemId"] == item["id"]
        )
        assert assignment["date"] == "2026-07-16"
        assert assignment["durationMinutes"] == 35
        assert assignment["precision"] == "protected"
        assert assignment["pinned"] is True
    finally:
        database.close()
