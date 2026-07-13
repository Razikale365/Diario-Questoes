from __future__ import annotations

import json
from pathlib import Path

import pytest

from study_os_service.db.connection import connect_database
from study_os_service.db.migrations import MigrationRunner
from study_os_service.repositories.inventory import InventoryRepository
from study_os_service.services.course_mapping import (
    CourseLessonEvidence,
    CourseMappingService,
    MappingTopic,
    match_course_lesson,
)
from study_os_service.services.inventory import InventoryService
from study_os_service.services.planner_profiles import PlannerProfileService


FIXTURE = (
    Path(__file__).parent
    / "fixtures"
    / "strategy_mapping"
    / "mapping_cases.json"
)


def _mapping_fixture():
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def _topic(payload: dict) -> MappingTopic:
    return MappingTopic(
        id=payload["id"],
        target_slug=payload["targetSlug"],
        discipline=payload["discipline"],
        topic=payload["topic"],
        transfer_kind=payload["transferKind"],
        aliases=tuple(payload["aliases"]),
    )


@pytest.mark.parametrize("case", _mapping_fixture()["cases"], ids=lambda case: case["name"])
def test_deterministic_mapper_handles_aliases_ambiguity_and_transfer(case: dict):
    fixture = _mapping_fixture()
    topics = tuple(
        _topic(topic)
        for topic in fixture["topics"]
        if topic["targetSlug"] == case["targetSlug"]
    )
    evidence = CourseLessonEvidence(
        source_target_slug=case["sourceTargetSlug"],
        discipline=case["discipline"],
        course_name=case["courseName"],
        lesson_id=1,
        lesson_number=case["lessonNumber"],
        title=case["title"],
        material_id=1,
        material_kind="original",
        trust_level=10,
        heading_tokens=tuple(case["headingTokens"]),
    )

    matches = match_course_lesson(
        evidence,
        topics,
        target_slug=case["targetSlug"],
    )

    assert [match.target_topic_id for match in matches] == case["expectedTopicIds"]
    if matches:
        assert {match.stage for match in matches} == {case["expectedStage"]}
        assert {match.mapping_status for match in matches} == {
            case["expectedStatus"]
        }
    assert 105 not in {match.target_topic_id for match in matches}


def _seed_validated_inventory(connection) -> tuple[int, int, int]:
    root_id = connection.execute(
        """
        INSERT INTO course_roots (
          target_slug, provider, package_name, package_id, package_url,
          edition_note, root_path, source_kind, acquisition_method,
          download_status, catalog_checked_at, active
        ) VALUES (
          'rfb_auditor', 'Estrategia Concursos', 'Pacote 249654', '249654',
          'https://www.estrategiaconcursos.com.br/app/dashboard/pacote/249654',
          '2026 fresh', ?, 'course_package', 'estrategia_downloader',
          'validated', '2026-07-13T00:00:00+00:00', 1
        )
        """,
        (str(Path("C:/fixture/package").resolve()),),
    ).lastrowid
    discipline_id = connection.execute(
        "INSERT INTO disciplines (canonical_name) VALUES ('Direito Tributario')"
    ).lastrowid
    regular_course_id = connection.execute(
        """
        INSERT INTO courses (
          root_id, display_name, provider, relative_path, active, scan_state
        ) VALUES (?, 'Direito Tributario Regular', 'Estrategia Concursos',
                  'Direito Tributario Regular', 1, 'available')
        """,
        (root_id,),
    ).lastrowid
    passo_course_id = connection.execute(
        """
        INSERT INTO courses (
          root_id, display_name, provider, relative_path, active, scan_state
        ) VALUES (?, 'Passo Estrategico de Direito Tributario',
                  'Estrategia Concursos',
                  'Passo Estrategico de Direito Tributario', 1, 'available')
        """,
        (root_id,),
    ).lastrowid

    lesson_ids = []
    for course_id, sequence in ((regular_course_id, 0), (passo_course_id, 1)):
        lesson_id = connection.execute(
            """
            INSERT INTO lessons (
              course_id, discipline_id, lesson_number, title,
              sequence_index, status, available
            ) VALUES (?, ?, 2, 'Aula 002 - Lancamento e credito tributario',
                      ?, 'unread', 1)
            """,
            (course_id, discipline_id, sequence),
        ).lastrowid
        material_id = connection.execute(
            """
            INSERT INTO materials (
              course_id, lesson_id, absolute_path, relative_path,
              normalized_relative_path, kind, size_bytes, modified_at,
              available, is_primary, primary_selection, trust_level
            ) VALUES (?, ?, ?, ?, ?, 'original', 100, '2026-07-13',
                      1, 1, 'automatic', 10)
            """,
            (
                course_id,
                lesson_id,
                f"C:/fixture/{course_id}/Aula 002.pdf",
                f"{course_id}/PDF/Aula 002.pdf",
                f"{course_id}/pdf/aula 002.pdf",
            ),
        ).lastrowid
        lesson_ids.append((lesson_id, material_id))
    connection.commit()
    return root_id, lesson_ids[0][0], lesson_ids[1][0]


