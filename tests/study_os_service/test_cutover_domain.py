from copy import deepcopy
import json
from pathlib import Path

import pytest

from study_os_service.domain.cutover import LegacyBrowserBundle


FIXTURE = (
    Path(__file__).parent
    / "fixtures"
    / "cutover"
    / "browser_bundle_v1.json"
)


def payload() -> dict:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def test_browser_bundle_is_strict_normalized_and_hashable():
    bundle = LegacyBrowserBundle.from_payload(payload())

    assert bundle.schema == "study-os.browser-migration.v1"
    assert bundle.migration_id == "browser-20260713-a1"
    assert bundle.active_target_slug == "rfb_auditor"
    assert len(bundle.target_profiles) == 1
    assert len(bundle.coverage_rows) == 1
    assert len(bundle.ls_tasks) == 1
    assert len(bundle.source_signals) == 1
    assert len(bundle.learning_items) == 1
    assert len(bundle.payload_hash) == 64
    assert bundle.payload_hash == LegacyBrowserBundle.from_payload(
        bundle.to_payload()
    ).payload_hash


@pytest.mark.parametrize(
    "forbidden_key",
    [
        "statement",
        "question",
        "questionText",
        "alternatives",
        "correctAnswer",
        "gabarito",
        "html",
        "cookies",
        "credentials",
        "password",
        "senha",
        "token",
        "accessToken",
        "refreshToken",
    ],
)
def test_browser_bundle_rejects_proprietary_and_secret_fields_recursively(
    forbidden_key: str,
):
    value = payload()
    value["sourceSignals"][0]["metadata"] = {
        "nested": {forbidden_key: "must-not-cross"}
    }

    with pytest.raises(ValueError, match="proprietary or secret fields"):
        LegacyBrowserBundle.from_payload(value)


def test_browser_bundle_rejects_unknown_fields_duplicates_and_bad_counts():
    unknown = payload()
    unknown["unexpected"] = True
    with pytest.raises(ValueError, match="unsupported browser bundle fields"):
        LegacyBrowserBundle.from_payload(unknown)

    duplicate = payload()
    duplicate["lsTasks"].append(deepcopy(duplicate["lsTasks"][0]))
    with pytest.raises(ValueError, match="duplicate lsTasks legacyId"):
        LegacyBrowserBundle.from_payload(duplicate)

    counts = payload()
    counts["learningItems"][0]["correctCount"] = 8
    counts["learningItems"][0]["wrongCount"] = 4
    with pytest.raises(ValueError, match="correct and wrong counts exceed"):
        LegacyBrowserBundle.from_payload(counts)


def test_browser_bundle_requires_explicit_cross_target_transfer():
    value = payload()
    value["sourceSignals"][0]["targetSlug"] = "bacen_economia_financas"

    with pytest.raises(ValueError, match="cross-target source signal"):
        LegacyBrowserBundle.from_payload(value)

    value["sourceSignals"][0]["transferKind"] = "shared"
    bundle = LegacyBrowserBundle.from_payload(value)
    assert bundle.source_signals[0].transfer_kind == "shared"


def test_browser_bundle_rejects_unknown_targets_and_naive_timestamps():
    unknown = payload()
    unknown["activeTargetSlug"] = "unknown_exam"
    with pytest.raises(ValueError, match="unsupported target"):
        LegacyBrowserBundle.from_payload(unknown)

    naive = payload()
    naive["exportedAt"] = "2026-07-13T14:00:00"
    with pytest.raises(ValueError, match="exportedAt must include a timezone"):
        LegacyBrowserBundle.from_payload(naive)


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("dailyQuota", 9, "dailyQuota must be at most 8"),
        ("priorityScore", 101, "priorityScore must be at most 100"),
    ],
)
def test_browser_bundle_rejects_target_values_outside_planner_limits(
    field: str,
    value: int,
    message: str,
):
    invalid = payload()
    invalid["targetProfiles"][0][field] = value

    with pytest.raises(ValueError, match=message):
        LegacyBrowserBundle.from_payload(invalid)
