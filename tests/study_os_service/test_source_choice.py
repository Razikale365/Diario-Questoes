from __future__ import annotations

from datetime import date
from pathlib import Path

from study_os_service.db.connection import connect_database
from study_os_service.db.migrations import MigrationRunner
from study_os_service.repositories.strategy import StrategyRepository
from study_os_service.services.planner_profiles import PlannerProfileService
from study_os_service.services.source_choice import SourceChoiceService


def _database(tmp_path: Path, *targets: str):
    connection = connect_database(tmp_path / "study.sqlite3")
    MigrationRunner(connection).migrate()
    PlannerProfileService(connection).seed(tuple(targets))
    return connection


def _topic_id(connection, target: str, discipline: str, topic: str) -> int:
    return connection.execute(
        """
        SELECT id FROM target_topics
        WHERE target_slug=? AND discipline=? AND topic=?
        """,
        (target, discipline, topic),
    ).fetchone()[0]


def _local_material(
    connection,
    *,
    target_slug: str,
    label: str,
    kind: str = "original",
    available: bool = True,
) -> tuple[int, int, int]:
    root_id = connection.execute(
        """
        INSERT INTO course_roots (
          target_slug, provider, package_name, package_url, edition_note,
          root_path, source_kind, acquisition_method, download_status,
          catalog_checked_at
        ) VALUES (?, 'Estrategia Concursos', ?, 'https://example.com/package',
                  '', ?, 'course_package', 'estrategia_downloader',
                  'validated', '2026-07-13T00:00:00+00:00')
        """,
        (target_slug, label, f"C:/fixture/{label}"),
    ).lastrowid
    course_id = connection.execute(
        """
        INSERT INTO courses (
          root_id, display_name, provider, relative_path, active, scan_state
        ) VALUES (?, ?, 'Estrategia Concursos', ?, 1, 'available')
        """,
        (root_id, label, label),
    ).lastrowid
    connection.execute(
        "INSERT OR IGNORE INTO disciplines (canonical_name) VALUES ('Direito Tributario')"
    )
    discipline_id = connection.execute(
        "SELECT id FROM disciplines WHERE canonical_name='Direito Tributario'"
    ).fetchone()[0]
    lesson_id = connection.execute(
        """
        INSERT INTO lessons (
          course_id, discipline_id, lesson_number, title,
          sequence_index, status, available
        ) VALUES (?, ?, 1, 'Credito tributario', 0, 'unread', 1)
        """,
        (course_id, discipline_id),
    ).lastrowid
    material_id = connection.execute(
        """
        INSERT INTO materials (
          course_id, lesson_id, absolute_path, relative_path,
          normalized_relative_path, kind, size_bytes, modified_at,
          available, is_primary, primary_selection, trust_level
        ) VALUES (?, ?, ?, ?, ?, ?, 100, '2026-07-13', ?, 1,
                  'automatic', 10)
        """,
        (
            course_id,
            lesson_id,
            f"C:/fixture/{label}/Aula 01.pdf",
            f"{label}/Aula 01.pdf",
            f"{label.casefold()}/aula 01.pdf",
            kind,
            int(available),
        ),
    ).lastrowid
    return root_id, lesson_id, material_id


def _add_source(
    connection,
    *,
    target_slug: str,
    target_topic_id: int,
    source_key: str,
    source_kind: str,
    content_role: str,
    trust_tier: int,
    edition: str,
    lesson_id: int | None = None,
    material_id: int | None = None,
    external_url: str | None = None,
    incidence_bp: int = 0,
    mapping_status: str = "approved",
    primary_eligible: bool = False,
    source_target_slug: str | None = None,
    transfer_kind: str = "target_specific",
    manual_override: bool = False,
):
    repository = StrategyRepository(connection)
    owner = source_target_slug or target_slug
    source = repository.create_source(
        target_slug=owner,
        source_key=source_key,
        source_kind=source_kind,
        display_name=source_key,
        trust_tier=trust_tier,
        root_id=None,
        material_id=None,
        external_url=external_url,
        external_id=source_key,
        edition=edition,
        notes="",
    )
    item = repository.insert_source_item(
        source_id=source.id,
        target_slug=owner,
        discipline=(
            connection.execute(
                "SELECT discipline FROM target_topics WHERE id=?",
                (target_topic_id,),
            ).fetchone()[0]
        ),
        topic_hint=(
            connection.execute(
                "SELECT topic FROM target_topics WHERE id=?", (target_topic_id,)
            ).fetchone()[0]
        ),
        source_order=1,
        content_role=content_role,
        lesson_id=lesson_id,
        material_id=material_id,
        external_url=external_url,
        external_id=source_key,
        incidence_bp=incidence_bp,
        banca="FGV" if source_kind == "tec" else "",
        provenance={"fixture": source_key},
        source_fingerprint=source_key,
    )
    mapping = repository.insert_mapping(
        target_slug=target_slug,
        target_topic_id=target_topic_id,
        source_item_id=item.id,
        source_target_slug=owner,
        transfer_kind=transfer_kind,
        mapping_status=mapping_status,
        confidence_bp=10000 if owner == target_slug else 7500,
        primary_eligible=primary_eligible,
        manual_override=manual_override,
        notes="manual" if manual_override else "",
    )
    connection.commit()
    return source, item, mapping


