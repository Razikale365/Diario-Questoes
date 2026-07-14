from __future__ import annotations

from datetime import date, timedelta
import json
import sqlite3
from typing import Any, Iterable, Mapping

from study_os_service.domain.sprint import (
    ExamSprintConfig,
    ExamSubjectProfile,
    SourcePlanTask,
)


class SprintVersionConflictError(RuntimeError):
    pass


def _subject(row: sqlite3.Row) -> ExamSubjectProfile:
    return ExamSubjectProfile(
        id=row["id"],
        target_slug=row["target_slug"],
        subject_key=row["subject_key"],
        display_name=row["display_name"],
        aliases=tuple(json.loads(row["aliases_json"])),
        paper=row["paper"],
        question_count=row["question_count"],
        question_weight=row["question_weight"],
        discursive_eligible=bool(row["discursive_eligible"]),
        baseline_accuracy_bp=row["baseline_accuracy_bp"],
        target_low_bp=row["target_low_bp"],
        target_high_bp=row["target_high_bp"],
        baseline_confidence_bp=row["baseline_confidence_bp"],
        focus_band=row["focus_band"],
        baseline_source=row["baseline_source"],
        notes=row["notes"],
        active=bool(row["active"]),
        version=row["version"],
    )


def _config(row: sqlite3.Row) -> ExamSprintConfig:
    return ExamSprintConfig(
        target_slug=row["target_slug"],
        start_date=date.fromisoformat(row["start_date"]),
        objective_date=date.fromisoformat(row["objective_date"]),
        exam_end_date=date.fromisoformat(row["exam_end_date"]),
        ls_budget_minutes=row["ls_budget_minutes"],
        extra_budget_minutes=row["extra_budget_minutes"],
        p1_floor_questions=row["p1_floor_questions"],
        p1_goal_low=row["p1_goal_low"],
        p1_goal_high=row["p1_goal_high"],
        p2_goal_low=row["p2_goal_low"],
        p2_goal_high=row["p2_goal_high"],
        discursive_goal_low=row["discursive_goal_low"],
        discursive_goal_high=row["discursive_goal_high"],
        triage_mode=row["triage_mode"],
        state=row["state"],
        version=row["version"],
    )


def _source_task(row: sqlite3.Row) -> SourcePlanTask:
    return SourcePlanTask(
        id=row["id"],
        target_slug=row["target_slug"],
        source_kind=row["source_kind"],
        external_task_id=row["external_task_id"],
        plan_label=row["plan_label"],
        meta_number=row["meta_number"],
        scheduled_date=(
            date.fromisoformat(row["scheduled_date"])
            if row["scheduled_date"]
            else None
        ),
        source_order=row["source_order"],
        discipline=row["discipline"],
        subject_key=row["subject_key"],
        topic_hint=row["topic_hint"],
        task_kind=row["task_kind"],
        description=row["description"],
        details=row["details"],
        material_hint=row["material_hint"],
        estimated_minutes=row["estimated_minutes"],
        spent_minutes=row["spent_minutes"],
        relevance=row["relevance"],
        status=row["status"],
        performance_bp=row["performance_bp"],
        linked_study_task_id=row["linked_study_task_id"],
        provenance=json.loads(row["provenance_json"]),
        version=row["version"],
    )


