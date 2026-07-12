from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime
import hashlib
import json
import sqlite3
from typing import Any

from study_os_service.domain.planner import (
    PlannerBlock,
    PlannerCandidate,
    PlannerRun,
)
from study_os_service.repositories.planner_profiles import PlannerProfileRepository
from study_os_service.repositories.planner_runs import (
    PlannerBlockVersionConflictError,
    PlannerRunRepository,
)
from study_os_service.services.planner_candidates import (
    CandidateDraft,
    build_candidates,
    collect_candidate_evidence,
)
from study_os_service.services.learning_projection import LearningProjectionService
from study_os_service.services.planner_profiles import TargetProfileNotFoundError
from study_os_service.services.planner_scoring import (
    ALGORITHM_VERSION,
    ScoredCandidate,
    ScoringContext,
    canonical_input_hash,
    score_candidates,
)


class PlannerIdempotencyConflictError(RuntimeError):
    pass


class PlannerDayNotFoundError(KeyError):
    pass


class PlannerRunNotFoundError(KeyError):
    pass


class PlannerBlockNotFoundError(KeyError):
    pass


class PlannerRefreshConflictError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class GeneratedDay:
    run: PlannerRun
    candidates: tuple[PlannerCandidate, ...]
    blocks: tuple[PlannerBlock, ...]


