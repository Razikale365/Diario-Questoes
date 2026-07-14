from __future__ import annotations

from dataclasses import dataclass
import unicodedata
from typing import Literal, Sequence

from study_os_service.domain.sprint import ExamSubjectProfile


SubjectMatchStatus = Literal["exact", "approximate", "ambiguous", "unresolved"]


@dataclass(frozen=True, slots=True)
class SubjectMatch:
    subject_key: str | None
    status: SubjectMatchStatus


def normalize_subject_text(value: str) -> str:
    decomposed = unicodedata.normalize("NFKD", value)
    ascii_value = "".join(
        character
        for character in decomposed
        if not unicodedata.combining(character)
    )
    return " ".join(
        "".join(
            character if character.isalnum() else " "
            for character in ascii_value.lower()
        ).split()
    )


def _contains_token_phrase(
    container: tuple[str, ...], phrase: tuple[str, ...]
) -> bool:
    if not phrase or len(phrase) > len(container):
        return False
    width = len(phrase)
    return any(
        container[index : index + width] == phrase
        for index in range(len(container) - width + 1)
    )


def token_phrase_match(candidate: str, alias: str) -> bool:
    candidate_tokens = tuple(candidate.split())
    alias_tokens = tuple(alias.split())
    return _contains_token_phrase(
        candidate_tokens, alias_tokens
    ) or _contains_token_phrase(
        alias_tokens,
        candidate_tokens,
    )


def _subject_aliases(subject: ExamSubjectProfile) -> tuple[str, ...]:
    return (subject.display_name, *subject.aliases)


def match_subject(
    discipline: str, subjects: Sequence[ExamSubjectProfile]
) -> SubjectMatch:
    candidate = normalize_subject_text(discipline)
    if not candidate:
        return SubjectMatch(None, "unresolved")

    exact = {
        subject.subject_key
        for subject in subjects
        for alias in _subject_aliases(subject)
        if normalize_subject_text(alias) == candidate
    }
    if len(exact) == 1:
        return SubjectMatch(next(iter(exact)), "exact")
    if len(exact) > 1:
        return SubjectMatch(None, "ambiguous")

    approximate = {
        subject.subject_key
        for subject in subjects
        for alias in _subject_aliases(subject)
        if token_phrase_match(candidate, normalize_subject_text(alias))
    }
    if len(approximate) == 1:
        return SubjectMatch(next(iter(approximate)), "approximate")
    return SubjectMatch(None, "ambiguous" if approximate else "unresolved")