def test_current_original_course_wins_theory_and_passo_is_explained(tmp_path: Path):
    connection = _database(tmp_path, "rfb_auditor")
    try:
        topic_id = _topic_id(
            connection, "rfb_auditor", "Direito Tributario", "Credito tributario"
        )
        _, course_lesson, course_material = _local_material(
            connection,
            target_slug="rfb_auditor",
            label="regular-current",
        )
        _, passo_lesson, passo_material = _local_material(
            connection,
            target_slug="rfb_auditor",
            label="passo-current",
        )
        _add_source(
            connection,
            target_slug="rfb_auditor",
            target_topic_id=topic_id,
            source_key="course-2026",
            source_kind="course",
            content_role="primary_theory",
            trust_tier=10,
            edition="2026.2",
            lesson_id=course_lesson,
            material_id=course_material,
            primary_eligible=True,
        )
        _add_source(
            connection,
            target_slug="rfb_auditor",
            target_topic_id=topic_id,
            source_key="passo-2026",
            source_kind="passo",
            content_role="review_support",
            trust_tier=7,
            edition="2026.2",
            lesson_id=passo_lesson,
            material_id=passo_material,
        )

        result = SourceChoiceService(connection).choose(
            target_slug="rfb_auditor",
            target_topic_id=topic_id,
            block_kind="theory",
            as_of=date(2026, 7, 13),
        )
        replay = SourceChoiceService(connection).choose(
            target_slug="rfb_auditor",
            target_topic_id=topic_id,
            block_kind="theory",
            as_of=date(2026, 7, 13),
        )

        assert result.selection is not None
        assert replay == result
        assert result.selection.source_kind == "course"
        assert result.selection.material_id == course_material
        assert len(result.rows) == 2
        stopped = next(row for row in result.rows if not row.chosen)
        assert stopped.stop_reason == "not_primary_theory"
    finally:
        connection.close()


def test_review_prefers_passo_while_questions_prefer_tec_incidence(tmp_path: Path):
    connection = _database(tmp_path, "rfb_auditor")
    try:
        topic_id = _topic_id(
            connection, "rfb_auditor", "Direito Tributario", "Credito tributario"
        )
        _, lesson_id, material_id = _local_material(
            connection,
            target_slug="rfb_auditor",
            label="passo-review",
        )
        _add_source(
            connection,
            target_slug="rfb_auditor",
            target_topic_id=topic_id,
            source_key="passo-review",
            source_kind="passo",
            content_role="review_support",
            trust_tier=7,
            edition="2026.2",
            lesson_id=lesson_id,
            material_id=material_id,
        )
        _add_source(
            connection,
            target_slug="rfb_auditor",
            target_topic_id=topic_id,
            source_key="tec-questions",
            source_kind="tec",
            content_role="incidence_signal",
            trust_tier=9,
            edition="2026-07-13",
            external_url="https://www.tecconcursos.com.br/questoes/cadernos/1",
            incidence_bp=9300,
        )
        _add_source(
            connection,
            target_slug="rfb_auditor",
            target_topic_id=topic_id,
            source_key="tec-low-incidence",
            source_kind="tec",
            content_role="incidence_signal",
            trust_tier=9,
            edition="2026-07-13",
            external_url="https://www.tecconcursos.com.br/questoes/cadernos/3",
            incidence_bp=4200,
        )
        service = SourceChoiceService(connection)

        review = service.choose(
            target_slug="rfb_auditor",
            target_topic_id=topic_id,
            block_kind="review",
            as_of=date(2026, 7, 13),
        )
        questions = service.choose(
            target_slug="rfb_auditor",
            target_topic_id=topic_id,
            block_kind="questions",
            as_of=date(2026, 7, 13),
        )

        assert review.selection is not None
        assert review.selection.source_kind == "passo"
        assert questions.selection is not None
        assert questions.selection.source_kind == "tec"
        assert questions.selection.external_id == "tec-questions"
    finally:
        connection.close()


