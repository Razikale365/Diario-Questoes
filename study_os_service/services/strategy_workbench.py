from __future__ import annotations

from dataclasses import dataclass
import sqlite3

from study_os_service.domain.planner import TargetTopic
from study_os_service.domain.strategy import (
    StrategySource,
    StrategySourceItem,
    TopicSourceMapping,
)
from study_os_service.repositories.inventory import (
    CourseRootRecord,
    InventoryRepository,
)
from study_os_service.repositories.planner_profiles import PlannerProfileRepository
from study_os_service.repositories.strategy import StrategyRepository


@dataclass(frozen=True, slots=True)
class StrategyWorkbenchPackage:
    state: str
    root: CourseRootRecord | None
    validated: bool


@dataclass(frozen=True, slots=True)
class StrategyWorkbenchMapping:
    mapping: TopicSourceMapping
    topic: TargetTopic


@dataclass(frozen=True, slots=True)
class StrategyWorkbenchItem:
    source: StrategySource
    item: StrategySourceItem
    mappings: tuple[StrategyWorkbenchMapping, ...]
    resolution_state: str


@dataclass(frozen=True, slots=True)
class StrategyWorkbench:
    target_slug: str
    package: StrategyWorkbenchPackage
    items: tuple[StrategyWorkbenchItem, ...]


