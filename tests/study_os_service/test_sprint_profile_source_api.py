from pathlib import Path

from fastapi.testclient import TestClient

from study_os_service.app import create_app
from study_os_service.config import StudyOsSettings
from study_os_service.db.connection import connect_database


def _client(tmp_path: Path) -> TestClient:
    return TestClient(create_app(StudyOsSettings.from_environment(tmp_path)))


def _seed_sefaz(client: TestClient) -> None:
    response = client.post(
        "/api/v1/planner/targets/seed",
        json={"targetSlugs": ["sefaz_ce"]},
    )
    assert response.status_code == 201


def test_sprint_config_bootstraps_official_sefaz_profile(tmp_path: Path):
    with _client(tmp_path) as client:
        _seed_sefaz(client)
        response = client.get("/api/v1/sprints/config?targetSlug=sefaz_ce")
        target = client.get("/api/v1/planner/targets").json()["items"][0]
        topics = client.get("/api/v1/planner/topics?targetSlug=sefaz_ce").json()["items"]

    assert response.status_code == 200
    payload = response.json()
    assert payload["targetSlug"] == "sefaz_ce"
    assert payload["objectiveDate"] == "2026-08-01"
    assert payload["examEndDate"] == "2026-08-02"
    assert payload["lsBudgetMinutes"] == 240
    assert payload["extraBudgetMinutes"] == 60
    assert payload["triageMode"] == "suggest_only"
    assert payload["goals"] == {
        "p1Floor": 48,
        "p1Low": 48,
        "p1High": 52,
        "p2Low": 63,
        "p2High": 67,
        "discursiveLow": 75,
        "discursiveHigh": 82,
    }

    subjects = payload["subjects"]
    assert sum(row["questionCount"] for row in subjects if row["paper"] == "P1") == 80
    assert sum(row["questionCount"] for row in subjects if row["paper"] == "P2") == 80
    assert all(row["questionWeight"] == 1 for row in subjects if row["paper"] == "P1")
    assert all(row["questionWeight"] == 2 for row in subjects if row["paper"] == "P2")

    lte = next(row for row in subjects if row["subjectKey"] == "p2_lte")
    finances = next(
        row for row in subjects if row["subjectKey"] == "p2_financas_publicas"
    )
    data_fluency = next(
        row for row in subjects if row["subjectKey"] == "p2_tecnologia_dados"
    )
    assert lte["questionCount"] == 20
    assert lte["baselineAccuracyBp"] is None
    assert lte["baselineConfidenceBp"] == 0
    assert lte["focusBand"] == "focus"
    assert finances["questionCount"] == 10
    assert finances["questionWeight"] == 2
    assert data_fluency["displayName"] == "Fluencia de Dados"
    assert data_fluency["aliases"] == ["fluencia de dados", "ciencia de dados"]

    assert target["banca"] == "FCC"
    assert target["deadline"] == "2026-08-01"
    assert "do20260424p02.pdf" in target["sourceUrls"][0]
    direito_tributario = next(
        row for row in topics if row["discipline"] == "Direito Tributario"
    )
    assert direito_tributario["editalWeight"] == 2


def test_official_subject_bootstrap_repairs_structure_without_losing_user_evidence(
    tmp_path: Path,
):
    with _client(tmp_path) as client:
        _seed_sefaz(client)
        client.get("/api/v1/sprints/config?targetSlug=sefaz_ce")
        database = client.app.state.settings.database_path
        connection = connect_database(database)
        try:
            connection.execute(
                """
                UPDATE exam_subject_profiles
                SET display_name='Tecnologia da Informacao e Ciencia de Dados',
                    aliases_json=?,
                    baseline_accuracy_bp=7650,
                    notes='Evidencia manual preservada'
                WHERE target_slug='sefaz_ce' AND subject_key='p2_tecnologia_dados'
                """,
                ('["tecnologia da informacao", "ti", "dados"]',),
            )
            connection.commit()
        finally:
            connection.close()

        response = client.get("/api/v1/sprints/config?targetSlug=sefaz_ce")

    assert database.exists()
    subject = next(
        row
        for row in response.json()["subjects"]
        if row["subjectKey"] == "p2_tecnologia_dados"
    )
    assert subject["displayName"] == "Fluencia de Dados"
    assert subject["aliases"] == ["fluencia de dados", "ciencia de dados"]
    assert subject["baselineAccuracyBp"] == 7650
    assert subject["notes"] == "Evidencia manual preservada"


