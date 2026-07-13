from __future__ import annotations

from datetime import UTC, date, datetime
import hashlib
import json
from pathlib import Path
import sqlite3
import zipfile

from fastapi.testclient import TestClient
from pypdf import PdfWriter

from study_os_service.app import create_app
from study_os_service.config import StudyOsSettings
from study_os_service.db.connection import connect_database
from study_os_service.db.migrations import CURRENT_SCHEMA_VERSION, MigrationRunner
from study_os_service.db.portable import create_portable_archive, restore_portable_archive
from study_os_service.domain.cutover import LegacyBrowserBundle
from study_os_service.services.legacy_migration import LegacyMigrationService
from study_os_service.services.planner_generation import PlannerGenerationService
from study_os_service.services.sessions import SessionService
from study_os_service.services.weekly_planner import WeeklyPlannerService
from tests.study_os_service.test_planner_generation import prepare_target


FIXTURE = (
    Path(__file__).parent
    / "fixtures"
    / "cutover"
    / "browser_bundle_v1.json"
)
TARGET = "bacen_economia_financas"
FORBIDDEN_MARKERS = (
    "do-not-export-paid-question-content",
    "questiontext",
    "correctanswer",
    "alternatives",
    "credentials",
    "password",
    "senha",
    "accesstoken",
    "refreshtoken",
)


def _settings(tmp_path: Path, database_path: Path) -> StudyOsSettings:
    return StudyOsSettings(
        repo_root=tmp_path,
        data_dir=database_path.parent,
        database_path=database_path,
        backup_dir=database_path.parent / "backups",
    )


def _write_pdf(path: Path, pages: int = 12) -> None:
    writer = PdfWriter()
    for _ in range(pages):
        writer.add_blank_page(width=612, height=792)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as handle:
        writer.write(handle)


def _table_hashes(connection: sqlite3.Connection) -> dict[str, str]:
    assert connection.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    tables = [
        row["name"]
        for row in connection.execute(
            """
            SELECT name FROM sqlite_master
            WHERE type='table' AND name NOT LIKE 'sqlite_%'
            ORDER BY name
            """
        )
    ]
    result: dict[str, str] = {}
    for table in tables:
        rows = [
            dict(row)
            for row in connection.execute(
                f'SELECT * FROM "{table}" ORDER BY rowid'
            )
        ]
        canonical = json.dumps(
            rows,
            ensure_ascii=True,
            sort_keys=True,
            separators=(",", ":"),
        )
        result[table] = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    return result


def _assert_metadata_only(value: object) -> None:
    if isinstance(value, bytes):
        canonical = value.decode("latin-1", errors="ignore").casefold()
    elif isinstance(value, str):
        canonical = value.casefold()
    else:
        canonical = json.dumps(
            value,
            ensure_ascii=True,
            sort_keys=True,
            default=str,
        ).casefold()
    for marker in FORBIDDEN_MARKERS:
        assert marker not in canonical


def _progress_and_session(
    connection: sqlite3.Connection,
    lesson_id: int,
    material_id: int,
    session_id: int,
) -> tuple[tuple, tuple]:
    progress = tuple(
        connection.execute(
            """
            SELECT cursor_page, furthest_page, status, total_seconds,
                   session_count, version
            FROM progress_states WHERE lesson_id=? AND material_id=?
            """,
            (lesson_id, material_id),
        ).fetchone()
    )
    session = tuple(
        connection.execute(
            """
            SELECT state, outcome, start_page, end_page,
                   elapsed_seconds, version
            FROM study_sessions WHERE id=?
            """,
            (session_id,),
        ).fetchone()
    )
    return progress, session


