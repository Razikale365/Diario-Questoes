from pathlib import Path
import sqlite3

import pytest

from study_os_service.db.connection import connect_database
from study_os_service.db.migrations import CURRENT_SCHEMA_VERSION, MIGRATIONS, MigrationRunner


EVIDENCE_TABLES = {
    "sprint_evidence_import_batches",
    "sprint_performance_observations",
    "source_plan_cycles",
    "source_plan_backlog_candidates",
}


def _install_version_ten(connection: sqlite3.Connection) -> None:
    connection.execute("BEGIN IMMEDIATE")
    connection.execute(
        """
        CREATE TABLE schema_migrations (
          version INTEGER PRIMARY KEY,
          applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    for version, statements in MIGRATIONS:
        if version > 10:
            break
        for statement in statements:
            connection.execute(statement)
        connection.execute("INSERT INTO schema_migrations (version) VALUES (?)", (version,))
    connection.commit()


def _seed_target(connection: sqlite3.Connection, slug: str = "sefaz_ce") -> None:
    connection.execute(
        """
        INSERT INTO exam_targets (
          target_slug, display_name, institution, role, banca, phase,
          deadline, daily_quota, priority_score, source_urls_json
        ) VALUES (?, ?, 'SEFAZ CE', 'Auditor Fiscal', 'FCC', 'pos_edital',
                  '2026-08-01', 4, 100, '["https://example.test/edital"]')
        """,
        (slug, slug),
    )


def _seed_config(connection: sqlite3.Connection, slug: str, *, p1_high: int = 52, p2_high: int = 67) -> None:
    connection.execute(
        """
        INSERT INTO exam_sprint_configs (
          target_slug, start_date, objective_date, exam_end_date,
          ls_budget_minutes, extra_budget_minutes, p1_floor_questions,
          p1_goal_low, p1_goal_high, p2_goal_low, p2_goal_high,
          discursive_goal_low, discursive_goal_high, triage_mode, state
        ) VALUES (?, '2026-07-13', '2026-08-01', '2026-08-02',
                  240, 60, 48, 48, ?, 63, ?, 75, 82, 'suggest_only', 'active')
        """,
        (slug, p1_high, p2_high),
    )


def _insert_batch(
    connection: sqlite3.Connection,
    *,
    batch_id: str,
    target_slug: str,
    origin: str = "ls",
) -> None:
    connection.execute(
        """
        INSERT INTO sprint_evidence_import_batches (
          batch_id, target_slug, origin, payload_hash, item_count,
          inserted_count, duplicate_count, conflict_count, report_json
        ) VALUES (?, ?, ?, ?, 1, 1, 0, 0, '{}')
        """,
        (batch_id, target_slug, origin, "a" * 64),
    )


def _insert_observation(
    connection: sqlite3.Connection,
    *,
    batch_id: str,
    target_slug: str,
    origin: str = "ls",
    source_updated_at: str = "2026-07-14T12:34:56.123456Z",
) -> None:
    connection.execute(
        """
        INSERT INTO sprint_performance_observations (
          target_slug, batch_id, discipline, observed_on, origin,
          source_record_id, source_revision, source_updated_at,
          measurement_type, percentage_bp, content_hash
        ) VALUES (?, ?, 'Economia', '2026-07-14', ?, 'record-1', 'revision-1', ?,
                  'ls_percentage', 8000, ?)
        """,
        (target_slug, batch_id, origin, source_updated_at, "b" * 64),
    )


def _insert_cycle(
    connection: sqlite3.Connection,
    *,
    target_slug: str,
    plan_label: str,
    released_at: str = "2026-07-11T08:00:00.000000Z",
) -> int:
    return connection.execute(
        """
        INSERT INTO source_plan_cycles (
          target_slug, source_kind, plan_label, meta_number,
          released_at, starts_on, ends_on
        ) VALUES (?, 'ls', ?, 47, ?, '2026-07-11', '2026-07-17')
        """,
        (target_slug, plan_label, released_at),
    ).lastrowid


def _insert_source_task(
    connection: sqlite3.Connection,
    *,
    target_slug: str,
    external_task_id: str,
    source_cycle_id: int | None = None,
) -> int:
    return connection.execute(
        """
        INSERT INTO source_plan_tasks (
          target_slug, source_kind, external_task_id, plan_label, meta_number,
          scheduled_date, source_order, discipline, task_kind, description,
          estimated_minutes, status, provenance_json, source_cycle_id
        ) VALUES (?, 'ls', ?, 'Meta 47', 47, '2026-07-14', 1,
                  'Economia', 'questions', 'Conjunto FCC', 60, 'pending', '{}', ?)
        """,
        (target_slug, external_task_id, source_cycle_id),
    ).lastrowid


def test_version_ten_upgrades_additively_and_preserves_source_plan_state(tmp_path: Path):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        _install_version_ten(connection)
        _seed_target(connection)
        task_id = connection.execute(
            """
            INSERT INTO source_plan_tasks (
              target_slug, source_kind, external_task_id, plan_label, meta_number,
              scheduled_date, source_order, discipline, task_kind, description,
              estimated_minutes, status, provenance_json
            ) VALUES (
              'sefaz_ce', 'ls', 'meta-47-task-1', 'Meta 47', 47,
              '2026-07-14', 1, 'Economia', 'questions', 'Conjunto FCC',
              60, 'completed', '{"origin":"ls-visible-history"}'
            )
            """
        ).lastrowid
        before = tuple(
            connection.execute(
                """
                SELECT external_task_id, meta_number, scheduled_date, status,
                       provenance_json, version
                FROM source_plan_tasks WHERE id=?
                """,
                (task_id,),
            ).fetchone()
        )

        assert MigrationRunner(connection).migrate() == 13
        tables = {
            row["name"]
            for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
        assert EVIDENCE_TABLES <= tables
        columns = {
            row["name"] for row in connection.execute("PRAGMA table_info(source_plan_tasks)")
        }
        assert "source_cycle_id" in columns
        after = tuple(
            connection.execute(
                """
                SELECT external_task_id, meta_number, scheduled_date, status,
                       provenance_json, version
                FROM source_plan_tasks WHERE id=?
                """,
                (task_id,),
            ).fetchone()
        )
        assert after == before
        assert connection.execute(
            "SELECT source_cycle_id FROM source_plan_tasks WHERE id=?", (task_id,)
        ).fetchone()[0] is None
    finally:
        connection.close()


def test_version_eleven_updates_only_untouched_sefaz_default_goals(tmp_path: Path):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        _install_version_ten(connection)
        _seed_target(connection, "sefaz_ce")
        _seed_target(connection, "user_edited")
        _seed_config(connection, "sefaz_ce")
        _seed_config(connection, "user_edited", p1_high=61, p2_high=69)
        connection.commit()

        MigrationRunner(connection).migrate()

        default = tuple(
            connection.execute(
                """
                SELECT p1_floor_questions, p1_goal_low, p1_goal_high,
                       p2_goal_low, p2_goal_high, version
                FROM exam_sprint_configs WHERE target_slug='sefaz_ce'
                """
            ).fetchone()
        )
        edited = tuple(
            connection.execute(
                """
                SELECT p1_floor_questions, p1_goal_low, p1_goal_high,
                       p2_goal_low, p2_goal_high, version
                FROM exam_sprint_configs WHERE target_slug='user_edited'
                """
            ).fetchone()
        )
        assert default == (48, 48, 64, 63, 70, 2)
        assert edited == (48, 48, 61, 63, 69, 1)
    finally:
        connection.close()


def test_current_schema_version_includes_task_execution_ledger():
    assert CURRENT_SCHEMA_VERSION == 13


@pytest.mark.parametrize(
    "invalid_timestamp",
    (
        "2026-07-14T12:34:56-03:00",
        "2026-07-14T12:34:56.123Z",
        "2026-02-30T12:34:56.123456Z",
        "0000-07-14T12:34:56.123456Z",
        "2026-07-14T24:00:00.000000Z",
        "not-a-real-timestamp-xxxxxxxx",
    ),
)
def test_evidence_source_updated_at_requires_canonical_valid_utc(
    tmp_path: Path,
    invalid_timestamp: str,
):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        MigrationRunner(connection).migrate()
        _seed_target(connection)
        _insert_batch(connection, batch_id="batch-1", target_slug="sefaz_ce")

        with pytest.raises(sqlite3.IntegrityError):
            _insert_observation(
                connection,
                batch_id="batch-1",
                target_slug="sefaz_ce",
                source_updated_at=invalid_timestamp,
            )

        _insert_observation(
            connection,
            batch_id="batch-1",
            target_slug="sefaz_ce",
            source_updated_at="2026-07-14T12:34:56.123456Z",
        )
    finally:
        connection.close()


@pytest.mark.parametrize(
    "invalid_timestamp",
    (
        "2026-07-11T08:00:00-03:00",
        "2026-07-11T08:00:00.000Z",
        "2026-02-30T08:00:00.000000Z",
        "0000-07-11T08:00:00.000000Z",
        "2026-07-11T24:00:00.000000Z",
        "not-a-real-timestamp-xxxxxxxx",
    ),
)
def test_cycle_released_at_requires_canonical_valid_utc(
    tmp_path: Path,
    invalid_timestamp: str,
):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        MigrationRunner(connection).migrate()
        _seed_target(connection)

        with pytest.raises(sqlite3.IntegrityError):
            _insert_cycle(
                connection,
                target_slug="sefaz_ce",
                plan_label=f"invalid-{invalid_timestamp}",
                released_at=invalid_timestamp,
            )

        _insert_cycle(
            connection,
            target_slug="sefaz_ce",
            plan_label="Meta 47",
            released_at="2026-07-11T08:00:00.000000Z",
        )
    finally:
        connection.close()


def test_observation_target_and_origin_must_match_import_batch(tmp_path: Path):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        MigrationRunner(connection).migrate()
        _seed_target(connection, "sefaz_ce")
        _seed_target(connection, "other_target")
        _insert_batch(
            connection,
            batch_id="batch-1",
            target_slug="sefaz_ce",
            origin="ls",
        )

        with pytest.raises(sqlite3.IntegrityError):
            _insert_observation(
                connection,
                batch_id="batch-1",
                target_slug="other_target",
                origin="ls",
            )
        with pytest.raises(sqlite3.IntegrityError):
            _insert_observation(
                connection,
                batch_id="batch-1",
                target_slug="sefaz_ce",
                origin="manual",
            )

        _insert_observation(
            connection,
            batch_id="batch-1",
            target_slug="sefaz_ce",
            origin="ls",
        )
    finally:
        connection.close()


def test_cycle_task_and_backlog_references_cannot_cross_targets(tmp_path: Path):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        MigrationRunner(connection).migrate()
        _seed_target(connection, "sefaz_ce")
        _seed_target(connection, "other_target")
        ce_cycle_id = _insert_cycle(
            connection, target_slug="sefaz_ce", plan_label="CE Meta 47"
        )
        other_cycle_id = _insert_cycle(
            connection, target_slug="other_target", plan_label="Other Meta 47"
        )

        with pytest.raises(sqlite3.IntegrityError):
            _insert_source_task(
                connection,
                target_slug="sefaz_ce",
                external_task_id="cross-cycle-on-insert",
                source_cycle_id=other_cycle_id,
            )

        task_id = _insert_source_task(
            connection,
            target_slug="sefaz_ce",
            external_task_id="ce-task",
            source_cycle_id=ce_cycle_id,
        )
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                "UPDATE source_plan_cycles SET target_slug='other_target' WHERE id=?",
                (ce_cycle_id,),
            )
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                "UPDATE source_plan_tasks SET source_cycle_id=? WHERE id=?",
                (other_cycle_id, task_id),
            )

        for target_slug, source_cycle_id in (
            ("other_target", ce_cycle_id),
            ("sefaz_ce", other_cycle_id),
        ):
            with pytest.raises(sqlite3.IntegrityError):
                connection.execute(
                    """
                    INSERT INTO source_plan_backlog_candidates (
                      target_slug, source_cycle_id, source_plan_task_id,
                      reason, return_score_milli, state, discovered_on
                    ) VALUES (?, ?, ?, 'cycle_closed_pending', 1000,
                              'candidate', '2026-07-18')
                    """,
                    (target_slug, source_cycle_id, task_id),
                )

        connection.execute(
            """
            INSERT INTO source_plan_backlog_candidates (
              target_slug, source_cycle_id, source_plan_task_id,
              reason, return_score_milli, state, discovered_on
            ) VALUES ('sefaz_ce', ?, ?, 'cycle_closed_pending', 1000,
                      'candidate', '2026-07-18')
            """,
            (ce_cycle_id, task_id),
        )
    finally:
        connection.close()
