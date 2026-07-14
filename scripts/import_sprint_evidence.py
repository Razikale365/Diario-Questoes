from __future__ import annotations

import argparse
from datetime import datetime
import hashlib
import json
from pathlib import Path
import sys

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from study_os_service.config import StudyOsSettings
from study_os_service.db.connection import connect_database
from study_os_service.services.evidence_adapters import (
    observations_from_diario_backup,
    observations_from_ls_history,
    sefaz_go_baseline_observations,
)
from study_os_service.services.sprint import SprintProfileService
from study_os_service.services.sprint_evidence import SprintEvidenceService


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Import aggregate-only sprint evidence")
    parser.add_argument("--format", required=True, choices=("diario-backup", "ls-history", "sefaz-go-baseline"))
    parser.add_argument("--input", type=Path)
    parser.add_argument("--target-slug", required=True)
    parser.add_argument("--batch-id", required=True)
    parser.add_argument("--snapshot-at")
    parser.add_argument("--planning-id", default="119790")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true")
    mode.add_argument("--commit", action="store_true")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    if args.format != "sefaz-go-baseline" and args.input is None:
        raise SystemExit("--input is required for this format")
    settings = StudyOsSettings.from_environment()
    connection = connect_database(settings.database_path)
    try:
        file_hash = None
        if args.format == "sefaz-go-baseline":
            _config, subjects = SprintProfileService(connection).bootstrap(args.target_slug)
            observations = sefaz_go_baseline_observations(subjects)
        else:
            raw = args.input.read_bytes()
            file_hash = hashlib.sha256(raw).hexdigest()
            document = json.loads(raw.decode("utf-8"))
            if args.format == "diario-backup":
                if not args.snapshot_at:
                    raise SystemExit("--snapshot-at is required for Diario backup")
                snapshot = datetime.fromisoformat(args.snapshot_at.replace("Z", "+00:00"))
                observations = observations_from_diario_backup(
                    document, args.target_slug, snapshot
                )
            else:
                observations = observations_from_ls_history(
                    document, args.target_slug, args.planning_id
                )
        payloads = []
        for observation in observations:
            payload = observation.to_payload()
            if file_hash:
                payload["provenance"] = dict(payload["provenance"]) | {
                    "importFileSha256": file_hash
                }
            payloads.append(payload)
        if not payloads:
            raise SystemExit("adapter produced no aggregate observations")
        report = SprintEvidenceService(connection).import_batch(
            {
                "targetSlug": args.target_slug,
                "batchId": args.batch_id,
                "origin": args.format.replace("-", "_"),
                "dryRun": not args.commit,
                "observations": payloads,
            }
        )
        print(json.dumps(report, ensure_ascii=True, sort_keys=True))
        return 0 if report["conflictCount"] == 0 else 2
    finally:
        connection.close()


if __name__ == "__main__":
    sys.exit(main())
