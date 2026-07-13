from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
from pathlib import Path
import re
import sqlite3
from typing import Literal, Mapping, Sequence
import unicodedata

from study_os_service.domain.strategy import StrategyIngestionRun
from study_os_service.repositories.strategy import StrategyRepository


ALGORITHM_VERSION = "m6-course-map-v1"
MatchStage = Literal["exact", "alias", "token"]

_AULA_PREFIX = re.compile(r"^\s*aula\s*0*\d{1,3}\s*[-:._/]*\s*", re.IGNORECASE)
_EDITION_PAREN = re.compile(
    r"\([^)]*(?:atualiz|edicao|edi[cç][aã]o|versao|vers[aã]o|20\d{2})[^)]*\)",
    re.IGNORECASE,
)
_EDITION_SUFFIX = re.compile(
    r"\b(?:atualizad[oa]|edicao|edi[cç][aã]o|versao|vers[aã]o)\s*(?:20\d{2})?\b",
    re.IGNORECASE,
)
_NOISE_TOKENS = {
    "a",
    "as",
    "aula",
    "com",
    "da",
    "das",
    "de",
    "do",
    "dos",
    "e",
    "em",
    "estrategico",
    "estrategica",
    "o",
    "os",
    "para",
    "passo",
    "regular",
}
_PRIMARY_KINDS = {"original", "simplified", "highlighted", "other"}


def normalize_mapping_text(value: str) -> str:
    without_aula = _AULA_PREFIX.sub("", value)
    without_edition = _EDITION_SUFFIX.sub(
        "", _EDITION_PAREN.sub("", without_aula)
    )
    decomposed = unicodedata.normalize("NFKD", without_edition)
    plain = "".join(
        character
        for character in decomposed
        if not unicodedata.combining(character)
    ).casefold()
    return " ".join(re.sub(r"[^a-z0-9]+", " ", plain).split())


def _tokens(value: str) -> frozenset[str]:
    return frozenset(
        token
        for token in normalize_mapping_text(value).split()
        if token not in _NOISE_TOKENS and not token.isdigit()
    )


@dataclass(frozen=True, slots=True)
class MappingTopic:
    id: int
    target_slug: str
    discipline: str
    topic: str
    transfer_kind: str
    aliases: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class CourseLessonEvidence:
    source_target_slug: str
    discipline: str
    course_name: str
    lesson_id: int
    lesson_number: int | None
    title: str
    material_id: int | None
    material_kind: str | None
    trust_level: int
    heading_tokens: tuple[str, ...] = ()
    material_name: str = ""

    @property
    def source_kind(self) -> Literal["course", "passo"]:
        course = normalize_mapping_text(self.course_name)
        return "passo" if "passo estrategico" in course else "course"


@dataclass(frozen=True, slots=True)
class CourseTopicMatch:
    target_topic_id: int
    target_slug: str
    stage: MatchStage
    confidence_bp: int
    mapping_status: Literal["approved", "proposed"]
    transfer_kind: Literal["target_specific", "shared", "partial"]


@dataclass(frozen=True, slots=True)
class CourseMappingSummary:
    root_id: int
    target_slug: str
    source_ids: tuple[int, ...]
    run_ids: tuple[int, ...]
    discovered_count: int
    mapped_count: int
    unresolved_count: int
    algorithm_version: str = ALGORITHM_VERSION


@dataclass(frozen=True, slots=True)
class _RankedMatch:
    topic: MappingTopic
    stage: MatchStage
    confidence_bp: int


def _direct_stage(
    topic: MappingTopic, normalized_phrases: tuple[str, ...]
) -> tuple[MatchStage, int] | None:
    normalized_topic = normalize_mapping_text(topic.topic)
    if normalized_topic and normalized_topic in normalized_phrases:
        return "exact", 10000
    aliases = {
        normalized
        for alias in topic.aliases
        if (normalized := normalize_mapping_text(alias))
    }
    if aliases.intersection(normalized_phrases):
        return "alias", 9600
    return None


def _token_score(topic: MappingTopic, phrases: tuple[str, ...]) -> int:
    topic_tokens = _tokens(topic.topic)
    if not topic_tokens:
        return 0
    best = 0
    for phrase in phrases:
        evidence_tokens = _tokens(phrase)
        overlap = len(topic_tokens.intersection(evidence_tokens))
        required = min(2, len(topic_tokens))
        if overlap < required:
            continue
        coverage = overlap / len(topic_tokens)
        precision = overlap / max(len(evidence_tokens), 1)
        score = round((coverage * 0.8 + precision * 0.2) * 10000)
        best = max(best, score)
    return best


