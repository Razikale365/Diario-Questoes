from dataclasses import replace
from datetime import date
from typing import Mapping

import pytest

from study_os_service.domain.sprint import SourcePlanTask
from study_os_service.domain.sprint_evidence import (
    PaperProjection,
    SprintProjection,
    SubjectProjection,
)
from study_os_service.services.sprint import DEFAULT_SEFAZ_CONFIG
from study_os_service.services.sprint_engine import SprintEngine


def _source_task(
    task_id: int,
    subject_key: str | None,
    minutes: int = 60,
    *,
    relevance: float = 5,
    task_kind: str = "questions",
) -> SourcePlanTask:
    return SourcePlanTask(
        id=task_id,
        target_slug="sefaz_ce",
        source_kind="ls",
        external_task_id=f"meta-47-{task_id}",
        plan_label="Meta 47",
        meta_number=47,
        scheduled_date=date(2026, 7, 14),
        source_order=task_id,
        discipline=subject_key,
        subject_key=subject_key,
        topic_hint=f"Topico {task_id}",
        task_kind=task_kind,
        description=f"Tarefa {task_id}",
        details="",
        material_hint="",
        estimated_minutes=minutes,
        spent_minutes=0,
        relevance=relevance,
        status="pending",
        performance_bp=None,
        linked_study_task_id=None,
        provenance={},
        version=1,
    )


def _subjects():
    from study_os_service.domain.sprint import ExamSubjectProfile
    from study_os_service.services.sprint import OFFICIAL_SEFAZ_SUBJECTS

    return tuple(
        ExamSubjectProfile(
            id=index,
            target_slug=row["target_slug"],
            subject_key=row["subject_key"],
            display_name=row["display_name"],
            aliases=tuple(row["aliases"]),
            paper=row["paper"],
            question_count=row["question_count"],
            question_weight=row["question_weight"],
            discursive_eligible=row["discursive_eligible"],
            baseline_accuracy_bp=row["baseline_accuracy_bp"],
            target_low_bp=row["target_low_bp"],
            target_high_bp=row["target_high_bp"],
            baseline_confidence_bp=row["baseline_confidence_bp"],
            focus_band=row["focus_band"],
            baseline_source=row["baseline_source"],
            notes=row["notes"],
            active=True,
            version=1,
        )
        for index, row in enumerate(OFFICIAL_SEFAZ_SUBJECTS, start=1)
    )


def _subject_projections(
    overrides: Mapping[str, Mapping[str, object]] | None = None,
    *,
    subjects=None,
) -> dict[str, SubjectProjection]:
    overrides = overrides or {}
    projections: dict[str, SubjectProjection] = {}
    for subject in subjects or _subjects():
        estimate = subject.baseline_accuracy_bp or 5000
        projection = SubjectProjection(
            subject_profile_id=subject.id,
            subject_key=subject.subject_key,
            display_name=subject.display_name,
            paper=subject.paper,
            question_count=subject.question_count,
            question_weight=float(subject.question_weight),
            estimate_bp=estimate,
            low_bp=max(0, estimate - 1000),
            high_bp=min(10000, estimate + 1000),
            effective_sample=0,
            confidence_bp=0,
            fragility_bp=0,
            representative_set_count=0,
            demotion_eligible=False,
            dominant_origin="baseline",
            warnings=("sample_limited",),
        )
        if subject.subject_key in overrides:
            projection = replace(
                projection,
                **dict(overrides[subject.subject_key]),
            )
        projections[subject.subject_key] = projection
    return projections


def _projection(
    subjects: Mapping[str, SubjectProjection],
    *,
    as_of: date = date(2026, 7, 14),
) -> SprintProjection:
    rows = tuple(subjects.values())

    def paper(kind: str, floor: int, stretch: int) -> PaperProjection:
        selected = [row for row in rows if row.paper == kind]
        return PaperProjection(
            projected=sum(
                row.question_count * row.estimate_bp / 10000
                for row in selected
            ),
            low=sum(
                row.question_count * row.low_bp / 10000
                for row in selected
            ),
            high=sum(
                row.question_count * row.high_bp / 10000
                for row in selected
            ),
            floor=floor,
            stretch=stretch,
        )

    return SprintProjection(
        target_slug="sefaz_ce",
        as_of=as_of,
        formula_version="sefaz-ce-projection-v2",
        score_kind="raw_weighted_equivalent_not_fcc_standardized",
        p1=paper("P1", 48, 64),
        p2=paper("P2", 63, 70),
        confidence_bp=max(row.confidence_bp for row in rows),
        dominant_origin="calibrated_test",
        subjects=rows,
        warnings=tuple(
            sorted({warning for row in rows for warning in row.warnings})
        ),
    )


