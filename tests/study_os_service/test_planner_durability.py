from datetime import UTC, date, datetime
from pathlib import Path
import shutil

from study_os_service.db.backup import create_backup
from study_os_service.db.connection import connect_database
from study_os_service.db.migrations import MigrationRunner
from study_os_service.services.planner_generation import PlannerGenerationService
from study_os_service.services.sessions import SessionService
from tests.study_os_service.test_planner_generation import prepare_target


EVIDENCE_TABLES = (
    ("exam_targets", "target_slug"),
    ("target_topics", "id"),
    ("planner_runs", "id"),
    ("planner_candidates", "id"),
    ("planner_blocks", "id"),
    ("progress_states", "id"),
    ("study_sessions", "id"),
)


def snapshot_evidence(connection):
    assert connection.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    return {
        table: [tuple(row) for row in connection.execute(
            f"SELECT * FROM {table} ORDER BY {order_by}"
        ).fetchall()]
        for table, order_by in EVIDENCE_TABLES
    }


def test_planner_adaptation_survives_restart_and_backup_restore(tmp_path: Path):
    database_path = tmp_path / "live" / "study.sqlite3"
    connection = connect_database(database_path)
    MigrationRunner(connection).migrate()
    prepare_target(connection)
    pdf_path = tmp_path / "Aula 01.pdf"
    pdf_path.write_bytes(b"%PDF-1.7\nfixture")
    connection.execute("UPDATE materials SET absolute_path=?", (str(pdf_path),))

    planner = PlannerGenerationService(connection)
    first = planner.generate_day(
        "bacen_economia_financas",
        date(2026, 7, 13),
        idempotency_key="durable-first-day",
        time_budget_minutes=240,
    )
    theory = next(block for block in first.blocks if block.block_kind == "theory")
    questions = [block for block in first.blocks if block.block_kind == "questions"]
    review = next(block for block in first.blocks if block.block_kind == "review")
    candidate = next(item for item in first.candidates if item.id == theory.candidate_id)
    completed_candidate = next(
        item for item in first.candidates if item.id == questions[0].candidate_id
    )
    skipped_candidate = next(
        item for item in first.candidates if item.id == questions[1].candidate_id
    )
    failed_candidate = next(
        item for item in first.candidates if item.id == review.candidate_id
    )

    sessions = SessionService(connection)
    started = sessions.start(
        "bacen_economia_financas",
        candidate.lesson_id,
        candidate.material_id,
        "durable-partial-session",
        planner_block_id=theory.id,
    )
    sessions.finish(
        started.session.id,
        outcome="partial",
        end_page=25,
        elapsed_seconds=1800,
        questions_done=0,
        correct_count=0,
        wrong_count=0,
        doubt_count=0,
        favorite_count=0,
        notes="intervalo",
        expected_version=started.session.version,
    )
    planner.record_block_result(
        questions[0].id,
        state="completed",
        questions_done=20,
        correct_count=18,
        wrong_count=2,
        doubt_count=0,
        favorite_count=0,
        expected_version=questions[0].version,
    )
    planner.record_block_result(
        questions[1].id,
        state="skipped",
        questions_done=0,
        correct_count=0,
        wrong_count=0,
        doubt_count=0,
        favorite_count=0,
        expected_version=questions[1].version,
    )
    planner.record_block_result(
        review.id,
        state="failed",
        questions_done=5,
        correct_count=1,
        wrong_count=4,
        doubt_count=2,
        favorite_count=1,
        expected_version=review.version,
    )
    prior_evidence = snapshot_evidence(connection)

    refreshed = planner.refresh_day(
        first.run.id,
        "bacen_economia_financas",
        date(2026, 7, 13),
        idempotency_key="durable-refreshed-day",
        time_budget_minutes=240,
    )
    old = planner.get_day_by_run(first.run.id)
    assert refreshed.run.supersedes_run_id == first.run.id
    assert [block.state for block in old.blocks] == [
        "pending", "completed", "skipped", "failed"
    ]
    chosen = [
        item for item in refreshed.candidates if item.chosen_position is not None
    ]
    assert any(
        item.block_kind == "theory"
        and item.target_topic_id == candidate.target_topic_id
        for item in chosen
    )
    assert all(
        item.target_topic_id != completed_candidate.target_topic_id
        for item in chosen
    )
    skipped_observations = [
        (
            item.target_topic_id,
            item.block_kind,
            item.evidence["candidateEvidence"].get("skippedBlocks"),
        )
        for item in refreshed.candidates
        if item.target_topic_id == skipped_candidate.target_topic_id
    ]
    assert any(
        item.target_topic_id == skipped_candidate.target_topic_id
        and item.evidence["candidateEvidence"]["skippedBlocks"] == 1
        for item in refreshed.candidates
    ), skipped_observations
    assert any(
        item.target_topic_id == failed_candidate.target_topic_id
        and item.block_kind == "review"
        and item.evidence["candidateEvidence"]["wrongCount"] >= 4
        and item.evidence["candidateEvidence"]["failedSessions"] >= 1
        for item in refreshed.candidates
    )
    after_refresh = snapshot_evidence(connection)
    for table in ("planner_runs", "planner_candidates", "planner_blocks"):
        assert after_refresh[table][:len(prior_evidence[table])] == prior_evidence[table]

    backup_path = create_backup(
        connection,
        tmp_path / "backups",
        datetime(2026, 7, 13, 12, tzinfo=UTC),
    )
    expected = snapshot_evidence(connection)
    connection.close()

    restarted = connect_database(database_path)
    try:
        MigrationRunner(restarted).migrate()
        assert snapshot_evidence(restarted) == expected
        restored_old = PlannerGenerationService(restarted).get_day_by_run(first.run.id)
        progress = restarted.execute(
            "SELECT cursor_page, status FROM progress_states WHERE lesson_id=?",
            (candidate.lesson_id,),
        ).fetchone()
        assert [block.state for block in restored_old.blocks] == [
            "pending", "completed", "skipped", "failed"
        ]
        assert tuple(progress) == (25, "in_progress")
    finally:
        restarted.close()

    restored_path = tmp_path / "restored" / "study.sqlite3"
    restored_path.parent.mkdir(parents=True)
    shutil.copy2(backup_path, restored_path)
    restored = connect_database(restored_path)
    try:
        MigrationRunner(restored).migrate()
        assert snapshot_evidence(restored) == expected
    finally:
        restored.close()
