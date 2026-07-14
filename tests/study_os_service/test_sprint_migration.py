from pathlib import Path
import sqlite3

import pytest

from study_os_service.db.connection import connect_database
from study_os_service.db.migrations import (
    CURRENT_SCHEMA_VERSION,
    MIGRATIONS,
    MigrationRunner,
)


SPRINT_TABLES = {
    "exam_subject_profiles",
    "source_plan_tasks",
    "exam_sprint_configs",
    "sprint_day_runs",
    "sprint_actions",
    "sprint_action_question_refs",
    "sprint_mutation_receipts",
}


def _install_version_nine(connection: sqlite3.Connection) -> None:
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
        if version > 9:
            break
        for statement in statements:
            connection.execute(statement)
        connection.execute(
            "INSERT INTO schema_migrations (version) VALUES (?)", (version,)
        )
    connection.commit()


def _seed_target(connection: sqlite3.Connection) -> None:
    connection.execute(
        """
        INSERT INTO exam_targets (
          target_slug, display_name, institution, role, banca, phase,
          deadline, daily_quota, priority_score, source_urls_json
        ) VALUES (
          'sefaz_ce', 'SEFAZ CE', 'SEFAZ CE', 'Auditor Fiscal', 'FCC',
          'pos_edital', '2026-08-01', 4, 100,
          '["https://www.sefaz.ce.gov.br/edital"]'
        )
        """
    )


def test_version_nine_upgrades_to_sprint_schema_without_losing_planner_data(
    tmp_path: Path,
):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        _install_version_nine(connection)
        _seed_target(connection)
        topic_id = connection.execute(
            """
            INSERT INTO target_topics (
              target_slug, discipline, topic, coverage_status, edital_weight,
              incidence, tier, banca_fit, overlap_value, transfer_kind,
              source_kind, review_debt
            ) VALUES (
              'sefaz_ce', 'Financas Publicas', 'Orcamento', 'weak', 2,
              90, 1, 95, 70, 'shared', 'manual', 60
            )
            """
        ).lastrowid

        assert MigrationRunner(connection).migrate() == CURRENT_SCHEMA_VERSION

        tables = {
            row["name"]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
        }
        assert SPRINT_TABLES <= tables
        assert connection.execute(
            "SELECT discipline FROM target_topics WHERE id=?", (topic_id,)
        ).fetchone()[0] == "Financas Publicas"
        assert tuple(
            connection.execute(
                "SELECT banca, deadline FROM exam_targets WHERE target_slug='sefaz_ce'"
            ).fetchone()
        ) == ("FCC", "2026-08-01")
    finally:
        connection.close()


def test_version_nine_preserves_user_edited_sefaz_target_fields(tmp_path: Path):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        _install_version_nine(connection)
        connection.execute(
            """
            INSERT INTO exam_targets (
              target_slug, display_name, institution, role, banca, phase,
              deadline, daily_quota, priority_score, source_urls_json, notes, active
            ) VALUES (
              'sefaz_ce', 'Meu sprint CE', 'Instituicao editada', 'Cargo editado',
              'Banca editada', 'pre_edital', '2026-08-15', 3, 42,
              '["https://example.test/meu-edital"]', 'Minhas notas', 0
            )
            """
        )
        connection.commit()

        MigrationRunner(connection).migrate()

        assert tuple(
            connection.execute(
                """
                SELECT display_name, institution, role, banca, phase, deadline,
                       daily_quota, priority_score, source_urls_json, notes, active
                FROM exam_targets WHERE target_slug='sefaz_ce'
                """
            ).fetchone()
        ) == (
            "Meu sprint CE",
            "Instituicao editada",
            "Cargo editado",
            "Banca editada",
            "pre_edital",
            "2026-08-15",
            3,
            42,
            '["https://example.test/meu-edital"]',
            "Minhas notas",
            0,
        )
    finally:
        connection.close()


