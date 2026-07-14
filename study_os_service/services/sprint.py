from __future__ import annotations

from datetime import date
import hashlib
import json
import sqlite3
import unicodedata
from typing import Any, Mapping

from study_os_service.domain.sprint import ExamSprintConfig, SourcePlanTask
from study_os_service.repositories.sprint import SprintRepository


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


def _normalized(value: str) -> str:
    decomposed = unicodedata.normalize("NFKD", value)
    ascii_value = "".join(char for char in decomposed if not unicodedata.combining(char))
    return " ".join(
        "".join(char if char.isalnum() else " " for char in ascii_value.lower()).split()
    )


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
        if not self.repository.target_exists(target_slug):
            raise SprintTargetNotFoundError(target_slug)
        self.connection.execute("BEGIN IMMEDIATE")
        try:
            if target_slug == "sefaz_ce":
                self.repository.ensure_subjects(OFFICIAL_SEFAZ_SUBJECTS)
                self.repository.ensure_config(DEFAULT_SEFAZ_CONFIG)
            self.connection.commit()
        except Exception:
            self.connection.rollback()
            raise
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
        aliases = self._alias_index(subjects)
        created_count = 0
        updated_count = 0
        unresolved_count = 0
        saved_ids: list[int] = []

        self.connection.execute("BEGIN IMMEDIATE")
        try:
            for task in prepared["tasks"]:
                subject_key = self._match_subject(task["discipline"], aliases)
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
                    self._merge_existing_evidence(task, existing)
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
        task: dict[str, Any], existing: SourcePlanTask
    ) -> None:
        incoming_provenance = task["provenance"]
        local_sync = incoming_provenance.get("origin") == "planner-local-sync"
        existing_is_ls_history = (
            existing.provenance.get("origin") == "ls-visible-history"
        )
        if local_sync and existing_is_ls_history:
            task["status"] = existing.status
            task["performance_bp"] = existing.performance_bp
        elif task["performance_bp"] is None:
            task["performance_bp"] = existing.performance_bp

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

        merged_provenance = dict(existing.provenance)
        for key, value in incoming_provenance.items():
            if value is not None and value != "":
                merged_provenance[key] = value
        if local_sync and existing_is_ls_history:
            merged_provenance["origin"] = "ls-visible-history"
            merged_provenance["lastSyncOrigin"] = "planner-local-sync"
        task["provenance"] = merged_provenance

    @staticmethod
    def _alias_index(subjects: tuple[Any, ...]) -> tuple[tuple[str, str], ...]:
        aliases: list[tuple[str, str]] = []
        for subject in subjects:
            for alias in (subject.display_name, *subject.aliases):
                aliases.append((_normalized(alias), subject.subject_key))
        aliases.sort(key=lambda pair: len(pair[0]), reverse=True)
        return tuple(aliases)

    @staticmethod
    def _match_subject(
        discipline: str, aliases: tuple[tuple[str, str], ...]
    ) -> str | None:
        candidate = _normalized(discipline)
        for alias, subject_key in aliases:
            if candidate == alias or alias in candidate or (
                len(candidate) >= 5 and candidate in alias
            ):
                return subject_key
        return None

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
                }
            )
        return {
            "target_slug": target_slug,
            "source_kind": source_kind,
            "plan_label": plan_label,
            "tasks": prepared_tasks,
        }
