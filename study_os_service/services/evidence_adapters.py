from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime
import hashlib
import json
from typing import Mapping, Sequence

from study_os_service.domain.sprint import ExamSubjectProfile


def _single_line(value: object, *, maximum: int) -> str:
    text = " ".join(str(value or "").split())
    return text[:maximum]


def _timestamp(value: object, fallback: datetime) -> datetime:
    if not value:
        return fallback.astimezone(UTC)
    parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError("source timestamp must be timezone-aware")
    return parsed.astimezone(UTC)


def _timestamp_text(value: datetime) -> str:
    return value.astimezone(UTC).isoformat(timespec="microseconds").replace(
        "+00:00", "Z"
    )


def _digest(value: object) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=True,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


@dataclass(frozen=True, slots=True)
class AggregateEvidenceObservation:
    discipline: str
    topic_hint: str
    observed_on: date
    source_record_id: str
    source_revision: str
    source_updated_at: datetime
    measurement_type: str
    exam_board: str
    correct_count: int | None
    wrong_count: int | None
    doubt_count: int
    percentage_bp: int | None
    transfer_scope: str
    transferability_bp: int
    provenance: Mapping[str, str | int | float | bool | None]

    def to_payload(self) -> dict[str, object]:
        return {
            "discipline": self.discipline,
            "topicHint": self.topic_hint,
            "observedOn": self.observed_on.isoformat(),
            "sourceRecordId": self.source_record_id,
            "sourceRevision": self.source_revision,
            "sourceUpdatedAt": _timestamp_text(self.source_updated_at),
            "measurementType": self.measurement_type,
            "examBoard": self.exam_board,
            "correctCount": self.correct_count,
            "wrongCount": self.wrong_count,
            "doubtCount": self.doubt_count,
            "percentageBp": self.percentage_bp,
            "transferScope": self.transfer_scope,
            "transferabilityBp": self.transferability_bp,
            "provenance": dict(self.provenance),
        }


def observations_from_diario_backup(
    document: object,
    target_slug: str,
    snapshot_at: datetime,
) -> tuple[AggregateEvidenceObservation, ...]:
    if not target_slug.strip():
        raise ValueError("target is required")
    if not isinstance(document, list):
        raise ValueError("Diario backup must be an array")
    rows: list[AggregateEvidenceObservation] = []
    for task_index, task in enumerate(document):
        if not isinstance(task, Mapping):
            continue
        task_id = _single_line(task.get("id", task_index), maximum=80)
        discipline = _single_line(task.get("discipline"), maximum=120)
        if not discipline:
            continue
        try:
            observed_on = date.fromisoformat(str(task.get("date")))
        except ValueError:
            continue
        blocks = task.get("blocks")
        if not isinstance(blocks, list):
            continue
        for block_index, block in enumerate(blocks):
            if not isinstance(block, Mapping):
                continue
            questions = block.get("questions")
            if not isinstance(questions, list):
                continue
            answered = [
                item
                for item in questions
                if isinstance(item, Mapping)
                and (
                    item.get("isCorrect") is True
                    or item.get("isCorrect") is False
                )
            ]
            correct = sum(item.get("isCorrect") is True for item in answered)
            wrong = sum(item.get("isCorrect") is False for item in answered)
            if correct + wrong == 0:
                continue
            doubts = sum(item.get("hasDoubt") is True for item in answered)
            block_id = _single_line(block.get("id", block_index), maximum=80)
            structural = {
                "targetSlug": target_slug,
                "taskId": task_id,
                "blockId": block_id,
                "observedOn": observed_on.isoformat(),
                "discipline": discipline,
                "correctCount": correct,
                "wrongCount": wrong,
                "doubtCount": doubts,
                "measurementType": "mixed_set",
            }
            updated_value = task.get("updatedAt") or block.get("updatedAt")
            updated_at = _timestamp(updated_value, snapshot_at)
            revision = (
                _timestamp_text(updated_at)
                if updated_value
                else _digest(structural)
            )
            topic = _single_line(
                block.get("title") or block.get("lesson") or "",
                maximum=200,
            )
            meta = task.get("meta")
            rows.append(
                AggregateEvidenceObservation(
                    discipline=discipline,
                    topic_hint=topic,
                    observed_on=observed_on,
                    source_record_id=f"diario:{task_id}:{block_id}",
                    source_revision=revision,
                    source_updated_at=updated_at,
                    measurement_type="mixed_set",
                    exam_board=_single_line(
                        block.get("bank") or task.get("bank") or "",
                        maximum=80,
                    ),
                    correct_count=correct,
                    wrong_count=wrong,
                    doubt_count=doubts,
                    percentage_bp=None,
                    transfer_scope="content",
                    transferability_bp=10000,
                    provenance={
                        "provider": "diario_backup",
                        "sourceTaskId": task_id,
                        "metaNumber": _single_line(meta, maximum=40) if meta else None,
                        "planningId": _single_line(
                            task.get("planejamento"), maximum=80
                        ) or None,
                        "timestampQuality": (
                            "source" if updated_value else "snapshot"
                        ),
                    },
                )
            )
    return tuple(rows)