def _generate(**kwargs):
    subject_rows = kwargs["subjects"]
    plan_date = kwargs["plan_date"]
    subject_projections = kwargs.pop("subject_projections", None)
    projection = kwargs.pop("projection", None)
    p1_projection = kwargs.pop("p1_projection", None)
    p2_projection = kwargs.pop("p2_projection", None)
    recent = kwargs.pop("recent_accuracy_bp", {})
    if subject_projections is None:
        overrides: dict[str, dict[str, object]] = {}
        for subject in subject_rows:
            scores = recent.get(subject.subject_key, ())
            if not scores:
                continue
            sample = scores[-3:]
            estimate = round(sum(sample) / len(sample))
            overrides[subject.subject_key] = {
                "estimate_bp": estimate,
                "low_bp": max(0, estimate - 1000),
                "high_bp": min(10000, estimate + 1000),
                "confidence_bp": min(
                    9000,
                    subject.baseline_confidence_bp + len(sample) * 2500,
                ),
                "representative_set_count": len(scores),
                "demotion_eligible": len(scores) >= 2,
            }
        subject_projections = _subject_projections(
            overrides,
            subjects=subject_rows,
        )
    if projection is None:
        projection = _projection(subject_projections, as_of=plan_date)
        if p1_projection is not None:
            projection = replace(
                projection,
                p1=replace(
                    projection.p1,
                    projected=p1_projection,
                    low=min(projection.p1.low, p1_projection),
                    high=max(projection.p1.high, p1_projection),
                ),
                p2=replace(
                    projection.p2,
                    projected=p2_projection,
                    low=min(projection.p2.low, p2_projection),
                    high=max(projection.p2.high, p2_projection),
                ),
            )
    return SprintEngine().generate(
        **kwargs,
        subject_projections=subject_projections,
        projection=projection,
    )


def test_all_ls_tasks_are_kept_and_reordered_when_they_fit_the_budget():
    tasks = (
        _source_task(1, "p1_portugues", relevance=3),
        _source_task(2, "p2_lte", relevance=10),
        _source_task(3, "p2_financas_publicas", relevance=8),
        _source_task(4, "p1_auditoria", relevance=4),
    )

    plan = _generate(
        config=DEFAULT_SEFAZ_CONFIG,
        subjects=_subjects(),
        source_tasks=tasks,
        plan_date=date(2026, 7, 14),
        energy_level=3,
        p1_projection=49,
        p2_projection=60,
    )

    ls_actions = [action for action in plan.actions if action.source_plan_task_id]
    assert len(ls_actions) == 4
    assert {action.recommendation for action in ls_actions} == {"execute"}
    assert sum(action.duration_minutes for action in ls_actions) == 240
    assert ls_actions[0].subject_key == "p2_lte"
    assert all(action.expected_gain_milli >= 0 for action in ls_actions)
    assert all(action.rationale for action in ls_actions)
    assert all(action.title.startswith("Executar:") for action in ls_actions)


def test_over_budget_ls_is_compressed_then_deferred_without_changing_source_state():
    tasks = tuple(
        _source_task(index, subject, 75, relevance=11 - index)
        for index, subject in enumerate(
            (
                "p2_lte",
                "p2_financas_publicas",
                "p2_contabilidade_avancada_custos",
                "p2_direito_tributario",
                "p1_portugues",
            ),
            start=1,
        )
    )

    plan = _generate(
        config=DEFAULT_SEFAZ_CONFIG,
        subjects=_subjects(),
        source_tasks=tasks,
        plan_date=date(2026, 7, 14),
        energy_level=3,
        p1_projection=50,
        p2_projection=60,
    )

    ls_actions = [action for action in plan.actions if action.source_plan_task_id]
    assert sum(
        action.duration_minutes
        for action in ls_actions
        if action.recommendation != "defer"
    ) <= 240
    assert "compress" in {action.recommendation for action in ls_actions}
    assert "defer" in {action.recommendation for action in ls_actions}
    assert all(task.status == "pending" for task in tasks)


def test_initial_extra_budget_uses_lte_finances_and_advanced_costs_ratio():
    plan = _generate(
        config=DEFAULT_SEFAZ_CONFIG,
        subjects=_subjects(),
        source_tasks=(),
        plan_date=date(2026, 7, 14),
        energy_level=3,
        p1_projection=49,
        p2_projection=60,
    )

    extras = [action for action in plan.actions if action.recommendation == "extra"]
    minutes = {action.subject_key: action.duration_minutes for action in extras}
    assert minutes == {
        "p2_lte": 30,
        "p2_financas_publicas": 18,
        "p2_contabilidade_avancada_custos": 12,
    }
    assert sum(minutes.values()) == 60
    assert all(10 <= action.duration_minutes <= 30 for action in extras)
    assert all(5 <= action.planned_questions <= 10 for action in extras)


