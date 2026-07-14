from datetime import UTC, date, datetime, timedelta, timezone
import importlib

import pytest


NOW = datetime(2026, 7, 14, 12, tzinfo=UTC)


def _domain():
    return importlib.import_module("study_os_service.domain.sprint_evidence")


def _observation(**overrides):
    values = {
        "id": 1,
        "target_slug": "sefaz_ce",
        "batch_id": "batch-1",
        "subject_profile_id": 4,
        "subject_key": "p1_economia",
        "discipline": "Economia",
        "topic_hint": "Microeconomia",
        "observed_on": date(2026, 7, 14),
        "origin": "ls_history",
        "source_record_id": "meta-47-task-1",
        "source_revision": "revision-1",
        "source_updated_at": NOW,
        "measurement_type": "unseen_set",
        "exam_board": "FCC",
        "correct_count": 8,
        "wrong_count": 2,
        "doubt_count": 1,
        "percentage_bp": 8000,
        "transfer_scope": "content",
        "transferability_bp": 10000,
        "content_hash": "a" * 64,
        "provenance": {"planningId": "119790", "metaNumber": 47},
    }
    values.update(overrides)
    return _domain().SprintPerformanceObservation(**values)


def _cycle(**overrides):
    values = {
        "id": 1,
        "target_slug": "sefaz_ce",
        "source_kind": "ls",
        "plan_label": "Meta 47",
        "meta_number": 47,
        "released_at": datetime(2026, 7, 11, 8, tzinfo=UTC),
        "starts_on": date(2026, 7, 11),
        "ends_on": date(2026, 7, 17),
        "version": 1,
    }
    values.update(overrides)
    return _domain().SourcePlanCycle(**values)


def _backlog(**overrides):
    values = {
        "id": 1,
        "target_slug": "sefaz_ce",
        "source_cycle_id": 1,
        "source_plan_task_id": 9,
        "reason": "cycle_closed_pending",
        "return_score_milli": 1200,
        "state": "candidate",
        "discovered_on": date(2026, 7, 18),
        "recovered_on": None,
    }
    values.update(overrides)
    return _domain().SourcePlanBacklogCandidate(**values)


def _subject(**overrides):
    values = {
        "subject_profile_id": 4,
        "subject_key": "p1_economia",
        "display_name": "Economia",
        "paper": "P1",
        "question_count": 10,
        "question_weight": 1.0,
        "estimate_bp": 7000,
        "low_bp": 6000,
        "high_bp": 8000,
        "effective_sample": 18.5,
        "confidence_bp": 4200,
        "fragility_bp": 2500,
        "representative_set_count": 1,
        "demotion_eligible": False,
        "dominant_origin": "diario_backup",
        "warnings": ("sample_limited",),
    }
    values.update(overrides)
    return _domain().SubjectProjection(**values)


def test_exact_observation_derives_sqlite_compatible_half_up_percentage():
    observation = _observation(
        correct_count=1,
        wrong_count=31,
        doubt_count=0,
        percentage_bp=None,
    )
    assert observation.percentage_bp == 313


def test_observation_enforces_aggregate_pair_and_doubt_bounds():
    with pytest.raises(ValueError, match="together"):
        _observation(wrong_count=None)
    with pytest.raises(ValueError, match="answered"):
        _observation(correct_count=0, wrong_count=0, doubt_count=0, percentage_bp=0)
    with pytest.raises(ValueError, match="doubt"):
        _observation(doubt_count=11)
    with pytest.raises(ValueError, match="percentage"):
        _observation(percentage_bp=7900)


def test_unknown_sample_percentage_is_valid_but_requires_a_percentage():
    observation = _observation(
        correct_count=None,
        wrong_count=None,
        doubt_count=0,
        percentage_bp=7350,
        measurement_type="ls_percentage",
    )
    assert observation.sample_size is None
    with pytest.raises(ValueError, match="percentage"):
        _observation(
            correct_count=None,
            wrong_count=None,
            doubt_count=0,
            percentage_bp=None,
            measurement_type="ls_percentage",
        )


def test_observation_normalizes_time_and_freezes_provenance():
    local = NOW.astimezone(timezone(-timedelta(hours=3)))
    original = {"planningId": "119790"}
    observation = _observation(source_updated_at=local, provenance=original)
    original["planningId"] = "changed"
    assert observation.source_updated_at == NOW
    assert observation.provenance["planningId"] == "119790"
    with pytest.raises(TypeError):
        observation.provenance["planningId"] = "blocked"
    with pytest.raises(ValueError, match="timezone-aware"):
        _observation(source_updated_at=datetime(2026, 7, 14, 12))


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("measurement_type", "quiz"),
        ("transfer_scope", "state_law"),
        ("transferability_bp", 10001),
        ("content_hash", "not-a-sha"),
    ],
)
def test_observation_rejects_invalid_enums_and_bounds(field, value):
    with pytest.raises(ValueError):
        _observation(**{field: value})


def test_cycle_requires_ordered_dates_and_aware_release():
    assert _cycle().starts_on == date(2026, 7, 11)
    with pytest.raises(ValueError, match="cycle dates"):
        _cycle(starts_on=date(2026, 7, 18), ends_on=date(2026, 7, 17))
    with pytest.raises(ValueError, match="release"):
        _cycle(released_at=datetime(2026, 7, 18, tzinfo=UTC))
    with pytest.raises(ValueError, match="timezone-aware"):
        _cycle(released_at=datetime(2026, 7, 11, 8))


def test_backlog_recovery_date_matches_state():
    assert _backlog().state == "candidate"
    recovered = _backlog(state="recovered", recovered_on=date(2026, 7, 19))
    assert recovered.recovered_on == date(2026, 7, 19)
    with pytest.raises(ValueError, match="recovery"):
        _backlog(state="recovered")
    with pytest.raises(ValueError, match="unrecovered"):
        _backlog(recovered_on=date(2026, 7, 19))


def test_projection_records_enforce_ordered_ranges_and_immutable_warnings():
    subject = _subject()
    assert subject.low_bp <= subject.estimate_bp <= subject.high_bp
    assert subject.warnings == ("sample_limited",)
    with pytest.raises(ValueError, match="interval"):
        _subject(low_bp=7100)
    with pytest.raises(ValueError, match="confidence"):
        _subject(confidence_bp=10001)
    with pytest.raises(ValueError, match="tuple"):
        _subject(warnings=["sample_limited"])


def test_sprint_projection_computes_weighted_values_and_subject_lookup():
    domain = _domain()
    p1 = domain.PaperProjection(projected=64.0, low=60.0, high=68.0, floor=48, stretch=64)
    p2 = domain.PaperProjection(projected=70.0, low=65.0, high=74.0, floor=63, stretch=70)
    projection = domain.SprintProjection(
        target_slug="sefaz_ce",
        as_of=date(2026, 7, 14),
        formula_version="sefaz-ce-projection-v2",
        score_kind="raw_weighted_equivalent_not_fcc_standardized",
        p1=p1,
        p2=p2,
        confidence_bp=5000,
        dominant_origin="diario_backup",
        subjects=(_subject(),),
        warnings=(),
    )
    assert projection.weighted_projected == 204.0
    assert projection.weighted_low == 190.0
    assert projection.weighted_high == 216.0
    assert projection.weighted_target == 204
    assert projection.distance_to_target == 0.0
    assert projection.subject("p1_economia").display_name == "Economia"
    with pytest.raises(KeyError):
        projection.subject("missing")
