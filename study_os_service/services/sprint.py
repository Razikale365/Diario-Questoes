from __future__ import annotations

from datetime import UTC, date, datetime
import hashlib
import json
import sqlite3
from typing import Any, Mapping

from study_os_service.domain.sprint import ExamSprintConfig, SourcePlanTask
from study_os_service.repositories.sprint import SprintRepository
from study_os_service.repositories.task_execution import TaskExecutionRepository
from study_os_service.services.subject_matching import match_subject
from study_os_service.services.source_plan_cycles import (
    SourcePlanCycleService,
    cycle_document,
)


OFFICIAL_EDITAL_URL = (
    "https://www.sefaz.ce.gov.br/wp-content/uploads/sites/61/2026/04/"
    "do20260424p02.pdf"
)


def _subject(
    subject_key: str,
    display_name: str,
    aliases: tuple[str, ...],
    paper: str,
    question_count: int,
    *,
    focus_band: str = "maintenance",
    discursive: bool = False,
    unknown_baseline: bool = False,
) -> dict[str, Any]:
    p1 = paper == "P1"
    return {
        "target_slug": "sefaz_ce",
        "subject_key": subject_key,
        "display_name": display_name,
        "aliases": aliases,
        "paper": paper,
        "question_count": question_count,
        "question_weight": 1 if p1 else 2,
        "discursive_eligible": discursive,
        "baseline_accuracy_bp": (
            None if unknown_baseline else (5250 if p1 else 6875)
        ),
        "target_low_bp": 6000 if p1 else 7875,
        "target_high_bp": 6500 if p1 else 8375,
        "baseline_confidence_bp": 0 if unknown_baseline else 1500,
        "focus_band": focus_band,
        "baseline_source": "unknown" if unknown_baseline else "sefaz_go_proxy",
        "notes": (
            "Sem evidencia CE; preencher com conjuntos recentes."
            if unknown_baseline
            else "Proxy agregado SEFAZ GO; baixa confianca e editavel."
        ),
    }


OFFICIAL_SEFAZ_SUBJECTS = (
    _subject("p1_portugues", "Lingua Portuguesa", ("portugues", "lingua portuguesa"), "P1", 10),
    _subject(
        "p1_matematica_estatistica_rlm",
        "Matematica Financeira, Estatistica e Raciocinio Logico",
        ("matematica financeira", "estatistica", "raciocinio logico", "rlm"),
        "P1",
        12,
    ),
    _subject(
        "p1_administracao_governanca",
        "Administracao e Governanca",
        ("administracao geral", "administracao publica", "governanca"),
        "P1",
        10,
    ),
    _subject("p1_economia", "Economia", ("economia",), "P1", 10),
    _subject(
        "p1_direitos_gerais",
        "Direitos Constitucional, Administrativo, Civil e Penal",
        (
            "direito constitucional",
            "direito administrativo",
            "direito civil",
            "direito penal",
        ),
        "P1",
        12,
    ),
    _subject(
        "p1_direito_financeiro",
        "Direito Financeiro",
        ("direito financeiro", "afo", "administracao financeira e orcamentaria"),
        "P1",
        8,
        focus_band="survival",
    ),
    _subject(
        "p1_contabilidade_geral_publica",
        "Contabilidade Geral e Publica",
        ("contabilidade geral", "contabilidade publica", "contabilidade aplicada ao setor publico"),
        "P1",
        10,
    ),
    _subject("p1_auditoria", "Auditoria", ("auditoria", "auditoria fiscal"), "P1", 8),
    _subject(
        "p2_direito_tributario",
        "Direito Tributario",
        ("direito tributario", "reforma tributaria", "reforma tributaria sobre o consumo"),
        "P2",
        20,
        discursive=True,
    ),
    _subject(
        "p2_lte",
        "Legislacao Tributaria Estadual do Ceara",
        (
            "legislacao tributaria estadual",
            "legis tribut estadual",
            "legis. tribut. estadual (icms)",
            "icms ceara",
            "itcd ceara",
            "lte",
        ),
        "P2",
        20,
        focus_band="focus",
        discursive=True,
        unknown_baseline=True,
    ),
    _subject(
        "p2_contabilidade_avancada_custos",
        "Contabilidade Avancada e de Custos",
        (
            "contabilidade avancada",
            "contabilidade de custos",
            "contabilidade avancada e custos",
            "custos",
        ),
        "P2",
        20,
        focus_band="focus",
        discursive=True,
    ),
    _subject(
        "p2_tecnologia_dados",
        "Fluencia de Dados",
        ("fluencia de dados", "ciencia de dados"),
        "P2",
        10,
    ),
    _subject(
        "p2_financas_publicas",
        "Financas Publicas",
        ("financas publicas", "financas", "economia do setor publico"),
        "P2",
        10,
        focus_band="focus",
        discursive=True,
    ),
)