def match_course_lesson(
    evidence: CourseLessonEvidence,
    topics: Sequence[MappingTopic],
    *,
    target_slug: str,
) -> tuple[CourseTopicMatch, ...]:
    evidence_discipline = normalize_mapping_text(evidence.discipline)
    raw_phrases = tuple(
        value
        for value in (
            evidence.title,
            *evidence.heading_tokens,
            Path(evidence.material_name).stem if evidence.material_name else "",
        )
        if value.strip()
    )
    normalized_phrases = tuple(
        dict.fromkeys(
            normalized
            for phrase in raw_phrases
            if (normalized := normalize_mapping_text(phrase))
        )
    )
    ranked: list[_RankedMatch] = []
    for topic in topics:
        if topic.target_slug != target_slug:
            continue
        if normalize_mapping_text(topic.discipline) != evidence_discipline:
            continue
        cross_target = evidence.source_target_slug != target_slug
        if cross_target and topic.transfer_kind == "target_specific":
            continue
        direct = _direct_stage(topic, normalized_phrases)
        if direct is None:
            score = _token_score(topic, raw_phrases)
            if score < 6000:
                continue
            stage: MatchStage = "token"
        else:
            stage, score = direct
        if cross_target:
            multiplier = 0.75 if topic.transfer_kind == "shared" else 0.55
            score = round(score * multiplier)
        ranked.append(_RankedMatch(topic, stage, score))

    direct_matches = [match for match in ranked if match.stage in {"exact", "alias"}]
    if direct_matches:
        selected = direct_matches
    elif ranked:
        top_score = max(match.confidence_bp for match in ranked)
        selected = [
            match for match in ranked if top_score - match.confidence_bp <= 250
        ]
    else:
        return ()

    ambiguous = len(selected) > 1
    cross_target = evidence.source_target_slug != target_slug
    return tuple(
        CourseTopicMatch(
            target_topic_id=match.topic.id,
            target_slug=target_slug,
            stage=match.stage,
            confidence_bp=match.confidence_bp,
            mapping_status=(
                "approved"
                if not ambiguous
                and not cross_target
                and match.stage in {"exact", "alias"}
                else "proposed"
            ),
            transfer_kind=(
                match.topic.transfer_kind if cross_target else "target_specific"
            ),
        )
        for match in sorted(selected, key=lambda value: value.topic.id)
    )


def _canonical_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(",", ":"))


def _sha256(value: object) -> str:
    return hashlib.sha256(_canonical_json(value).encode("utf-8")).hexdigest()


def _source_key(root_id: int, course_id: int, source_kind: str) -> str:
    return f"inventory:{root_id}:{course_id}:{source_kind}"


def _fingerprint(lesson_id: int, material_id: int | None) -> str:
    return _sha256({"lessonId": lesson_id, "materialId": material_id})


