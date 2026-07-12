from datetime import date
import json

from study_os_service.domain.planner import ExamTarget, TargetTopic
from study_os_service.services.planner_candidates import (
    CandidateTopicEvidence,
    MaterialEvidence,
    ReviewEvidence,
    build_candidates,
)
from study_os_service.services.planner_scoring import (
    ScoringContext,
    canonical_input_hash,
    score_candidates,
)


TEC_URL = "https://www.tecconcursos.com.br/questoes/cadernos"


def make_target(**overrides) -> ExamTarget:
    values = {
        "target_slug": "bacen_economia_financas",
        "display_name": "BACEN Economia e Financas",
        "institution": "Banco Central do Brasil",
        "role": "Analista",
        "banca": "CEBRASPE",
        "phase": "pre_edital",
        "deadline": None,
        "daily_quota": 4,
        "priority_score": 90,
        "source_urls": ("https://www.bcb.gov.br/",),
        "notes": "",
        "active": True,
        "version": 1,
    }
    values.update(overrides)
    return ExamTarget(**values)


def make_topic(topic_id: int, **overrides) -> TargetTopic:
    values = {
        "id": topic_id,
        "target_slug": "bacen_economia_financas",
        "discipline": f"Disciplina {topic_id}",
        "topic": f"Topico {topic_id}",
        "coverage_status": "covered",
        "edital_weight": 1.0,
        "incidence": 50.0,
        "tier": 3,
        "banca_fit": 70.0,
        "overlap_value": 100.0,
        "transfer_kind": "target_specific",
        "source_kind": "manual",
        "lesson_id": None,
        "material_id": None,
        "tec_source_url": TEC_URL,
        "tec_source_id": None,
        "planned_questions": 20,
        "review_debt": 0.0,
        "notes": "",
        "active": True,
        "version": 1,
    }
    values.update(overrides)
    return TargetTopic(**values)


def question_candidate(topic: TargetTopic):
    row = CandidateTopicEvidence(
        topic=topic,
        material_mapping_present=False,
        materials=(),
        review=ReviewEvidence(),
    )
    pool = build_candidates("bacen_economia_financas", (row,))
    return next(item for item in pool.all if item.block_kind == "questions")


def theory_candidate(topic: TargetTopic, *, trust_level=10, kind="original"):
    material = MaterialEvidence(
        lesson_id=topic.lesson_id or 1,
        material_id=topic.material_id or topic.id,
        target_slug=topic.target_slug,
        kind=kind,
        available=True,
        is_primary=True,
        trust_level=trust_level,
        progress_status="weak" if topic.coverage_status == "weak" else "covered",
        cursor_page=1,
        page_count=50,
    )
    row = CandidateTopicEvidence(
        topic=topic,
        material_mapping_present=True,
        materials=(material,),
        review=ReviewEvidence(weak_progress=topic.coverage_status == "weak"),
    )
    return next(
        item
        for item in build_candidates("bacen_economia_financas", (row,)).all
        if item.block_kind == "theory"
    )


def context(target=None, **overrides) -> ScoringContext:
    values = {
        "target": target or make_target(),
        "plan_date": date(2026, 7, 13),
        "ls_target_slug": None,
        "discipline_counts": {},
    }
    values.update(overrides)
    return ScoringContext(**values)


def score_map(candidates, scoring_context):
    return {
        item.candidate.target_topic_id: item
        for item in score_candidates(tuple(candidates), scoring_context)
    }


def test_high_roi_weakness_beats_plain_ls_alignment():
    weak = question_candidate(
        make_topic(
            1,
            coverage_status="weak",
            incidence=90,
            tier=1,
            source_kind="manual",
            review_debt=70,
        )
    )
    aligned = question_candidate(
        make_topic(
            2,
            coverage_status="strong",
            incidence=50,
            tier=3,
            source_kind="ls",
            review_debt=0,
        )
    )
    scores = score_map((aligned, weak), context(ls_target_slug="bacen_economia_financas"))

    assert scores[1].breakdown.final_score > scores[2].breakdown.final_score
    assert scores[2].breakdown.ls_alignment == 10000