class SprintRepository:
    def __init__(self, connection: sqlite3.Connection):
        self.connection = connection

    def target_exists(self, target_slug: str) -> bool:
        row = self.connection.execute(
            "SELECT 1 FROM exam_targets WHERE target_slug=?", (target_slug,)
        ).fetchone()
        return row is not None

    def ensure_subjects(self, rows: Iterable[Mapping[str, Any]]) -> None:
        for row in rows:
            self.connection.execute(
                """
                INSERT INTO exam_subject_profiles (
                  target_slug, subject_key, display_name, aliases_json, paper,
                  question_count, question_weight, discursive_eligible,
                  baseline_accuracy_bp, target_low_bp, target_high_bp,
                  baseline_confidence_bp, focus_band, baseline_source, notes
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(target_slug, subject_key) DO UPDATE SET
                  display_name=excluded.display_name,
                  aliases_json=excluded.aliases_json,
                  paper=excluded.paper,
                  question_count=excluded.question_count,
                  question_weight=excluded.question_weight,
                  discursive_eligible=excluded.discursive_eligible,
                  version=exam_subject_profiles.version+1,
                  updated_at=STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW')
                WHERE exam_subject_profiles.display_name<>excluded.display_name
                   OR exam_subject_profiles.aliases_json<>excluded.aliases_json
                   OR exam_subject_profiles.paper<>excluded.paper
                   OR exam_subject_profiles.question_count<>excluded.question_count
                   OR exam_subject_profiles.question_weight<>excluded.question_weight
                   OR exam_subject_profiles.discursive_eligible<>excluded.discursive_eligible
                """,
                (
                    row["target_slug"],
                    row["subject_key"],
                    row["display_name"],
                    json.dumps(row["aliases"], ensure_ascii=True),
                    row["paper"],
                    row["question_count"],
                    row["question_weight"],
                    int(row["discursive_eligible"]),
                    row["baseline_accuracy_bp"],
                    row["target_low_bp"],
                    row["target_high_bp"],
                    row["baseline_confidence_bp"],
                    row["focus_band"],
                    row["baseline_source"],
                    row["notes"],
                ),
            )

    def list_subjects(self, target_slug: str) -> tuple[ExamSubjectProfile, ...]:
        rows = self.connection.execute(
            """
            SELECT * FROM exam_subject_profiles
            WHERE target_slug=?
            ORDER BY paper, id
            """,
            (target_slug,),
        )
        return tuple(_subject(row) for row in rows)

    def get_subject(self, subject_id: int) -> ExamSubjectProfile | None:
        row = self.connection.execute(
            "SELECT * FROM exam_subject_profiles WHERE id=?", (subject_id,)
        ).fetchone()
        return _subject(row) if row else None

    def ensure_config(self, config: ExamSprintConfig) -> None:
        self.connection.execute(
            """
            INSERT OR IGNORE INTO exam_sprint_configs (
              target_slug, start_date, objective_date, exam_end_date,
              ls_budget_minutes, extra_budget_minutes, p1_floor_questions,
              p1_goal_low, p1_goal_high, p2_goal_low, p2_goal_high,
              discursive_goal_low, discursive_goal_high, triage_mode, state,
              version
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                config.target_slug,
                config.start_date.isoformat(),
                config.objective_date.isoformat(),
                config.exam_end_date.isoformat(),
                config.ls_budget_minutes,
                config.extra_budget_minutes,
                config.p1_floor_questions,
                config.p1_goal_low,
                config.p1_goal_high,
                config.p2_goal_low,
                config.p2_goal_high,
                config.discursive_goal_low,
                config.discursive_goal_high,
                config.triage_mode,
                config.state,
                config.version,
            ),
        )

    def get_config(self, target_slug: str) -> ExamSprintConfig | None:
        row = self.connection.execute(
            "SELECT * FROM exam_sprint_configs WHERE target_slug=?", (target_slug,)
        ).fetchone()
        return _config(row) if row else None

    def update_config(
        self, values: Mapping[str, Any], *, expected_version: int
    ) -> ExamSprintConfig:
        cursor = self.connection.execute(
            """
            UPDATE exam_sprint_configs SET
              ls_budget_minutes=?, extra_budget_minutes=?, p1_floor_questions=?,
              p1_goal_low=?, p1_goal_high=?, p2_goal_low=?, p2_goal_high=?,
              discursive_goal_low=?, discursive_goal_high=?, state=?,
              version=version+1,
              updated_at=(STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW'))
            WHERE target_slug=? AND version=?
            """,
            (
                values["ls_budget_minutes"],
                values["extra_budget_minutes"],
                values["p1_floor_questions"],
                values["p1_goal_low"],
                values["p1_goal_high"],
                values["p2_goal_low"],
                values["p2_goal_high"],
                values["discursive_goal_low"],
                values["discursive_goal_high"],
                values["state"],
                values["target_slug"],
                expected_version,
            ),
        )
        if cursor.rowcount != 1:
            raise SprintVersionConflictError("sprint config has changed")
        saved = self.get_config(str(values["target_slug"]))
        if saved is None:
            raise RuntimeError("updated sprint config disappeared")
        return saved

    def get_receipt(self, idempotency_key: str) -> sqlite3.Row | None:
        return self.connection.execute(
            "SELECT * FROM sprint_mutation_receipts WHERE idempotency_key=?",
            (idempotency_key,),
        ).fetchone()

    def save_receipt(
        self,
        *,
        idempotency_key: str,
        mutation_kind: str,
        target_slug: str,
        entity_ref: str,
        payload_hash: str,
        response: Mapping[str, Any],
    ) -> None:
        self.connection.execute(
            """
            INSERT INTO sprint_mutation_receipts (
              idempotency_key, mutation_kind, target_slug, entity_ref,
              payload_hash, response_json
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                idempotency_key,
                mutation_kind,
                target_slug,
                entity_ref,
                payload_hash,
                json.dumps(response, ensure_ascii=True, sort_keys=True),
            ),
        )

    def find_source_task(
        self, target_slug: str, source_kind: str, external_task_id: str
    ) -> SourcePlanTask | None:
        row = self.connection.execute(
            """
            SELECT * FROM source_plan_tasks
            WHERE target_slug=? AND source_kind=? AND external_task_id=?
            """,
            (target_slug, source_kind, external_task_id),
        ).fetchone()
        return _source_task(row) if row else None

    def upsert_source_task(self, values: Mapping[str, Any]) -> tuple[SourcePlanTask, bool]:
        existing = self.find_source_task(
            str(values["target_slug"]),
            str(values["source_kind"]),
            str(values["external_task_id"]),
        )
        if existing is None:
            cursor = self.connection.execute(
                """
                INSERT INTO source_plan_tasks (
                  target_slug, source_kind, external_task_id, plan_label,
                  meta_number, scheduled_date, source_order, discipline,
                  subject_key, topic_hint, task_kind, description, details,
                  material_hint, estimated_minutes, spent_minutes, relevance,
                  status, performance_bp, linked_study_task_id, provenance_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                self._source_values(values),
            )
            row = self.connection.execute(
                "SELECT * FROM source_plan_tasks WHERE id=?", (cursor.lastrowid,)
            ).fetchone()
            if row is None:
                raise RuntimeError("inserted source task disappeared")
            return _source_task(row), True

        self.connection.execute(
            """
            UPDATE source_plan_tasks SET
              plan_label=?, meta_number=?, scheduled_date=?, source_order=?,
              discipline=?, subject_key=?, topic_hint=?, task_kind=?,
              description=?, details=?, material_hint=?, estimated_minutes=?,
              spent_minutes=?, relevance=?, status=?, performance_bp=?,
              linked_study_task_id=?, provenance_json=?, version=version+1,
              updated_at=(STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW'))
            WHERE id=?
            """,
            (
                values["plan_label"],
                values["meta_number"],
                values["scheduled_date"],
                values["source_order"],
                values["discipline"],
                values["subject_key"],
                values["topic_hint"],
                values["task_kind"],
                values["description"],
                values["details"],
                values["material_hint"],
                values["estimated_minutes"],
                values["spent_minutes"],
                values["relevance"],
                values["status"],
                values["performance_bp"],
                values["linked_study_task_id"],
                json.dumps(values["provenance"], ensure_ascii=True, sort_keys=True),
                existing.id,
            ),
        )
        saved = self.find_source_task(
            str(values["target_slug"]),
            str(values["source_kind"]),
            str(values["external_task_id"]),
        )
        if saved is None:
            raise RuntimeError("updated source task disappeared")
        return saved, False

    @staticmethod
    def _source_values(values: Mapping[str, Any]) -> tuple[object, ...]:
        return (
            values["target_slug"],
            values["source_kind"],
            values["external_task_id"],
            values["plan_label"],
            values["meta_number"],
            values["scheduled_date"],
            values["source_order"],
            values["discipline"],
            values["subject_key"],
            values["topic_hint"],
            values["task_kind"],
            values["description"],
            values["details"],
            values["material_hint"],
            values["estimated_minutes"],
            values["spent_minutes"],
            values["relevance"],
            values["status"],
            values["performance_bp"],
            values["linked_study_task_id"],
            json.dumps(values["provenance"], ensure_ascii=True, sort_keys=True),
        )

    def list_source_tasks(
        self,
        target_slug: str,
        *,
        scheduled_date: date | None = None,
        include_inactive: bool = False,
    ) -> tuple[SourcePlanTask, ...]:
        clauses = ["target_slug=?"]
        parameters: list[object] = [target_slug]
        if scheduled_date is not None:
            clauses.append("scheduled_date=?")
            parameters.append(scheduled_date.isoformat())
        if not include_inactive:
            clauses.append("status!='archived'")
        rows = self.connection.execute(
            f"""
            SELECT * FROM source_plan_tasks
            WHERE {' AND '.join(clauses)}
            ORDER BY scheduled_date IS NULL, scheduled_date, source_order, id
            """,
            tuple(parameters),
        )
        return tuple(_source_task(row) for row in rows)

    def get_run_by_idempotency(self, idempotency_key: str) -> sqlite3.Row | None:
        return self.connection.execute(
            "SELECT * FROM sprint_day_runs WHERE idempotency_key=?",
            (idempotency_key,),
        ).fetchone()

    def latest_day_run(
        self, target_slug: str, plan_date: date
    ) -> sqlite3.Row | None:
        return self.connection.execute(
            """
            SELECT * FROM sprint_day_runs
            WHERE target_slug=? AND plan_date=?
            ORDER BY id DESC LIMIT 1
            """,
            (target_slug, plan_date.isoformat()),
        ).fetchone()

    def insert_day_run(
        self,
        *,
        idempotency_key: str,
        target_slug: str,
        plan_date: date,
        days_remaining: int,
        ls_budget_minutes: int,
        extra_budget_minutes: int,
        energy_level: int,
        algorithm_version: str,
        input_hash: str,
        supersedes_run_id: int | None,
        status: str,
        score_snapshot: Mapping[str, object],
    ) -> sqlite3.Row:
        cursor = self.connection.execute(
            """
            INSERT INTO sprint_day_runs (
              idempotency_key, target_slug, plan_date, days_remaining,
              ls_budget_minutes, extra_budget_minutes, energy_level,
              algorithm_version, input_hash, supersedes_run_id, status,
              score_snapshot_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                idempotency_key,
                target_slug,
                plan_date.isoformat(),
                days_remaining,
                ls_budget_minutes,
                extra_budget_minutes,
                energy_level,
                algorithm_version,
                input_hash,
                supersedes_run_id,
                status,
                json.dumps(score_snapshot, ensure_ascii=True, sort_keys=True),
            ),
        )
        row = self.connection.execute(
            "SELECT * FROM sprint_day_runs WHERE id=?", (cursor.lastrowid,)
        ).fetchone()
        if row is None:
            raise RuntimeError("inserted sprint run disappeared")
        return row

    def insert_action(
        self,
        *,
        run_id: int,
        target_slug: str,
        position: int,
        values: Mapping[str, Any],
    ) -> sqlite3.Row:
        cursor = self.connection.execute(
            """
            INSERT INTO sprint_actions (
              run_id, target_slug, position, action_kind, recommendation,
              source_plan_task_id, subject_profile_id, topic_hint, title,
              duration_minutes, planned_questions, expected_gain_milli,
              confidence_bp, rationale_json, evidence_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                run_id,
                target_slug,
                position,
                values["action_kind"],
                values["recommendation"],
                values["source_plan_task_id"],
                values["subject_profile_id"],
                values["topic_hint"],
                values["title"],
                values["duration_minutes"],
                values["planned_questions"],
                values["expected_gain_milli"],
                values["confidence_bp"],
                json.dumps(values["rationale"], ensure_ascii=True),
                json.dumps(values["evidence"], ensure_ascii=True, sort_keys=True),
            ),
        )
        row = self.get_action(cursor.lastrowid)
        if row is None:
            raise RuntimeError("inserted sprint action disappeared")
        return row

    def list_run_actions(self, run_id: int) -> tuple[sqlite3.Row, ...]:
        rows = self.connection.execute(
            """
            SELECT actions.*, subjects.subject_key, subjects.display_name,
                   subjects.paper, subjects.question_weight,
                   source.external_task_id, source.plan_label,
                   source.discipline AS source_discipline,
                   source.material_hint AS source_material_hint,
                   source.linked_study_task_id
            FROM sprint_actions AS actions
            JOIN exam_subject_profiles AS subjects
              ON subjects.id=actions.subject_profile_id
            LEFT JOIN source_plan_tasks AS source
              ON source.id=actions.source_plan_task_id
            WHERE actions.run_id=?
            ORDER BY actions.position, actions.id
            """,
            (run_id,),
        )
        return tuple(rows)

    def get_action(self, action_id: int) -> sqlite3.Row | None:
        return self.connection.execute(
            """
            SELECT actions.*, subjects.subject_key, subjects.display_name,
                   subjects.paper, subjects.question_weight,
                   source.external_task_id, source.plan_label,
                   source.discipline AS source_discipline,
                   source.material_hint AS source_material_hint,
                   source.linked_study_task_id
            FROM sprint_actions AS actions
            JOIN exam_subject_profiles AS subjects
              ON subjects.id=actions.subject_profile_id
            LEFT JOIN source_plan_tasks AS source
              ON source.id=actions.source_plan_task_id
            WHERE actions.id=?
            """,
            (action_id,),
        ).fetchone()

    def list_action_question_refs(self, action_id: int) -> tuple[sqlite3.Row, ...]:
        return tuple(
            self.connection.execute(
                """
                SELECT * FROM sprint_action_question_refs
                WHERE action_id=? ORDER BY id
                """,
                (action_id,),
            )
        )

    def insert_action_question_refs(
        self, action_id: int, refs: Iterable[Mapping[str, Any]]
    ) -> None:
        for ref in refs:
            self.connection.execute(
                """
                INSERT OR IGNORE INTO sprint_action_question_refs (
                  action_id, question_fingerprint, source_task_id, reason
                ) VALUES (?, ?, ?, ?)
                """,
                (
                    action_id,
                    ref["question_fingerprint"],
                    ref["source_task_id"],
                    ref["reason"],
                ),
            )

    def review_question_refs(
        self,
        target_slug: str,
        subject_profile_id: int,
        *,
        limit: int,
    ) -> tuple[dict[str, Any], ...]:
        rows = self.connection.execute(
            """
            SELECT refs.question_fingerprint, refs.source_task_id, refs.reason,
                   MAX(refs.id) AS newest_id
            FROM sprint_action_question_refs AS refs
            JOIN sprint_actions AS origin ON origin.id=refs.action_id
            WHERE origin.target_slug=? AND origin.subject_profile_id=?
              AND origin.state='completed'
            GROUP BY refs.question_fingerprint, refs.source_task_id, refs.reason
            ORDER BY newest_id DESC
            LIMIT ?
            """,
            (target_slug, subject_profile_id, limit),
        )
        return tuple(
            {
                "question_fingerprint": row["question_fingerprint"],
                "source_task_id": row["source_task_id"],
                "reason": row["reason"],
            }
            for row in rows
        )

    def update_action(
        self,
        action_id: int,
        *,
        expected_version: int,
        values: Mapping[str, Any],
    ) -> sqlite3.Row:
        cursor = self.connection.execute(
            """
            UPDATE sprint_actions SET
              decision=?, state=?, actual_minutes=?, questions_done=?,
              correct_count=?, wrong_count=?, doubt_count=?, energy_after=?,
              version=version+1,
              updated_at=(STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW'))
            WHERE id=? AND version=?
            """,
            (
                values["decision"],
                values["state"],
                values["actual_minutes"],
                values["questions_done"],
                values["correct_count"],
                values["wrong_count"],
                values["doubt_count"],
                values["energy_after"],
                action_id,
                expected_version,
            ),
        )
        if cursor.rowcount != 1:
            raise SprintVersionConflictError(f"sprint action {action_id} has changed")
        row = self.get_action(action_id)
        if row is None:
            raise RuntimeError("updated sprint action disappeared")
        return row

    def resolved_source_task_ids_for_day(
        self, target_slug: str, plan_date: date
    ) -> set[int]:
        return {
            row["source_plan_task_id"]
            for row in self.connection.execute(
                """
                SELECT DISTINCT actions.source_plan_task_id
                FROM sprint_actions AS actions
                JOIN sprint_day_runs AS runs ON runs.id=actions.run_id
                WHERE runs.target_slug=? AND runs.plan_date=?
                  AND actions.state IN ('completed', 'skipped')
                  AND actions.source_plan_task_id IS NOT NULL
                """,
                (target_slug, plan_date.isoformat()),
            )
        }

    def recent_accuracy(self, target_slug: str) -> dict[str, tuple[int, ...]]:
        grouped: dict[str, list[int]] = {}
        source_rows = self.connection.execute(
            """
            SELECT source.subject_key, source.performance_bp
            FROM source_plan_tasks AS source
            WHERE source.target_slug=? AND source.status='completed'
              AND source.subject_key IS NOT NULL
              AND source.performance_bp IS NOT NULL
              AND NOT EXISTS (
                SELECT 1 FROM sprint_actions AS action
                WHERE action.source_plan_task_id=source.id
                  AND action.state='completed'
                  AND action.questions_done > 0
              )
            ORDER BY COALESCE(source.meta_number, 0),
                     COALESCE(source.scheduled_date, ''),
                     source.source_order, source.id
            """,
            (target_slug,),
        )
        for row in source_rows:
            grouped.setdefault(row["subject_key"], []).append(
                row["performance_bp"]
            )

        action_rows = self.connection.execute(
            """
            SELECT subjects.subject_key, actions.correct_count,
                   actions.questions_done
            FROM sprint_actions AS actions
            JOIN exam_subject_profiles AS subjects
              ON subjects.id=actions.subject_profile_id
            WHERE actions.target_slug=? AND actions.state='completed'
              AND actions.questions_done > 0
            ORDER BY actions.updated_at, actions.id
            """,
            (target_slug,),
        )
        for row in action_rows:
            grouped.setdefault(row["subject_key"], []).append(
                round(row["correct_count"] * 10000 / row["questions_done"])
            )
        return {key: tuple(values[-3:]) for key, values in grouped.items()}

    def afo_rescues_this_week(self, target_slug: str, plan_date: date) -> int:
        week_start = plan_date - timedelta(days=plan_date.weekday())
        row = self.connection.execute(
            """
            SELECT COUNT(*) FROM sprint_actions AS actions
            JOIN sprint_day_runs AS runs ON runs.id=actions.run_id
            JOIN exam_subject_profiles AS subjects
              ON subjects.id=actions.subject_profile_id
            WHERE actions.target_slug=?
              AND subjects.subject_key='p1_direito_financeiro'
              AND actions.state='completed'
              AND runs.plan_date BETWEEN ? AND ?
            """,
            (
                target_slug,
                week_start.isoformat(),
                (week_start + timedelta(days=6)).isoformat(),
            ),
        ).fetchone()
        return int(row[0])

    def list_runs(self, target_slug: str) -> tuple[sqlite3.Row, ...]:
        return tuple(
            self.connection.execute(
                """
                SELECT * FROM sprint_day_runs
                WHERE target_slug=? ORDER BY plan_date, id
                """,
                (target_slug,),
            )
        )