def test_fluencia_de_dados_maps_without_broad_ti_aliases(tmp_path: Path):
    with _client(tmp_path) as client:
        _seed_sefaz(client)
        client.get("/api/v1/sprints/config?targetSlug=sefaz_ce")
        response = client.post(
            "/api/v1/source-plans/import",
            headers={"Idempotency-Key": "fluencia-aliases"},
            json={
                "targetSlug": "sefaz_ce",
                "sourceKind": "ls",
                "planLabel": "Meta 47",
                "metaNumber": 47,
                "tasks": [
                    {
                        "externalTaskId": "fluencia",
                        "sourceOrder": 1,
                        "discipline": "Fluencia de dados",
                        "taskKind": "questions",
                        "description": "Questoes FCC",
                        "estimatedMinutes": 45,
                        "status": "pending",
                    },
                    {
                        "externalTaskId": "ti-generica",
                        "sourceOrder": 2,
                        "discipline": "TI",
                        "taskKind": "questions",
                        "description": "Conteudo generico",
                        "estimatedMinutes": 45,
                        "status": "pending",
                    },
                ],
            },
        )
        listed = client.get(
            "/api/v1/source-plans/tasks?targetSlug=sefaz_ce"
        ).json()["items"]

    assert response.status_code == 201, response.text
    fluencia = next(row for row in listed if row["externalTaskId"] == "fluencia")
    generic_ti = next(row for row in listed if row["externalTaskId"] == "ti-generica")
    assert fluencia["subjectKey"] == "p2_tecnologia_dados"
    assert fluencia["mappingStatus"] == "matched"
    assert generic_ti["subjectKey"] is None
    assert generic_ti["mappingStatus"] == "unresolved"


def test_sprint_bootstrap_does_not_overwrite_user_edited_target_fields(tmp_path: Path):
    with _client(tmp_path) as client:
        _seed_sefaz(client)
        target = client.get("/api/v1/planner/targets").json()["items"][0]
        edited = client.put(
            "/api/v1/planner/targets",
            json={
                "targetSlug": "sefaz_ce",
                "displayName": "Meu sprint CE",
                "banca": "Banca editada",
                "deadline": "2026-08-15",
                "notes": "Minhas notas",
                "expectedVersion": target["version"],
            },
        )
        assert edited.status_code == 200

        config = client.get("/api/v1/sprints/config?targetSlug=sefaz_ce")
        after = next(
            row
            for row in client.get("/api/v1/planner/targets").json()["items"]
            if row["targetSlug"] == "sefaz_ce"
        )

    assert config.status_code == 200
    assert after["displayName"] == "Meu sprint CE"
    assert after["banca"] == "Banca editada"
    assert after["deadline"] == "2026-08-15"
    assert after["notes"] == "Minhas notas"