def test_pre_edital_coverage_gap_is_weighted_more_than_pos_edital():
    unread = question_candidate(make_topic(1, coverage_status="unread"))
    covered = question_candidate(make_topic(2, coverage_status="covered"))
    pre = score_map((unread, covered), context())
    pos_target = make_target(
        phase="pos_edital", deadline=date(2026, 8, 2)
    )
    pos = score_map((unread, covered), context(target=pos_target))

    pre_gap = pre[1].breakdown.final_score - pre[2].breakdown.final_score
    pos_gap = pos[1].breakdown.final_score - pos[2].breakdown.final_score
    assert pre_gap > pos_gap


def test_pos_edital_amplifies_incidence_and_deadline_pressure():
    high = question_candidate(make_topic(1, incidence=95))
    low = question_candidate(make_topic(2, incidence=35))
    pre = score_map((high, low), context())
    pos_target = make_target(
        phase="pos_edital", deadline=date(2026, 7, 20)
    )
    pos = score_map((high, low), context(target=pos_target))

    pre_gap = pre[1].breakdown.final_score - pre[2].breakdown.final_score
    pos_gap = pos[1].breakdown.final_score - pos[2].breakdown.final_score
    assert pos_gap > pre_gap
    assert pos[1].breakdown.deadline_pressure == 10000
    assert pre[1].breakdown.deadline_pressure == 0


def test_target_specific_edital_weight_override_changes_order():
    ordinary = question_candidate(make_topic(1, edital_weight=1))
    weight_two = question_candidate(make_topic(2, edital_weight=2))
    scores = score_map((ordinary, weight_two), context())

    assert scores[2].breakdown.edital_weight == 2000
    assert scores[2].breakdown.final_score > scores[1].breakdown.final_score


def test_cross_target_transfer_loses_target_fit_and_overlap_value():
    local = question_candidate(make_topic(1))
    shared_topic = make_topic(
        2,
        target_slug="rfb_auditor",
        transfer_kind="shared",
        overlap_value=70,
    )
    shared_row = CandidateTopicEvidence(
        topic=shared_topic,
        material_mapping_present=False,
        materials=(),
        review=ReviewEvidence(),
    )
    shared = next(
        item
        for item in build_candidates("bacen_economia_financas", (shared_row,)).all
        if item.block_kind == "questions"
    )
    scores = score_map((shared, local), context())

    assert scores[1].breakdown.target_fit == 10000
    assert scores[2].breakdown.target_fit < scores[1].breakdown.target_fit
    assert scores[1].breakdown.final_score > scores[2].breakdown.final_score


def test_low_trust_bizu_has_explicit_penalty_and_cannot_win():
    trusted = theory_candidate(
        make_topic(1, lesson_id=1, material_id=1, coverage_status="weak")
    )
    bizu = theory_candidate(
        make_topic(2, lesson_id=2, material_id=2, coverage_status="weak"),
        trust_level=2,
        kind="bizu",
    )
    scores = score_map((bizu, trusted), context())

    assert scores[2].breakdown.low_trust_penalty == 10000
    assert scores[2].breakdown.final_score < scores[1].breakdown.final_score


def test_same_inputs_produce_identical_hash_rank_and_score_evidence_bytes():
    first_candidate = question_candidate(
        make_topic(1, coverage_status="stale", incidence=85, edital_weight=2)
    )
    second_candidate = question_candidate(
        make_topic(2, coverage_status="stale", incidence=85, edital_weight=2)
    )
    scoring_context = context()

    first = score_candidates((second_candidate, first_candidate), scoring_context)
    second = score_candidates((first_candidate, second_candidate), scoring_context)

    assert canonical_input_hash(
        (second_candidate, first_candidate), scoring_context
    ) == canonical_input_hash((first_candidate, second_candidate), scoring_context)
    assert [item.candidate.candidate_key for item in first] == [
        item.candidate.candidate_key for item in second
    ]
    assert [item.evidence_json.encode("utf-8") for item in first] == [
        item.evidence_json.encode("utf-8") for item in second
    ]
    assert all(json.loads(item.evidence_json)["algorithmVersion"] == "m4-v1" for item in first)
