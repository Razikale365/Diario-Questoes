from datetime import UTC, date, datetime
import json

from study_os_service.services.evidence_adapters import (
    observations_from_diario_backup,
    observations_from_ls_history,
)


def test_diario_adapter_emits_counts_without_question_content():
    document = [
        {
            "id": "task-1",
            "date": "2026-07-14",
            "discipline": "Economia",
            "bank": "FCC",
            "blocks": [
                {
                    "id": "block-1",
                    "title": "Aggregate block",
                    "questions": [
                        {
                            "statement": "PROPRIETARY",
                            "alternatives": [{"text": "SECRET"}],
                            "answer": "A",
                            "correctAnswer": "A",
                            "isCorrect": True,
                            "hasDoubt": True,
                        },
                        {
                            "statement": "PROPRIETARY-2",
                            "answer": "B",
                            "isCorrect": False,
                            "hasDoubt": False,
                        },
                    ],
                }
            ],
        }
    ]

    observations = observations_from_diario_backup(
        document,
        "sefaz_ce",
        datetime(2026, 7, 14, 12, tzinfo=UTC),
    )

    assert len(observations) == 1
    assert observations[0].correct_count == 1
    assert observations[0].wrong_count == 1
    assert observations[0].doubt_count == 1
    encoded = json.dumps(observations[0].to_payload())
    assert "PROPRIETARY" not in encoded
    assert "SECRET" not in encoded
    assert "correctAnswer" not in encoded
    assert "answer" not in encoded


def test_diario_hash_revision_is_deterministic_and_target_is_explicit():
    document = [
        {
            "id": "t",
            "date": "2026-07-14",
            "discipline": "Economia",
            "blocks": [
                {"id": "b", "questions": [{"isCorrect": True, "hasDoubt": False}]}
            ],
        }
    ]
    snapshot = datetime(2026, 7, 14, tzinfo=UTC)
    first = observations_from_diario_backup(document, "sefaz_ce", snapshot)
    second = observations_from_diario_backup(document, "sefaz_ce", snapshot)
    assert first[0].source_revision == second[0].source_revision
    try:
        observations_from_diario_backup(document, "", snapshot)
    except ValueError as exc:
        assert "target" in str(exc)
    else:
        raise AssertionError("empty target was accepted")


def test_diario_adapter_derives_observed_date_from_iso_datetime():
    document = [
        {
            "id": "timestamped-task",
            "date": "2026-07-14T00:50:01.639Z",
            "discipline": "Economia",
            "blocks": [
                {
                    "id": "timestamped-block",
                    "questions": [{"isCorrect": True, "hasDoubt": False}],
                }
            ],
        }
    ]

    observations = observations_from_diario_backup(
        document,
        "sefaz_ce",
        datetime(2026, 7, 14, 12, tzinfo=UTC),
    )

    assert len(observations) == 1
    assert observations[0].observed_on == date(2026, 7, 14)


def test_ls_percentage_stays_low_sample_when_counts_are_unknown():
    rows = observations_from_ls_history(
        [
            {
                "taskId": "ls-1",
                "discipline": "Economia",
                "observedOn": "2026-07-14",
                "percentageBp": 8000,
                "examBoard": "FCC",
            }
        ],
        "sefaz_ce",
        119790,
    )
    assert rows[0].measurement_type == "ls_percentage"
    assert rows[0].correct_count is None
    assert rows[0].wrong_count is None
    assert rows[0].percentage_bp == 8000
