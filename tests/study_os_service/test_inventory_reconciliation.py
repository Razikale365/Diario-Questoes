from pathlib import Path

import pytest

from study_os_service.db.connection import connect_database
from study_os_service.db.migrations import MigrationRunner
from study_os_service.repositories.inventory import InventoryRepository
from study_os_service.services.inventory import InventoryService
from tests.study_os_service.fixture_tree import create_audited_course_tree


def register_test_root(connection, root: Path) -> int:
    return connection.execute(
        """
        INSERT INTO course_roots (
          target_slug, provider, package_name, package_id, package_url,
          edition_note, root_path, source_kind, acquisition_method,
          download_status, catalog_checked_at, active
        ) VALUES (
          'rfb_auditor', 'Estrategia Concursos', 'Fixture package', 'fixture',
          'https://www.estrategiaconcursos.com.br/app/dashboard/pacote/249654',
          'test', ?, 'course_package', 'estrategia_downloader',
          'selected', '2026-07-11T12:00:00+00:00', 1
        )
        """,
        (str(root.resolve()),),
    ).lastrowid


@pytest.fixture
def inventory(tmp_path: Path):
    root = create_audited_course_tree(tmp_path / "package")
    connection = connect_database(tmp_path / "study.sqlite3")
    MigrationRunner(connection).migrate()
    root_id = register_test_root(connection, root)
    repository = InventoryRepository(connection)
    service = InventoryService(repository)
    try:
        yield connection, repository, service, root, root_id
    finally:
        connection.close()


def inventory_ids(connection):
    return {
        "courses": [row["id"] for row in connection.execute("SELECT id FROM courses ORDER BY id")],
        "lessons": [row["id"] for row in connection.execute("SELECT id FROM lessons ORDER BY id")],
        "materials": [
            row["id"] for row in connection.execute("SELECT id FROM materials ORDER BY id")
        ],
    }


def test_identical_rescan_preserves_ids_and_creates_no_duplicates(inventory):
    connection, _, service, _, root_id = inventory

    first = service.scan_and_reconcile(root_id)
    first_ids = inventory_ids(connection)
    second = service.scan_and_reconcile(root_id)

    assert first.state == "completed"
    assert first.discovered_count == 9
    assert second.state == "completed"
    assert inventory_ids(connection) == first_ids
    assert connection.execute("SELECT COUNT(*) FROM courses").fetchone()[0] == 4
    assert connection.execute("SELECT COUNT(*) FROM lessons").fetchone()[0] == 4
    assert connection.execute("SELECT COUNT(*) FROM materials").fetchone()[0] == 9


def test_missing_material_and_empty_lesson_are_marked_unavailable_without_deletion(
    inventory,
):
    connection, _, service, root, root_id = inventory
    service.scan_and_reconcile(root_id)
    material = connection.execute(
        "SELECT id, relative_path, lesson_id FROM materials WHERE relative_path LIKE '%Aula_02_Apostila.pdf'"
    ).fetchone()
    (root / Path(material["relative_path"])).unlink()

    service.scan_and_reconcile(root_id)

    assert connection.execute(
        "SELECT available FROM materials WHERE id=?", (material["id"],)
    ).fetchone()[0] == 0
    assert connection.execute(
        "SELECT available FROM lessons WHERE id=?", (material["lesson_id"],)
    ).fetchone()[0] == 0
    assert connection.execute(
        "SELECT COUNT(*) FROM materials WHERE id=?", (material["id"],)
    ).fetchone()[0] == 1


def test_future_progress_reference_survives_disappearing_material(inventory):
    connection, _, service, root, root_id = inventory
    service.scan_and_reconcile(root_id)
    material = connection.execute(
        "SELECT id, relative_path FROM materials ORDER BY id LIMIT 1"
    ).fetchone()
    connection.execute(
        "CREATE TABLE future_progress (id INTEGER PRIMARY KEY, material_id INTEGER REFERENCES materials(id) ON DELETE RESTRICT)"
    )
    connection.execute(
        "INSERT INTO future_progress (material_id) VALUES (?)", (material["id"],)
    )
    (root / Path(material["relative_path"])).unlink()

    service.scan_and_reconcile(root_id)

    assert connection.execute(
        "SELECT material_id FROM future_progress"
    ).fetchone()[0] == material["id"]