class StrategyWorkbenchService:
    def __init__(self, connection: sqlite3.Connection):
        self.connection = connection
        self.strategy = StrategyRepository(connection)
        self.profiles = PlannerProfileRepository(connection)
        self.inventory = InventoryRepository(connection)

    def get(self, target_slug: str) -> StrategyWorkbench:
        target = self._target(target_slug)
        roots = self.inventory.list_roots(
            target_slug=target.target_slug, active_only=True
        )
        root = max(roots, key=lambda item: item.id, default=None)
        package = StrategyWorkbenchPackage(
            state=root.download_status if root is not None else "missing",
            root=root,
            validated=bool(root is not None and root.download_status == "validated"),
        )
        topic_by_id = {
            topic.id: topic for topic in self.profiles.list_topics(target.target_slug)
        }
        source_by_id: dict[int, StrategySource] = {}
        rows: list[StrategyWorkbenchItem] = []
        for item in self.strategy.list_workbench_source_items(target.target_slug):
            source = source_by_id.get(item.source_id)
            if source is None:
                source = self.strategy.get_source(item.source_id)
                if source is None:
                    raise RuntimeError("strategy workbench source disappeared")
                source_by_id[item.source_id] = source
            mappings = tuple(
                StrategyWorkbenchMapping(mapping=mapping, topic=topic_by_id[mapping.target_topic_id])
                for mapping in self.strategy.list_mappings_for_source_item(
                    target.target_slug, item.id
                )
                if mapping.target_topic_id in topic_by_id
            )
            rows.append(
                StrategyWorkbenchItem(
                    source=source,
                    item=item,
                    mappings=mappings,
                    resolution_state=self._resolution_state(mappings),
                )
            )
        order = {"unresolved": 0, "proposed": 1, "rejected": 2, "approved": 3}
        rows.sort(
            key=lambda row: (
                order[row.resolution_state],
                row.item.discipline.casefold(),
                row.item.source_order,
                row.item.id,
            )
        )
        return StrategyWorkbench(target.target_slug, package, tuple(rows))

    def save_mapping(
        self,
        *,
        source_item_id: int,
        target_slug: str,
        target_topic_id: int,
        expected_version: int,
        expected_source_version: int,
        source_trust_tier: int,
        mapping_status: str,
        transfer_kind: str,
        confidence_bp: int,
        primary_eligible: bool,
        notes: str,
    ) -> TopicSourceMapping:
        target = self._target(target_slug)
        item = self.strategy.get_source_item(source_item_id)
        if item is None:
            raise KeyError(f"strategy source item {source_item_id} does not exist")
        source = self.strategy.get_source(item.source_id)
        if source is None:
            raise RuntimeError("strategy source disappeared")
        if (
            isinstance(target_topic_id, bool)
            or not isinstance(target_topic_id, int)
            or target_topic_id < 1
        ):
            raise ValueError("target topic id must be a positive integer")
        topic = self.profiles.get_topic(target_topic_id)
        if topic is None:
            raise KeyError(f"target topic {target_topic_id} does not exist")
        if topic.target_slug != target.target_slug:
            raise ValueError("target topic belongs to a different target")
        self._validate_update(
            source=source,
            item=item,
            target_slug=target.target_slug,
            expected_version=expected_version,
            expected_source_version=expected_source_version,
            source_trust_tier=source_trust_tier,
            mapping_status=mapping_status,
            transfer_kind=transfer_kind,
            confidence_bp=confidence_bp,
            primary_eligible=primary_eligible,
            notes=notes,
        )
        owns_transaction = not self.connection.in_transaction
        if owns_transaction:
            self.connection.execute("BEGIN IMMEDIATE")
        try:
            saved = self.strategy.save_manual_mapping(
                target_slug=target.target_slug,
                target_topic_id=topic.id,
                source_item_id=item.id,
                source_target_slug=source.target_slug,
                transfer_kind=transfer_kind,
                mapping_status=mapping_status,
                confidence_bp=confidence_bp,
                primary_eligible=primary_eligible,
                notes=notes.strip(),
                expected_version=expected_version,
            )
            self.strategy.update_source_trust(
                source.id,
                trust_tier=source_trust_tier,
                expected_version=expected_source_version,
            )
            if owns_transaction:
                self.connection.commit()
            return saved
        except Exception:
            if owns_transaction:
                self.connection.rollback()
            raise

    def _target(self, target_slug: str):
        resolved = target_slug.strip() if isinstance(target_slug, str) else ""
        if not resolved:
            raise ValueError("target is required")
        target = self.profiles.get_target(resolved)
        if target is None:
            raise KeyError(f"target profile {resolved} does not exist")
        return target

    @staticmethod
    def _resolution_state(
        mappings: tuple[StrategyWorkbenchMapping, ...]
    ) -> str:
        statuses = {row.mapping.mapping_status for row in mappings}
        if "approved" in statuses:
            return "approved"
        if "proposed" in statuses:
            return "proposed"
        if "rejected" in statuses:
            return "rejected"
        return "unresolved"

    def _validate_update(
        self,
        *,
        source: StrategySource,
        item: StrategySourceItem,
        target_slug: str,
        expected_version: int,
        expected_source_version: int,
        source_trust_tier: int,
        mapping_status: str,
        transfer_kind: str,
        confidence_bp: int,
        primary_eligible: bool,
        notes: str,
    ) -> None:
        if isinstance(expected_version, bool) or not isinstance(expected_version, int) or expected_version < 0:
            raise ValueError("expected version must be a non-negative integer")
        if isinstance(expected_source_version, bool) or not isinstance(expected_source_version, int) or expected_source_version < 1:
            raise ValueError("expected source version must be a positive integer")
        if isinstance(source_trust_tier, bool) or not isinstance(source_trust_tier, int) or not 0 <= source_trust_tier <= 10:
            raise ValueError("source trust tier must be between 0 and 10")
        if mapping_status not in {"proposed", "approved", "rejected"}:
            raise ValueError("invalid mapping status")
        if transfer_kind not in {"target_specific", "shared", "partial"}:
            raise ValueError("invalid transfer kind")
        if isinstance(confidence_bp, bool) or not isinstance(confidence_bp, int) or not 0 <= confidence_bp <= 10000:
            raise ValueError("mapping confidence must be basis points")
        if not isinstance(primary_eligible, bool):
            raise ValueError("primary eligibility must be boolean")
        if not isinstance(notes, str):
            raise ValueError("notes must be text")
        cross_target = source.target_slug != target_slug
        if cross_target and transfer_kind == "target_specific":
            raise ValueError("cross-target mapping must be shared or partial")
        if cross_target and mapping_status == "approved" and not notes.strip():
            raise ValueError("approved cross-target mapping requires notes")
        if cross_target and primary_eligible:
            raise ValueError("cross-target source cannot be primary")
        if primary_eligible:
            if mapping_status != "approved":
                raise ValueError("primary source mapping must be approved")
            if item.content_role != "primary_theory" or item.material_id is None:
                raise ValueError("primary source requires an original local material")
            if not notes.strip():
                raise ValueError("manual primary source requires notes")
            root = (
                self.inventory.get_root(source.root_id)
                if source.root_id is not None
                else None
            )
            if root is None or root.download_status != "validated":
                raise ValueError("primary source requires a validated fresh package")
