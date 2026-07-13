from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
import hashlib
import json
import sqlite3
from typing import Any
import unicodedata

from study_os_service.domain.cutover import (
    LegacyBrowserBundle,
    LegacyCoverageRow,
    LegacySourceSignal,
    LegacyTargetProfile,
)
from study_os_service.repositories.cutover import (
    CutoverRepository,
    MigrationRunRecord,
)
from study_os_service.repositories.strategy import StrategyRepository
from study_os_service.services.learning_import import LearningImportService
from study_os_service.services.planner_profiles import PlannerProfileService
from study_os_service.services.preferences import PreferenceService
from study_os_service.services.strategy_ingestion import (
    StrategyIngestionService,
    StrategyInputBatch,
    StrategyInputRow,
)


@dataclass(frozen=True, slots=True)
class LegacyMigrationResult:
    run: MigrationRunRecord

    @property
    def report(self) -> dict[str, Any]:
        return self.run.report


def _normalize(value: str) -> str:
    decomposed = unicodedata.normalize("NFKD", value)
    plain = "".join(
        character for character in decomposed if not unicodedata.combining(character)
    )
    return " ".join(plain.casefold().split())


def _fingerprint(prefix: str, legacy_id: str) -> str:
    value = json.dumps(
        {"kind": prefix, "legacyId": legacy_id},
        ensure_ascii=True,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


class LegacyMigrationService:
    def __init__(self, connection: sqlite3.Connection):
        self.connection = connection
        self.cutover = CutoverRepository(connection)

    def import_bundle(
        self,
        bundle: LegacyBrowserBundle,
        *,
        migration_key: str,
    ) -> LegacyMigrationResult:
        run = self.cutover.begin_migration(
            migration_key=migration_key.strip(),
            schema_name=bundle.schema,
            payload_hash=bundle.payload_hash,
        )
        if run.state == "completed":
            return LegacyMigrationResult(run)
        if run.state == "failed":
            run = self.cutover.resume_migration(
                run.id,
                stage=run.stage,
                expected_version=run.version,
            )

        report = dict(run.report)
        stage = "profiles"
        try:
            report["targetsImported"] = self._import_profiles(bundle, run.id)
            run = self.cutover.update_stage(
                run.id,
                stage="coverage",
                report=report,
                expected_version=run.version,
            )

            stage = "coverage"
            report["coverageRowsImported"] = self._import_coverage(bundle, run.id)
            run = self.cutover.update_stage(
                run.id,
                stage="strategy",
                report=report,
                expected_version=run.version,
            )

            stage = "strategy"
            strategy_run_ids = self._import_strategy(bundle, run.id)
            report["lsTasksImported"] = len(bundle.ls_tasks)
            report["sourceSignalsImported"] = len(bundle.source_signals)
            report["strategyRunIds"] = strategy_run_ids
            run = self.cutover.update_stage(
                run.id,
                stage="learning",
                report=report,
                expected_version=run.version,
            )

            stage = "learning"
            imported, rejected = self._import_learning(bundle, run.id)
            report["learningItemsImported"] = imported
            report["learningItemsRejected"] = rejected
            run = self.cutover.update_stage(
                run.id,
                stage="preference",
                report=report,
                expected_version=run.version,
            )

            stage = "preference"
            preference = PreferenceService(self.connection).get_active_target()
            if preference.target_slug != bundle.active_target_slug:
                preference = PreferenceService(self.connection).set_active_target(
                    bundle.active_target_slug,
                    expected_version=preference.version,
                )
            report["activeTargetSlug"] = preference.target_slug
            report["legacyIdsRecorded"] = self.cutover.count_legacy_ids(run.id)
            run = self.cutover.complete_migration(
                run.id,
                report=report,
                expected_version=run.version,
            )
            return LegacyMigrationResult(run)
        except Exception as exc:
            current = self.cutover.get_migration(run.id)
            if current is not None and current.state == "running":
                self.cutover.fail_migration(
                    current.id,
                    stage=stage,
                    error_code=type(exc).__name__,
                    error_message=str(exc)[:1000] or type(exc).__name__,
                    report=report,
                    expected_version=current.version,
                )
            raise

    def _import_profiles(self, bundle: LegacyBrowserBundle, run_id: int) -> int:
        referenced = {
            bundle.active_target_slug,
            *(item.target_slug for item in bundle.target_profiles),
            *(item.target_slug for item in bundle.coverage_rows),
            *(item.source_target_slug for item in bundle.ls_tasks),
            *(item.target_slug for item in bundle.ls_tasks),
            *(item.source_target_slug for item in bundle.source_signals),
            *(item.target_slug for item in bundle.source_signals),
            *(item.target_slug for item in bundle.learning_items),
        }
        profiles = PlannerProfileService(self.connection)
        profiles.seed(tuple(sorted(referenced)))
        current_by_slug = {
            item.target_slug: item for item in profiles.list_targets()
        }
        for item in bundle.target_profiles:
            current = current_by_slug[item.target_slug]
            if not self._profile_matches(current, item):
                current = profiles.update_target(
                    item.to_payload()
                    | {
                        "targetSlug": item.target_slug,
                        "expectedVersion": current.version,
                    }
                )
                current_by_slug[item.target_slug] = current
            self.cutover.record_legacy_id(
                migration_run_id=run_id,
                record_kind="target_profile",
                legacy_id=item.legacy_id,
                target_type="exam_target",
                target_ref=item.target_slug,
                metadata={"targetSlug": item.target_slug},
            )
        return len(bundle.target_profiles)

    @staticmethod
    def _profile_matches(current, item: LegacyTargetProfile) -> bool:
        return (
            current.display_name == item.display_name
            and current.institution == item.institution
            and current.role == item.role
            and current.banca == item.banca
            and current.phase == item.phase
            and current.deadline == item.deadline
            and current.daily_quota == item.daily_quota
            and current.priority_score == item.priority_score
            and current.source_urls == item.source_urls
            and current.notes == item.notes
            and current.active == item.active
        )

    def _import_coverage(self, bundle: LegacyBrowserBundle, run_id: int) -> int:
        profiles = PlannerProfileService(self.connection)
        grouped: dict[str, list[LegacyCoverageRow]] = defaultdict(list)
        for item in bundle.coverage_rows:
            grouped[item.target_slug].append(item)
        for target_slug in sorted(grouped):
            topics = list(profiles.list_topics(target_slug))
            by_identity = {
                (_normalize(topic.discipline), _normalize(topic.topic)): topic
                for topic in topics
            }
            for item in grouped[target_slug]:
                identity = (_normalize(item.discipline), _normalize(item.topic))
                current = by_identity.get(identity)
                payload = item.to_payload()
                if current is None:
                    saved = profiles.update_topics(target_slug, [payload])[0]
                    by_identity[identity] = saved
                elif self._coverage_matches(current, item):
                    saved = current
                else:
                    saved = profiles.update_topics(
                        target_slug,
                        [payload | {"id": current.id, "expectedVersion": current.version}],
                    )[0]
                    by_identity[identity] = saved
                self.cutover.record_legacy_id(
                    migration_run_id=run_id,
                    record_kind="coverage_row",
                    legacy_id=item.legacy_id,
                    target_type="target_topic",
                    target_ref=str(saved.id),
                    metadata={
                        "targetSlug": target_slug,
                        "discipline": saved.discipline,
                        "topic": saved.topic,
                    },
                )
        return len(bundle.coverage_rows)

    @staticmethod
    def _coverage_matches(current, item: LegacyCoverageRow) -> bool:
        return (
            current.discipline == item.discipline
            and current.topic == item.topic
            and current.coverage_status == item.coverage_status
            and current.edital_weight == item.edital_weight
            and current.incidence == item.incidence
            and current.tier == item.tier
            and current.banca_fit == item.banca_fit
            and current.overlap_value == item.overlap_value
            and current.transfer_kind == item.transfer_kind
            and current.source_kind == item.source_kind
            and current.planned_questions == item.planned_questions
            and current.review_debt == item.review_debt
            and current.notes == item.notes
            and current.active == item.active
        )

    def _import_strategy(
        self, bundle: LegacyBrowserBundle, run_id: int
    ) -> list[int]:
        run_ids: list[int] = []
        ingestion = StrategyIngestionService(self.connection)
        strategy_repository = StrategyRepository(self.connection)

        ls_groups = defaultdict(list)
        for item in bundle.ls_tasks:
            ls_groups[(item.source_target_slug, item.target_slug)].append(item)
        for (source_target, target), items in sorted(ls_groups.items()):
            source_key = f"legacy-ls:{source_target}:{target}"
            batch = StrategyInputBatch(
                source_target_slug=source_target,
                target_slug=target,
                source_key=source_key,
                source_kind="ls",
                display_name=f"LS legado ({source_target} -> {target})",
                trust_tier=6,
                edition="legacy-browser",
                notes="Migrated from browser LS planner metadata",
                rows=tuple(
                    StrategyInputRow(
                        discipline=item.discipline,
                        topic_hint=item.topic_hint,
                        source_order=item.order,
                        content_role="schedule_advice",
                        source_fingerprint=_fingerprint("ls_task", item.legacy_id),
                        external_id=item.legacy_id,
                        provenance=item.metadata
                        | {
                            "legacyId": item.legacy_id,
                            "status": item.status,
                            "taskKind": item.task_kind,
                            **(
                                {"scheduledDate": item.scheduled_date.isoformat()}
                                if item.scheduled_date
                                else {}
                            ),
                        },
                    )
                    for item in sorted(items, key=lambda row: (row.order, row.legacy_id))
                ),
            )
            result = ingestion.ingest(
                batch,
                idempotency_key=(
                    f"cutover:{bundle.migration_id}:ls:{source_target}:{target}"
                ),
            )
            run_ids.append(result.run.id)
            source_items = {
                item.external_id: item
                for item in strategy_repository.list_source_items(result.source.id)
            }
            for legacy in items:
                saved = source_items.get(legacy.legacy_id)
                if saved is None:
                    raise RuntimeError("migrated LS source item disappeared")
                self.cutover.record_legacy_id(
                    migration_run_id=run_id,
                    record_kind="ls_task",
                    legacy_id=legacy.legacy_id,
                    target_type="strategy_source_item",
                    target_ref=str(saved.id),
                    metadata={"targetSlug": target},
                )

        signal_groups: dict[tuple[str, str, str], list[LegacySourceSignal]] = defaultdict(list)
        for item in bundle.source_signals:
            signal_groups[
                (item.source_target_slug, item.target_slug, item.source_key)
            ].append(item)
        for (source_target, target, source_key), items in sorted(signal_groups.items()):
            head = items[0]
            for item in items[1:]:
                if self._source_identity(item) != self._source_identity(head):
                    raise ValueError(
                        f"source key {source_key} has conflicting source metadata"
                    )
            batch = StrategyInputBatch(
                source_target_slug=source_target,
                target_slug=target,
                source_key=source_key,
                source_kind=head.source_kind,
                display_name=head.display_name,
                trust_tier=head.trust_tier,
                edition=head.edition,
                notes=head.notes,
                external_url=head.external_url,
                rows=tuple(
                    StrategyInputRow(
                        discipline=item.discipline,
                        topic_hint=item.topic_hint,
                        source_order=item.order,
                        content_role=item.content_role,
                        source_fingerprint=_fingerprint(
                            "source_signal", item.legacy_id
                        ),
                        target_topic_id=item.target_topic_id,
                        external_url=item.external_url,
                        external_id=item.legacy_id,
                        incidence_bp=item.incidence_bp,
                        banca=item.banca,
                        provenance=item.metadata
                        | {
                            "legacyId": item.legacy_id,
                            "transferKind": item.transfer_kind,
                            **(
                                {"legacyExternalId": item.external_id}
                                if item.external_id
                                else {}
                            ),
                        },
                    )
                    for item in sorted(items, key=lambda row: (row.order, row.legacy_id))
                ),
            )
            result = ingestion.ingest(
                batch,
                idempotency_key=(
                    f"cutover:{bundle.migration_id}:source:"
                    f"{source_target}:{target}:{source_key}"
                ),
            )
            run_ids.append(result.run.id)
            source_items = {
                item.external_id: item
                for item in strategy_repository.list_source_items(result.source.id)
            }
            for legacy in items:
                saved = source_items.get(legacy.legacy_id)
                if saved is None:
                    raise RuntimeError("migrated strategy source item disappeared")
                self.cutover.record_legacy_id(
                    migration_run_id=run_id,
                    record_kind="source_signal",
                    legacy_id=legacy.legacy_id,
                    target_type="strategy_source_item",
                    target_ref=str(saved.id),
                    metadata={"targetSlug": target},
                )
        return run_ids

    @staticmethod
    def _source_identity(item: LegacySourceSignal) -> tuple[object, ...]:
        return (
            item.source_kind,
            item.display_name,
            item.trust_tier,
            item.edition,
            item.notes,
            item.external_url,
        )

    def _import_learning(
        self, bundle: LegacyBrowserBundle, run_id: int
    ) -> tuple[int, int]:
        grouped = defaultdict(list)
        for item in bundle.learning_items:
            grouped[item.target_slug].append(item)
        imported_count = 0
        rejected_count = 0
        for target_slug, items in sorted(grouped.items()):
            result = LearningImportService(self.connection).import_aggregates(
                target_slug=target_slug,
                batch_id=f"legacy:{bundle.migration_id}:{target_slug}",
                idempotency_key=(
                    f"cutover:{bundle.migration_id}:learning:{target_slug}"
                ),
                items=[
                    {
                        "sourceItemId": item.legacy_id,
                        "targetTopicId": item.target_topic_id,
                        "discipline": item.discipline,
                        "topic": item.topic,
                        "eventKind": item.event_kind,
                        "occurredAt": item.occurred_at.isoformat(),
                        "sourceDate": (
                            item.source_date.isoformat() if item.source_date else None
                        ),
                        "questionsDone": item.questions_done,
                        "correctCount": item.correct_count,
                        "wrongCount": item.wrong_count,
                        "doubtCount": item.doubt_count,
                        "favoriteCount": item.favorite_count,
                    }
                    for item in items
                ],
            )
            imported_count += result.imported_count
            rejected_count += result.rejected_count
            rejected_ids = {item.source_item_id for item in result.rejected}
            for item in items:
                if item.legacy_id in rejected_ids:
                    continue
                self.cutover.record_legacy_id(
                    migration_run_id=run_id,
                    record_kind="learning_item",
                    legacy_id=item.legacy_id,
                    target_type="learning_event_key",
                    target_ref=f"legacy:{target_slug}:{item.legacy_id}",
                    metadata={
                        "targetSlug": target_slug,
                        "sourceLabel": item.source_label,
                        "banca": item.banca,
                        "tags": list(item.tags),
                    },
                )
        return imported_count, rejected_count