class PlannerGenerationService:
    def __init__(self, connection: sqlite3.Connection):
        self.connection = connection
        self.profiles = PlannerProfileRepository(connection)
        self.repository = PlannerRunRepository(connection)
        self.learning = LearningProjectionService(connection)

    def generate_day(
        self,
        target_slug: str,
        plan_date: date,
        *,
        idempotency_key: str,
        time_budget_minutes: int | None = None,
        ls_target_slug: str | None = None,
    ) -> GeneratedDay:
        return self._generate(
            target_slug,
            plan_date,
            idempotency_key=idempotency_key,
            time_budget_minutes=time_budget_minutes,
            ls_target_slug=ls_target_slug,
            supersedes_run_id=None,
        )

    def refresh_day(
        self,
        previous_run_id: int,
        target_slug: str,
        plan_date: date,
        *,
        idempotency_key: str,
        time_budget_minutes: int | None = None,
        ls_target_slug: str | None = None,
    ) -> GeneratedDay:
        if (
            isinstance(previous_run_id, bool)
            or not isinstance(previous_run_id, int)
            or previous_run_id < 1
        ):
            raise ValueError("previous run id must be a positive integer")
        return self._generate(
            target_slug,
            plan_date,
            idempotency_key=idempotency_key,
            time_budget_minutes=time_budget_minutes,
            ls_target_slug=ls_target_slug,
            supersedes_run_id=previous_run_id,
        )

    def _generate(
        self,
        target_slug: str,
        plan_date: date,
        *,
        idempotency_key: str,
        time_budget_minutes: int | None,
        ls_target_slug: str | None,
        supersedes_run_id: int | None,
    ) -> GeneratedDay:
        target_name = self._target_name(target_slug)
        resolved_date = self._plan_date(plan_date)
        key = self._key(idempotency_key)
        self.connection.execute("BEGIN IMMEDIATE")
        try:
            target = self.profiles.get_target(target_name)
            if target is None:
                raise TargetProfileNotFoundError(target_name)
            existing = self.repository.get_run_by_idempotency_key(key)
            budget = self._budget(
                time_budget_minutes,
                target.daily_quota * 60,
            )
            if existing is not None:
                if (
                    existing.target_slug != target_name
                    or existing.plan_date != resolved_date
                    or existing.time_budget_minutes != budget
                    or existing.supersedes_run_id != supersedes_run_id
                ):
                    raise PlannerIdempotencyConflictError(
                        "idempotency key already belongs to another request"
                    )
                result = self.get_day_by_run(existing.id)
                self.connection.commit()
                return result

            excluded_topic_ids: set[int] = set()
            if supersedes_run_id is not None:
                previous = self.repository.get_run(supersedes_run_id)
                if previous is None:
                    raise PlannerRunNotFoundError(supersedes_run_id)
                if previous.target_slug != target_name:
                    raise PlannerRefreshConflictError(
                        "previous run belongs to another target"
                    )
                excluded_topic_ids = self._refresh_exclusions(previous.id)

            effective_quota = min(
                target.daily_quota,
                max(1, budget // 60),
            )
            evidence = collect_candidate_evidence(self.connection, target_name)
            pool = build_candidates(target_name, evidence)
            base_context = ScoringContext(
                target=target,
                plan_date=resolved_date,
                ls_target_slug=ls_target_slug,
                discipline_counts={},
            )
            required_kinds = self._required_kinds(effective_quota)
            chosen, shortfall_reasons, discipline_counts = self._select(
                pool.all,
                base_context,
                required_kinds,
                excluded_topic_ids,
            )
            final_context = ScoringContext(
                target=target,
                plan_date=resolved_date,
                ls_target_slug=ls_target_slug,
                discipline_counts=discipline_counts,
            )
            scored = score_candidates(pool.all, final_context)
            base_hash = canonical_input_hash(pool.all, base_context)
            input_hash = self._generation_hash(
                base_hash,
                required_kinds,
                budget,
                supersedes_run_id,
                excluded_topic_ids,
            )
            status = "generated" if not shortfall_reasons else "shortfall"
            run = self.repository.create_run(
                idempotency_key=key,
                target_slug=target_name,
                plan_date=resolved_date,
                phase=target.phase,
                daily_quota=effective_quota,
                time_budget_minutes=budget,
                algorithm_version=ALGORITHM_VERSION,
                input_hash=input_hash,
                supersedes_run_id=supersedes_run_id,
                status=status,
                shortfall_reasons=tuple(shortfall_reasons),
                generated_at=datetime.now(UTC),
            )
            persisted = self._persist_candidates(run, scored, chosen)
            self._persist_blocks(run, persisted)
            result = self.get_day_by_run(run.id)
            self.connection.commit()
            return result
        except Exception:
            self.connection.rollback()
            raise

    def get_day(self, target_slug: str, plan_date: date) -> GeneratedDay:
        target_name = self._target_name(target_slug)
        resolved_date = self._plan_date(plan_date)
        run = self.repository.get_latest_run(target_name, resolved_date)
        if run is None:
            raise PlannerDayNotFoundError((target_name, resolved_date))
        return self.get_day_by_run(run.id)

    def get_day_by_run(self, run_id: int) -> GeneratedDay:
        run = self.repository.get_run(run_id)
        if run is None:
            raise PlannerRunNotFoundError(run_id)
        return GeneratedDay(
            run=run,
            candidates=self.repository.list_candidates(run.id),
            blocks=self.repository.list_blocks(run.id),
        )

    def get_scoreboard(self, run_id: int) -> tuple[PlannerCandidate, ...]:
        if self.repository.get_run(run_id) is None:
            raise PlannerRunNotFoundError(run_id)
        return self.repository.list_candidates(run_id)

    def record_block_result(
        self,
        block_id: int,
        *,
        state: str,
        questions_done: int,
        correct_count: int,
        wrong_count: int,
        doubt_count: int,
        favorite_count: int,
        expected_version: int,
    ) -> PlannerBlock:
        counts = {
            "questions done": questions_done,
            "correct count": correct_count,
            "wrong count": wrong_count,
            "doubt count": doubt_count,
            "favorite count": favorite_count,
        }
        for label, value in counts.items():
            if isinstance(value, bool) or not isinstance(value, int) or value < 0:
                raise ValueError(f"{label} must be a non-negative integer")
        if state not in {"completed", "skipped", "failed"}:
            raise ValueError("result state must be completed, skipped, or failed")
        if correct_count + wrong_count > questions_done:
            raise ValueError("result counts exceed questions done")
        if (
            isinstance(expected_version, bool)
            or not isinstance(expected_version, int)
            or expected_version < 1
        ):
            raise ValueError("expected version must be a positive integer")

        self.connection.execute("BEGIN IMMEDIATE")
        try:
            current = self.repository.get_block(block_id)
            if current is None:
                raise PlannerBlockNotFoundError(block_id)
            if current.block_kind == "theory" and any(counts.values()):
                raise ValueError("theory result cannot contain question counts")
            if current.block_kind != "theory" and state == "completed" and questions_done < 1:
                raise ValueError("completed question block requires results")
            if state == "skipped" and any(counts.values()):
                raise ValueError("skipped block cannot contain result counts")
            saved = self.repository.update_block_result(
                block_id,
                state=state,
                questions_done=questions_done,
                correct_count=correct_count,
                wrong_count=wrong_count,
                doubt_count=doubt_count,
                favorite_count=favorite_count,
                expected_version=expected_version,
            )
            self.learning.record_planner_block(saved)
            self.connection.commit()
            return saved
        except Exception:
            self.connection.rollback()
            raise

    @staticmethod
    def _select(
        candidates: tuple[CandidateDraft, ...],
        base_context: ScoringContext,
        required_kinds: tuple[str, ...],
        excluded_topic_ids: set[int],
    ) -> tuple[dict[str, int], list[str], dict[str, int]]:
        chosen: dict[str, int] = {}
        chosen_topics: set[int] = set()
        discipline_counts: dict[str, int] = {}
        shortfalls: list[str] = []
        for block_kind in required_kinds:
            context = ScoringContext(
                target=base_context.target,
                plan_date=base_context.plan_date,
                ls_target_slug=base_context.ls_target_slug,
                discipline_counts=discipline_counts,
            )
            ranked = [
                item.candidate
                for item in score_candidates(candidates, context)
                if item.candidate.executable
                and item.candidate.block_kind == block_kind
                and item.candidate.candidate_key not in chosen
                and item.candidate.target_topic_id not in excluded_topic_ids
            ]
            unique = [
                item for item in ranked if item.target_topic_id not in chosen_topics
            ]
            pool = unique or ranked
            balanced = [
                item
                for item in pool
                if discipline_counts.get(item.discipline, 0) < 2
            ]
            pool = balanced or pool
            if not pool:
                shortfalls.append(f"no executable {block_kind} candidate")
                continue
            selected = pool[0]
            chosen[selected.candidate_key] = len(chosen) + 1
            chosen_topics.add(selected.target_topic_id)
            discipline_counts[selected.discipline] = (
                discipline_counts.get(selected.discipline, 0) + 1
            )
        return chosen, shortfalls, discipline_counts

    def _persist_candidates(
        self,
        run: PlannerRun,
        scored: tuple[ScoredCandidate, ...],
        chosen: dict[str, int],
    ) -> tuple[PlannerCandidate, ...]:
        chosen_by_kind = {
            item.candidate.block_kind: item.candidate.candidate_key
            for item in scored
            if item.candidate.candidate_key in chosen
        }
        persisted: list[PlannerCandidate] = []
        for item in scored:
            candidate = item.candidate
            score = item.breakdown
            chosen_position = chosen.get(candidate.candidate_key)
            displaced_by = None
            if candidate.executable and chosen_position is None:
                displaced_by = chosen_by_kind.get(candidate.block_kind)
            evidence_json = json.dumps(
                {
                    "candidateEvidence": dict(candidate.evidence),
                    "scoreEvidence": json.loads(item.evidence_json),
                },
                ensure_ascii=True,
                sort_keys=True,
                separators=(",", ":"),
            )
            persisted.append(
                self.repository.insert_candidate(
                    {
                        "run_id": run.id,
                        "candidate_key": candidate.candidate_key,
                        "target_slug": run.target_slug,
                        "discipline": candidate.discipline,
                        "topic": candidate.topic,
                        "block_kind": candidate.block_kind,
                        "source_kind": candidate.source_kind,
                        "target_topic_id": candidate.target_topic_id,
                        "lesson_id": candidate.lesson_id,
                        "material_id": candidate.material_id,
                        "duration_minutes": candidate.duration_minutes,
                        "planned_questions": candidate.planned_questions,
                        "weakness": score.weakness,
                        "incidence": score.incidence,
                        "tier": score.tier,
                        "coverage_need": score.coverage_need,
                        "review_debt": score.review_debt,
                        "ls_alignment": score.ls_alignment,
                        "target_fit": score.target_fit,
                        "overlap_value": score.overlap_value,
                        "deadline_pressure": score.deadline_pressure,
                        "banca_fit": score.banca_fit,
                        "edital_weight": score.edital_weight,
                        "balance_penalty": score.balance_penalty,
                        "low_trust_penalty": score.low_trust_penalty,
                        "final_score": score.final_score,
                        "chosen_position": chosen_position,
                        "displaced_by_candidate_key": displaced_by,
                        "stop_reason": candidate.stop_reason,
                        "evidence_json": evidence_json,
                    }
                )
            )
        return tuple(persisted)

    def _persist_blocks(
        self,
        run: PlannerRun,
        candidates: tuple[PlannerCandidate, ...],
    ) -> None:
        selected = sorted(
            (item for item in candidates if item.chosen_position is not None),
            key=lambda item: item.chosen_position,
        )
        for candidate in selected:
            self.repository.insert_block(
                run_id=run.id,
                candidate_id=candidate.id,
                target_slug=run.target_slug,
                scheduled_date=run.plan_date,
                position=candidate.chosen_position,
                block_kind=candidate.block_kind,
                title=self._title(candidate),
                duration_minutes=candidate.duration_minutes,
                planned_questions=candidate.planned_questions,
            )

    def _refresh_exclusions(self, run_id: int) -> set[int]:
        candidates = {item.id: item for item in self.repository.list_candidates(run_id)}
        blocks = self.repository.list_blocks(run_id)
        if not any(block.state in {"completed", "skipped", "failed"} for block in blocks):
            raise PlannerRefreshConflictError(
                "refresh requires at least one finished planner block"
            )
        excluded: set[int] = set()
        for block in blocks:
            if block.state != "completed":
                continue
            candidate = candidates[block.candidate_id]
            high_performance = (
                block.block_kind == "theory"
                or (
                    block.questions_done > 0
                    and block.correct_count / block.questions_done >= 0.6
                )
            )
            if high_performance and candidate.target_topic_id is not None:
                excluded.add(candidate.target_topic_id)
        return excluded

    @staticmethod
    def _title(candidate: PlannerCandidate) -> str:
        prefix = {
            "theory": "Ler ou reler",
            "questions": "TEC",
            "review": "Corrigir erros e provar",
        }[candidate.block_kind]
        return f"{prefix}: {candidate.discipline} - {candidate.topic}"

    @staticmethod
    def _required_kinds(quota: int) -> tuple[str, ...]:
        pattern = (
            "theory",
            "questions",
            "questions",
            "review",
            "questions",
            "theory",
            "review",
            "questions",
        )
        return pattern[:quota]

    @staticmethod
    def _generation_hash(
        base_hash: str,
        required_kinds: tuple[str, ...],
        budget: int,
        supersedes_run_id: int | None,
        excluded_topic_ids: set[int],
    ) -> str:
        document = json.dumps(
            {
                "baseHash": base_hash,
                "requiredKinds": required_kinds,
                "timeBudgetMinutes": budget,
                "supersedesRunId": supersedes_run_id,
                "excludedTopicIds": sorted(excluded_topic_ids),
            },
            ensure_ascii=True,
            sort_keys=True,
            separators=(",", ":"),
        )
        return hashlib.sha256(document.encode("utf-8")).hexdigest()

    @staticmethod
    def _target_name(value: str) -> str:
        if not isinstance(value, str) or not value.strip():
            raise ValueError("target is required")
        return value.strip()

    @staticmethod
    def _plan_date(value: date) -> date:
        if isinstance(value, datetime) or not isinstance(value, date):
            raise ValueError("plan date must be a date")
        return value

    @staticmethod
    def _key(value: str) -> str:
        if not isinstance(value, str) or not value.strip():
            raise ValueError("idempotency key is required")
        return value.strip()

    @staticmethod
    def _budget(value: int | None, default: int) -> int:
        resolved = default if value is None else value
        if isinstance(resolved, bool) or not isinstance(resolved, int):
            raise ValueError("time budget minutes must be an integer")
        if not 15 <= resolved <= 720:
            raise ValueError("time budget minutes must be between 15 and 720")
        return resolved


__all__ = [
    "GeneratedDay",
    "PlannerBlockNotFoundError",
    "PlannerBlockVersionConflictError",
    "PlannerDayNotFoundError",
    "PlannerGenerationService",
    "PlannerIdempotencyConflictError",
    "PlannerRefreshConflictError",
    "PlannerRunNotFoundError",
]