def test_source_plan_import_is_idempotent_and_exposes_unresolved_aliases(
    tmp_path: Path,
):
    payload = {
        "targetSlug": "sefaz_ce",
        "sourceKind": "ls",
        "planLabel": "SEFAZ SP POS EDITAL [110806] - Meta 47",
        "metaNumber": 47,
        "tasks": [
            {
                "externalTaskId": "meta-47-task-29",
                "scheduledDate": "2026-07-13",
                "sourceOrder": 29,
                "discipline": "Legis. Tribut. Estadual (ICMS)",
                "topicHint": "Lei 18.665/2023 - Arts. 24 a 27",
                "taskKind": "review",
                "description": "Revisao intermediaria VI",
                "estimatedMinutes": 60,
                "status": "completed",
                "performanceBp": 10000,
                "provenance": {"meta": 47, "historyStatus": "feita"},
            },
            {
                "externalTaskId": "meta-47-task-19",
                "scheduledDate": "2026-07-13",
                "sourceOrder": 19,
                "discipline": "Contabilidade de Custos",
                "topicHint": "Custeio por absorcao",
                "taskKind": "questions",
                "description": "Resolver bateria FCC",
                "estimatedMinutes": 60,
                "status": "ignored",
                "provenance": {"meta": 47, "historyStatus": "ignorada"},
            },
            {
                "externalTaskId": "meta-47-task-x",
                "scheduledDate": "2026-07-13",
                "sourceOrder": 99,
                "discipline": "Materia ainda sem alias",
                "topicHint": "Pendente",
                "taskKind": "theory",
                "description": "Correspondencia manual necessaria",
                "estimatedMinutes": 45,
                "status": "pending",
            },
        ],
    }

    with _client(tmp_path) as client:
        _seed_sefaz(client)
        client.get("/api/v1/sprints/config?targetSlug=sefaz_ce")
        first = client.post(
            "/api/v1/source-plans/import",
            headers={"Idempotency-Key": "meta-47-history-v1"},
            json=payload,
        )
        replay = client.post(
            "/api/v1/source-plans/import",
            headers={"Idempotency-Key": "meta-47-history-v1"},
            json=payload,
        )
        listed = client.get(
            "/api/v1/source-plans/tasks"
            "?targetSlug=sefaz_ce&date=2026-07-13&includeInactive=true"
        )
        conflict_payload = payload | {"planLabel": "payload diferente"}
        conflict = client.post(
            "/api/v1/source-plans/import",
            headers={"Idempotency-Key": "meta-47-history-v1"},
            json=conflict_payload,
        )

    assert first.status_code == 201
    assert first.json()["createdCount"] == 3
    assert first.json()["updatedCount"] == 0
    assert first.json()["unresolvedCount"] == 1
    assert first.json()["replayed"] is False
    assert replay.status_code == 201
    assert replay.json() | {"replayed": False} == first.json()
    assert replay.json()["replayed"] is True

    assert listed.status_code == 200
    tasks = listed.json()["items"]
    assert len(tasks) == 3
    lte = next(row for row in tasks if row["externalTaskId"] == "meta-47-task-29")
    costs = next(row for row in tasks if row["externalTaskId"] == "meta-47-task-19")
    unresolved = next(row for row in tasks if row["externalTaskId"] == "meta-47-task-x")
    assert lte["subjectKey"] == "p2_lte"
    assert lte["status"] == "completed"
    assert costs["subjectKey"] == "p2_contabilidade_avancada_custos"
    assert costs["status"] == "ignored"
    assert unresolved["subjectKey"] is None
    assert unresolved["mappingStatus"] == "unresolved"

    assert conflict.status_code == 409
    assert conflict.json()["code"] == "idempotency_conflict"


def test_source_plan_reimport_updates_history_without_duplicate_tasks(tmp_path: Path):
    base_task = {
        "externalTaskId": "meta-47-task-16",
        "scheduledDate": "2026-07-14",
        "sourceOrder": 16,
        "discipline": "Reforma Tributaria",
        "topicHint": "EC 132",
        "taskKind": "questions",
        "description": "Questoes FCC",
        "estimatedMinutes": 60,
        "status": "pending",
    }
    base = {
        "targetSlug": "sefaz_ce",
        "sourceKind": "ls",
        "planLabel": "Meta 47",
        "metaNumber": 47,
        "tasks": [base_task],
    }

    with _client(tmp_path) as client:
        _seed_sefaz(client)
        client.get("/api/v1/sprints/config?targetSlug=sefaz_ce")
        created = client.post(
            "/api/v1/source-plans/import",
            headers={"Idempotency-Key": "meta-47-first"},
            json=base,
        )
        updated = client.post(
            "/api/v1/source-plans/import",
            headers={"Idempotency-Key": "meta-47-history-update"},
            json=base
            | {
                "tasks": [
                    base_task
                    | {
                        "status": "completed",
                        "spentMinutes": 52,
                        "performanceBp": 8500,
                    }
                ]
            },
        )
        listed = client.get(
            "/api/v1/source-plans/tasks?targetSlug=sefaz_ce&includeInactive=true"
        )

    assert created.json()["createdCount"] == 1
    assert updated.json()["createdCount"] == 0
    assert updated.json()["updatedCount"] == 1
    assert len(listed.json()["items"]) == 1
    assert listed.json()["items"][0]["status"] == "completed"
    assert listed.json()["items"][0]["spentMinutes"] == 52
    assert listed.json()["items"][0]["performanceBp"] == 8500