def test_manual_primary_is_preserved_then_replaced_when_it_disappears(inventory):
    connection, _, service, root, root_id = inventory
    service.scan_and_reconcile(root_id)
    lesson_id = connection.execute(
        """
        SELECT id FROM lessons
        WHERE lesson_number=1 AND course_id=(
          SELECT id FROM courses WHERE display_name='Economia e Financas Publicas'
        )
        """
    ).fetchone()[0]
    original = connection.execute(
        "SELECT id FROM materials WHERE lesson_id=? AND kind='original'", (lesson_id,)
    ).fetchone()[0]
    simplified = connection.execute(
        "SELECT id, relative_path FROM materials WHERE lesson_id=? AND kind='simplified'",
        (lesson_id,),
    ).fetchone()
    connection.execute(
        "UPDATE materials SET is_primary=0, primary_selection=NULL WHERE lesson_id=?",
        (lesson_id,),
    )
    connection.execute(
        "UPDATE materials SET is_primary=1, primary_selection='manual' WHERE id=?",
        (simplified["id"],),
    )

    service.scan_and_reconcile(root_id)
    assert connection.execute(
        "SELECT id FROM materials WHERE lesson_id=? AND is_primary=1", (lesson_id,)
    ).fetchone()[0] == simplified["id"]

    (root / Path(simplified["relative_path"])).unlink()
    service.scan_and_reconcile(root_id)
    replacement = connection.execute(
        "SELECT id, primary_selection FROM materials WHERE lesson_id=? AND is_primary=1",
        (lesson_id,),
    ).fetchone()
    assert replacement["id"] == original
    assert replacement["primary_selection"] == "automatic"


def test_probable_rename_creates_new_identity_and_durable_issue(inventory):
    connection, _, service, root, root_id = inventory
    first = service.scan_and_reconcile(root_id)
    material = connection.execute(
        "SELECT id, relative_path FROM materials WHERE relative_path LIKE '%Aula_02_Apostila.pdf'"
    ).fetchone()
    old_path = root / Path(material["relative_path"])
    new_path = old_path.with_name("Aula_02_Apostila_renomeada.pdf")
    old_path.rename(new_path)

    second = service.scan_and_reconcile(root_id)

    rows = connection.execute(
        "SELECT id, relative_path, available FROM materials WHERE course_id=(SELECT course_id FROM materials WHERE id=?) ORDER BY id",
        (material["id"],),
    ).fetchall()
    assert len(rows) == 2
    assert rows[0]["id"] == material["id"] and rows[0]["available"] == 0
    assert rows[1]["id"] != material["id"] and rows[1]["available"] == 1
    issue = connection.execute(
        "SELECT issue_kind, context_json FROM import_issues WHERE import_run_id=? AND issue_kind='possible_rename'",
        (second.id,),
    ).fetchone()
    assert issue is not None
    assert "Aula_02_Apostila.pdf" in issue["context_json"]
    assert "Aula_02_Apostila_renomeada.pdf" in issue["context_json"]
    assert first.id != second.id


def test_reconciliation_rolls_back_inventory_and_records_failed_run_separately(
    inventory, monkeypatch
):
    connection, repository, service, _, root_id = inventory

    def partially_write_then_fail(*args, **kwargs):
        connection.execute(
            """
            INSERT INTO courses (
              root_id, display_name, provider, relative_path, active, scan_state
            ) VALUES (?, 'Partial', 'Estrategia', 'Partial', 1, 'available')
            """,
            (root_id,),
        )
        raise RuntimeError("forced reconciliation failure")

    monkeypatch.setattr(repository, "reconcile_snapshot", partially_write_then_fail)

    with pytest.raises(RuntimeError, match="forced reconciliation failure"):
        service.scan_and_reconcile(root_id)

    assert connection.execute("SELECT COUNT(*) FROM courses").fetchone()[0] == 0
    run = connection.execute(
        "SELECT state, error_message FROM import_runs ORDER BY id DESC LIMIT 1"
    ).fetchone()
    assert run["state"] == "failed"
    assert "forced reconciliation failure" in run["error_message"]


def test_inserting_earlier_lesson_preserves_existing_lesson_identity(inventory):
    connection, _, service, root, root_id = inventory
    service.scan_and_reconcile(root_id)
    existing = connection.execute(
        """
        SELECT lessons.id
        FROM lessons
        JOIN courses ON courses.id=lessons.course_id
        WHERE courses.display_name='Direito Tributario' AND lessons.lesson_number=2
        """
    ).fetchone()[0]
    (root / "Direito Tributario" / "PDF" / "Aula_01_Apostila.pdf").write_bytes(b"")

    service.scan_and_reconcile(root_id)

    lessons = connection.execute(
        """
        SELECT lessons.id, lessons.lesson_number, lessons.sequence_index
        FROM lessons
        JOIN courses ON courses.id=lessons.course_id
        WHERE courses.display_name='Direito Tributario'
        ORDER BY lessons.sequence_index
        """
    ).fetchall()
    assert [(row["lesson_number"], row["sequence_index"]) for row in lessons] == [
        (1, 0),
        (2, 1),
    ]
    assert lessons[1]["id"] == existing


def test_scanner_failure_is_persisted_before_any_inventory_transaction(inventory):
    connection, repository, _, _, root_id = inventory

    def failing_scanner(*args, **kwargs):
        raise OSError("filesystem unavailable")

    service = InventoryService(repository, scanner=failing_scanner)

    with pytest.raises(OSError, match="filesystem unavailable"):
        service.scan_and_reconcile(root_id)

    run = connection.execute(
        "SELECT state, error_message FROM import_runs ORDER BY id DESC LIMIT 1"
    ).fetchone()
    assert run["state"] == "failed"
    assert run["error_message"] == "filesystem unavailable"
    assert connection.execute("SELECT COUNT(*) FROM courses").fetchone()[0] == 0
