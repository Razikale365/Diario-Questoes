from __future__ import annotations

from dataclasses import replace
from datetime import UTC, date, datetime
import hashlib
import json
import math
import sqlite3
from typing import Any, Mapping, Sequence

from study_os_service.domain.sprint import ExamSubjectProfile
from study_os_service.domain.sprint_evidence import SprintPerformanceObservation
from study_os_service.repositories.sprint_evidence import SprintEvidenceRepository
from study_os_service.repositories.sprint import SprintRepository
from study_os_service.services.sprint import (
    SprintProfileService,
    SprintTargetNotFoundError,
)
from study_os_service.services.subject_matching import SubjectMatch, match_subject


OBSERVATION_KEYS = frozenset(
    {
        "discipline",
        "topicHint",
        "observedOn",
        "sourceRecordId",
        "sourceRevision",
        "sourceUpdatedAt",
        "measurementType",
        "examBoard",
        "correctCount",
        "wrongCount",
        "doubtCount",
        "percentageBp",
        "transferScope",
        "transferabilityBp",
        "provenance",
    }
)
BATCH_KEYS = frozenset(
    {"targetSlug", "batchId", "origin", "dryRun", "observations"}
)
PROVENANCE_KEYS = frozenset(
    {
        "planningId",
        "metaNumber",
        "sourceTaskId",
        "sourceOrder",
        "provider",
        "importFileSha256",
        "timestampQuality",
        "originalScheduledDate",
        "sourceKind",
    }
)


class EvidenceBatchConflictError(RuntimeError):
    pass


def _canonical_json(value: object) -> str:
    return json.dumps(
        value,
        ensure_ascii=True,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    )


def _sha256(value: object) -> str:
    return hashlib.sha256(_canonical_json(value).encode("utf-8")).hexdigest()


def _text(
    value: object,
    label: str,
    *,
    maximum: int,
    allow_empty: bool = False,
) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{label} must be text")
    if "\n" in value or "\r" in value:
        raise ValueError(f"{label} must be single-line")
    normalized = value.strip()
    if not allow_empty and not normalized:
        raise ValueError(f"{label} is required")
    if len(normalized) > maximum:
        raise ValueError(f"{label} is too long")
    return normalized


def _integer(
    value: object,
    label: str,
    *,
    minimum: int = 0,
    maximum: int = 2_147_483_647,
) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"{label} must be an integer")
    if not minimum <= value <= maximum:
        raise ValueError(f"{label} is out of range")
    return value


def _optional_integer(
    value: object,
    label: str,
    *,
    maximum: int,
) -> int | None:
    if value is None:
        return None
    return _integer(value, label, maximum=maximum)


def _date(value: object, label: str) -> date:
    if not isinstance(value, str):
        raise ValueError(f"{label} must use YYYY-MM-DD")
    try:
        parsed = date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError(f"{label} must use YYYY-MM-DD") from exc
    if parsed.isoformat() != value:
        raise ValueError(f"{label} must use YYYY-MM-DD")
    return parsed


def _timestamp(value: object, label: str) -> datetime:
    if not isinstance(value, str):
        raise ValueError(f"{label} must be an ISO timestamp")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(f"{label} must be an ISO timestamp") from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError(f"{label} must be timezone-aware")
    return parsed.astimezone(UTC)


def _timestamp_text(value: datetime) -> str:
    return value.astimezone(UTC).isoformat(timespec="microseconds").replace(
        "+00:00", "Z"
    )


def _provenance(value: object) -> dict[str, str | int | float | bool | None]:
    if not isinstance(value, Mapping):
        raise ValueError("provenance must be an object")
    extras = set(value) - PROVENANCE_KEYS
    if extras:
        raise ValueError("provenance contains a non-allowlisted key")
    result: dict[str, str | int | float | bool | None] = {}
    for key, item in value.items():
        if item is not None and not isinstance(item, (str, int, float, bool)):
            raise ValueError("provenance values must be scalar")
        if isinstance(item, str):
            item = _text(
                item,
                f"provenance {key}",
                maximum=200,
                allow_empty=True,
            )
        if isinstance(item, float) and not math.isfinite(item):
            raise ValueError("provenance numeric values must be finite")
        result[key] = item
    return result


