from pathlib import Path

from fastapi.testclient import TestClient

from study_os_service.app import create_app
from study_os_service.config import StudyOsSettings


ALL_TARGETS = {
    "bacen_economia_financas",
    "rfb_auditor",
    "rfb_analista",
    "sefaz_ce",
}


def make_client(tmp_path: Path) -> TestClient:
    return TestClient(create_app(StudyOsSettings.from_environment(tmp_path)))


def seed(client: TestClient, *target_slugs: str):
    payload = {"targetSlugs": list(target_slugs)} if target_slugs else {}
    return client.post("/api/v1/planner/targets/seed", json=payload)


def test_seed_profiles_are_editable_target_scoped_defaults(tmp_path: Path):
    with make_client(tmp_path) as client:
        seeded = seed(client)
        targets = client.get("/api/v1/planner/targets")
        bacen = client.get(
            "/api/v1/planner/topics?targetSlug=bacen_economia_financas"
        )
        sefaz = client.get("/api/v1/planner/topics?targetSlug=sefaz_ce")

    assert seeded.status_code == 201
    assert seeded.json()["targetsSeeded"] == 4
    assert seeded.json()["topicsSeeded"] >= 24
    assert targets.status_code == 200
    assert {item["targetSlug"] for item in targets.json()["items"]} == ALL_TARGETS

    bacen_topics = bacen.json()["items"]
    assert len(bacen_topics) >= 6
    assert all(item["targetSlug"] == "bacen_economia_financas" for item in bacen_topics)
    assert {item["discipline"] for item in bacen_topics} >= {
        "Macroeconomia",
        "Microeconomia",
        "Sistema Financeiro Nacional",
        "Estatistica e Econometria",
    }
    assert not any(item["discipline"] == "Direito Aduaneiro" for item in bacen_topics)
    assert all(item["tecSourceUrl"].startswith("https://www.tecconcursos.com.br/") for item in bacen_topics)

    financas = next(
        item
        for item in sefaz.json()["items"]
        if item["discipline"] == "Financas Publicas"
    )
    assert financas["editalWeight"] == 2
    assert financas["transferKind"] == "shared"
    assert financas["notes"]


def test_reseed_never_overwrites_manual_topic_edits(tmp_path: Path):
    with make_client(tmp_path) as client:
        assert seed(client, "bacen_economia_financas").status_code == 201
        topics = client.get(
            "/api/v1/planner/topics?targetSlug=bacen_economia_financas"
        ).json()["items"]
        macro = next(item for item in topics if item["discipline"] == "Macroeconomia")

        updated = client.put(
            "/api/v1/planner/topics?targetSlug=bacen_economia_financas",
            json={
                "items": [
                    {
                        "id": macro["id"],
                        "coverageStatus": "weak",
                        "incidence": 99,
                        "notes": "Autoauditoria manual",
                        "expectedVersion": macro["version"],
                    }
                ]
            },
        )
        reseeded = seed(client, "bacen_economia_financas")
        after = client.get(
            "/api/v1/planner/topics?targetSlug=bacen_economia_financas"
        ).json()["items"]

    assert updated.status_code == 200
    assert updated.json()["items"][0]["version"] == macro["version"] + 1
    assert reseeded.status_code == 201
    assert reseeded.json() == {
        "targetsSeeded": 0,
        "topicsSeeded": 0,
        "targetSlugs": ["bacen_economia_financas"],
    }
    saved = next(item for item in after if item["id"] == macro["id"])
    assert saved["coverageStatus"] == "weak"
    assert saved["incidence"] == 99
    assert saved["notes"] == "Autoauditoria manual"
    assert saved["version"] == macro["version"] + 1


