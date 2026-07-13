from __future__ import annotations

from datetime import UTC, date, datetime
import hashlib
import json
from pathlib import Path
import shutil

from study_os_service.db.backup import create_backup
from study_os_service.db.connection import connect_database
from study_os_service.db.migrations import MigrationRunner
from study_os_service.services.adapters.ls_trilha import adapt_ls_metas
from study_os_service.services.planner_generation import PlannerGenerationService
from study_os_service.services.strategy_ingestion import StrategyIngestionService
from study_os_service.services.weekly_planner import WeeklyPlannerService
from tests.study_os_service.test_planner_generation import prepare_target
from tests.study_os_service.test_source_choice import _add_source, _local_material


TABLES = (
    "strategy_sources",
    "strategy_source_items",
    "topic_source_mappings",
    "strategy_ingestion_runs",
    "source_choice_runs",
    "source_choice_rows",
    "planner_week_runs",
    "planner_week_slots",
    "planner_runs",
    "planner_candidates",
    "planner_blocks",
)


def _snapshot(connection) -> dict[str, str]:
    result = {}
    for table in TABLES:
        rows = [
            dict(row)
            for row in connection.execute(
                f"SELECT * FROM {table} ORDER BY rowid"
            )
        ]
        canonical = json.dumps(
            rows, ensure_ascii=True, sort_keys=True, separators=(",", ":")
        )
        result[table] = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    return result


def _seed_source_aware_plan(connection):
    topic_ids = prepare_target(connection, "rfb_auditor")
    _, lesson_id, material_id = _local_material(
        connection,
        target_slug="rfb_auditor",
        label="durable-current-course",
    )
    _add_source(
        connection,
        target_slug="rfb_auditor",
        target_topic_id=topic_ids[0],
        source_key="durable-course",
        source_kind="course",
        content_role="primary_theory",
        trust_tier=10,
        edition="2026.2",
        lesson_id=lesson_id,
        material_id=material_id,
        primary_eligible=True,
    )
    _add_source(
        connection,
        target_slug="rfb_auditor",
        target_topic_id=topic_ids[0],
        source_key="durable-passo",
        source_kind="passo",
        content_role="review_support",
        trust_tier=7,
        edition="2026.2",
        lesson_id=lesson_id,
        material_id=material_id,
    )
    for index, topic_id in enumerate(topic_ids[:3]):
        _add_source(
            connection,
            target_slug="rfb_auditor",
            target_topic_id=topic_id,
            source_key=f"durable-tec-{index}",
            source_kind="tec",
            content_role="incidence_signal",
            trust_tier=9,
            edition="2026-07-13",
            external_url=(
                f"https://www.tecconcursos.com.br/questoes/cadernos/{index + 1}"
            ),
            incidence_bp=9000 - index * 500,
        )
    ls_batch = adapt_ls_metas(
        {
            "sourceTargetSlug": "rfb_auditor",
            "targetSlug": "rfb_auditor",
            "sourceKey": "durable-ls-meta",
            "displayName": "LS RFB durable baseline",
            "edition": "2026-07-13",
            "metas": [
                {
                    "taskId": "ls-durable-1",
                    "order": 1,
                    "discipline": connection.execute(
                        "SELECT discipline FROM target_topics WHERE id=?",
                        (topic_ids[0],),
                    ).fetchone()[0],
                    "topicHint": connection.execute(
                        "SELECT topic FROM target_topics WHERE id=?",
                        (topic_ids[0],),
                    ).fetchone()[0],
                    "targetTopicId": topic_ids[0],
                    "taskKind": "revisao",
                }
            ],
        }
    )
    ingestion = StrategyIngestionService(connection).ingest(
        ls_batch, idempotency_key="durable-ls-import"
    )
    week = WeeklyPlannerService(connection).generate_week(
        "rfb_auditor",
        date(2026, 7, 13),
        idempotency_key="durable-source-week",
    )
    day = PlannerGenerationService(connection).generate_day(
        "rfb_auditor",
        date(2026, 7, 13),
        idempotency_key="durable-source-day",
        time_budget_minutes=240,
    )
    return ls_batch, ingestion, week, day


def test_strategy_plan_survives_restart_replay_and_backup_restore(tmp_path: Path):
    database_path = tmp_path / "source" / "study.sqlite3"
    database_path.parent.mkdir()
    connection = connect_database(database_path)
    MigrationRunner(connection).migrate()
    ls_batch, ingestion, week, day = _seed_source_aware_plan(connection)

    assert ingestion.mapped_count == 1
    assert week.slots
    assert [block.block_kind for block in day.blocks] == [
        "theory",
        "questions",
        "questions",
        "review",
    ]
    assert all(
        candidate.evidence["candidateEvidence"]["sourceChoice"]
        for candidate in day.candidates
        if candidate.chosen_position is not None
    )
    expected = _snapshot(connection)
    backup_path = create_backup(
        connection,
        tmp_path / "backups",
        datetime(2026, 7, 13, 14, 30, tzinfo=UTC),
    )
    connection.close()

    restarted = connect_database(database_path)
    try:
        MigrationRunner(restarted).migrate()
        replay = StrategyIngestionService(restarted).ingest(
            ls_batch, idempotency_key="durable-ls-import"
        )
        assert replay == ingestion
        assert _snapshot(restarted) == expected
    finally:
        restarted.close()

    restored_path = tmp_path / "restored" / "study.sqlite3"
    restored_path.parent.mkdir()
    shutil.copy2(backup_path, restored_path)
    restored = connect_database(restored_path)
    try:
        MigrationRunner(restored).migrate()
        assert restored.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert _snapshot(restored) == expected
    finally:
        restored.close()
