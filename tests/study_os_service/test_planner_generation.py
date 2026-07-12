from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path
from threading import Barrier

import pytest

from study_os_service.db.connection import connect_database
from study_os_service.db.migrations import MigrationRunner
from study_os_service.services.planner_generation import (
    PlannerGenerationService,
    PlannerIdempotencyConflictError,
)
from study_os_service.services.planner_profiles import PlannerProfileService


def seed_material(connection, target_slug: str) -> tuple[int, int]:
    root_id = connection.execute(
        """
        INSERT INTO course_roots (
          target_slug, provider, package_name, package_url, edition_note,
          root_path, source_kind, acquisition_method, download_status,
          catalog_checked_at
        ) VALUES (?, 'Estrategia Concursos', 'Fixture executavel',
          'https://www.estrategiaconcursos.com.br/', 'fixture', ?,
          'course_package', 'estrategia_downloader', 'validated',
          '2026-07-12T12:00:00+00:00')
        """,
        (target_slug, f"C:/fixture/{target_slug}"),
    ).lastrowid
    course_id = connection.execute(
        """
        INSERT INTO courses (
          root_id, display_name, provider, relative_path, active, scan_state
        ) VALUES (?, 'Curso principal', 'Estrategia Concursos',
                  'Curso principal', 1, 'available')
        """,
        (root_id,),
    ).lastrowid
    lesson_id = connection.execute(
        """
        INSERT INTO lessons (
          course_id, lesson_number, title, sequence_index, status, available
        ) VALUES (?, 1, 'Aula 01', 0, 'unread', 1)
        """,
        (course_id,),
    ).lastrowid
    material_id = connection.execute(
        """
        INSERT INTO materials (
          course_id, lesson_id, absolute_path, relative_path,
          normalized_relative_path, kind, size_bytes, modified_at,
          page_count, available, is_primary, primary_selection, trust_level
        ) VALUES (?, ?, ?, 'PDF/Aula 01.pdf', 'pdf/aula 01.pdf',
                  'original', 1024, '1', 100, 1, 1, 'automatic', 10)
        """,
        (
            course_id,
            lesson_id,
            f"C:/fixture/{target_slug}/PDF/Aula 01.pdf",
        ),
    ).lastrowid
    return lesson_id, material_id


def prepare_target(connection, target_slug="bacen_economia_financas"):
    PlannerProfileService(connection).seed((target_slug,))
    lesson_id, material_id = seed_material(connection, target_slug)
    topics = connection.execute(
        "SELECT id FROM target_topics WHERE target_slug=? ORDER BY id",
        (target_slug,),
    ).fetchall()
    connection.execute(
        """
        UPDATE target_topics SET coverage_status='weak', review_debt=70
        WHERE target_slug=?
        """,
        (target_slug,),
    )
    connection.execute(
        """
        UPDATE target_topics SET lesson_id=?, material_id=? WHERE id=?
        """,
        (lesson_id, material_id, topics[0]["id"]),
    )
    return tuple(row["id"] for row in topics)


@pytest.fixture
def planner_connection(tmp_path: Path):
    connection = connect_database(tmp_path / "study.sqlite3")
    MigrationRunner(connection).migrate()
    try:
        yield connection
    finally:
        connection.close()


@pytest.mark.parametrize(
    "target_slug", ["bacen_economia_financas", "rfb_auditor"]
)
def test_no_ls_target_generates_full_mixed_balanced_day(
    planner_connection, target_slug
):
    prepare_target(planner_connection, target_slug)
    service = PlannerGenerationService(planner_connection)

    day = service.generate_day(
        target_slug,
        date(2026, 7, 13),
        idempotency_key=f"{target_slug}-day-2026-07-13",
        time_budget_minutes=240,
    )
    retry = service.generate_day(
        target_slug,
        date(2026, 7, 13),
        idempotency_key=f"{target_slug}-day-2026-07-13",
        time_budget_minutes=240,
    )

    assert retry.run.id == day.run.id
    assert day.run.status == "generated"
    assert day.run.shortfall_count == 0
    assert [block.block_kind for block in day.blocks] == [
        "theory",
        "questions",
        "questions",
        "review",
    ]
    assert all(block.target_slug == target_slug for block in day.blocks)
    disciplines = Counter(
        candidate.discipline
        for candidate in day.candidates
        if candidate.chosen_position is not None
    )
    assert max(disciplines.values()) <= 2
    assert all(candidate.score.ls_alignment == 0 for candidate in day.candidates)


def test_short_pool_returns_real_blocks_and_explicit_missing_slots(
    planner_connection,
):
    PlannerProfileService(planner_connection).seed(("rfb_analista",))
    service = PlannerGenerationService(planner_connection)

    day = service.generate_day(
        "rfb_analista",
        date(2026, 7, 13),
        idempotency_key="rfb-shortfall",
        time_budget_minutes=240,
    )

    assert day.run.status == "shortfall"
    assert day.run.shortfall_count == 2
    assert len(day.run.shortfall_reasons) == 2
    assert any("theory" in reason for reason in day.run.shortfall_reasons)
    assert any("review" in reason for reason in day.run.shortfall_reasons)
    assert [block.block_kind for block in day.blocks] == ["questions", "questions"]
    assert any(
        candidate.stop_reason == "material_unmapped"
        for candidate in day.candidates
    )
    assert any(
        candidate.stop_reason == "review_evidence_missing"
        for candidate in day.candidates
    )