def test_target_updates_validate_phase_deadline_and_version(tmp_path: Path):
    with make_client(tmp_path) as client:
        seed(client, "rfb_auditor")
        target = client.get("/api/v1/planner/targets").json()["items"][0]

        invalid_deadline = client.put(
            "/api/v1/planner/targets",
            json={
                "targetSlug": "rfb_auditor",
                "phase": "pos_edital",
                "deadline": "06/12/2026",
                "expectedVersion": target["version"],
            },
        )
        updated = client.put(
            "/api/v1/planner/targets",
            json={
                "targetSlug": "rfb_auditor",
                "phase": "pos_edital",
                "deadline": "2026-12-06",
                "dailyQuota": 5,
                "expectedVersion": target["version"],
            },
        )
        stale = client.put(
            "/api/v1/planner/targets",
            json={
                "targetSlug": "rfb_auditor",
                "notes": "stale write",
                "expectedVersion": target["version"],
            },
        )

    assert invalid_deadline.status_code == 422
    assert invalid_deadline.json()["code"] == "invalid_target_profile"
    assert "deadline" in invalid_deadline.json()["message"]
    assert updated.status_code == 200
    assert updated.json()["phase"] == "pos_edital"
    assert updated.json()["deadline"] == "2026-12-06"
    assert updated.json()["dailyQuota"] == 5
    assert updated.json()["version"] == target["version"] + 1
    assert stale.status_code == 409
    assert stale.json()["code"] == "stale_target_profile"


def test_bulk_topic_update_is_atomic_and_unknown_target_is_structured(tmp_path: Path):
    with make_client(tmp_path) as client:
        seed(client, "sefaz_ce")
        topics = client.get("/api/v1/planner/topics?targetSlug=sefaz_ce").json()[
            "items"
        ]
        first = topics[0]
        invalid = client.put(
            "/api/v1/planner/topics?targetSlug=sefaz_ce",
            json={
                "items": [
                    {
                        "id": first["id"],
                        "coverageStatus": "strong",
                        "expectedVersion": first["version"],
                    },
                    {
                        "discipline": "Disciplina invalida",
                        "topic": "Incidencia invalida",
                        "incidence": 101,
                    },
                ]
            },
        )
        after = client.get("/api/v1/planner/topics?targetSlug=sefaz_ce").json()[
            "items"
        ]
        unknown = client.get("/api/v1/planner/topics?targetSlug=nao_existe")

    assert invalid.status_code == 422
    assert invalid.json()["code"] == "invalid_target_topic"
    unchanged = next(item for item in after if item["id"] == first["id"])
    assert unchanged["coverageStatus"] == first["coverageStatus"]
    assert unchanged["version"] == first["version"]
    assert unknown.status_code == 404
    assert unknown.json() == {
        "code": "target_profile_not_found",
        "message": "target profile nao_existe does not exist",
    }


def test_topic_identity_cannot_cross_target_boundaries(tmp_path: Path):
    with make_client(tmp_path) as client:
        seed(client, "bacen_economia_financas", "rfb_auditor")
        rfb_topic = client.get(
            "/api/v1/planner/topics?targetSlug=rfb_auditor"
        ).json()["items"][0]
        crossed = client.put(
            "/api/v1/planner/topics?targetSlug=bacen_economia_financas",
            json={
                "items": [
                    {
                        "id": rfb_topic["id"],
                        "coverageStatus": "weak",
                        "expectedVersion": rfb_topic["version"],
                    }
                ]
            },
        )

    assert crossed.status_code == 409
    assert crossed.json()["code"] == "target_topic_mismatch"


def test_manual_topic_rows_can_be_added_and_empty_seed_is_rejected(tmp_path: Path):
    with make_client(tmp_path) as client:
        assert seed(client, "rfb_analista").status_code == 201
        created = client.put(
            "/api/v1/planner/topics?targetSlug=rfb_analista",
            json={
                "items": [
                    {
                        "discipline": "Ingles",
                        "topic": "Compreensao de textos tecnicos",
                        "coverageStatus": "stale",
                        "editalWeight": 1.5,
                        "incidence": 67,
                        "tier": 2,
                        "bancaFit": 85,
                        "overlapValue": 100,
                        "transferKind": "shared",
                        "sourceKind": "manual",
                        "plannedQuestions": 15,
                        "notes": "Linha adicionada pela tabela manual",
                    }
                ]
            },
        )
        empty = client.post(
            "/api/v1/planner/targets/seed", json={"targetSlugs": []}
        )

    assert created.status_code == 200
    topic = created.json()["items"][0]
    assert topic["id"] > 0
    assert topic["targetSlug"] == "rfb_analista"
    assert topic["discipline"] == "Ingles"
    assert topic["coverageStatus"] == "stale"
    assert topic["version"] == 1
    assert empty.status_code == 422
    assert empty.json()["code"] == "invalid_target_seed"
