from datetime import UTC, date, datetime

import pytest

from study_os_service.domain.planner import (
    ExamTarget,
    PlannerBlock,
    PlannerCandidate,
    PlannerRun,
    ScoreBreakdown,
    TargetTopic,
)


NOW = datetime(2026, 7, 12, 18, 0, tzinfo=UTC)


def make_target(**overrides) -> ExamTarget:
    values = {
        "target_slug": "rfb_auditor",
        "display_name": "RFB Auditor",
        "institution": "Receita Federal",
        "role": "Auditor",
        "banca": "FGV",
        "phase": "pre_edital",
        "deadline": None,
        "daily_quota": 4,
        "priority_score": 80.0,
        "source_urls": ("https://www.gov.br/receitafederal",),
        "notes": "",
        "active": True,
        "version": 1,
    }
    values.update(overrides)
    return ExamTarget(**values)


def make_topic(**overrides) -> TargetTopic:
    values = {
        "id": 1,
        "target_slug": "rfb_auditor",
        "discipline": "Direito Tributario",
        "topic": "Credito tributario",
        "coverage_status": "weak",
        "edital_weight": 2.0,
        "incidence": 85.0,
        "tier": 1,
        "banca_fit": 90.0,
        "overlap_value": 100.0,
        "transfer_kind": "target_specific",
        "source_kind": "manual",
        "lesson_id": None,
        "material_id": None,
        "tec_source_url": "https://www.tecconcursos.com.br/questoes/cadernos/1",
        "tec_source_id": "1",
        "planned_questions": 20,
        "review_debt": 60.0,
        "notes": "",
        "active": True,
        "version": 1,
    }
    values.update(overrides)
    return TargetTopic(**values)


def make_run(**overrides) -> PlannerRun:
    values = {
        "id": 1,
        "idempotency_key": "run-1",
        "target_slug": "rfb_auditor",
        "plan_date": date(2026, 7, 13),
        "phase": "pre_edital",
        "daily_quota": 4,
        "time_budget_minutes": 240,
        "algorithm_version": "m4-v1",
        "input_hash": "abc123",
        "supersedes_run_id": None,
        "status": "generated",
        "shortfall_count": 0,
        "shortfall_reasons": (),
        "generated_at": NOW,
    }
    values.update(overrides)
    return PlannerRun(**values)


SCORE = ScoreBreakdown(
    weakness=9000,
    incidence=8500,
    tier=10000,
    coverage_need=8000,
    review_debt=6000,
    ls_alignment=0,
    target_fit=10000,
    overlap_value=10000,
    deadline_pressure=2000,
    banca_fit=9000,
    edital_weight=4000,
    balance_penalty=0,
    low_trust_penalty=0,
    final_score=35000,
)


def make_candidate(**overrides) -> PlannerCandidate:
    values = {
        "id": 1,
        "run_id": 1,
        "candidate_key": "rfb|tributario|questions",
        "target_slug": "rfb_auditor",
        "discipline": "Direito Tributario",
        "topic": "Credito tributario",
        "block_kind": "questions",
        "source_kind": "tec",
        "target_topic_id": 1,
        "lesson_id": None,
        "material_id": None,
        "duration_minutes": 60,
        "planned_questions": 20,
        "score": SCORE,
        "chosen_position": 1,
        "displaced_by_candidate_key": None,
        "stop_reason": None,
        "evidence": {"coverage": "weak"},
    }
    values.update(overrides)
    return PlannerCandidate(**values)


def make_block(**overrides) -> PlannerBlock:
    values = {
        "id": 1,
        "run_id": 1,
        "candidate_id": 1,
        "target_slug": "rfb_auditor",
        "scheduled_date": date(2026, 7, 13),
        "position": 1,
        "block_kind": "questions",
        "title": "TEC: Credito tributario",
        "duration_minutes": 60,
        "planned_questions": 20,
        "state": "pending",
        "execution_session_id": None,
        "questions_done": 0,
        "correct_count": 0,
        "wrong_count": 0,
        "doubt_count": 0,
        "favorite_count": 0,
        "version": 1,
    }
    values.update(overrides)
    return PlannerBlock(**values)


def test_valid_planner_domain_records_preserve_target_evidence():
    assert make_target().daily_quota == 4
    assert make_topic().edital_weight == 2.0
    assert make_run().shortfall_reasons == ()
    assert make_candidate().score.final_score == 35000
    assert make_block().planned_questions == 20


@pytest.mark.parametrize(
    ("updates", "message"),
    [
        ({"target_slug": " "}, "target"),
        ({"phase": "rumor"}, "phase"),
        ({"daily_quota": 0}, "daily quota"),
        ({"priority_score": 101}, "priority"),
        ({"source_urls": ("not-a-url",)}, "source URL"),
        ({"deadline": datetime(2026, 7, 13)}, "deadline"),
    ],
)
def test_target_rejects_invalid_configuration(updates, message):
    with pytest.raises(ValueError, match=message):
        make_target(**updates)


@pytest.mark.parametrize(
    ("updates", "message"),
    [
        ({"coverage_status": "done"}, "coverage"),
        ({"edital_weight": -1}, "edital weight"),
        ({"incidence": 101}, "incidence"),
        ({"tier": 0}, "tier"),
        ({"transfer_kind": "blind"}, "transfer"),
        ({"material_id": 20, "lesson_id": None}, "lesson"),
        ({"planned_questions": -1}, "planned questions"),
    ],
)
def test_topic_rejects_invalid_evidence(updates, message):
    with pytest.raises(ValueError, match=message):
        make_topic(**updates)


def test_shortfall_run_requires_matching_reasons():
    with pytest.raises(ValueError, match="shortfall"):
        make_run(status="shortfall", shortfall_count=1, shortfall_reasons=())
    with pytest.raises(ValueError, match="shortfall"):
        make_run(status="generated", shortfall_count=1, shortfall_reasons=("no_tec",))


def test_candidate_rejects_hidden_stop_and_non_executable_questions():
    with pytest.raises(ValueError, match="chosen candidate"):
        make_candidate(stop_reason="target_mismatch")
    with pytest.raises(ValueError, match="planned questions"):
        make_candidate(planned_questions=0)
    with pytest.raises(ValueError, match="displaced"):
        make_candidate(chosen_position=1, displaced_by_candidate_key="other")


def test_block_rejects_invalid_results_and_theory_question_count():
    with pytest.raises(ValueError, match="result counts"):
        make_block(
            state="completed",
            questions_done=10,
            correct_count=8,
            wrong_count=4,
        )
    with pytest.raises(ValueError, match="planned questions"):
        make_block(block_kind="theory", planned_questions=20)
    with pytest.raises(ValueError, match="pending block"):
        make_block(state="pending", questions_done=1)