def test_two_sets_at_goal_demote_a_focus_subject_and_p1_floor_is_protected():
    plan = _generate(
        config=DEFAULT_SEFAZ_CONFIG,
        subjects=_subjects(),
        source_tasks=(),
        plan_date=date(2026, 7, 14),
        energy_level=3,
        p1_projection=42,
        p2_projection=60,
        recent_accuracy_bp={
            "p2_lte": (8200, 8400),
            "p2_financas_publicas": (6000, 6200),
            "p2_contabilidade_avancada_custos": (6100, 6300),
        },
    )

    extras = [action for action in plan.actions if action.recommendation == "extra"]
    assert not any(action.subject_key == "p2_lte" for action in extras)
    p1 = [action for action in extras if action.subject_key.startswith("p1_")]
    assert len(p1) == 1
    assert p1[0].duration_minutes >= 10
    assert "piso da p1" in " ".join(p1[0].rationale).lower()
    assert sum(action.duration_minutes for action in extras) <= 60


def test_afo_rescue_is_limited_to_twice_per_week():
    subjects = tuple(
        replace(
            subject,
            baseline_accuracy_bp=(3000 if subject.subject_key == "p1_direito_financeiro" else subject.baseline_accuracy_bp),
        )
        for subject in _subjects()
    )

    plan = _generate(
        config=DEFAULT_SEFAZ_CONFIG,
        subjects=subjects,
        source_tasks=(),
        plan_date=date(2026, 7, 14),
        energy_level=3,
        p1_projection=42,
        p2_projection=60,
        afo_rescues_this_week=2,
    )

    assert not any(
        action.subject_key == "p1_direito_financeiro" for action in plan.actions
    )


def test_d2_consolidates_and_d1_reduces_load():
    d2 = _generate(
        config=DEFAULT_SEFAZ_CONFIG,
        subjects=_subjects(),
        source_tasks=(_source_task(1, "p2_lte", task_kind="theory"),),
        plan_date=date(2026, 7, 30),
        energy_level=3,
        p1_projection=49,
        p2_projection=64,
    )
    d1 = _generate(
        config=DEFAULT_SEFAZ_CONFIG,
        subjects=_subjects(),
        source_tasks=(_source_task(1, "p2_lte", task_kind="questions"),),
        plan_date=date(2026, 7, 31),
        energy_level=3,
        p1_projection=49,
        p2_projection=64,
    )

    assert all(action.action_kind == "review" for action in d2.actions)
    assert "D-2" in d2.mode_label
    assert sum(action.duration_minutes for action in d1.actions) <= 150
    assert "D-1" in d1.mode_label


def test_last_full_weekend_adds_simulation_only_when_ls_has_none():
    without_ls_simulation = _generate(
        config=DEFAULT_SEFAZ_CONFIG,
        subjects=_subjects(),
        source_tasks=(),
        plan_date=date(2026, 7, 25),
        energy_level=3,
        p1_projection=49,
        p2_projection=60,
        has_scheduled_simulation=False,
    )
    with_ls_simulation = _generate(
        config=DEFAULT_SEFAZ_CONFIG,
        subjects=_subjects(),
        source_tasks=(_source_task(1, "p1_portugues", task_kind="simulation"),),
        plan_date=date(2026, 7, 25),
        energy_level=3,
        p1_projection=49,
        p2_projection=60,
        has_scheduled_simulation=True,
    )

    assert any(action.action_kind == "simulation" for action in without_ls_simulation.actions)
    assert sum(action.duration_minutes for action in without_ls_simulation.actions if action.recommendation == "extra") <= 60
    assert sum(action.action_kind == "simulation" for action in with_ls_simulation.actions) == 1


def test_unmapped_ls_simulation_and_discursive_tasks_are_still_protected():
    plan = _generate(
        config=DEFAULT_SEFAZ_CONFIG,
        subjects=_subjects(),
        source_tasks=(
            replace(
                _source_task(1, None, task_kind="simulation"),
                discipline="Simulados",
                description="Simulado 09 SEFAZ CE",
            ),
            replace(
                _source_task(2, None, task_kind="discursive"),
                discipline="Discursivas",
                description="Pratica de producao textual",
            ),
        ),
        plan_date=date(2026, 7, 14),
        energy_level=3,
        p1_projection=49,
        p2_projection=60,
    )

    source_actions = [
        action for action in plan.actions if action.source_plan_task_id is not None
    ]
    assert {action.action_kind for action in source_actions} == {
        "simulation",
        "ls_execute",
    }
    assert {action.source_plan_task_id for action in source_actions} == {1, 2}