class CourseMappingService:
    def __init__(self, connection: sqlite3.Connection):
        self.connection = connection
        self.repository = StrategyRepository(connection)

    def map_root(
        self,
        root_id: int,
        *,
        target_slug: str | None = None,
        topic_aliases: Mapping[int, Sequence[str]] | None = None,
        heading_hints: Mapping[int, Sequence[str]] | None = None,
    ) -> CourseMappingSummary:
        root = self.connection.execute(
            "SELECT * FROM course_roots WHERE id=?", (root_id,)
        ).fetchone()
        if root is None:
            raise KeyError(f"course root {root_id} does not exist")
        if root["download_status"] != "validated":
            raise ValueError("course mapping requires a validated fresh package")
        destination_target = target_slug or root["target_slug"]
        if self.connection.execute(
            "SELECT 1 FROM exam_targets WHERE target_slug=?", (destination_target,)
        ).fetchone() is None:
            raise KeyError(f"target {destination_target} does not exist")

        aliases = {
            int(topic_id): tuple(str(value) for value in values)
            for topic_id, values in (topic_aliases or {}).items()
        }
        headings = {
            int(lesson_id): tuple(str(value) for value in values)
            for lesson_id, values in (heading_hints or {}).items()
        }
        topics = self._topics(destination_target, aliases)
        courses = self.connection.execute(
            """
            SELECT * FROM courses
            WHERE root_id=? AND active=1
            ORDER BY id
            """,
            (root_id,),
        ).fetchall()

        runs: list[StrategyIngestionRun] = []
        source_ids: list[int] = []
        for course in courses:
            if self._unsupported_course(course["display_name"]):
                continue
            source_kind = self._source_kind(course["display_name"])
            source = self._ensure_source(root, course, source_kind)
            source_ids.append(source.id)
            evidence_rows = self._course_evidence(
                root["target_slug"], course, headings
            )
            input_hash = self._input_hash(
                root_id=root_id,
                source_id=source.id,
                destination_target=destination_target,
                evidence_rows=evidence_rows,
                topics=topics,
            )
            idempotency_key = (
                f"course-map:{source.id}:{destination_target}:{input_hash}"
            )
            existing = self.repository.get_ingestion_run_by_key(idempotency_key)
            if existing is not None:
                runs.append(existing)
                continue
            runs.append(
                self._map_course(
                    source=source,
                    destination_target=destination_target,
                    evidence_rows=evidence_rows,
                    topics=topics,
                    input_hash=input_hash,
                    idempotency_key=idempotency_key,
                )
            )

        return CourseMappingSummary(
            root_id=root_id,
            target_slug=destination_target,
            source_ids=tuple(source_ids),
            run_ids=tuple(run.id for run in runs),
            discovered_count=sum(run.discovered_count for run in runs),
            mapped_count=sum(run.mapped_count for run in runs),
            unresolved_count=sum(run.unresolved_count for run in runs),
        )

    @staticmethod
    def _unsupported_course(display_name: str) -> bool:
        normalized = normalize_mapping_text(display_name)
        return "trilha estrategica" in normalized or "dicas e bizus" in normalized

    @staticmethod
    def _source_kind(display_name: str) -> Literal["course", "passo"]:
        return (
            "passo"
            if "passo estrategico" in normalize_mapping_text(display_name)
            else "course"
        )

    def _topics(
        self,
        target_slug: str,
        aliases: Mapping[int, tuple[str, ...]],
    ) -> tuple[MappingTopic, ...]:
        rows = self.connection.execute(
            """
            SELECT id, target_slug, discipline, topic, transfer_kind
            FROM target_topics
            WHERE target_slug=? AND active=1
            ORDER BY id
            """,
            (target_slug,),
        ).fetchall()
        known_ids = {row["id"] for row in rows}
        unknown_aliases = sorted(set(aliases) - known_ids)
        if unknown_aliases:
            raise ValueError(
                "topic aliases reference unknown target topics: "
                + ", ".join(str(value) for value in unknown_aliases)
            )
        return tuple(
            MappingTopic(
                id=row["id"],
                target_slug=row["target_slug"],
                discipline=row["discipline"],
                topic=row["topic"],
                transfer_kind=row["transfer_kind"],
                aliases=aliases.get(row["id"], ()),
            )
            for row in rows
        )

    def _ensure_source(self, root, course, source_kind: str):
        source_key = _source_key(root["id"], course["id"], source_kind)
        existing = self.repository.get_source_by_key(
            root["target_slug"], source_key
        )
        if existing is not None:
            return existing
        return self.repository.create_source(
            target_slug=root["target_slug"],
            source_key=source_key,
            source_kind=source_kind,
            display_name=course["display_name"],
            trust_tier=10 if source_kind == "course" else 7,
            root_id=root["id"],
            material_id=None,
            external_url=root["package_url"],
            external_id=f"{root['package_id'] or root['id']}:{course['id']}",
            edition=root["edition_note"],
            notes="Generated from validated local inventory",
        )

    def _course_evidence(
        self,
        source_target_slug: str,
        course,
        heading_hints: Mapping[int, tuple[str, ...]],
    ) -> tuple[CourseLessonEvidence, ...]:
        rows = self.connection.execute(
            """
            SELECT lessons.id AS lesson_id, lessons.lesson_number,
                   lessons.title, lessons.sequence_index,
                   disciplines.canonical_name AS discipline,
                   materials.id AS material_id, materials.kind AS material_kind,
                   materials.trust_level, materials.relative_path
            FROM lessons
            LEFT JOIN disciplines ON disciplines.id=lessons.discipline_id
            LEFT JOIN materials ON materials.id=(
              SELECT selected.id FROM materials AS selected
              WHERE selected.lesson_id=lessons.id AND selected.available=1
              ORDER BY selected.is_primary DESC, selected.trust_level DESC,
                       selected.id
              LIMIT 1
            )
            WHERE lessons.course_id=? AND lessons.available=1
            ORDER BY lessons.sequence_index, lessons.id
            """,
            (course["id"],),
        ).fetchall()
        return tuple(
            CourseLessonEvidence(
                source_target_slug=source_target_slug,
                discipline=row["discipline"] or course["display_name"],
                course_name=course["display_name"],
                lesson_id=row["lesson_id"],
                lesson_number=row["lesson_number"],
                title=row["title"],
                material_id=row["material_id"],
                material_kind=row["material_kind"],
                trust_level=row["trust_level"] or 0,
                heading_tokens=heading_hints.get(row["lesson_id"], ()),
                material_name=row["relative_path"] or "",
            )
            for row in rows
        )

    @staticmethod
    def _input_hash(
        *,
        root_id: int,
        source_id: int,
        destination_target: str,
        evidence_rows: tuple[CourseLessonEvidence, ...],
        topics: tuple[MappingTopic, ...],
    ) -> str:
        return _sha256(
            {
                "algorithmVersion": ALGORITHM_VERSION,
                "rootId": root_id,
                "sourceId": source_id,
                "targetSlug": destination_target,
                "evidence": [
                    {
                        "discipline": row.discipline,
                        "courseName": row.course_name,
                        "lessonId": row.lesson_id,
                        "lessonNumber": row.lesson_number,
                        "title": row.title,
                        "materialId": row.material_id,
                        "materialKind": row.material_kind,
                        "trustLevel": row.trust_level,
                        "headingTokens": row.heading_tokens,
                        "materialName": row.material_name,
                    }
                    for row in evidence_rows
                ],
                "topics": [
                    {
                        "id": topic.id,
                        "discipline": topic.discipline,
                        "topic": topic.topic,
                        "transferKind": topic.transfer_kind,
                        "aliases": topic.aliases,
                    }
                    for topic in topics
                ],
            }
        )

    def _map_course(
        self,
        *,
        source,
        destination_target: str,
        evidence_rows: tuple[CourseLessonEvidence, ...],
        topics: tuple[MappingTopic, ...],
        input_hash: str,
        idempotency_key: str,
    ) -> StrategyIngestionRun:
        mapped_count = 0
        unresolved: list[Mapping[str, object]] = []
        self.connection.execute("BEGIN IMMEDIATE")
        try:
            for source_order, evidence in enumerate(evidence_rows):
                matches = match_course_lesson(
                    evidence, topics, target_slug=destination_target
                )
                role = (
                    "primary_theory"
                    if source.source_kind == "course"
                    and evidence.material_id is not None
                    and evidence.material_kind in _PRIMARY_KINDS
                    else "review_support"
                )
                topic_hint = self._topic_hint(evidence)
                item = self.repository.upsert_source_item(
                    source_id=source.id,
                    target_slug=source.target_slug,
                    discipline=evidence.discipline,
                    topic_hint=topic_hint,
                    source_order=source_order,
                    content_role=role,
                    lesson_id=evidence.lesson_id,
                    material_id=evidence.material_id,
                    external_url=None,
                    external_id=None,
                    incidence_bp=0,
                    banca="",
                    provenance={
                        "algorithmVersion": ALGORITHM_VERSION,
                        "courseName": evidence.course_name,
                        "headingTokens": list(evidence.heading_tokens),
                        "lessonNumber": evidence.lesson_number,
                        "materialKind": evidence.material_kind,
                        "sourceTargetSlug": evidence.source_target_slug,
                    },
                    source_fingerprint=_fingerprint(
                        evidence.lesson_id, evidence.material_id
                    ),
                )
                keep_topic_ids = tuple(match.target_topic_id for match in matches)
                self.repository.reject_automatic_mappings_except(
                    source_item_id=item.id,
                    target_slug=destination_target,
                    keep_topic_ids=keep_topic_ids,
                )
                for match in matches:
                    primary_eligible = (
                        role == "primary_theory"
                        and match.mapping_status == "approved"
                        and evidence.source_target_slug == destination_target
                        and evidence.trust_level >= 7
                    )
                    self.repository.upsert_mapping(
                        target_slug=destination_target,
                        target_topic_id=match.target_topic_id,
                        source_item_id=item.id,
                        source_target_slug=evidence.source_target_slug,
                        transfer_kind=match.transfer_kind,
                        mapping_status=match.mapping_status,
                        confidence_bp=match.confidence_bp,
                        primary_eligible=primary_eligible,
                        notes=f"Deterministic {match.stage} match ({ALGORITHM_VERSION})",
                    )
                approved = [
                    match for match in matches if match.mapping_status == "approved"
                ]
                if approved:
                    mapped_count += 1
                else:
                    unresolved.append(
                        {
                            "lessonId": evidence.lesson_id,
                            "courseName": evidence.course_name,
                            "topicHint": topic_hint,
                            "candidateTopicIds": [
                                match.target_topic_id for match in matches
                            ],
                            "reason": "ambiguous" if matches else "no_match",
                        }
                    )
            run = self.repository.insert_ingestion_run(
                idempotency_key=idempotency_key,
                source_id=source.id,
                target_slug=source.target_slug,
                input_hash=input_hash,
                algorithm_version=ALGORITHM_VERSION,
                status="completed",
                discovered_count=len(evidence_rows),
                mapped_count=mapped_count,
                unresolved_report=tuple(unresolved),
            )
            self.connection.commit()
            return run
        except Exception:
            self.connection.rollback()
            raise

    @staticmethod
    def _topic_hint(evidence: CourseLessonEvidence) -> str:
        candidates = (*evidence.heading_tokens, evidence.title)
        for candidate in candidates:
            normalized = normalize_mapping_text(candidate)
            if normalized:
                return normalized
        return normalize_mapping_text(evidence.course_name) or "unresolved lesson"