def observations_from_ls_history(
    document: object,
    target_slug: str,
    planning_id: int | str,
) -> tuple[AggregateEvidenceObservation, ...]:
    if not target_slug.strip():
        raise ValueError("target is required")
    if not str(planning_id).strip():
        raise ValueError("planning id is required")
    if isinstance(document, Mapping):
        records = document.get("observations", document.get("items"))
    else:
        records = document
    if not isinstance(records, list):
        raise ValueError("LS history must contain an observations array")
    rows: list[AggregateEvidenceObservation] = []
    for index, item in enumerate(records):
        if not isinstance(item, Mapping):
            raise ValueError("LS observation must be an object")
        discipline = _single_line(item.get("discipline"), maximum=120)
        if not discipline:
            raise ValueError("LS observation discipline is required")
        observed = date.fromisoformat(
            str(item.get("observedOn") or item.get("completionDate"))
        )
        updated_at = _timestamp(item.get("sourceUpdatedAt"), datetime.combine(observed, datetime.min.time(), tzinfo=UTC))
        correct = item.get("correctCount")
        wrong = item.get("wrongCount")
        percentage = item.get("percentageBp")
        if correct is not None or wrong is not None:
            if not isinstance(correct, int) or not isinstance(wrong, int):
                raise ValueError("LS exact counts must be integers")
            percentage = None
        elif not isinstance(percentage, int):
            raise ValueError("LS percentage is required when counts are unknown")
        task_id = _single_line(
            item.get("sourceTaskId") or item.get("taskId") or index,
            maximum=100,
        )
        revision = _single_line(item.get("sourceRevision"), maximum=200)
        if not revision:
            revision = _digest(
                {
                    "planningId": str(planning_id),
                    "taskId": task_id,
                    "observedOn": observed.isoformat(),
                    "correctCount": correct,
                    "wrongCount": wrong,
                    "percentageBp": percentage,
                }
            )
        rows.append(
            AggregateEvidenceObservation(
                discipline=discipline,
                topic_hint=_single_line(item.get("topicHint"), maximum=200),
                observed_on=observed,
                source_record_id=f"ls:{planning_id}:{task_id}",
                source_revision=revision,
                source_updated_at=updated_at,
                measurement_type=(
                    _single_line(item.get("measurementType"), maximum=40)
                    or ("mixed_set" if correct is not None else "ls_percentage")
                ),
                exam_board=_single_line(item.get("examBoard"), maximum=80),
                correct_count=correct,
                wrong_count=wrong,
                doubt_count=int(item.get("doubtCount", 0)),
                percentage_bp=percentage,
                transfer_scope="content",
                transferability_bp=int(item.get("transferabilityBp", 10000)),
                provenance={
                    "provider": "ls_history",
                    "planningId": str(planning_id),
                    "metaNumber": item.get("metaNumber"),
                    "sourceTaskId": task_id,
                    "sourceOrder": item.get("sourceOrder"),
                    "timestampQuality": (
                        "source" if item.get("sourceUpdatedAt") else "completion_date"
                    ),
                },
            )
        )
    return tuple(rows)


def sefaz_go_baseline_observations(
    subjects: Sequence[ExamSubjectProfile],
) -> tuple[AggregateEvidenceObservation, ...]:
    observed = date(2026, 4, 24)
    updated = datetime(2026, 4, 24, tzinfo=UTC)
    return tuple(
        AggregateEvidenceObservation(
            discipline=subject.display_name,
            topic_hint="SEFAZ GO low-confidence aggregate baseline",
            observed_on=observed,
            source_record_id=f"sefaz-go-baseline:{subject.subject_key}",
            source_revision="sefaz-go-low-confidence-v1",
            source_updated_at=updated,
            measurement_type="baseline",
            exam_board="FCC",
            correct_count=None,
            wrong_count=None,
            doubt_count=0,
            percentage_bp=subject.baseline_accuracy_bp or 5000,
            transfer_scope="content",
            transferability_bp=(0 if subject.subject_key == "p2_lte" else 2500),
            provenance={
                "provider": "sefaz_go_baseline",
                "sourceTaskId": subject.subject_key,
                "timestampQuality": "exam_date",
            },
        )
        for subject in subjects
    )