def test_protected_simulation_never_pushes_executable_ls_over_budget():
    tasks = tuple(
        _source_task(index, "p2_lte") for index in range(1, 5)
    ) + (
        replace(
            _source_task(5, "p1_portugues", task_kind="simulation"),
            description="Simulado P1/P2",
            estimated_minutes=120,
        ),
    )

    plan = _generate(
        config=DEFAULT_SEFAZ_CONFIG,
        subjects=_subjects(),
        source_tasks=tasks,
        plan_date=date(2026, 7, 14),
        energy_level=3,
        p1_projection=49,
        p2_projection=60,
    )

    source_actions = [
        action for action in plan.actions if action.source_plan_task_id is not None
    ]
    executable_minutes = sum(
        action.duration_minutes
        for action in source_actions
        if action.recommendation != "defer"
    )
    simulation = next(
        action for action in source_actions if action.action_kind == "simulation"
    )
    assert executable_minutes <= DEFAULT_SEFAZ_CONFIG.ls_budget_minutes
    assert simulation.recommendation == "execute"


def test_d2_consolidation_respects_the_combined_capacity():
    config = replace(
        DEFAULT_SEFAZ_CONFIG,
        ls_budget_minutes=15,
        extra_budget_minutes=0,
    )
    plan = _generate(
        config=config,
        subjects=_subjects(),
        source_tasks=(_source_task(1, "p2_lte", task_kind="review"),),
        plan_date=date(2026, 7, 30),
        energy_level=3,
        p1_projection=49,
        p2_projection=60,
    )

    assert sum(action.duration_minutes for action in plan.actions) <= 15


def test_ls_action_keeps_the_exact_tec_caderno_url_in_auditable_evidence():
    plan = _generate(
        config=DEFAULT_SEFAZ_CONFIG,
        subjects=_subjects(),
        source_tasks=(
            replace(
                _source_task(1, "p2_lte"),
                provenance={"tecUrl": "https://www.tecconcursos.com.br/s/teste"},
            ),
        ),
        plan_date=date(2026, 7, 14),
        energy_level=3,
        p1_projection=49,
        p2_projection=60,
    )

    action = next(row for row in plan.actions if row.source_plan_task_id == 1)
    assert action.evidence["tecUrl"] == "https://www.tecconcursos.com.br/s/teste"


def test_ls_action_normalizes_valid_source_durations_to_persistable_blocks():
    short = _generate(
        config=replace(DEFAULT_SEFAZ_CONFIG, ls_budget_minutes=15, extra_budget_minutes=0),
        subjects=_subjects(),
        source_tasks=(_source_task(1, "p2_lte", minutes=1),),
        plan_date=date(2026, 7, 14),
        energy_level=3,
        p1_projection=49,
        p2_projection=60,
    )
    long = _generate(
        config=replace(DEFAULT_SEFAZ_CONFIG, ls_budget_minutes=300, extra_budget_minutes=0),
        subjects=_subjects(),
        source_tasks=(_source_task(2, "p2_lte", minutes=300),),
        plan_date=date(2026, 7, 14),
        energy_level=3,
        p1_projection=49,
        p2_projection=60,
    )

    assert short.actions[0].duration_minutes == 5
    assert long.actions[0].duration_minutes == 240
    assert long.actions[0].recommendation == "compress"


def test_long_protected_simulation_remains_a_simulation_when_compressed():
    task = _source_task(1, "p1_portugues", minutes=300, task_kind="simulation")
    fits_clamped_limit = _generate(
        config=replace(DEFAULT_SEFAZ_CONFIG, ls_budget_minutes=300, extra_budget_minutes=0),
        subjects=_subjects(),
        source_tasks=(task,),
        plan_date=date(2026, 7, 14),
        energy_level=3,
        p1_projection=49,
        p2_projection=60,
    )
    constrained = _generate(
        config=replace(DEFAULT_SEFAZ_CONFIG, ls_budget_minutes=200, extra_budget_minutes=0),
        subjects=_subjects(),
        source_tasks=(task,),
        plan_date=date(2026, 7, 14),
        energy_level=3,
        p1_projection=49,
        p2_projection=60,
    )

    for plan, expected_minutes in ((fits_clamped_limit, 240), (constrained, 200)):
        action = plan.actions[0]
        assert action.action_kind == "ls_compress"
        assert action.recommendation == "compress"
        assert action.duration_minutes == expected_minutes
        assert action.evidence["sourceTaskKind"] == "simulation"


