from __future__ import annotations

from dataclasses import replace
from datetime import date
import hashlib
import json
import math
import sqlite3
from typing import Any, Mapping

from study_os_service.domain.sprint import ExamSprintConfig, ExamSubjectProfile
from study_os_service.domain.sprint_evidence import PaperProjection, SprintProjection
from study_os_service.repositories.sprint import (
    SprintRepository,
    SprintVersionConflictError,
)
from study_os_service.services.sprint import (
    IdempotencyConflictError,
    SprintProfileService,
    SprintTargetNotFoundError,
)
from study_os_service.services.sprint_engine import SprintActionDraft, SprintEngine
from study_os_service.services.sprint_projection import (
    SprintProjectionService,
    projection_document,
)


class SprintDayNotFoundError(KeyError):
    pass


class SprintActionNotFoundError(KeyError):
    pass


def _hash(payload: object) -> str:
    document = json.dumps(payload, ensure_ascii=True, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(document.encode("utf-8")).hexdigest()


def _text(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{label} is required")
    return value.strip()


def _integer(
    value: Any,
    label: str,
    *,
    minimum: int,
    maximum: int,
) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"{label} must be an integer")
    if not minimum <= value <= maximum:
        raise ValueError(f"{label} must be between {minimum} and {maximum}")
    return value


def _number(value: Any, label: str, *, minimum: float, maximum: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{label} must be numeric")
    resolved = float(value)
    if not minimum <= resolved <= maximum:
        raise ValueError(f"{label} must be between {minimum:g} and {maximum:g}")
    return resolved


def _date(value: Any, label: str) -> date:
    if not isinstance(value, str):
        raise ValueError(f"{label} must use YYYY-MM-DD")
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError(f"{label} must use YYYY-MM-DD") from exc


def _manual_paper_projection(
    paper: PaperProjection,
    projected: float,
) -> PaperProjection:
    if paper.variance is None:
        low = min(paper.low, projected)
        high = max(paper.high, projected)
    else:
        margin = 1.645 * math.sqrt(paper.variance)
        low = max(0.0, projected - margin)
        high = min(80.0, projected + margin)
    return replace(paper, projected=projected, low=low, high=high)


def _manual_projection(
    projection: SprintProjection,
    *,
    p1: float,
    p2: float,
) -> SprintProjection:
    return replace(
        projection,
        p1=_manual_paper_projection(projection.p1, p1),
        p2=_manual_paper_projection(projection.p2, p2),
    )


def _subject_document(subject: ExamSubjectProfile) -> dict[str, Any]:
    return {
        "id": subject.id,
        "targetSlug": subject.target_slug,
        "subjectKey": subject.subject_key,
        "displayName": subject.display_name,
        "aliases": list(subject.aliases),
        "paper": subject.paper,
        "questionCount": subject.question_count,
        "questionWeight": subject.question_weight,
        "discursiveEligible": subject.discursive_eligible,
        "baselineAccuracyBp": subject.baseline_accuracy_bp,
        "targetLowBp": subject.target_low_bp,
        "targetHighBp": subject.target_high_bp,
        "baselineConfidenceBp": subject.baseline_confidence_bp,
        "focusBand": subject.focus_band,
        "baselineSource": subject.baseline_source,
        "notes": subject.notes,
        "active": subject.active,
        "version": subject.version,
    }


def _config_document(
    config: ExamSprintConfig,
    subjects: tuple[ExamSubjectProfile, ...],
    *,
    replayed: bool,
) -> dict[str, Any]:
    return {
        "targetSlug": config.target_slug,
        "startDate": config.start_date.isoformat(),
        "objectiveDate": config.objective_date.isoformat(),
        "examEndDate": config.exam_end_date.isoformat(),
        "lsBudgetMinutes": config.ls_budget_minutes,
        "extraBudgetMinutes": config.extra_budget_minutes,
        "triageMode": config.triage_mode,
        "state": config.state,
        "goals": {
            "p1Floor": config.p1_floor_questions,
            "p1Low": config.p1_goal_low,
            "p1High": config.p1_goal_high,
            "p2Low": config.p2_goal_low,
            "p2High": config.p2_goal_high,
            "discursiveLow": config.discursive_goal_low,
            "discursiveHigh": config.discursive_goal_high,
        },
        "subjects": [_subject_document(subject) for subject in subjects],
        "version": config.version,
        "replayed": replayed,
    }


class SprintDayService:
    def __init__(self, connection: sqlite3.Connection):
        self.connection = connection
        self.repository = SprintRepository(connection)
        self.engine = SprintEngine()

    def generate(
        self,
        payload: Mapping[str, Any],
        *,
        idempotency_key: str,
        refresh: bool,
    ) -> dict[str, Any]:
        prepared = self._prepare_generation(payload)
        target_slug = prepared["target_slug"]
        config, subjects = SprintProfileService(self.connection).bootstrap(target_slug)
        effective_config = replace(
            config,
            ls_budget_minutes=(
                prepared["ls_budget_minutes"]
                if prepared["ls_budget_minutes"] is not None
                else config.ls_budget_minutes
            ),
            extra_budget_minutes=(
                prepared["extra_budget_minutes"]
                if prepared["extra_budget_minutes"] is not None
                else config.extra_budget_minutes
            ),
        )
        key = _text(idempotency_key, "Idempotency-Key")
        receipt_key = f"sprint-{'refresh' if refresh else 'generate'}:{key}"
        input_hash = _hash(payload)
        existing = self.repository.get_run_by_idempotency(receipt_key)
        if existing is not None:
            if existing["input_hash"] != input_hash:
                raise IdempotencyConflictError(
                    "Idempotency-Key was already used with another payload"
                )
            return self._run_document(existing, replayed=True)

        latest = self.repository.latest_day_run(target_slug, prepared["plan_date"])
        completed_source_ids: set[int] = set()
        if refresh and latest is not None:
            completed_source_ids = self.repository.resolved_source_task_ids_for_day(
                target_slug, prepared["plan_date"]
            )
        source_tasks = tuple(
            task
            for task in self.repository.list_source_tasks(
                target_slug,
                scheduled_date=prepared["plan_date"],
                include_inactive=False,
            )
            if task.id not in completed_source_ids
        )
        projection = SprintProjectionService(self.connection).project(
            target_slug,
            prepared["plan_date"],
        )
        projection_origin = "derived"
        if prepared["p1_projection"] is not None:
            projection = _manual_projection(
                projection,
                p1=prepared["p1_projection"],
                p2=prepared["p2_projection"],
            )
            projection_origin = "manual"
        subject_projections = {
            subject.subject_key: subject for subject in projection.subjects
        }
        draft = self.engine.generate(
            config=effective_config,
            subjects=subjects,
            source_tasks=source_tasks,
            plan_date=prepared["plan_date"],
            energy_level=prepared["energy_level"],
            subject_projections=subject_projections,
            projection=projection,
            afo_rescues_this_week=self.repository.afo_rescues_this_week(
                target_slug, prepared["plan_date"]
            ),
        )
        score_snapshot = dict(draft.score_snapshot) | {
            "modeLabel": draft.mode_label,
            "projection": projection_document(projection),
            "projectionOrigin": projection_origin,
        }
        status = "generated" if draft.actions else "shortfall"

        self.connection.execute("BEGIN IMMEDIATE")
        try:
            run = self.repository.insert_day_run(
                idempotency_key=receipt_key,
                target_slug=target_slug,
                plan_date=prepared["plan_date"],
                days_remaining=draft.days_remaining,
                ls_budget_minutes=(
                    min(effective_config.ls_budget_minutes, 120)
                    if draft.days_remaining == 1
                    else effective_config.ls_budget_minutes
                ),
                extra_budget_minutes=(
                    min(effective_config.extra_budget_minutes, 30)
                    if draft.days_remaining == 1
                    else effective_config.extra_budget_minutes
                ),
                energy_level=prepared["energy_level"],
                algorithm_version=self.engine.algorithm_version,
                input_hash=input_hash,
                supersedes_run_id=latest["id"] if refresh and latest else None,
                status=status,
                score_snapshot=score_snapshot,
            )
            for position, action in enumerate(draft.actions, start=1):
                saved_action = self.repository.insert_action(
                    run_id=run["id"],
                    target_slug=target_slug,
                    position=position,
                    values=self._action_values(action),
                )
                if action.action_kind == "review" and action.planned_questions > 0:
                    refs = self.repository.review_question_refs(
                        target_slug,
                        action.subject_profile_id,
                        limit=action.planned_questions,
                    )
                    self.repository.insert_action_question_refs(
                        saved_action["id"], refs
                    )
            self.connection.commit()
        except Exception:
            self.connection.rollback()
            raise
        saved = self.repository.latest_day_run(target_slug, prepared["plan_date"])
        if saved is None:
            raise RuntimeError("generated sprint day disappeared")
        return self._run_document(saved, replayed=False)

    def get_day(self, target_slug: str, plan_date: date) -> dict[str, Any]:
        if not self.repository.target_exists(target_slug):
            raise SprintTargetNotFoundError(target_slug)
        run = self.repository.latest_day_run(target_slug, plan_date)
        if run is None:
            raise SprintDayNotFoundError(f"{target_slug}:{plan_date.isoformat()}")
        return self._run_document(run, replayed=False)

    def update_action(
        self,
        action_id: int,
        payload: Mapping[str, Any],
        *,
        idempotency_key: str,
    ) -> dict[str, Any]:
        action = self.repository.get_action(action_id)
        if action is None:
            raise SprintActionNotFoundError(action_id)
        key = _text(idempotency_key, "Idempotency-Key")
        receipt_key = f"sprint-action:{action_id}:{key}"
        payload_hash = _hash(payload)
        receipt = self.repository.get_receipt(receipt_key)
        if receipt is not None:
            if receipt["payload_hash"] != payload_hash:
                raise IdempotencyConflictError(
                    "Idempotency-Key was already used with another payload"
                )
            return json.loads(receipt["response_json"]) | {"replayed": True}

        values, refs, expected_version = self._prepare_action_result(payload)
        self.connection.execute("BEGIN IMMEDIATE")
        try:
            saved = self.repository.update_action(
                action_id,
                expected_version=expected_version,
                values=values,
            )
            self.repository.insert_action_question_refs(action_id, refs)
            response = self._action_document(saved) | {"replayed": False}
            self.repository.save_receipt(
                idempotency_key=receipt_key,
                mutation_kind="sprint_action_update",
                target_slug=saved["target_slug"],
                entity_ref=str(action_id),
                payload_hash=payload_hash,
                response=response,
            )
            self.connection.commit()
            return response
        except Exception:
            self.connection.rollback()
            raise

    def trajectory(self, target_slug: str) -> dict[str, Any]:
        if not self.repository.target_exists(target_slug):
            raise SprintTargetNotFoundError(target_slug)
        runs = self.repository.list_runs(target_slug)
        documents = []
        for run in runs:
            snapshot = json.loads(run["score_snapshot_json"])
            projection = snapshot.get("projection")
            p1 = (
                projection["p1"]["projected"]
                if isinstance(projection, Mapping)
                else snapshot.get("p1Projection", 0)
            )
            p2 = (
                projection["p2"]["projected"]
                if isinstance(projection, Mapping)
                else snapshot.get("p2Projection", 0)
            )
            documents.append(
                {
                    "runId": run["id"],
                    "date": run["plan_date"],
                    "p1": p1,
                    "p2": p2,
                    "generatedAt": run["generated_at"],
                }
            )
        latest = documents[-1] if documents else {"p1": 0, "p2": 0}
        return {"targetSlug": target_slug, "latest": latest, "runs": documents}

    def _run_document(self, run: sqlite3.Row, *, replayed: bool) -> dict[str, Any]:
        snapshot = json.loads(run["score_snapshot_json"])
        projection = snapshot.get("projection")
        p1_projection = (
            projection["p1"]["projected"]
            if isinstance(projection, Mapping)
            else snapshot.get("p1Projection", 0)
        )
        p2_projection = (
            projection["p2"]["projected"]
            if isinstance(projection, Mapping)
            else snapshot.get("p2Projection", 0)
        )
        actions = [
            self._action_document(action)
            for action in self.repository.list_run_actions(run["id"])
        ]
        eligible = [
            action
            for action in actions
            if action["recommendation"] in {"execute", "compress", "extra"}
            and action["state"] not in {"completed", "skipped", "failed"}
        ]
        viable: list[dict[str, Any]] = []
        groups = (
            [action for action in eligible if action["sourcePlanTaskId"] is not None],
            [
                action
                for action in eligible
                if action["sourcePlanTaskId"] is None
                and action["subjectKey"] == "p2_lte"
            ],
            [
                action
                for action in eligible
                if action["sourcePlanTaskId"] is None
                and action["subjectKey"] != "p2_lte"
            ],
        )
        for group in groups:
            if group:
                viable.append(group[0])
        for action in eligible:
            if len(viable) >= 3:
                break
            if action not in viable:
                viable.append(action)
        return {
            "runId": run["id"],
            "targetSlug": run["target_slug"],
            "date": run["plan_date"],
            "daysRemaining": run["days_remaining"],
            "modeLabel": snapshot.get("modeLabel", "Reta final tatica"),
            "capacity": {
                "lsBudgetMinutes": run["ls_budget_minutes"],
                "extraBudgetMinutes": run["extra_budget_minutes"],
                "energyLevel": run["energy_level"],
            },
            "projections": {
                "p1": p1_projection,
                "p2": p2_projection,
            },
            "projection": projection,
            "projectionOrigin": snapshot.get("projectionOrigin", "legacy"),
            "actions": actions,
            "minimumViable": {
                "actionIds": [action["id"] for action in viable],
                "minutes": sum(action["durationMinutes"] for action in viable),
            },
            "supersedesRunId": run["supersedes_run_id"],
            "status": run["status"],
            "algorithmVersion": run["algorithm_version"],
            "generatedAt": run["generated_at"],
            "version": 1,
            "replayed": replayed,
        }

    def _action_document(self, row: sqlite3.Row) -> dict[str, Any]:
        rationale = json.loads(row["rationale_json"])
        evidence = json.loads(row["evidence_json"])
        refs = self.repository.list_action_question_refs(row["id"])
        return {
            "id": row["id"],
            "runId": row["run_id"],
            "position": row["position"],
            "actionKind": row["action_kind"],
            "recommendation": row["recommendation"],
            "sourcePlanTaskId": row["source_plan_task_id"],
            "externalTaskId": row["external_task_id"],
            "planLabel": row["plan_label"],
            "subjectProfileId": row["subject_profile_id"],
            "subjectKey": row["subject_key"],
            "subjectName": row["display_name"],
            "paper": row["paper"],
            "topicHint": row["topic_hint"],
            "title": row["title"],
            "durationMinutes": row["duration_minutes"],
            "plannedQuestions": row["planned_questions"],
            "expectedGainMilli": row["expected_gain_milli"],
            "confidenceBp": row["confidence_bp"],
            "whyNow": rationale[0] if rationale else "",
            "rationale": rationale,
            "scoreDetails": evidence
            | {
                "expectedGainMilli": row["expected_gain_milli"],
                "confidenceBp": row["confidence_bp"],
                "paper": row["paper"],
                "questionWeight": row["question_weight"],
            },
            "decision": row["decision"],
            "state": row["state"],
            "actualMinutes": row["actual_minutes"],
            "questionsDone": row["questions_done"],
            "correctCount": row["correct_count"],
            "wrongCount": row["wrong_count"],
            "doubtCount": row["doubt_count"],
            "energyAfter": row["energy_after"],
            "linkedStudyTaskId": row["linked_study_task_id"],
            "materialHint": row["source_material_hint"] or "",
            "questionRefs": [
                {
                    "questionFingerprint": ref["question_fingerprint"],
                    "sourceTaskId": ref["source_task_id"],
                    "reason": ref["reason"],
                }
                for ref in refs
            ],
            "version": row["version"],
        }

    @staticmethod
    def _action_values(action: SprintActionDraft) -> dict[str, Any]:
        return {
            "action_kind": action.action_kind,
            "recommendation": action.recommendation,
            "source_plan_task_id": action.source_plan_task_id,
            "subject_profile_id": action.subject_profile_id,
            "topic_hint": action.topic_hint,
            "title": action.title,
            "duration_minutes": action.duration_minutes,
            "planned_questions": action.planned_questions,
            "expected_gain_milli": action.expected_gain_milli,
            "confidence_bp": action.confidence_bp,
            "rationale": list(action.rationale),
            "evidence": dict(action.evidence),
        }

    @staticmethod
    def _prepare_generation(payload: Mapping[str, Any]) -> dict[str, Any]:
        if not isinstance(payload, Mapping):
            raise ValueError("sprint day payload must be an object")
        p1 = payload.get("p1Projection")
        p2 = payload.get("p2Projection")
        if (p1 is None) != (p2 is None):
            raise ValueError("P1 and P2 projections must be supplied together")
        ls_budget = payload.get("lsBudgetMinutes")
        extra_budget = payload.get("extraBudgetMinutes")
        return {
            "target_slug": _text(payload.get("targetSlug"), "target"),
            "plan_date": _date(payload.get("date"), "date"),
            "energy_level": _integer(
                payload.get("energyLevel", 3),
                "energy level",
                minimum=1,
                maximum=5,
            ),
            "p1_projection": (
                _number(p1, "P1 projection", minimum=0, maximum=80)
                if p1 is not None
                else None
            ),
            "p2_projection": (
                _number(p2, "P2 projection", minimum=0, maximum=80)
                if p2 is not None
                else None
            ),
            "ls_budget_minutes": (
                _integer(
                    ls_budget,
                    "LS budget",
                    minimum=15,
                    maximum=720,
                )
                if ls_budget is not None
                else None
            ),
            "extra_budget_minutes": (
                _integer(
                    extra_budget,
                    "extra budget",
                    minimum=0,
                    maximum=240,
                )
                if extra_budget is not None
                else None
            ),
        }

    @staticmethod
    def _prepare_action_result(
        payload: Mapping[str, Any]
    ) -> tuple[dict[str, Any], tuple[dict[str, Any], ...], int]:
        expected_version = _integer(
            payload.get("expectedVersion"),
            "expected version",
            minimum=1,
            maximum=2_147_483_647,
        )
        decision = payload.get("decision", "accepted")
        state = payload.get("state")
        if decision not in {"pending", "accepted", "rejected"}:
            raise ValueError("invalid action decision")
        if state not in {"pending", "active", "completed", "skipped", "failed"}:
            raise ValueError("invalid action state")
        if decision == "pending" and state != "pending":
            raise ValueError("pending decision requires pending state")
        if decision == "rejected" and state != "skipped":
            raise ValueError("rejected decision requires skipped state")
        if decision == "accepted" and state == "pending":
            raise ValueError("accepted decision cannot remain pending")
        questions_done = _integer(
            payload.get("questionsDone", 0),
            "questions done",
            minimum=0,
            maximum=10000,
        )
        correct = _integer(
            payload.get("correctCount", 0),
            "correct count",
            minimum=0,
            maximum=questions_done,
        )
        wrong = _integer(
            payload.get("wrongCount", 0),
            "wrong count",
            minimum=0,
            maximum=questions_done,
        )
        doubts = _integer(
            payload.get("doubtCount", 0),
            "doubt count",
            minimum=0,
            maximum=questions_done,
        )
        if correct + wrong > questions_done:
            raise ValueError("correct and wrong counts exceed questions done")
        actual = payload.get("actualMinutes")
        energy = payload.get("energyAfter")
        refs_payload = payload.get("questionRefs", [])
        if not isinstance(refs_payload, list):
            raise ValueError("question refs must be an array")
        refs: list[dict[str, Any]] = []
        for ref in refs_payload:
            if not isinstance(ref, Mapping):
                raise ValueError("question ref must be an object")
            reason = ref.get("reason")
            if reason not in {"wrong", "doubt", "favorite"}:
                raise ValueError("invalid question ref reason")
            refs.append(
                {
                    "question_fingerprint": _text(
                        ref.get("questionFingerprint"), "question fingerprint"
                    ),
                    "source_task_id": (
                        str(ref["sourceTaskId"])
                        if ref.get("sourceTaskId") is not None
                        else None
                    ),
                    "reason": reason,
                }
            )
        return (
            {
                "decision": decision,
                "state": state,
                "actual_minutes": (
                    _integer(actual, "actual minutes", minimum=0, maximum=720)
                    if actual is not None
                    else None
                ),
                "questions_done": questions_done,
                "correct_count": correct,
                "wrong_count": wrong,
                "doubt_count": doubts,
                "energy_after": (
                    _integer(energy, "energy after", minimum=1, maximum=5)
                    if energy is not None
                    else None
                ),
            },
            tuple(refs),
            expected_version,
        )


class SprintConfigMutationService:
    def __init__(self, connection: sqlite3.Connection):
        self.connection = connection
        self.repository = SprintRepository(connection)

    def update(
        self, payload: Mapping[str, Any], *, idempotency_key: str
    ) -> dict[str, Any]:
        target_slug = _text(payload.get("targetSlug"), "target")
        current, subjects = SprintProfileService(self.connection).bootstrap(target_slug)
        key = _text(idempotency_key, "Idempotency-Key")
        receipt_key = f"sprint-config:{key}"
        payload_hash = _hash(payload)
        receipt = self.repository.get_receipt(receipt_key)
        if receipt is not None:
            if receipt["payload_hash"] != payload_hash:
                raise IdempotencyConflictError(
                    "Idempotency-Key was already used with another payload"
                )
            return json.loads(receipt["response_json"]) | {"replayed": True}
        expected_version = _integer(
            payload.get("expectedVersion"),
            "expected version",
            minimum=1,
            maximum=2_147_483_647,
        )
        goals = payload.get("goals", {})
        if not isinstance(goals, Mapping):
            raise ValueError("goals must be an object")
        values = {
            "target_slug": target_slug,
            "ls_budget_minutes": _integer(
                payload.get("lsBudgetMinutes", current.ls_budget_minutes),
                "LS budget",
                minimum=15,
                maximum=720,
            ),
            "extra_budget_minutes": _integer(
                payload.get("extraBudgetMinutes", current.extra_budget_minutes),
                "extra budget",
                minimum=0,
                maximum=240,
            ),
            "p1_floor_questions": _integer(
                goals.get("p1Floor", current.p1_floor_questions),
                "P1 floor",
                minimum=0,
                maximum=80,
            ),
            "p1_goal_low": _integer(
                goals.get("p1Low", current.p1_goal_low),
                "P1 low goal",
                minimum=0,
                maximum=80,
            ),
            "p1_goal_high": _integer(
                goals.get("p1High", current.p1_goal_high),
                "P1 high goal",
                minimum=0,
                maximum=80,
            ),
            "p2_goal_low": _integer(
                goals.get("p2Low", current.p2_goal_low),
                "P2 low goal",
                minimum=0,
                maximum=80,
            ),
            "p2_goal_high": _integer(
                goals.get("p2High", current.p2_goal_high),
                "P2 high goal",
                minimum=0,
                maximum=80,
            ),
            "discursive_goal_low": _integer(
                goals.get("discursiveLow", current.discursive_goal_low),
                "discursive low goal",
                minimum=0,
                maximum=100,
            ),
            "discursive_goal_high": _integer(
                goals.get("discursiveHigh", current.discursive_goal_high),
                "discursive high goal",
                minimum=0,
                maximum=100,
            ),
            "state": payload.get("state", current.state),
        }
        if values["state"] not in {"active", "paused", "completed"}:
            raise ValueError("invalid sprint state")
        for label, low_key, high_key in (
            ("P1", "p1_goal_low", "p1_goal_high"),
            ("P2", "p2_goal_low", "p2_goal_high"),
            ("discursive", "discursive_goal_low", "discursive_goal_high"),
        ):
            if values[low_key] > values[high_key]:
                raise ValueError(f"{label} low goal cannot exceed high goal")

        self.connection.execute("BEGIN IMMEDIATE")
        try:
            saved = self.repository.update_config(values, expected_version=expected_version)
            response = _config_document(saved, subjects, replayed=False)
            self.repository.save_receipt(
                idempotency_key=receipt_key,
                mutation_kind="sprint_config_update",
                target_slug=target_slug,
                entity_ref=target_slug,
                payload_hash=payload_hash,
                response=response,
            )
            self.connection.commit()
            return response
        except Exception:
            self.connection.rollback()
            raise
