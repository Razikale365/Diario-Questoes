from datetime import UTC, date, datetime
from pathlib import Path

import pytest

from study_os_service.db.connection import connect_database
from study_os_service.db.migrations import MigrationRunner
from study_os_service.domain.sprint_calendar import (
    HorizonAssignmentDraft,
    HorizonDayCapacity,
    HorizonDayDraft,
    HorizonItemDraft,
    SprintHorizonDraft,
)
from study_os_service.repositories.sprint_calendar import (
    CalendarOverrideConflictError,
    CalendarSupersessionConflictError,
    SprintCalendarRepository,
)


NOW = datetime(2026, 7, 15, 8, tzinfo=UTC)


def connection(tmp_path: Path):
    db = connect_database(tmp_path / "study.sqlite3")
    MigrationRunner(db).migrate()
    db.execute(
        """
        INSERT INTO exam_targets (
          target_slug,display_name,institution,role,banca,phase,deadline
        ) VALUES ('sefaz_ce','SEFAZ CE','SEFAZ CE','Auditor','FCC',
                  'pos_edital','2026-08-01')
        """
    )
    return db


def draft(day: date = date(2026, 7, 15)) -> SprintHorizonDraft:
    capacity = HorizonDayCapacity(
        plan_date=day,
        ls_minutes=180,
        extra_minutes=30,
        energy_level=3,
        available=True,
        origin="default",
        confidence_bp=0,
    )
    item = HorizonItemDraft(
        item_key=f"manual:review:{day.isoformat()}",
        origin="manual",
        kind="manual",
        source_plan_task_id=None,
        subject_profile_id=None,
        title="Revisão manual",
        expected_meta_number=None,
    )
    assignment = HorizonAssignmentDraft(
        item_key=item.item_key,
        source_plan_task_id=None,
        kind="manual",
        plan_date=day,
        position=1,
        duration_minutes=60,
        precision="exact",
        priority_tier="high",
        reasons=("manual",),
        pinned=True,
        action=None,
        expected_gain_milli=0,
    )
    return SprintHorizonDraft(
        target_slug="sefaz_ce",
        starts_on=day,
        ends_on=day,
        exact_through=day,
        planning_cutoff=NOW,
        algorithm_version="calendar-v1",
        days=(
            HorizonDayDraft(
                plan_date=day,
                precision="exact",
                capacity=capacity,
                assignments=(assignment,),
            ),
        ),
        items=(item,),
    )


def insert_preview(repo: SprintCalendarRepository, key: str, base=None, day=date(2026, 7, 15)):
    return repo.insert_preview_in_transaction(
        idempotency_key=key,
        request_hash="a" * 64,
        input_hash="b" * 64,
        base_applied_run_id=base,
        draft=draft(day),
        projection_snapshot={"asOf": "2026-07-14"},
        capacity_snapshot={"source": "default"},
    )


def test_preview_round_trip_requires_caller_owned_transaction(tmp_path: Path):
    db = connection(tmp_path)
    try:
        repo = SprintCalendarRepository(db)
        with pytest.raises(RuntimeError, match="active calendar transaction"):
            insert_preview(repo, "preview-1")
        db.execute("BEGIN IMMEDIATE")
        saved = insert_preview(repo, "preview-1")
        db.commit()

        assert repo.get_run_by_idempotency("preview-1")["id"] == saved["id"]
        assert repo.list_days(saved["id"])[0]["reserved_minutes"] == 60
        assert repo.list_items(saved["id"])[0]["item_key"].startswith("manual:")
        assert repo.list_assignments(saved["id"])[0]["priority_tier"] == "high"
        assert repo.get_head("sefaz_ce") is None
    finally:
        db.close()


def test_apply_is_linear_compare_and_swap(tmp_path: Path):
    db = connection(tmp_path)
    try:
        repo = SprintCalendarRepository(db)
        db.execute("BEGIN IMMEDIATE")
        first = insert_preview(repo, "preview-1")
        applied_first = repo.apply_run_in_transaction(first["id"], None)
        db.commit()
        assert applied_first["decision"] == "applied"
        assert repo.get_head("sefaz_ce")["id"] == first["id"]

        db.execute("BEGIN IMMEDIATE")
        second = insert_preview(
            repo,
            "preview-2",
            base=first["id"],
            day=date(2026, 7, 16),
        )
        db.commit()

        db.execute("BEGIN IMMEDIATE")
        with pytest.raises(CalendarSupersessionConflictError, match="head changed"):
            repo.apply_run_in_transaction(second["id"], None)
        db.rollback()

        db.execute("BEGIN IMMEDIATE")
        applied_second = repo.apply_run_in_transaction(second["id"], first["id"])
        db.commit()
        assert applied_second["supersedes_run_id"] == first["id"]
        assert repo.get_head("sefaz_ce")["id"] == second["id"]
        assert repo.get_run(first["id"])["decision"] == "applied"
    finally:
        db.close()


def test_day_and_item_override_compare_and_swap(tmp_path: Path):
    db = connection(tmp_path)
    try:
        repo = SprintCalendarRepository(db)
        db.execute("BEGIN IMMEDIATE")
        run = insert_preview(repo, "preview-1")
        item_id = repo.list_items(run["id"])[0]["id"]
        day_override = repo.upsert_day_override(
            target_slug="sefaz_ce",
            scope_kind="date",
            scope_value="2026-07-15",
            availability="available",
            ls_minutes=200,
            extra_minutes=30,
            energy_level=4,
            expected_version=None,
        )
        item_override = repo.upsert_item_override(
            target_slug="sefaz_ce",
            item_id=item_id,
            plan_date="2026-07-16",
            start_time="08:30",
            position=1,
            duration_minutes=45,
            pinned=True,
            expected_version=None,
        )
        db.commit()
        assert (day_override["version"], item_override["version"]) == (1, 1)

        db.execute("BEGIN IMMEDIATE")
        with pytest.raises(CalendarOverrideConflictError, match="override changed"):
            repo.upsert_day_override(
                target_slug="sefaz_ce",
                scope_kind="date",
                scope_value="2026-07-15",
                availability="available",
                ls_minutes=180,
                extra_minutes=30,
                energy_level=3,
                expected_version=9,
            )
        db.rollback()
    finally:
        db.close()