def test_transversal_simulation_and_discursive_tasks_do_not_enter_alias_queue(
    tmp_path: Path,
):
    with _client(tmp_path) as client:
        _seed_sefaz(client)
        response = client.post(
            "/api/v1/source-plans/import",
            headers={"Idempotency-Key": "meta-47-transversal"},
            json={
                "targetSlug": "sefaz_ce",
                "sourceKind": "ls",
                "planLabel": "Meta 47",
                "metaNumber": 47,
                "tasks": [
                    {
                        "externalTaskId": "meta-47-23",
                        "scheduledDate": "2026-07-27",
                        "sourceOrder": 23,
                        "discipline": "Simulados",
                        "taskKind": "simulation",
                        "description": "Simulado 09 SEFAZ CE",
                        "estimatedMinutes": 180,
                        "status": "pending",
                    },
                    {
                        "externalTaskId": "meta-47-31",
                        "scheduledDate": "2026-07-15",
                        "sourceOrder": 31,
                        "discipline": "Discursivas",
                        "taskKind": "discursive",
                        "description": "Pratica de producao textual",
                        "estimatedMinutes": 60,
                        "status": "pending",
                    },
                ],
            },
        )
        listed = client.get(
            "/api/v1/source-plans/tasks?targetSlug=sefaz_ce"
        )

    assert response.status_code == 201, response.text
    assert response.json()["unresolvedCount"] == 0
    assert {row["mappingStatus"] for row in listed.json()["items"]} == {
        "transversal"
    }


def test_local_planner_sync_does_not_downgrade_richer_ls_history(tmp_path: Path):
    base = {
        "targetSlug": "sefaz_ce",
        "sourceKind": "ls",
        "planLabel": "Meta 47",
        "metaNumber": 47,
        "tasks": [
            {
                "externalTaskId": "ls-sefaz-ce-meta-47-task-17",
                "scheduledDate": "2026-07-11",
                "sourceOrder": 17,
                "discipline": "Legis. Tribut. Estadual (ICMS)",
                "topicHint": "Lei 18.665/2023",
                "taskKind": "review",
                "description": "Lei 18.665/2023 - arts. 24 a 27",
                "materialHint": "TEC Concursos + resumos",
                "estimatedMinutes": 60,
                "spentMinutes": 60,
                "status": "completed",
                "performanceBp": 9100,
                "provenance": {
                    "origin": "ls-visible-history",
                    "tecUrl": "https://www.tecconcursos.com.br/s/Q6Z7ae",
                },
            }
        ],
    }
    local_sync = base | {
        "tasks": [
            base["tasks"][0]
            | {
                "description": "Lei 18.665/2023 - arts. 24 a 27",
                "materialHint": "",
                "spentMinutes": 0,
                "status": "pending",
                "performanceBp": None,
                "linkedStudyTaskId": "local-study-task",
                "provenance": {
                    "origin": "planner-local-sync",
                    "tecUrl": None,
                },
            }
        ]
    }

    with _client(tmp_path) as client:
        _seed_sefaz(client)
        first = client.post(
            "/api/v1/source-plans/import",
            headers={"Idempotency-Key": "ls-history-rich"},
            json=base,
        )
        sync = client.post(
            "/api/v1/source-plans/import",
            headers={"Idempotency-Key": "planner-local-sync"},
            json=local_sync,
        )
        task = client.get(
            "/api/v1/source-plans/tasks?targetSlug=sefaz_ce"
        ).json()["items"][0]

    assert first.status_code == 201, first.text
    assert sync.status_code == 201, sync.text
    assert task["status"] == "completed"
    assert task["performanceBp"] == 9100
    assert task["spentMinutes"] == 60
    assert task["description"] == "Lei 18.665/2023 - arts. 24 a 27"
    assert task["materialHint"] == "TEC Concursos + resumos"
    assert task["linkedStudyTaskId"] == "local-study-task"
    assert task["provenance"]["tecUrl"] == "https://www.tecconcursos.com.br/s/Q6Z7ae"
