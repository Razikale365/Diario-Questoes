from __future__ import annotations

from datetime import datetime
import json
import sqlite3
from typing import Mapping

from study_os_service.domain.strategy import (
    SourceChoiceRow,
    SourceChoiceRun,
    StrategySource,
    StrategySourceItem,
    TopicSourceMapping,
    validate_strategy_metadata,
)


def _timestamp(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _source(row: sqlite3.Row) -> StrategySource:
    return StrategySource(
        id=row["id"],
        target_slug=row["target_slug"],
        source_key=row["source_key"],
        source_kind=row["source_kind"],
        display_name=row["display_name"],
        trust_tier=row["trust_tier"],
        root_id=row["root_id"],
        material_id=row["material_id"],
        external_url=row["external_url"],
        external_id=row["external_id"],
        edition=row["edition"],
        active=bool(row["active"]),
        notes=row["notes"],
        version=row["version"],
        created_at=_timestamp(row["created_at"]),
        updated_at=_timestamp(row["updated_at"]),
    )


def _item(row: sqlite3.Row) -> StrategySourceItem:
    return StrategySourceItem(
        id=row["id"],
        source_id=row["source_id"],
        target_slug=row["target_slug"],
        discipline=row["discipline"],
        topic_hint=row["topic_hint"],
        source_order=row["source_order"],
        content_role=row["content_role"],
        lesson_id=row["lesson_id"],
        material_id=row["material_id"],
        external_url=row["external_url"],
        external_id=row["external_id"],
        incidence_bp=row["incidence_bp"],
        banca=row["banca"],
        provenance=json.loads(row["provenance_json"]),
        source_fingerprint=row["source_fingerprint"],
        active=bool(row["active"]),
        version=row["version"],
        created_at=_timestamp(row["created_at"]),
        updated_at=_timestamp(row["updated_at"]),
    )


def _mapping(row: sqlite3.Row) -> TopicSourceMapping:
    return TopicSourceMapping(
        id=row["id"],
        target_slug=row["target_slug"],
        target_topic_id=row["target_topic_id"],
        source_item_id=row["source_item_id"],
        source_target_slug=row["source_target_slug"],
        transfer_kind=row["transfer_kind"],
        mapping_status=row["mapping_status"],
        confidence_bp=row["confidence_bp"],
        primary_eligible=bool(row["primary_eligible"]),
        manual_override=bool(row["manual_override"]),
        notes=row["notes"],
        version=row["version"],
        created_at=_timestamp(row["created_at"]),
        updated_at=_timestamp(row["updated_at"]),
    )


def _choice_run(row: sqlite3.Row) -> SourceChoiceRun:
    return SourceChoiceRun(
        id=row["id"],
        idempotency_key=row["idempotency_key"],
        target_slug=row["target_slug"],
        target_topic_id=row["target_topic_id"],
        block_kind=row["block_kind"],
        algorithm_version=row["algorithm_version"],
        input_hash=row["input_hash"],
        status=row["status"],
        shortfall_reason=row["shortfall_reason"],
        created_at=_timestamp(row["created_at"]),
    )


def _choice_row(row: sqlite3.Row) -> SourceChoiceRow:
    return SourceChoiceRow(
        id=row["id"],
        run_id=row["run_id"],
        target_slug=row["target_slug"],
        source_item_id=row["source_item_id"],
        target_fit_bp=row["target_fit_bp"],
        transfer_confidence_bp=row["transfer_confidence_bp"],
        trust_bp=row["trust_bp"],
        freshness_bp=row["freshness_bp"],
        order_readiness_bp=row["order_readiness_bp"],
        strategy_alignment_bp=row["strategy_alignment_bp"],
        material_availability_bp=row["material_availability_bp"],
        low_trust_penalty_bp=row["low_trust_penalty_bp"],
        mismatch_penalty_bp=row["mismatch_penalty_bp"],
        final_score=row["final_score"],
        chosen=bool(row["chosen"]),
        displaced_by_row_id=row["displaced_by_row_id"],
        stop_reason=row["stop_reason"],
        evidence=json.loads(row["evidence_json"]),
    )


class StrategyRepository:
    def __init__(self, connection: sqlite3.Connection):
        self.connection = connection

    def create_source(
        self,
        *,
        target_slug: str,
        source_key: str,
        source_kind: str,
        display_name: str,
        trust_tier: int,
        root_id: int | None,
        material_id: int | None,
        external_url: str | None,
        external_id: str | None,
        edition: str,
        notes: str,
    ) -> StrategySource:
        cursor = self.connection.execute(
            """
            INSERT INTO strategy_sources (
              target_slug, source_key, source_kind, display_name, trust_tier,
              root_id, material_id, external_url, external_id, edition, notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                target_slug,
                source_key,
                source_kind,
                display_name,
                trust_tier,
                root_id,
                material_id,
                external_url,
                external_id,
                edition,
                notes,
            ),
        )
        source = self.get_source(cursor.lastrowid)
        if source is None:
            raise RuntimeError("strategy source insert was not visible")
        return source

    def get_source(self, source_id: int) -> StrategySource | None:
        row = self.connection.execute(
            "SELECT * FROM strategy_sources WHERE id=?", (source_id,)
        ).fetchone()
        return _source(row) if row is not None else None

    def list_sources(self, target_slug: str) -> tuple[StrategySource, ...]:
        return tuple(
            _source(row)
            for row in self.connection.execute(
                """
                SELECT * FROM strategy_sources
                WHERE target_slug=? ORDER BY active DESC, source_kind, id
                """,
                (target_slug,),
            )
        )

    def insert_source_item(
        self,
        *,
        source_id: int,
        target_slug: str,
        discipline: str,
        topic_hint: str,
        source_order: int,
        content_role: str,
        lesson_id: int | None,
        material_id: int | None,
        external_url: str | None,
        external_id: str | None,
        incidence_bp: int,
        banca: str,
        provenance: Mapping[str, object],
        source_fingerprint: str,
    ) -> StrategySourceItem:
        safe_provenance = dict(validate_strategy_metadata(provenance, "provenance"))
        cursor = self.connection.execute(
            """
            INSERT INTO strategy_source_items (
              source_id, target_slug, discipline, topic_hint, source_order,
              content_role, lesson_id, material_id, external_url, external_id,
              incidence_bp, banca, provenance_json, source_fingerprint
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                source_id,
                target_slug,
                discipline,
                topic_hint,
                source_order,
                content_role,
                lesson_id,
                material_id,
                external_url,
                external_id,
                incidence_bp,
                banca,
                json.dumps(safe_provenance, sort_keys=True, separators=(",", ":")),
                source_fingerprint,
            ),
        )
        row = self.connection.execute(
            "SELECT * FROM strategy_source_items WHERE id=?", (cursor.lastrowid,)
        ).fetchone()
        if row is None:
            raise RuntimeError("strategy source item insert was not visible")
        return _item(row)

    def list_source_items(self, source_id: int) -> tuple[StrategySourceItem, ...]:
        return tuple(
            _item(row)
            for row in self.connection.execute(
                """
                SELECT * FROM strategy_source_items
                WHERE source_id=? ORDER BY source_order, id
                """,
                (source_id,),
            )
        )

    def insert_mapping(
        self,
        *,
        target_slug: str,
        target_topic_id: int,
        source_item_id: int,
        source_target_slug: str,
        transfer_kind: str,
        mapping_status: str,
        confidence_bp: int,
        primary_eligible: bool,
        manual_override: bool,
        notes: str,
    ) -> TopicSourceMapping:
        cursor = self.connection.execute(
            """
            INSERT INTO topic_source_mappings (
              target_slug, target_topic_id, source_item_id,
              source_target_slug, transfer_kind, mapping_status,
              confidence_bp, primary_eligible, manual_override, notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                target_slug,
                target_topic_id,
                source_item_id,
                source_target_slug,
                transfer_kind,
                mapping_status,
                confidence_bp,
                int(primary_eligible),
                int(manual_override),
                notes,
            ),
        )
        row = self.connection.execute(
            "SELECT * FROM topic_source_mappings WHERE id=?", (cursor.lastrowid,)
        ).fetchone()
        if row is None:
            raise RuntimeError("topic source mapping insert was not visible")
        return _mapping(row)

    def list_mappings(
        self, target_slug: str, mapping_status: str | None = None
    ) -> tuple[TopicSourceMapping, ...]:
        where = "target_slug=?"
        values: list[object] = [target_slug]
        if mapping_status is not None:
            where += " AND mapping_status=?"
            values.append(mapping_status)
        return tuple(
            _mapping(row)
            for row in self.connection.execute(
                f"SELECT * FROM topic_source_mappings WHERE {where} ORDER BY id",
                values,
            )
        )

    def insert_choice_run(
        self,
        *,
        idempotency_key: str,
        target_slug: str,
        target_topic_id: int,
        block_kind: str,
        algorithm_version: str,
        input_hash: str,
        status: str,
        shortfall_reason: str | None,
    ) -> SourceChoiceRun:
        cursor = self.connection.execute(
            """
            INSERT INTO source_choice_runs (
              idempotency_key, target_slug, target_topic_id, block_kind,
              algorithm_version, input_hash, status, shortfall_reason
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                idempotency_key,
                target_slug,
                target_topic_id,
                block_kind,
                algorithm_version,
                input_hash,
                status,
                shortfall_reason,
            ),
        )
        run = self.get_choice_run(cursor.lastrowid)
        if run is None:
            raise RuntimeError("source choice run insert was not visible")
        return run

    def get_choice_run(self, run_id: int) -> SourceChoiceRun | None:
        row = self.connection.execute(
            "SELECT * FROM source_choice_runs WHERE id=?", (run_id,)
        ).fetchone()
        return _choice_run(row) if row is not None else None

    def get_choice_run_by_key(self, idempotency_key: str) -> SourceChoiceRun | None:
        row = self.connection.execute(
            "SELECT * FROM source_choice_runs WHERE idempotency_key=?",
            (idempotency_key,),
        ).fetchone()
        return _choice_run(row) if row is not None else None

    def insert_choice_row(
        self,
        *,
        run_id: int,
        target_slug: str,
        source_item_id: int,
        target_fit_bp: int,
        transfer_confidence_bp: int,
        trust_bp: int,
        freshness_bp: int,
        order_readiness_bp: int,
        strategy_alignment_bp: int,
        material_availability_bp: int,
        low_trust_penalty_bp: int,
        mismatch_penalty_bp: int,
        final_score: int,
        chosen: bool,
        displaced_by_row_id: int | None,
        stop_reason: str | None,
        evidence: Mapping[str, object],
    ) -> SourceChoiceRow:
        safe_evidence = dict(validate_strategy_metadata(evidence, "choice evidence"))
        cursor = self.connection.execute(
            """
            INSERT INTO source_choice_rows (
              run_id, target_slug, source_item_id, target_fit_bp,
              transfer_confidence_bp, trust_bp, freshness_bp,
              order_readiness_bp, strategy_alignment_bp,
              material_availability_bp, low_trust_penalty_bp,
              mismatch_penalty_bp, final_score, chosen,
              displaced_by_row_id, stop_reason, evidence_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                run_id,
                target_slug,
                source_item_id,
                target_fit_bp,
                transfer_confidence_bp,
                trust_bp,
                freshness_bp,
                order_readiness_bp,
                strategy_alignment_bp,
                material_availability_bp,
                low_trust_penalty_bp,
                mismatch_penalty_bp,
                final_score,
                int(chosen),
                displaced_by_row_id,
                stop_reason,
                json.dumps(safe_evidence, sort_keys=True, separators=(",", ":")),
            ),
        )
        row = self.connection.execute(
            "SELECT * FROM source_choice_rows WHERE id=?", (cursor.lastrowid,)
        ).fetchone()
        if row is None:
            raise RuntimeError("source choice row insert was not visible")
        return _choice_row(row)

    def list_choice_rows(self, run_id: int) -> tuple[SourceChoiceRow, ...]:
        return tuple(
            _choice_row(row)
            for row in self.connection.execute(
                """
                SELECT * FROM source_choice_rows
                WHERE run_id=? ORDER BY chosen DESC, final_score DESC, id
                """,
                (run_id,),
            )
        )
