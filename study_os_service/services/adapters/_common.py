from __future__ import annotations

from datetime import date
import hashlib
import json
from typing import Mapping

from study_os_service.domain.strategy import validate_strategy_metadata


def object_payload(value: object, label: str = "payload") -> dict[str, object]:
    if not isinstance(value, Mapping):
        raise ValueError(f"{label} must be an object")
    validate_strategy_metadata(value, label)
    return dict(value)


def strict_fields(
    value: Mapping[str, object], allowed: set[str], label: str
) -> None:
    unsupported = sorted(set(value) - allowed)
    if unsupported:
        raise ValueError(
            f"unsupported {label} fields: " + ", ".join(unsupported)
        )


def required_text(value: Mapping[str, object], key: str) -> str:
    raw = value.get(key)
    if not isinstance(raw, str) or not raw.strip():
        raise ValueError(f"{key} is required")
    return raw.strip()


def optional_text(value: Mapping[str, object], key: str, default: str = "") -> str:
    raw = value.get(key, default)
    if not isinstance(raw, str):
        raise ValueError(f"{key} must be text")
    return raw.strip()


def iso_date(value: Mapping[str, object], key: str) -> str:
    resolved = required_text(value, key)
    try:
        date.fromisoformat(resolved)
    except ValueError as exc:
        raise ValueError(f"{key} must use YYYY-MM-DD") from exc
    return resolved


def rows(value: Mapping[str, object], key: str) -> list[dict[str, object]]:
    raw = value.get(key)
    if not isinstance(raw, list):
        raise ValueError(f"{key} must be an array")
    return [object_payload(item, f"{key} item") for item in raw]


def non_negative_order(value: Mapping[str, object], key: str) -> int:
    raw = value.get(key)
    if isinstance(raw, bool) or not isinstance(raw, int) or raw < 0:
        raise ValueError(f"{key} must be a non-negative integer")
    return raw


def optional_id(value: Mapping[str, object], key: str) -> int | None:
    raw = value.get(key)
    if raw is None:
        return None
    if isinstance(raw, bool) or not isinstance(raw, int) or raw < 1:
        raise ValueError(f"{key} must be a positive integer")
    return raw


def fingerprint(value: object) -> str:
    canonical = json.dumps(
        value, ensure_ascii=True, sort_keys=True, separators=(",", ":")
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()
