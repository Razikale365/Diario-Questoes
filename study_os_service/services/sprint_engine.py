from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import date, timedelta
from types import MappingProxyType
from typing import Mapping

from study_os_service.domain.sprint import (
    ExamSprintConfig,
    ExamSubjectProfile,
    SourcePlanTask,
)
from study_os_service.domain.sprint_evidence import (
    SprintProjection,
    SubjectProjection,
)


@dataclass(frozen=True, slots=True)
class SprintActionDraft:
    action_kind: str
    recommendation: str
    source_plan_task_id: int | None
    subject_profile_id: int
    subject_key: str
    topic_hint: str
    title: str
    duration_minutes: int
    planned_questions: int
    expected_gain_milli: int
    confidence_bp: int
    rationale: tuple[str, ...]
    evidence: Mapping[str, object]


@dataclass(frozen=True, slots=True)
class SprintDayDraft:
    plan_date: date
    days_remaining: int
    mode_label: str
    actions: tuple[SprintActionDraft, ...]
    score_snapshot: Mapping[str, object]


class SprintEngine:
    algorithm_version = "sefaz-ce-sprint-v2"
    MIN_ACTION_MINUTES = 5
    MAX_ACTION_MINUTES = 240

    def generate(
        self,
        *,
        config: ExamSprintConfig,
        subjects: tuple[ExamSubjectProfile, ...],
        source_tasks: tuple[SourcePlanTask, ...],
        plan_date: date,
        energy_level: int,
        subject_projections: Mapping[str, SubjectProjection],
        projection: SprintProjection,
        afo_rescues_this_week: int = 0,
        has_scheduled_simulation: bool | None = None,
    ) -> SprintDayDraft:
        if config.state != "active":
            raise ValueError("sprint must be active to generate a day")
        if not 1 <= energy_level <= 5:
            raise ValueError("energy level must be between 1 and 5")
        if plan_date > config.exam_end_date:
            raise ValueError("plan date is after the exam")
        if projection.as_of != plan_date:
            raise ValueError("projection date must match plan date")
        subject_by_key = {subject.subject_key: subject for subject in subjects if subject.active}
        frozen_subject_projections = {
            subject.subject_key: subject for subject in projection.subjects
        }
        if dict(subject_projections) != frozen_subject_projections:
            raise ValueError("subject projections must match the frozen projection")
        missing_projections = subject_by_key.keys() - subject_projections.keys()
        if missing_projections:
            missing = ", ".join(sorted(missing_projections))
            raise ValueError(f"missing calibrated projections for: {missing}")
        if projection.target_slug != config.target_slug:
            raise ValueError("projection target must match sprint target")
        active_tasks = tuple(
            replace(task, subject_key=subject_key)
            for task in source_tasks
            if task.status in {"pending", "started"}
            if (
                subject_key := self._source_subject_key(
                    task,
                    subject_by_key,
                    subject_projections,
                )
            ) is not None
        )
        days_remaining = max(0, (config.objective_date - plan_date).days)

        if days_remaining == 2:
            actions = self._d2_actions(
                active_tasks,
                subject_by_key,
                min(120, config.ls_budget_minutes + config.extra_budget_minutes),
                subject_projections,
            )
            return self._day(
                plan_date,
                days_remaining,
                "D-2: erros, excecoes e lei seca",
                actions,
                projection,
            )

        d1 = days_remaining == 1
        ls_budget = min(config.ls_budget_minutes, 120) if d1 else config.ls_budget_minutes
        extra_budget = min(config.extra_budget_minutes, 30) if d1 else config.extra_budget_minutes
        ls_actions = self._triage_ls(
            active_tasks,
            subject_by_key,
            subject_projections,
            ls_budget,
        )

        scheduled_simulation = (
            any(task.task_kind == "simulation" for task in active_tasks)
            if has_scheduled_simulation is None
            else has_scheduled_simulation
        )
        extras = self._extra_actions(
            config=config,
            subjects=subjects,
            subject_by_key=subject_by_key,
            plan_date=plan_date,
            budget=extra_budget,
            subject_projections=subject_projections,
            p1_projection=projection.p1.projected,
            afo_rescues_this_week=afo_rescues_this_week,
            has_scheduled_simulation=scheduled_simulation,
        )
        actions = self._positioned(ls_actions + extras)
        mode_label = "D-1: reducao de carga" if d1 else "Reta final tática"
        return self._day(
            plan_date,
            days_remaining,
            mode_label,
            actions,
            projection,
        )

    def _source_subject_key(
        self,
        task: SourcePlanTask,
        subject_by_key: Mapping[str, ExamSubjectProfile],
        subject_projections: Mapping[str, SubjectProjection],
    ) -> str | None:
        if task.subject_key in subject_by_key:
            return task.subject_key
        if task.task_kind == "simulation":
            return "p2_lte" if "p2_lte" in subject_by_key else None
        if task.task_kind != "discursive":
            return None
        eligible = [
            subject
            for subject in subject_by_key.values()
            if subject.discursive_eligible
        ]
        if not eligible:
            return None
        return max(
            eligible,
            key=lambda subject: self._deficit(
                subject,
                subject_projections[subject.subject_key],
            ),
        ).subject_key

    def _triage_ls(
        self,
        tasks: tuple[SourcePlanTask, ...],
        subject_by_key: Mapping[str, ExamSubjectProfile],
        subject_projections: Mapping[str, SubjectProjection],
        budget: int,
    ) -> tuple[SprintActionDraft, ...]:
        scored = sorted(
            (
                (
                    self._task_gain(
                        task,
                        subject_by_key[task.subject_key],
                        subject_projections[task.subject_key],
                    ),
                    task,
                    subject_by_key[task.subject_key],
                )
                for task in tasks
                if task.subject_key is not None
            ),
            key=lambda row: (
                0 if row[1].task_kind == "simulation" else 1,
                -row[0][0],
                row[1].source_order,
                row[1].id,
            ),
        )
        if not scored:
            return ()

        total = sum(self._bounded_ls_duration(task) for _, task, _ in scored)
        if total <= budget:
            return tuple(
                self._ls_action(
                    task,
                    subject,
                    gain,
                    (
                        "compress"
                        if self._bounded_ls_duration(task) < task.estimated_minutes
                        else "execute"
                    ),
                    self._bounded_ls_duration(task),
                )
                for gain, task, subject in scored
            )

        remaining = budget
        actions: list[SprintActionDraft] = []
        for gain, task, subject in scored:
            source_duration = self._bounded_ls_duration(task)
            if task.task_kind == "simulation":
                duration = min(source_duration, remaining)
                if duration >= 5:
                    recommendation = (
                        "execute" if duration >= task.estimated_minutes else "compress"
                    )
                    actions.append(
                        self._ls_action(task, subject, gain, recommendation, duration)
                    )
                    remaining -= duration
                else:
                    actions.append(
                        self._ls_action(
                            task, subject, gain, "defer", source_duration
                        )
                    )
                continue
            if remaining >= source_duration:
                recommendation = (
                    "compress" if source_duration < task.estimated_minutes else "execute"
                )
                actions.append(
                    self._ls_action(
                        task, subject, gain, recommendation, source_duration
                    )
                )
                remaining -= source_duration
                continue

            compressed = min(45, max(20, round(source_duration * 0.6)))
            if remaining < compressed:
                reclaimed = self._compress_last_execute(actions)
                remaining += reclaimed
            if remaining >= compressed:
                actions.append(
                    self._ls_action(task, subject, gain, "compress", compressed)
                )
                remaining -= compressed
            else:
                actions.append(
                    self._ls_action(task, subject, gain, "defer", source_duration)
                )
        return tuple(actions)

    def _bounded_ls_duration(self, task: SourcePlanTask) -> int:
        return min(
            self.MAX_ACTION_MINUTES,
            max(self.MIN_ACTION_MINUTES, task.estimated_minutes),
        )

    @staticmethod
    def _compress_last_execute(actions: list[SprintActionDraft]) -> int:
        for index in range(len(actions) - 1, -1, -1):
            action = actions[index]
            if action.recommendation != "execute" or action.action_kind == "simulation":
                continue
            compressed = min(45, max(20, round(action.duration_minutes * 0.6)))
            if compressed >= action.duration_minutes:
                continue
            reclaimed = action.duration_minutes - compressed
            actions[index] = replace(
                action,
                action_kind="ls_compress",
                recommendation="compress",
                duration_minutes=compressed,
                rationale=action.rationale
                + ("Comprimida para caber no orcamento sem cortar uma prioridade maior.",),
            )
            return reclaimed
        return 0

    def _ls_action(
        self,
        task: SourcePlanTask,
        subject: ExamSubjectProfile,
        gain: tuple[int, int, int, int],
        recommendation: str,
        duration: int,
    ) -> SprintActionDraft:
        expected_gain, estimate, confidence, fragility = gain
        if task.task_kind == "simulation" and recommendation == "execute":
            action_kind = "simulation"
        else:
            action_kind = {
                "execute": "ls_execute",
                "compress": "ls_compress",
                "defer": "ls_defer",
            }[recommendation]
        reason = {
            "execute": "Melhor retorno ponderado por minuto entre as tarefas LS de hoje.",
            "compress": "Mantem o nucleo da tarefa com escopo reduzido e verificavel.",
            "defer": "Menor retorno relativo depois de preencher o orcamento disponivel.",
        }[recommendation]
        command = {
            "execute": "Executar",
            "compress": "Comprimir",
            "defer": "Adiar",
        }[recommendation]
        return SprintActionDraft(
            action_kind=action_kind,
            recommendation=recommendation,
            source_plan_task_id=task.id,
            subject_profile_id=subject.id,
            subject_key=subject.subject_key,
            topic_hint=task.topic_hint,
            title=f"{command}: {task.description}",
            duration_minutes=duration,
            planned_questions=(
                max(5, min(20, round(duration / 4)))
                if task.task_kind in {"questions", "review", "simulation", "mixed"}
                else 0
            ),
            expected_gain_milli=expected_gain,
            confidence_bp=confidence,
            rationale=(
                reason,
                f"{subject.paper}, peso {subject.question_weight:g}; estimativa {estimate / 100:.0f}%.",
            ),
            evidence=MappingProxyType(
                {
                    "sourceStatus": task.status,
                    "sourceTaskKind": task.task_kind,
                    "sourceMinutes": task.estimated_minutes,
                    "sourceOrder": task.source_order,
                    "performanceBp": task.performance_bp,
                    "tecUrl": task.provenance.get("tecUrl", ""),
                    "estimateBp": estimate,
                    "fragilityBp": fragility,
                }
            ),
        )

    def _task_gain(
        self,
        task: SourcePlanTask,
        subject: ExamSubjectProfile,
        projection: SubjectProjection,
    ) -> tuple[int, int, int, int]:
        estimate = projection.estimate_bp
        confidence = projection.confidence_bp
        fragility = projection.fragility_bp
        gap = max(250, subject.target_low_bp - estimate) + self._fragility_bonus(
            fragility
        )
        weighted_points = subject.question_count * subject.question_weight
        relevance_factor = 0.5 + task.relevance / 20
        confidence_factor = 0.5 + confidence / 20000
        raw = (
            weighted_points
            * gap
            / 10000
            * relevance_factor
            * confidence_factor
            / max(1, task.estimated_minutes)
        )
        return max(0, round(raw * 1000)), estimate, confidence, fragility

    def _extra_actions(
        self,
        *,
        config: ExamSprintConfig,
        subjects: tuple[ExamSubjectProfile, ...],
        subject_by_key: Mapping[str, ExamSubjectProfile],
        plan_date: date,
        budget: int,
        subject_projections: Mapping[str, SubjectProjection],
        p1_projection: float,
        afo_rescues_this_week: int,
        has_scheduled_simulation: bool,
    ) -> tuple[SprintActionDraft, ...]:
        if budget <= 0:
            return ()
        if plan_date == self._last_full_weekend(config.objective_date)[0] and not has_scheduled_simulation:
            subject = subject_by_key["p2_lte"]
            return (
                self._extra_action(
                    subject,
                    "simulation",
                    budget,
                    "Simulacao seccional P1/P2 no ultimo fim de semana completo.",
                    planned_questions=max(10, min(40, budget // 2)),
                    projection=subject_projections[subject.subject_key],
                ),
            )

        actions: list[SprintActionDraft] = []
        remaining = budget
        if plan_date.weekday() in {0, 2, 4} and remaining >= 10:
            discursive_subjects = [subject for subject in subjects if subject.discursive_eligible]
            subject = max(
                discursive_subjects,
                key=lambda row: self._deficit(
                    row, subject_projections[row.subject_key]
                ),
            )
            actions.append(
                self._extra_action(
                    subject,
                    "discursive",
                    10,
                    "Um dos tres esqueletos discursivos protegidos desta semana.",
                    planned_questions=0,
                    projection=subject_projections[subject.subject_key],
                )
            )
            remaining -= 10

        if p1_projection < config.p1_floor_questions and remaining >= 10:
            p1_candidates = [
                subject
                for subject in subjects
                if subject.paper == "P1"
                and not (
                    subject.subject_key == "p1_direito_financeiro"
                    and afo_rescues_this_week >= 2
                )
            ]
            subject = max(
                p1_candidates,
                key=lambda row: self._deficit(
                    row, subject_projections[row.subject_key]
                ),
            )
            duration = min(15, remaining)
            actions.append(
                self._extra_action(
                    subject,
                    "review",
                    duration,
                    "Piso da P1 abaixo de 48: resgate curto de ponto recuperavel.",
                    planned_questions=max(5, min(10, duration // 2)),
                    projection=subject_projections[subject.subject_key],
                )
            )
            remaining -= duration

        focus_weights = (
            ("p2_lte", 50),
            ("p2_financas_publicas", 30),
            ("p2_contabilidade_avancada_custos", 20),
        )
        active_focus = [
            (key, weight)
            for key, weight in focus_weights
            if key in subject_by_key
            and not self._at_goal_twice(
                subject_by_key[key], subject_projections[key]
            )
        ]
        if remaining >= 10 and active_focus:
            allocations = self._allocate_minutes(remaining, active_focus)
            for key, minutes in allocations:
                subject = subject_by_key[key]
                for chunk in self._chunks(minutes):
                    actions.append(
                        self._extra_action(
                            subject,
                            "review",
                            chunk,
                            "Debito confirmado em materia de peso 2; corrigir e provar com conjunto curto.",
                            planned_questions=max(5, min(10, round(chunk / 3))),
                            projection=subject_projections[key],
                        )
                    )
        return tuple(actions)

    def _d2_actions(
        self,
        tasks: tuple[SourcePlanTask, ...],
        subject_by_key: Mapping[str, ExamSubjectProfile],
        budget: int,
        subject_projections: Mapping[str, SubjectProjection],
    ) -> tuple[SprintActionDraft, ...]:
        actions: list[SprintActionDraft] = []
        remaining = min(120, budget)
        for task in tasks:
            if remaining < 10 or task.subject_key is None:
                break
            subject = subject_by_key[task.subject_key]
            duration = min(30, remaining)
            actions.append(
                replace(
                    self._extra_action(
                        subject,
                        "review",
                        duration,
                        "D-2: somente erros, excecoes e lei seca; sem conteudo novo.",
                        planned_questions=max(5, min(10, duration // 3)),
                        projection=subject_projections[subject.subject_key],
                    ),
                    source_plan_task_id=task.id,
                    topic_hint=task.topic_hint,
                    title=f"Consolidar: {task.description}",
                )
            )
            remaining -= duration
        if not actions:
            subject = subject_by_key["p2_lte"]
            actions.append(
                self._extra_action(
                    subject,
                    "review",
                    min(30, budget),
                    "D-2: erros, excecoes e lei seca de LTE.",
                    planned_questions=8,
                    projection=subject_projections[subject.subject_key],
                )
            )
        return self._positioned(tuple(actions))

    def _extra_action(
        self,
        subject: ExamSubjectProfile,
        action_kind: str,
        duration: int,
        reason: str,
        *,
        planned_questions: int,
        projection: SubjectProjection,
    ) -> SprintActionDraft:
        estimate = projection.estimate_bp
        confidence = projection.confidence_bp
        fragility = projection.fragility_bp
        deficit = max(0, subject.target_low_bp - estimate)
        expected = round(
            subject.question_count
            * subject.question_weight
            * (max(250, deficit) + self._fragility_bonus(fragility))
            / 10000
            * 1000
            / max(1, duration)
        )
        title_prefix = {
            "review": "Revisao cirurgica",
            "discursive": "Esqueleto discursivo",
            "simulation": "Simulacao protegida",
        }.get(action_kind, "Microbloco")
        return SprintActionDraft(
            action_kind=action_kind,
            recommendation="extra",
            source_plan_task_id=None,
            subject_profile_id=subject.id,
            subject_key=subject.subject_key,
            topic_hint="",
            title=f"{title_prefix}: {subject.display_name}",
            duration_minutes=duration,
            planned_questions=planned_questions,
            expected_gain_milli=max(0, expected),
            confidence_bp=confidence,
            rationale=(reason,),
            evidence=MappingProxyType(
                {
                    "estimateBp": estimate,
                    "targetLowBp": subject.target_low_bp,
                    "questionWeight": subject.question_weight,
                    "baselineSource": subject.baseline_source,
                    "fragilityBp": fragility,
                    "projectionOrigin": projection.dominant_origin,
                }
            ),
        )

    @staticmethod
    def _fragility_bonus(fragility_bp: int) -> int:
        return min(1000, max(0, fragility_bp) // 10)

    @staticmethod
    def _deficit(
        subject: ExamSubjectProfile, projection: SubjectProjection
    ) -> int:
        return (
            subject.target_low_bp
            - projection.estimate_bp
            + SprintEngine._fragility_bonus(projection.fragility_bp)
        )

    @staticmethod
    def _at_goal_twice(
        subject: ExamSubjectProfile, projection: SubjectProjection
    ) -> bool:
        return (
            projection.demotion_eligible
            and projection.estimate_bp >= subject.target_low_bp
        )

    @staticmethod
    def _allocate_minutes(
        budget: int, weighted_keys: list[tuple[str, int]]
    ) -> tuple[tuple[str, int], ...]:
        if not weighted_keys or budget < 10:
            return ()
        if budget < 10 * len(weighted_keys):
            weighted_keys = sorted(weighted_keys, key=lambda row: -row[1])[
                : budget // 10
            ]
        total_weight = sum(weight for _, weight in weighted_keys)
        allocations = [
            [key, max(10, budget * weight // total_weight)]
            for key, weight in weighted_keys
        ]
        used = sum(int(row[1]) for row in allocations)
        while used > budget:
            row = max((item for item in allocations if item[1] > 10), key=lambda item: item[1])
            row[1] -= 1
            used -= 1
        index = 0
        while used < budget:
            allocations[index % len(allocations)][1] += 1
            used += 1
            index += 1
        return tuple((str(key), int(minutes)) for key, minutes in allocations)

    @staticmethod
    def _chunks(minutes: int) -> tuple[int, ...]:
        if minutes <= 30:
            return (minutes,)
        chunks: list[int] = []
        remaining = minutes
        while remaining > 30:
            chunk = min(30, remaining - 10)
            chunks.append(chunk)
            remaining -= chunk
        chunks.append(remaining)
        return tuple(chunks)

    @staticmethod
    def _last_full_weekend(objective_date: date) -> tuple[date, date]:
        candidate = objective_date - timedelta(days=1)
        while candidate.weekday() != 5:
            candidate -= timedelta(days=1)
        if candidate + timedelta(days=1) >= objective_date:
            candidate -= timedelta(days=7)
        return candidate, candidate + timedelta(days=1)

    @staticmethod
    def _positioned(
        actions: tuple[SprintActionDraft, ...]
    ) -> tuple[SprintActionDraft, ...]:
        return actions

    @staticmethod
    def _day(
        plan_date: date,
        days_remaining: int,
        mode_label: str,
        actions: tuple[SprintActionDraft, ...],
        projection: SprintProjection,
    ) -> SprintDayDraft:
        return SprintDayDraft(
            plan_date=plan_date,
            days_remaining=days_remaining,
            mode_label=mode_label,
            actions=actions,
            score_snapshot=MappingProxyType(
                {
                    "p1Projection": projection.p1.projected,
                    "p2Projection": projection.p2.projected,
                    "lsPlannedMinutes": sum(
                        action.duration_minutes
                        for action in actions
                        if action.source_plan_task_id is not None
                        and action.recommendation != "defer"
                    ),
                    "extraPlannedMinutes": sum(
                        action.duration_minutes
                        for action in actions
                        if action.recommendation == "extra"
                    ),
                }
            ),
        )