def test_cutover_replay_execution_and_portable_restore_are_exact(
    tmp_path: Path,
    caplog,
):
    database_path = tmp_path / "live" / "study-os.sqlite3"
    archive_path = tmp_path / "exports" / "study-os-portable.zip"
    bundle_payload = json.loads(FIXTURE.read_text(encoding="utf-8"))
    bundle = LegacyBrowserBundle.from_payload(bundle_payload)
    migration_key = f"browser:{bundle.migration_id}"

    connection = connect_database(database_path)
    MigrationRunner(connection).migrate()
    first_import = LegacyMigrationService(connection).import_bundle(
        bundle,
        migration_key=migration_key,
    )
    first_hashes = _table_hashes(connection)
    first_report = first_import.report
    connection.close()

    restarted = connect_database(database_path)
    MigrationRunner(restarted).migrate()
    replay = LegacyMigrationService(restarted).import_bundle(
        bundle,
        migration_key=migration_key,
    )
    assert replay == first_import
    assert replay.report == first_report
    assert _table_hashes(restarted) == first_hashes

    topic_ids = prepare_target(restarted, TARGET)
    mapped_topic = restarted.execute(
        """
        SELECT lesson_id, material_id FROM target_topics
        WHERE id=?
        """,
        (topic_ids[0],),
    ).fetchone()
    pdf_path = tmp_path / "course" / "Aula 01.pdf"
    _write_pdf(pdf_path)
    restarted.execute(
        """
        UPDATE materials
        SET absolute_path=?, page_count=12, size_bytes=?
        WHERE id=?
        """,
        (str(pdf_path), pdf_path.stat().st_size, mapped_topic["material_id"]),
    )

    week = WeeklyPlannerService(restarted).generate_week(
        TARGET,
        date(2026, 7, 13),
        idempotency_key="cutover-week",
    )
    planner = PlannerGenerationService(restarted)
    day = planner.generate_day(
        TARGET,
        date(2026, 7, 13),
        idempotency_key="cutover-day",
        time_budget_minutes=240,
    )
    assert week.slots
    assert day.run.shortfall_count == 0
    assert [block.block_kind for block in day.blocks] == [
        "theory",
        "questions",
        "questions",
        "review",
    ]
    assert all(candidate.score.ls_alignment == 0 for candidate in day.candidates)

    theory = next(block for block in day.blocks if block.block_kind == "theory")
    theory_candidate = next(
        candidate for candidate in day.candidates if candidate.id == theory.candidate_id
    )
    assert theory_candidate.lesson_id == mapped_topic["lesson_id"]
    assert theory_candidate.material_id == mapped_topic["material_id"]
    started = SessionService(restarted).start(
        TARGET,
        theory_candidate.lesson_id,
        theory_candidate.material_id,
        "cutover-real-pdf-session",
        planner_block_id=theory.id,
    )
    SessionService(restarted).finish(
        started.session.id,
        outcome="completed",
        end_page=12,
        elapsed_seconds=2700,
        questions_done=0,
        correct_count=0,
        wrong_count=0,
        doubt_count=0,
        favorite_count=0,
        notes="regular PDF completed",
        expected_version=started.session.version,
    )

    question_blocks = [
        block for block in day.blocks if block.block_kind == "questions"
    ]
    tec_candidate = next(
        candidate
        for candidate in day.candidates
        if candidate.id == question_blocks[0].candidate_id
    )
    assert tec_candidate.source_kind == "tec"
    assert tec_candidate.lesson_id is None
    assert tec_candidate.material_id is None
    for index, block in enumerate(question_blocks):
        done = block.planned_questions
        planner.record_block_result(
            block.id,
            state="completed",
            questions_done=done,
            correct_count=done - 2 - index,
            wrong_count=2 + index,
            doubt_count=index,
            favorite_count=0,
            expected_version=block.version,
        )

    review = next(block for block in day.blocks if block.block_kind == "review")
    assert 5 <= review.planned_questions <= 10
    planner.record_block_result(
        review.id,
        state="completed",
        questions_done=review.planned_questions,
        correct_count=review.planned_questions - 1,
        wrong_count=1,
        doubt_count=0,
        favorite_count=0,
        expected_version=review.version,
    )
    refreshed = planner.refresh_day(
        day.run.id,
        TARGET,
        date(2026, 7, 14),
        idempotency_key="cutover-next-day",
        time_budget_minutes=240,
    )
    assert refreshed.run.supersedes_run_id == day.run.id
    assert refreshed.run.plan_date == date(2026, 7, 14)

    progress, session = _progress_and_session(
        restarted,
        theory_candidate.lesson_id,
        theory_candidate.material_id,
        started.session.id,
    )
    assert progress == (12, 12, "covered", 2700, 1, 3)
    assert session == ("finished", "completed", 1, 12, 2700, 2)
    expected_hashes = _table_hashes(restarted)
    archive = create_portable_archive(
        restarted,
        archive_path,
        CURRENT_SCHEMA_VERSION,
        now=datetime(2026, 7, 13, 20, 0, tzinfo=UTC),
    )
    restarted.close()

    with TestClient(create_app(_settings(tmp_path, database_path))) as client:
        day_response = client.get(
            "/api/v1/planner/day",
            params={"targetSlug": TARGET, "date": "2026-07-14"},
        )
        scoreboard_response = client.get(
            "/api/v1/planner/scoreboard",
            params={"runId": refreshed.run.id},
        )
        cutover_response = client.get("/api/v1/cutover/status")
    assert day_response.status_code == 200
    assert scoreboard_response.status_code == 200
    assert cutover_response.status_code == 200

    restored_path = tmp_path / "restored" / "study-os.sqlite3"
    restore_portable_archive(
        archive.archive_path,
        restored_path,
        tmp_path / "restored" / "backups",
        now=datetime(2026, 7, 13, 20, 5, tzinfo=UTC),
    )
    restored = connect_database(restored_path)
    try:
        assert _table_hashes(restored) == expected_hashes
        assert _progress_and_session(
            restored,
            theory_candidate.lesson_id,
            theory_candidate.material_id,
            started.session.id,
        ) == (progress, session)
        database_dump = "\n".join(restored.iterdump())
    finally:
        restored.close()

    with zipfile.ZipFile(archive.archive_path, "r") as portable:
        assert portable.namelist() == ["manifest.json", "study-os.sqlite3"]
        archive_database = portable.read("study-os.sqlite3")

    _assert_metadata_only(bundle_payload)
    _assert_metadata_only(first_report)
    _assert_metadata_only(day_response.json())
    _assert_metadata_only(scoreboard_response.json())
    _assert_metadata_only(cutover_response.json())
    _assert_metadata_only(database_dump)
    _assert_metadata_only(archive_database)
    _assert_metadata_only(caplog.text)