DEFAULT_SEFAZ_CONFIG = ExamSprintConfig(
    target_slug="sefaz_ce",
    start_date=date(2026, 7, 13),
    objective_date=date(2026, 8, 1),
    exam_end_date=date(2026, 8, 2),
    ls_budget_minutes=240,
    extra_budget_minutes=60,
    p1_floor_questions=48,
    p1_goal_low=48,
    p1_goal_high=64,
    p2_goal_low=63,
    p2_goal_high=70,
    discursive_goal_low=75,
    discursive_goal_high=82,
    triage_mode="suggest_only",
    state="active",
    version=1,
)


class SprintTargetNotFoundError(KeyError):
    pass


class IdempotencyConflictError(RuntimeError):
    pass


def _canonical_hash(payload: object) -> str:
    document = json.dumps(payload, ensure_ascii=True, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(document.encode("utf-8")).hexdigest()


def _required_text(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{label} is required")
    return value.strip()


def _integer(
    value: Any,
    label: str,
    *,
    minimum: int = 0,
    maximum: int = 2_147_483_647,
) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"{label} must be an integer")
    if not minimum <= value <= maximum:
        raise ValueError(f"{label} must be between {minimum} and {maximum}")
    return value


def _optional_date(value: Any, label: str) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError(f"{label} must use YYYY-MM-DD")
    try:
        return date.fromisoformat(value).isoformat()
    except ValueError as exc:
        raise ValueError(f"{label} must use YYYY-MM-DD") from exc


class SprintProfileService:
    def __init__(self, connection: sqlite3.Connection):
        self.connection = connection
        self.repository = SprintRepository(connection)

    def bootstrap(self, target_slug: str) -> tuple[ExamSprintConfig, tuple[Any, ...]]:
        self.connection.execute("BEGIN IMMEDIATE")
        try:
            result = self.bootstrap_in_transaction(target_slug)
            self.connection.commit()
            return result
        except Exception:
            self.connection.rollback()
            raise

    def bootstrap_in_transaction(
        self, target_slug: str
    ) -> tuple[ExamSprintConfig, tuple[Any, ...]]:
        if not self.connection.in_transaction:
            raise RuntimeError("caller must own an active profile transaction")
        if not self.repository.target_exists(target_slug):
            raise SprintTargetNotFoundError(target_slug)
        if target_slug == "sefaz_ce":
            self.repository.ensure_subjects(OFFICIAL_SEFAZ_SUBJECTS)
            self.repository.ensure_config(DEFAULT_SEFAZ_CONFIG)
        config = self.repository.get_config(target_slug)
        if config is None:
            raise ValueError(f"target {target_slug} has no sprint configuration")
        return config, self.repository.list_subjects(target_slug)


class SourcePlanService:
    def __init__(self, connection: sqlite3.Connection):
        self.connection = connection
        self.repository = SprintRepository(connection)

    def import_tasks(
        self, payload: Mapping[str, Any], *, idempotency_key: str
    ) -> dict[str, Any]:
        key = _required_text(idempotency_key, "Idempotency-Key")
        prepared = self._prepare_import(payload)
        target_slug = prepared["target_slug"]
        SprintProfileService(self.connection).bootstrap(target_slug)
        payload_hash = _canonical_hash(payload)
        receipt_key = f"source-plan:{key}"
        existing_receipt = self.repository.get_receipt(receipt_key)
        if existing_receipt is not None:
            if existing_receipt["payload_hash"] != payload_hash:
                raise IdempotencyConflictError(
                    "Idempotency-Key was already used with another payload"
                )
            response = json.loads(existing_receipt["response_json"])
            return response | {"replayed": True}

        subjects = self.repository.list_subjects(target_slug)
        created_count = 0
        updated_count = 0
        unresolved_count = 0
        saved_ids: list[int] = []
        cycle_overrun_count = 0

        self.connection.execute("BEGIN IMMEDIATE")
        try:
            cycle = None
            if prepared["cycle"] is not None:
                cycle = SourcePlanCycleService(self.connection).upsert_in_transaction(
                    target_slug=target_slug,
                    source_kind=prepared["source_kind"],
                    plan_label=prepared["plan_label"],
                    meta_number=prepared["meta_number"],
                    allow_correction=prepared["cycle_correction"],
                    **prepared["cycle"],
                )
            for task in prepared["tasks"]:
                task["source_cycle_id"] = cycle.id if cycle else None
                if (
                    cycle is not None
                    and task["scheduled_date"] is not None
                    and date.fromisoformat(task["scheduled_date"]) > cycle.ends_on
                ):
                    task["provenance"] = dict(task["provenance"]) | {
                        "originalScheduledDate": task["scheduled_date"]
                    }
                    task["scheduled_date"] = None
                    cycle_overrun_count += 1
                subject_key = match_subject(task["discipline"], subjects).subject_key
                task["subject_key"] = subject_key
                unresolved_count += int(
                    subject_key is None
                    and task["task_kind"] not in {"simulation", "discursive"}
                )
                existing = self.repository.find_source_task(
                    target_slug,
                    prepared["source_kind"],
                    task["external_task_id"],
                )
                if existing is not None:
                    terminal_execution = TaskExecutionRepository(
                        self.connection
                    ).latest_terminal_for_source_task(target_slug, existing.id)
                    self._merge_existing_evidence(
                        task, existing, terminal_execution=terminal_execution
                    )
                saved, created = self.repository.upsert_source_task(task)
                saved_ids.append(saved.id)
                created_count += int(created)
                updated_count += int(not created)
            response = {
                "targetSlug": target_slug,
                "sourceKind": prepared["source_kind"],
                "planLabel": prepared["plan_label"],
                "createdCount": created_count,
                "updatedCount": updated_count,
                "unresolvedCount": unresolved_count,
                "cycleOverrunCount": cycle_overrun_count,
                "cycle": cycle_document(cycle),
                "taskIds": saved_ids,
                "replayed": False,
            }
            self.repository.save_receipt(
                idempotency_key=receipt_key,
                mutation_kind="source_plan_import",
                target_slug=target_slug,
                entity_ref=prepared["plan_label"],
                payload_hash=payload_hash,
                response=response,
            )
            self.connection.commit()
            return response
        except Exception:
            self.connection.rollback()
            raise

    def list_tasks(
        self,
        target_slug: str,
        *,
        scheduled_date: date | None,
        include_inactive: bool,
    ) -> tuple[SourcePlanTask, ...]:
        if not self.repository.target_exists(target_slug):
            raise SprintTargetNotFoundError(target_slug)
        return self.repository.list_source_tasks(
            target_slug,
            scheduled_date=scheduled_date,
            include_inactive=include_inactive,
        )

    @staticmethod
    def _merge_existing_evidence(
        task: dict[str, Any],
        existing: SourcePlanTask,
        *,
        terminal_execution: Any | None,
    ) -> None:
        incoming_provenance = task["provenance"]
        local_sync = incoming_provenance.get("origin") == "planner-local-sync"
        incoming_is_ls_history = (
            incoming_provenance.get("origin") == "ls-visible-history"
        )
        existing_is_ls_history = (
            existing.provenance.get("origin") == "ls-visible-history"
        )
        if terminal_execution is not None:
            task["status"] = (
                "completed"
                if terminal_execution.outcome == "completed"
                else existing.status
            )
            task["spent_minutes"] = terminal_execution.task_minutes
            task["performance_bp"] = terminal_execution.performance_bp
        elif local_sync and existing_is_ls_history:
            task["status"] = existing.status
            task["performance_bp"] = existing.performance_bp
        elif task["performance_bp"] is None:
            task["performance_bp"] = existing.performance_bp

        if not incoming_is_ls_history and terminal_execution is None:
            task["spent_minutes"] = max(
                existing.spent_minutes,
                task["spent_minutes"],
            )
        if not task["material_hint"]:
            task["material_hint"] = existing.material_hint
        if not task["details"]:
            task["details"] = existing.details
        if not task["topic_hint"]:
            task["topic_hint"] = existing.topic_hint
        if task["linked_study_task_id"] is None:
            task["linked_study_task_id"] = existing.linked_study_task_id
        if task["source_cycle_id"] is None:
            task["source_cycle_id"] = existing.source_cycle_id

        merged_provenance = dict(existing.provenance)
        canonical_keys = {
            "taskExecutionId", "lastOutcome", "observedOn", "completedAt",
            "questionsTotal", "correctCount", "wrongCount", "doubtCount",
            "exerciseMinutes",
        }
        for key, value in incoming_provenance.items():
            if (
                key not in canonical_keys
                and value is not None
                and value != ""
            ):
                merged_provenance[key] = value
        if terminal_execution is not None:
            merged_provenance |= {
                "taskExecutionId": terminal_execution.id,
                "lastOutcome": terminal_execution.outcome,
                "observedOn": terminal_execution.performed_on.isoformat(),
                "questionsTotal": terminal_execution.questions_total,
                "correctCount": terminal_execution.correct_count,
                "wrongCount": terminal_execution.wrong_count,
                "doubtCount": terminal_execution.doubt_count,
                "exerciseMinutes": terminal_execution.exercise_minutes,
            }
            if terminal_execution.outcome == "completed":
                merged_provenance["completedAt"] = terminal_execution.recorded_at.isoformat(
                    timespec="microseconds"
                ).replace("+00:00", "Z")
        if local_sync and existing_is_ls_history:
            merged_provenance["origin"] = "ls-visible-history"
            merged_provenance["lastSyncOrigin"] = "planner-local-sync"
        task["provenance"] = merged_provenance

    @staticmethod
    def _prepare_import(payload: Mapping[str, Any]) -> dict[str, Any]:
        if not isinstance(payload, Mapping):
            raise ValueError("source plan payload must be an object")
        target_slug = _required_text(payload.get("targetSlug"), "target")
        source_kind = _required_text(payload.get("sourceKind"), "source kind")
        if source_kind not in {"ls", "trilha", "manual"}:
            raise ValueError("source kind must be ls, trilha, or manual")
        plan_label = _required_text(payload.get("planLabel"), "plan label")
        meta_number = payload.get("metaNumber")
        if meta_number is not None:
            meta_number = _integer(meta_number, "meta number")
        cycle_payload = payload.get("cycle")
        cycle_correction = payload.get("cycleCorrection", False)
        if not isinstance(cycle_correction, bool):
            raise ValueError("cycleCorrection must be boolean")
        cycle = None
        if cycle_payload is not None:
            if not isinstance(cycle_payload, Mapping):
                raise ValueError("cycle must be an object")
            try:
                released_at = datetime.fromisoformat(
                    str(cycle_payload.get("releasedAt", "")).replace("Z", "+00:00")
                )
            except ValueError as exc:
                raise ValueError("cycle releasedAt must be an ISO timestamp") from exc
            if released_at.tzinfo is None or released_at.utcoffset() is None:
                raise ValueError("cycle releasedAt must be timezone-aware")
            try:
                starts_on = date.fromisoformat(str(cycle_payload.get("startsOn", "")))
                ends_on = date.fromisoformat(str(cycle_payload.get("endsOn", "")))
            except ValueError as exc:
                raise ValueError("cycle dates must use YYYY-MM-DD") from exc
            if starts_on > ends_on:
                raise ValueError("cycle dates must be ordered")
            if released_at.date() > ends_on:
                raise ValueError("cycle release cannot be after its end")
            cycle = {
                "released_at": released_at.astimezone(UTC),
                "starts_on": starts_on,
                "ends_on": ends_on,
            }
        tasks = payload.get("tasks")
        if not isinstance(tasks, list) or not tasks:
            raise ValueError("tasks must be a non-empty array")

        prepared_tasks: list[dict[str, Any]] = []
        for index, task in enumerate(tasks):
            if not isinstance(task, Mapping):
                raise ValueError(f"task {index + 1} must be an object")
            task_kind = _required_text(task.get("taskKind"), "task kind")
            if task_kind not in {
                "theory", "questions", "review", "simulation", "discursive", "mixed"
            }:
                raise ValueError("invalid task kind")
            status = task.get("status", "pending")
            if status not in {"pending", "started", "completed", "ignored", "archived"}:
                raise ValueError("invalid source task status")
            provenance = task.get("provenance", {})
            if not isinstance(provenance, dict):
                raise ValueError("task provenance must be an object")
            performance = task.get("performanceBp")
            if performance is not None:
                performance = _integer(
                    performance, "performance", minimum=0, maximum=10000
                )
            relevance = task.get("relevance", 5)
            if isinstance(relevance, bool) or not isinstance(relevance, (int, float)):
                raise ValueError("relevance must be numeric")
            if not 0 <= float(relevance) <= 10:
                raise ValueError("relevance must be between 0 and 10")
            prepared_tasks.append(
                {
                    "target_slug": target_slug,
                    "source_kind": source_kind,
                    "external_task_id": _required_text(
                        task.get("externalTaskId"), "external task id"
                    ),
                    "plan_label": plan_label,
                    "meta_number": meta_number,
                    "scheduled_date": _optional_date(
                        task.get("scheduledDate"), "scheduled date"
                    ),
                    "source_order": _integer(
                        task.get("sourceOrder", index), "source order"
                    ),
                    "discipline": _required_text(task.get("discipline"), "discipline"),
                    "subject_key": None,
                    "topic_hint": str(task.get("topicHint", "")),
                    "task_kind": task_kind,
                    "description": _required_text(task.get("description"), "description"),
                    "details": str(task.get("details", "")),
                    "material_hint": str(task.get("materialHint", "")),
                    "estimated_minutes": _integer(
                        task.get("estimatedMinutes", 60),
                        "estimated minutes",
                        minimum=1,
                        maximum=720,
                    ),
                    "spent_minutes": _integer(
                        task.get("spentMinutes", 0),
                        "spent minutes",
                        maximum=720,
                    ),
                    "relevance": float(relevance),
                    "status": status,
                    "performance_bp": performance,
                    "linked_study_task_id": (
                        str(task["linkedStudyTaskId"])
                        if task.get("linkedStudyTaskId") is not None
                        else None
                    ),
                    "provenance": provenance,
                    "source_cycle_id": None,
                }
            )
        return {
            "target_slug": target_slug,
            "source_kind": source_kind,
            "plan_label": plan_label,
            "meta_number": meta_number,
            "cycle": cycle,
            "cycle_correction": cycle_correction,
            "tasks": prepared_tasks,
        }