def test_stale_course_never_hides_missing_current_material(tmp_path: Path):
    connection = _database(tmp_path, "rfb_auditor")
    try:
        topic_id = _topic_id(
            connection, "rfb_auditor", "Direito Tributario", "Credito tributario"
        )
        _, old_lesson, old_material = _local_material(
            connection,
            target_slug="rfb_auditor",
            label="regular-2023",
        )
        _, current_lesson, current_material = _local_material(
            connection,
            target_slug="rfb_auditor",
            label="regular-2026",
        )
        _add_source(
            connection,
            target_slug="rfb_auditor",
            target_topic_id=topic_id,
            source_key="course-2023",
            source_kind="course",
            content_role="primary_theory",
            trust_tier=10,
            edition="2023",
            lesson_id=old_lesson,
            material_id=old_material,
            primary_eligible=True,
        )
        _add_source(
            connection,
            target_slug="rfb_auditor",
            target_topic_id=topic_id,
            source_key="course-2026",
            source_kind="course",
            content_role="primary_theory",
            trust_tier=10,
            edition="2026",
            lesson_id=current_lesson,
            material_id=current_material,
            primary_eligible=True,
        )
        service = SourceChoiceService(connection)
        current = service.choose(
            target_slug="rfb_auditor",
            target_topic_id=topic_id,
            block_kind="theory",
            as_of=date(2026, 7, 13),
        )
        assert current.selection is not None
        assert current.selection.material_id == current_material

        connection.execute(
            "UPDATE materials SET available=0 WHERE id=?", (current_material,)
        )
        connection.commit()
        missing = service.choose(
            target_slug="rfb_auditor",
            target_topic_id=topic_id,
            block_kind="theory",
            as_of=date(2026, 7, 13),
        )

        assert missing.selection is None
        assert missing.run.status == "shortfall"
        assert missing.run.shortfall_reason == "missing_current_material"
        reasons = {row.stop_reason for row in missing.rows}
        assert reasons == {"material_unavailable", "stale_superseded"}
    finally:
        connection.close()


def test_cross_target_source_requires_manual_approval_and_keeps_reduced_fit(
    tmp_path: Path,
):
    connection = _database(
        tmp_path, "rfb_auditor", "bacen_economia_financas"
    )
    try:
        topic_id = _topic_id(
            connection,
            "bacen_economia_financas",
            "Estatistica e Econometria",
            "Inferencia, regressao e series temporais",
        )
        _, item, mapping = _add_source(
            connection,
            target_slug="bacen_economia_financas",
            target_topic_id=topic_id,
            source_key="tec-rfb-estatistica",
            source_kind="tec",
            content_role="question_practice",
            trust_tier=9,
            edition="2026",
            external_url="https://www.tecconcursos.com.br/questoes/cadernos/2",
            mapping_status="proposed",
            source_target_slug="rfb_auditor",
            transfer_kind="shared",
        )
        service = SourceChoiceService(connection)
        proposed = service.choose(
            target_slug="bacen_economia_financas",
            target_topic_id=topic_id,
            block_kind="questions",
            as_of=date(2026, 7, 13),
        )
        assert proposed.selection is None
        assert proposed.rows[0].stop_reason == "mapping_not_approved"

        connection.execute(
            """
            UPDATE topic_source_mappings
            SET mapping_status='approved', manual_override=1,
                notes='Transferencia aprovada manualmente', version=version+1
            WHERE id=?
            """,
            (mapping.id,),
        )
        connection.commit()
        approved = service.choose(
            target_slug="bacen_economia_financas",
            target_topic_id=topic_id,
            block_kind="questions",
            as_of=date(2026, 7, 13),
        )

        assert approved.selection is not None
        assert approved.selection.source_item_id == item.id
        assert approved.selection.source_target_slug == "rfb_auditor"
        assert approved.selection.evidence["manualOverride"] is True
        assert approved.selection.evidence["targetFitBp"] < 10000
    finally:
        connection.close()