def _observation_hash_document(
    observation: SprintPerformanceObservation,
) -> dict[str, Any]:
    return {
        "targetSlug": observation.target_slug,
        "origin": observation.origin,
        "discipline": observation.discipline,
        "topicHint": observation.topic_hint,
        "observedOn": observation.observed_on.isoformat(),
        "sourceRecordId": observation.source_record_id,
        "sourceRevision": observation.source_revision,
        "sourceUpdatedAt": _timestamp_text(observation.source_updated_at),
        "measurementType": observation.measurement_type,
        "examBoard": observation.exam_board,
        "correctCount": observation.correct_count,
        "wrongCount": observation.wrong_count,
        "doubtCount": observation.doubt_count,
        "percentageBp": observation.percentage_bp,
        "transferScope": observation.transfer_scope,
        "transferabilityBp": observation.transferability_bp,
        "provenance": dict(observation.provenance),
    }


def _prepare_observation(
    raw: object,
    *,
    target_slug: str,
    batch_id: str,
    origin: str,
) -> SprintPerformanceObservation:
    if not isinstance(raw, Mapping):
        raise ValueError("each observation must be an object")
    extras = set(raw) - OBSERVATION_KEYS
    if extras:
        raise ValueError("observation contains a non-allowlisted key")

    provisional = SprintPerformanceObservation(
        id=None,
        target_slug=target_slug,
        batch_id=batch_id,
        subject_profile_id=None,
        subject_key=None,
        discipline=_text(raw.get("discipline"), "discipline", maximum=120),
        topic_hint=_text(
            raw.get("topicHint", ""),
            "topic hint",
            maximum=200,
            allow_empty=True,
        ),
        observed_on=_date(raw.get("observedOn"), "observed on"),
        origin=origin,
        source_record_id=_text(
            raw.get("sourceRecordId"), "source record id", maximum=200
        ),
        source_revision=_text(
            raw.get("sourceRevision"), "source revision", maximum=200
        ),
        source_updated_at=_timestamp(
            raw.get("sourceUpdatedAt"), "source updated at"
        ),
        measurement_type=raw.get("measurementType"),
        exam_board=_text(
            raw.get("examBoard", ""),
            "exam board",
            maximum=80,
            allow_empty=True,
        ),
        correct_count=_optional_integer(
            raw.get("correctCount"), "correct count", maximum=1_000_000
        ),
        wrong_count=_optional_integer(
            raw.get("wrongCount"), "wrong count", maximum=1_000_000
        ),
        doubt_count=_integer(
            raw.get("doubtCount", 0), "doubt count", maximum=1_000_000
        ),
        percentage_bp=_optional_integer(
            raw.get("percentageBp"), "percentage", maximum=10000
        ),
        transfer_scope=raw.get("transferScope", "content"),
        transferability_bp=_integer(
            raw.get("transferabilityBp", 10000),
            "transferability",
            maximum=10000,
        ),
        content_hash="0" * 64,
        provenance=_provenance(raw.get("provenance", {})),
    )
    return replace(
        provisional,
        content_hash=_sha256(_observation_hash_document(provisional)),
    )


def _batch_hash(
    target_slug: str,
    batch_id: str,
    origin: str,
    observations: Sequence[SprintPerformanceObservation],
) -> str:
    return _sha256(
        {
            "targetSlug": target_slug,
            "batchId": batch_id,
            "origin": origin,
            "observations": [item.content_hash for item in observations],
        }
    )


def _map_observation(
    observation: SprintPerformanceObservation,
    subjects: Sequence[ExamSubjectProfile],
) -> tuple[SprintPerformanceObservation, SubjectMatch]:
    match = match_subject(observation.discipline, subjects)
    if match.subject_key is None:
        return observation, match
    subject = next(
        item for item in subjects if item.subject_key == match.subject_key
    )
    return (
        replace(
            observation,
            subject_profile_id=subject.id,
            subject_key=subject.subject_key,
        ),
        match,
    )