def test_balance_uses_lower_scored_disciplines_before_a_third_same_subject(
    planner_connection,
):
    topic_ids = prepare_target(planner_connection)
    planner_connection.execute(
        "UPDATE target_topics SET discipline='Economia' WHERE id IN (?, ?, ?, ?)",
        topic_ids[:4],
    )
    service = PlannerGenerationService(planner_connection)

    day = service.generate_day(
        "bacen_economia_financas",
        date(2026, 7, 14),
        idempotency_key="balanced-day",
        time_budget_minutes=240,
    )
    chosen = [
        candidate
        for candidate in day.candidates
        if candidate.chosen_position is not None
    ]

    assert Counter(item.discipline for item in chosen)["Economia"] == 2
    assert len({item.discipline for item in chosen}) >= 3


def test_idempotency_key_cannot_be_reused_for_another_request(planner_connection):
    prepare_target(planner_connection)
    service = PlannerGenerationService(planner_connection)
    service.generate_day(
        "bacen_economia_financas",
        date(2026, 7, 13),
        idempotency_key="same-key",
        time_budget_minutes=240,
    )

    with pytest.raises(PlannerIdempotencyConflictError, match="another request"):
        service.generate_day(
            "bacen_economia_financas",
            date(2026, 7, 14),
            idempotency_key="same-key",
            time_budget_minutes=240,
        )


def test_scoreboard_persists_every_component_and_displaced_alternative(
    planner_connection,
):
    prepare_target(planner_connection)
    service = PlannerGenerationService(planner_connection)
    day = service.generate_day(
        "bacen_economia_financas",
        date(2026, 7, 13),
        idempotency_key="scoreboard-day",
        time_budget_minutes=240,
    )

    scoreboard = service.get_scoreboard(day.run.id)
    assert len(scoreboard) == 18
    assert all(candidate.target_slug == day.run.target_slug for candidate in scoreboard)
    assert all(isinstance(candidate.score.final_score, int) for candidate in scoreboard)
    assert any(candidate.chosen_position == 1 for candidate in scoreboard)
    assert any(
        candidate.displaced_by_candidate_key is not None
        for candidate in scoreboard
        if candidate.stop_reason is None and candidate.chosen_position is None
    )


def test_refresh_uses_results_and_preserves_the_superseded_run(planner_connection):
    prepare_target(planner_connection)
    service = PlannerGenerationService(planner_connection)
    first = service.generate_day(
        "bacen_economia_financas",
        date(2026, 7, 13),
        idempotency_key="before-refresh",
        time_budget_minutes=240,
    )
    theory = next(block for block in first.blocks if block.block_kind == "theory")
    questions = [block for block in first.blocks if block.block_kind == "questions"]
    review = next(block for block in first.blocks if block.block_kind == "review")
    completed = service.record_block_result(
        questions[0].id,
        state="completed",
        questions_done=20,
        correct_count=18,
        wrong_count=2,
        doubt_count=0,
        favorite_count=0,
        expected_version=questions[0].version,
    )
    service.record_block_result(
        questions[1].id,
        state="skipped",
        questions_done=0,
        correct_count=0,
        wrong_count=0,
        doubt_count=0,
        favorite_count=0,
        expected_version=questions[1].version,
    )
    service.record_block_result(
        review.id,
        state="failed",
        questions_done=5,
        correct_count=1,
        wrong_count=4,
        doubt_count=2,
        favorite_count=1,
        expected_version=review.version,
    )

    refreshed = service.refresh_day(
        first.run.id,
        "bacen_economia_financas",
        date(2026, 7, 14),
        idempotency_key="after-refresh",
        time_budget_minutes=240,
    )
    old = service.get_day_by_run(first.run.id)
    completed_candidate = next(
        candidate for candidate in old.candidates if candidate.id == completed.candidate_id
    )

    assert refreshed.run.supersedes_run_id == first.run.id
    assert all(
        candidate.target_topic_id != completed_candidate.target_topic_id
        for candidate in refreshed.candidates
        if candidate.chosen_position is not None
    )
    assert next(block for block in old.blocks if block.id == theory.id).state == "pending"
    assert next(block for block in old.blocks if block.id == questions[0].id).state == "completed"
    assert next(block for block in old.blocks if block.id == questions[1].id).state == "skipped"
    assert next(block for block in old.blocks if block.id == review.id).state == "failed"
    assert any(
        candidate.block_kind == "review"
        and candidate.score.review_debt > 0
        and candidate.chosen_position is not None
        for candidate in refreshed.candidates
    )


def test_concurrent_generation_with_one_key_returns_one_persisted_run(tmp_path: Path):
    database_path = tmp_path / "study.sqlite3"
    setup = connect_database(database_path)
    try:
        MigrationRunner(setup).migrate()
        prepare_target(setup)
    finally:
        setup.close()

    barrier = Barrier(2)

    def generate() -> int:
        connection = connect_database(database_path)
        try:
            barrier.wait(timeout=5)
            return PlannerGenerationService(connection).generate_day(
                "bacen_economia_financas",
                date(2026, 7, 15),
                idempotency_key="concurrent-day",
                time_budget_minutes=240,
            ).run.id
        finally:
            connection.close()

    with ThreadPoolExecutor(max_workers=2) as executor:
        run_ids = list(executor.map(lambda _index: generate(), range(2)))

    verification = connect_database(database_path)
    try:
        persisted_count = verification.execute(
            "SELECT COUNT(*) FROM planner_runs WHERE idempotency_key='concurrent-day'"
        ).fetchone()[0]
    finally:
        verification.close()

    assert run_ids[0] == run_ids[1]
    assert persisted_count == 1