def test_sprint_schema_enforces_stable_sources_and_auditable_actions(tmp_path: Path):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        MigrationRunner(connection).migrate()
        _seed_target(connection)
        subject_id = connection.execute(
            """
            INSERT INTO exam_subject_profiles (
              target_slug, subject_key, display_name, paper, question_count,
              question_weight, discursive_eligible, baseline_accuracy_bp,
              target_low_bp, target_high_bp, baseline_confidence_bp,
              focus_band, baseline_source
            ) VALUES (
              'sefaz_ce', 'p2_lte', 'Legislacao Tributaria Estadual', 'P2',
              20, 2, 1, NULL, 8000, 9000, 0, 'focus', 'unknown'
            )
            """
        ).lastrowid
        source_task_id = connection.execute(
            """
            INSERT INTO source_plan_tasks (
              target_slug, source_kind, external_task_id, plan_label,
              meta_number, scheduled_date, source_order, discipline,
              subject_key, topic_hint, task_kind, description,
              estimated_minutes, relevance, status, provenance_json
            ) VALUES (
              'sefaz_ce', 'ls', 'meta-47-task-29', 'Meta 47', 47,
              '2026-07-13', 29, 'Legis. Tribut. Estadual (ICMS)', 'p2_lte',
              'Revisao Intermediaria VI', 'review', 'Lei 18.665/2023',
              60, 10, 'pending', '{"origin":"ls-meta"}'
            )
            """
        ).lastrowid
        connection.execute(
            """
            INSERT INTO exam_sprint_configs (
              target_slug, start_date, objective_date, exam_end_date,
              ls_budget_minutes, extra_budget_minutes, p1_floor_questions,
              p1_goal_low, p1_goal_high, p2_goal_low, p2_goal_high,
              discursive_goal_low, discursive_goal_high, triage_mode, state
            ) VALUES (
              'sefaz_ce', '2026-07-13', '2026-08-01', '2026-08-02',
              240, 60, 48, 48, 52, 63, 67, 75, 82, 'suggest_only', 'active'
            )
            """
        )
        run_id = connection.execute(
            """
            INSERT INTO sprint_day_runs (
              idempotency_key, target_slug, plan_date, days_remaining,
              ls_budget_minutes, extra_budget_minutes, energy_level,
              algorithm_version, input_hash, status, score_snapshot_json
            ) VALUES (
              'sprint-day-2026-07-13', 'sefaz_ce', '2026-07-13', 19,
              240, 60, 3, 'sprint-v1', 'input-hash', 'generated', '{}'
            )
            """
        ).lastrowid
        action_id = connection.execute(
            """
            INSERT INTO sprint_actions (
              run_id, target_slug, position, action_kind, recommendation,
              source_plan_task_id, subject_profile_id, title,
              duration_minutes, planned_questions, expected_gain_milli,
              confidence_bp, rationale_json, evidence_json
            ) VALUES (
              ?, 'sefaz_ce', 1, 'ls_execute', 'execute', ?, ?,
              'Executar LTE da LS', 60, 20, 14000, 7000,
              '["peso 2","alinhado a LS"]', '{}'
            )
            """,
            (run_id, source_task_id, subject_id),
        ).lastrowid
        connection.execute(
            """
            INSERT INTO sprint_action_question_refs (
              action_id, question_fingerprint, reason
            ) VALUES (?, 'question-fingerprint-1', 'doubt')
            """,
            (action_id,),
        )

        with pytest.raises(sqlite3.IntegrityError, match="UNIQUE"):
            connection.execute(
                """
                INSERT INTO source_plan_tasks (
                  target_slug, source_kind, external_task_id, plan_label,
                  source_order, discipline, topic_hint, task_kind, description,
                  estimated_minutes, relevance, status
                ) VALUES (
                  'sefaz_ce', 'ls', 'meta-47-task-29', 'Meta 47', 29,
                  'LTE', 'ICMS', 'review', 'Duplicada', 60, 10, 'pending'
                )
                """
            )
        with pytest.raises(sqlite3.IntegrityError, match="CHECK"):
            connection.execute(
                "UPDATE sprint_actions SET recommendation='auto_delete' WHERE id=?",
                (action_id,),
            )
        with pytest.raises(sqlite3.IntegrityError, match="CHECK"):
            connection.execute(
                "UPDATE sprint_actions SET duration_minutes=0 WHERE id=?",
                (action_id,),
            )
    finally:
        connection.close()
