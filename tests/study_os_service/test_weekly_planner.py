from collections import Counter
from datetime import UTC, date, datetime
from pathlib import Path

import pytest

from study_os_service.db.connection import connect_database
from study_os_service.db.migrations import MigrationRunner
from study_os_service.services.learning_projection import LearningProjectionService
from study_os_service.services.planner_generation import PlannerGenerationService
from study_os_service.services.weekly_planner import (
    WeeklyIdempotencyConflictError,
    WeeklyPlannerService,
)
from tests.study_os_service.test_planner_generation import prepare_target
from tests.study_os_service.test_source_choice import _add_source, _local_material


def setup_week(connection, target_slug="bacen_economia_financas"):
    prepare_target(connection, target_slug)
    return WeeklyPlannerService(connection)


def test_week_forecast_is_idempotent_balanced_and_explicit_about_pool_exhaustion(
    tmp_path: Path,
):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        MigrationRunner(connection).migrate()
        service = setup_week(connection)
        first = service.generate_week(
            "bacen_economia_financas",
            date(2026, 7, 13),
            idempotency_key="bacen-week-1",
        )
        retry = service.generate_week(
            "bacen_economia_financas",
            date(2026, 7, 13),
            idempotency_key="bacen-week-1",
        )

        assert retry.run.id == first.run.id
        assert first.run.status == "shortfall"
        assert first.run.shortfall_count > 0
        assert len({slot.candidate_key for slot in first.slots}) == len(first.slots)
        assert all(
            {"finalScore", "incidence", "weeklyAlignment"} <= set(slot.score)
            for slot in first.slots
        )
        assert all(first.run.week_start <= slot.scheduled_date <= date(2026, 7, 19) for slot in first.slots)
        for plan_date in {slot.scheduled_date for slot in first.slots}:
            counts = Counter(
                slot.evidence["discipline"]
                for slot in first.slots
                if slot.scheduled_date == plan_date
            )
            assert max(counts.values(), default=0) <= 2
    finally:
        connection.close()


@pytest.mark.parametrize("target_slug", ["bacen_economia_financas", "rfb_auditor"])
def test_no_ls_target_can_forecast_week_without_cross_target_ownership(
    tmp_path: Path, target_slug: str
):
    connection = connect_database(tmp_path / f"{target_slug}.sqlite3")
    try:
        MigrationRunner(connection).migrate()
        week = setup_week(connection, target_slug).generate_week(
            target_slug,
            date(2026, 7, 13),
            idempotency_key=f"{target_slug}-week",
        )

        assert week.slots
        assert all(slot.target_slug == target_slug for slot in week.slots)
        assert all(slot.week_run_id == week.run.id for slot in week.slots)
    finally:
        connection.close()


def test_week_idempotency_rejects_changed_daily_budget(tmp_path: Path):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        MigrationRunner(connection).migrate()
        service = setup_week(connection)
        service.generate_week(
            "bacen_economia_financas",
            date(2026, 7, 13),
            idempotency_key="budgeted-week",
        )

        with pytest.raises(WeeklyIdempotencyConflictError, match="another request"):
            service.generate_week(
                "bacen_economia_financas",
                date(2026, 7, 13),
                idempotency_key="budgeted-week",
                daily_quotas={date(2026, 7, 13): 2},
            )
    finally:
        connection.close()


def test_day_materializes_forecast_slots_without_rewriting_week(tmp_path: Path):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        MigrationRunner(connection).migrate()
        weekly = setup_week(connection)
        week = weekly.generate_week(
            "bacen_economia_financas",
            date(2026, 7, 13),
            idempotency_key="materialized-week",
        )
        before = tuple((slot.id, slot.state, slot.day_run_id) for slot in week.slots)
        day = PlannerGenerationService(connection).generate_day(
            "bacen_economia_financas",
            date(2026, 7, 13),
            idempotency_key="materialized-day",
            time_budget_minutes=240,
        )
        after = weekly.get_week_by_run(week.run.id)
        aligned = [
            candidate
            for candidate in day.candidates
            if candidate.score.weekly_alignment > 0
        ]

        assert aligned
        assert any(candidate.adaptation_reason == "weekly_forecast_follow" for candidate in aligned)
        assert any(slot.state == "materialized" for slot in after.slots)
        assert all(slot.week_run_id == week.run.id for slot in after.slots)
        assert tuple(item[0] for item in before) == tuple(slot.id for slot in after.slots)
    finally:
        connection.close()