def test_mapping_service_persists_regular_and_passo_roles_idempotently(tmp_path: Path):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        MigrationRunner(connection).migrate()
        PlannerProfileService(connection).seed(("rfb_auditor",))
        root_id, regular_lesson_id, passo_lesson_id = _seed_validated_inventory(
            connection
        )
        topic_id = connection.execute(
            """
            SELECT id FROM target_topics
            WHERE target_slug='rfb_auditor'
              AND discipline='Direito Tributario'
              AND topic='Credito tributario'
            """
        ).fetchone()[0]
        aliases = {topic_id: ("Lancamento e credito tributario",)}
        inventory = InventoryService(InventoryRepository(connection))

        first = inventory.map_course_topics(root_id, topic_aliases=aliases)
        second = inventory.map_course_topics(root_id, topic_aliases=aliases)

        assert first.discovered_count == 2
        assert first.mapped_count == 2
        assert first.unresolved_count == 0
        assert second == first
        assert connection.execute(
            "SELECT COUNT(*) FROM strategy_sources"
        ).fetchone()[0] == 2
        assert connection.execute(
            "SELECT COUNT(*) FROM strategy_source_items"
        ).fetchone()[0] == 2
        assert connection.execute(
            "SELECT COUNT(*) FROM topic_source_mappings"
        ).fetchone()[0] == 2
        rows = connection.execute(
            """
            SELECT sources.source_kind, items.content_role,
                   mappings.mapping_status, mappings.primary_eligible,
                   items.lesson_id
            FROM topic_source_mappings AS mappings
            JOIN strategy_source_items AS items ON items.id=mappings.source_item_id
            JOIN strategy_sources AS sources ON sources.id=items.source_id
            ORDER BY sources.source_kind
            """
        ).fetchall()
        assert [dict(row) for row in rows] == [
            {
                "source_kind": "course",
                "content_role": "primary_theory",
                "mapping_status": "approved",
                "primary_eligible": 1,
                "lesson_id": regular_lesson_id,
            },
            {
                "source_kind": "passo",
                "content_role": "review_support",
                "mapping_status": "approved",
                "primary_eligible": 0,
                "lesson_id": passo_lesson_id,
            },
        ]
    finally:
        connection.close()


def test_mapping_rerun_preserves_manual_decision_when_evidence_changes(tmp_path: Path):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        MigrationRunner(connection).migrate()
        PlannerProfileService(connection).seed(("rfb_auditor",))
        root_id, _, passo_lesson_id = _seed_validated_inventory(connection)
        topic_id = connection.execute(
            """
            SELECT id FROM target_topics
            WHERE target_slug='rfb_auditor'
              AND discipline='Direito Tributario'
              AND topic='Credito tributario'
            """
        ).fetchone()[0]
        aliases = {topic_id: ("Lancamento e credito tributario",)}
        service = CourseMappingService(connection)
        service.map_root(root_id, topic_aliases=aliases)
        mapping_id = connection.execute(
            """
            SELECT mappings.id
            FROM topic_source_mappings AS mappings
            JOIN strategy_source_items AS items ON items.id=mappings.source_item_id
            WHERE items.lesson_id=?
            """,
            (passo_lesson_id,),
        ).fetchone()[0]
        connection.execute(
            """
            UPDATE topic_source_mappings
            SET mapping_status='rejected', primary_eligible=0,
                manual_override=1, notes='Passo desatualizado', version=version+1
            WHERE id=?
            """,
            (mapping_id,),
        )
        connection.commit()

        service.map_root(
            root_id,
            topic_aliases=aliases,
            heading_hints={passo_lesson_id: ("Credito tributario",)},
        )

        preserved = connection.execute(
            """
            SELECT mapping_status, primary_eligible, manual_override, notes, version
            FROM topic_source_mappings WHERE id=?
            """,
            (mapping_id,),
        ).fetchone()
        assert dict(preserved) == {
            "mapping_status": "rejected",
            "primary_eligible": 0,
            "manual_override": 1,
            "notes": "Passo desatualizado",
            "version": 2,
        }
    finally:
        connection.close()


def test_cross_target_mapping_run_keeps_source_ownership_and_reports_gap(tmp_path: Path):
    connection = connect_database(tmp_path / "study.sqlite3")
    try:
        MigrationRunner(connection).migrate()
        PlannerProfileService(connection).seed(
            ("rfb_auditor", "bacen_economia_financas")
        )
        root_id, _, _ = _seed_validated_inventory(connection)

        summary = CourseMappingService(connection).map_root(
            root_id,
            target_slug="bacen_economia_financas",
        )

        assert summary.target_slug == "bacen_economia_financas"
        assert summary.discovered_count == 2
        assert summary.mapped_count == 0
        assert summary.unresolved_count == 2
        assert connection.execute(
            "SELECT COUNT(*) FROM topic_source_mappings"
        ).fetchone()[0] == 0
        run_targets = {
            row[0]
            for row in connection.execute(
                "SELECT target_slug FROM strategy_ingestion_runs"
            )
        }
        assert run_targets == {"rfb_auditor"}
    finally:
        connection.close()