class SprintEvidenceService:
    def __init__(self, connection: sqlite3.Connection):
        self.connection = connection
        self.repository = SprintEvidenceRepository(connection)

    def import_batch(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        if not isinstance(payload, Mapping):
            raise ValueError("evidence payload must be an object")
        extras = set(payload) - BATCH_KEYS
        if extras:
            raise ValueError("evidence payload contains a non-allowlisted key")
        target_slug = _text(payload.get("targetSlug"), "target", maximum=100)
        batch_id = _text(payload.get("batchId"), "batch id", maximum=200)
        origin = _text(payload.get("origin"), "origin", maximum=100)
        dry_run = payload.get("dryRun", True)
        if type(dry_run) is not bool:
            raise ValueError("dryRun must be boolean")
        raw_observations = payload.get("observations")
        if not isinstance(raw_observations, list) or not raw_observations:
            raise ValueError("observations must be a non-empty array")
        observations = tuple(
            _prepare_observation(
                item,
                target_slug=target_slug,
                batch_id=batch_id,
                origin=origin,
            )
            for item in raw_observations
        )

        self.connection.execute("BEGIN IMMEDIATE")
        try:
            _, subjects = SprintProfileService(
                self.connection
            ).bootstrap_in_transaction(target_slug)
            mapped = tuple(
                _map_observation(item, subjects) for item in observations
            )
            observations = tuple(item for item, _match in mapped)
            matches = tuple(match for _item, match in mapped)
            payload_hash = _batch_hash(
                target_slug, batch_id, origin, observations
            )
            existing_batch = self.repository.get_batch(batch_id)
            if existing_batch is not None:
                if existing_batch["payload_hash"] != payload_hash:
                    raise EvidenceBatchConflictError(
                        "batch id was already used with another payload"
                    )
                response = dict(existing_batch["report"])
                response["replayed"] = True
                response["dryRun"] = dry_run
                self.connection.rollback()
                return response

            self.repository.create_batch_in_transaction(
                batch_id=batch_id,
                target_slug=target_slug,
                origin=origin,
                payload_hash=payload_hash,
                item_count=len(observations),
            )
            inserted_count = 0
            duplicate_count = 0
            conflict_count = 0
            items: list[dict[str, Any]] = []
            for observation, match in zip(observations, matches, strict=True):
                existing = self.repository.find_revision(
                    observation.target_slug,
                    observation.origin,
                    observation.source_record_id,
                    observation.source_revision,
                )
                if existing is None:
                    self.repository.append_observation_in_transaction(observation)
                    outcome = "inserted"
                    inserted_count += 1
                elif existing.content_hash == observation.content_hash:
                    outcome = "duplicate"
                    duplicate_count += 1
                else:
                    outcome = "conflict"
                    conflict_count += 1
                items.append(
                    {
                        "sourceRecordId": observation.source_record_id,
                        "sourceRevision": observation.source_revision,
                        "outcome": outcome,
                        "subjectKey": observation.subject_key,
                        "matchStatus": match.status,
                        "contentHash": observation.content_hash,
                    }
                )

            report = {
                "batchId": batch_id,
                "targetSlug": target_slug,
                "origin": origin,
                "dryRun": dry_run,
                "replayed": False,
                "insertedCount": inserted_count,
                "duplicateCount": duplicate_count,
                "conflictCount": conflict_count,
                "unresolvedCount": sum(
                    match.subject_key is None for match in matches
                ),
                "items": items,
            }
            self.repository.finalize_batch_in_transaction(
                batch_id=batch_id,
                inserted_count=inserted_count,
                duplicate_count=duplicate_count,
                conflict_count=conflict_count,
                report=report | {"dryRun": False},
            )
            if dry_run:
                self.connection.rollback()
            else:
                self.connection.commit()
            return report
        except Exception:
            if self.connection.in_transaction:
                self.connection.rollback()
            raise

    def list_observations(
        self, target_slug: str
    ) -> tuple[SprintPerformanceObservation, ...]:
        target_slug = _text(target_slug, "target", maximum=100)
        if not SprintRepository(self.connection).target_exists(target_slug):
            raise SprintTargetNotFoundError(target_slug)
        return self.repository.list_observations(target_slug)