def test_fresh_evidence_can_diverge_from_forecast_and_refresh_preserves_old_week(
    tmp_path: Path,
):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        MigrationRunner(connection).migrate()
        weekly = setup_week(connection)
        first = weekly.generate_week(
            "bacen_economia_financas",
            date(2026, 7, 13),
            idempotency_key="before-week-refresh",
        )
        forecast = next(
            slot
            for slot in first.slots
            if slot.block_kind == "questions" and slot.scheduled_date > date(2026, 7, 13)
        )
        LearningProjectionService(connection).append_event(
            idempotency_key="forecast-cooldown",
            target_slug="bacen_economia_financas",
            topic_target_slug=forecast.topic_target_slug,
            target_topic_id=forecast.target_topic_id,
            source_kind="legacy_aggregate",
            source_id="forecast-cooldown",
            event_kind="questions",
            outcome="imported",
            questions_done=20,
            correct_count=18,
            wrong_count=2,
            doubt_count=0,
            favorite_count=0,
            elapsed_seconds=0,
            start_page=None,
            end_page=None,
            occurred_at=datetime(2026, 7, 13, 18, tzinfo=UTC),
            evidence={"importBatchId": "forecast-cooldown"},
        )
        day = PlannerGenerationService(connection).generate_day(
            "bacen_economia_financas",
            forecast.scheduled_date,
            idempotency_key="diverged-day",
            time_budget_minutes=240,
        )
        forecast_candidate = next(
            item for item in day.candidates if item.candidate_key == forecast.candidate_key
        )
        old_snapshot = tuple(
            (slot.id, slot.candidate_key, slot.state, slot.day_run_id)
            for slot in weekly.get_week_by_run(first.run.id).slots
        )
        refreshed = weekly.refresh_week(
            first.run.id,
            "bacen_economia_financas",
            date(2026, 7, 13),
            idempotency_key="after-week-refresh",
        )

        assert forecast_candidate.stop_reason == "adaptive_cooldown"
        assert forecast_candidate.score.weekly_alignment == 10000
        assert any(
            item.chosen_position is not None
            and item.adaptation_reason == "weekly_diverged_current_evidence"
            for item in day.candidates
        )
        assert refreshed.run.supersedes_week_run_id == first.run.id
        assert tuple(
            (slot.id, slot.candidate_key, slot.state, slot.day_run_id)
            for slot in weekly.get_week_by_run(first.run.id).slots
        ) == old_snapshot
    finally:
        connection.close()


def test_week_keeps_old_source_snapshot_when_day_chooses_new_evidence(
    tmp_path: Path,
):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        MigrationRunner(connection).migrate()
        topic_ids = prepare_target(connection, "rfb_auditor")
        _, old_lesson, old_material = _local_material(
            connection,
            target_slug="rfb_auditor",
            label="week-source-old",
        )
        _, new_lesson, new_material = _local_material(
            connection,
            target_slug="rfb_auditor",
            label="week-source-new",
        )
        old_source, _, _ = _add_source(
            connection,
            target_slug="rfb_auditor",
            target_topic_id=topic_ids[0],
            source_key="week-course-old",
            source_kind="course",
            content_role="primary_theory",
            trust_tier=10,
            edition="2026.1",
            lesson_id=old_lesson,
            material_id=old_material,
            primary_eligible=True,
        )
        new_source, _, _ = _add_source(
            connection,
            target_slug="rfb_auditor",
            target_topic_id=topic_ids[0],
            source_key="week-course-new",
            source_kind="course",
            content_role="primary_theory",
            trust_tier=8,
            edition="2026.1",
            lesson_id=new_lesson,
            material_id=new_material,
            primary_eligible=True,
        )
        quotas = {
            date(2026, 7, 13 + offset): 1
            for offset in range(7)
        }
        weekly = WeeklyPlannerService(connection)
        week = weekly.generate_week(
            "rfb_auditor",
            date(2026, 7, 13),
            idempotency_key="source-snapshot-week",
            daily_quotas=quotas,
        )
        forecast = next(slot for slot in week.slots if slot.block_kind == "theory")
        before_choice = forecast.evidence["candidateEvidence"]["sourceChoice"]
        assert before_choice["sourceItemId"]

        connection.execute(
            "UPDATE materials SET available=0 WHERE id=?", (old_material,)
        )
        connection.execute(
            "UPDATE strategy_sources SET trust_tier=10, version=version+1 WHERE id=?",
            (new_source.id,),
        )
        connection.commit()
        day = PlannerGenerationService(connection).generate_day(
            "rfb_auditor",
            forecast.scheduled_date,
            idempotency_key="source-diverged-day",
            time_budget_minutes=60,
        )
        day_choice = next(
            item
            for item in day.candidates
            if item.chosen_position is not None and item.block_kind == "theory"
        )
        after = weekly.get_week_by_run(week.run.id)
        preserved = next(slot for slot in after.slots if slot.id == forecast.id)

        assert day_choice.material_id == new_material
        assert day_choice.adaptation_reason == "weekly_source_diverged"
        assert (
            day_choice.evidence["candidateEvidence"]["sourceChoice"]["choiceRowId"]
            != before_choice["choiceRowId"]
        )
        assert preserved.evidence["candidateEvidence"]["sourceChoice"] == before_choice
        assert old_source.id != new_source.id
    finally:
        connection.close()