def test_projection_doubt_fragility_raises_priority_without_reducing_estimate():
    tasks = (
        _source_task(1, "p2_contabilidade_avancada_custos", relevance=5),
        _source_task(2, "p2_lte", relevance=5),
    )
    base_overrides = {
        "p2_lte": {
            "estimate_bp": 7000,
            "low_bp": 6200,
            "high_bp": 7800,
            "confidence_bp": 5000,
        },
        "p2_contabilidade_avancada_custos": {
            "estimate_bp": 7000,
            "low_bp": 6200,
            "high_bp": 7800,
            "confidence_bp": 5000,
        },
    }
    stable = _subject_projections(base_overrides)
    fragile = dict(stable)
    fragile["p2_lte"] = replace(
        fragile["p2_lte"],
        fragility_bp=7000,
    )
    config = replace(
        DEFAULT_SEFAZ_CONFIG,
        ls_budget_minutes=120,
        extra_budget_minutes=0,
    )

    stable_plan = SprintEngine().generate(
        config=config,
        subjects=_subjects(),
        source_tasks=tasks,
        plan_date=date(2026, 7, 14),
        energy_level=3,
        subject_projections=stable,
        projection=_projection(stable),
    )
    fragile_plan = SprintEngine().generate(
        config=config,
        subjects=_subjects(),
        source_tasks=tasks,
        plan_date=date(2026, 7, 14),
        energy_level=3,
        subject_projections=fragile,
        projection=_projection(fragile),
    )

    assert stable_plan.actions[0].subject_key == (
        "p2_contabilidade_avancada_custos"
    )
    assert fragile_plan.actions[0].subject_key == "p2_lte"
    stable_lte = next(
        action for action in stable_plan.actions if action.subject_key == "p2_lte"
    )
    fragile_lte = next(
        action for action in fragile_plan.actions if action.subject_key == "p2_lte"
    )
    assert fragile_lte.expected_gain_milli > stable_lte.expected_gain_milli
    assert fragile_lte.evidence["estimateBp"] == 7000
    assert fragile_lte.evidence["fragilityBp"] == 7000


def test_calibrated_projection_governs_gain_and_deficit_instead_of_profile_prior():
    tasks = (
        _source_task(1, "p2_lte", relevance=5),
        _source_task(2, "p2_contabilidade_avancada_custos", relevance=5),
    )
    calibrated = _subject_projections(
        {
            "p2_lte": {
                "estimate_bp": 7800,
                "low_bp": 7200,
                "high_bp": 8400,
                "confidence_bp": 6000,
            },
            "p2_contabilidade_avancada_custos": {
                "estimate_bp": 5000,
                "low_bp": 4400,
                "high_bp": 5600,
                "confidence_bp": 6000,
            },
        }
    )

    plan = SprintEngine().generate(
        config=replace(
            DEFAULT_SEFAZ_CONFIG,
            ls_budget_minutes=120,
            extra_budget_minutes=0,
        ),
        subjects=_subjects(),
        source_tasks=tasks,
        plan_date=date(2026, 7, 14),
        energy_level=3,
        subject_projections=calibrated,
        projection=_projection(calibrated),
    )

    assert plan.actions[0].subject_key == "p2_contabilidade_avancada_custos"
    costs, lte = sorted(
        plan.actions,
        key=lambda action: action.subject_key != (
            "p2_contabilidade_avancada_custos"
        ),
    )
    assert costs.expected_gain_milli > lte.expected_gain_milli
    assert costs.evidence["estimateBp"] == 5000
    assert lte.evidence["estimateBp"] == 7800


def test_projection_owned_engine_uses_v2_algorithm_version():
    assert SprintEngine.algorithm_version == "sefaz-ce-sprint-v2"


def test_engine_rejects_projection_inputs_that_cannot_share_one_snapshot():
    subjects = _subject_projections()
    frozen = _projection(subjects)
    divergent = dict(subjects)
    divergent["p2_lte"] = replace(
        divergent["p2_lte"],
        estimate_bp=7100,
        high_bp=max(7100, divergent["p2_lte"].high_bp),
    )

    with pytest.raises(ValueError, match="frozen projection"):
        SprintEngine().generate(
            config=DEFAULT_SEFAZ_CONFIG,
            subjects=_subjects(),
            source_tasks=(),
            plan_date=date(2026, 7, 14),
            energy_level=3,
            subject_projections=divergent,
            projection=frozen,
        )
