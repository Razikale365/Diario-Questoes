from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal, Mapping
from urllib.parse import urlparse


DownloadStatus = Literal["candidate", "selected", "downloaded", "validated"]
AcquisitionMethod = Literal["estrategia_downloader"]

_DOWNLOAD_STATUSES = {"candidate", "selected", "downloaded", "validated"}
_DOWNLOADED_STATES = {"downloaded", "validated"}


def _optional_text(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    return normalized or None


def _utc_datetime(value: datetime | None, field: str, *, required: bool) -> datetime | None:
    if value is None:
        if required:
            raise ValueError(f"{field} is required")
        return None
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{field} must be timezone-aware")
    return value.astimezone(UTC)


def _parse_datetime(value: Any, field: str) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(f"{field} must be an ISO 8601 datetime") from exc


def _required_mapping_text(value: Mapping[str, Any], key: str, label: str) -> str:
    raw = value.get(key)
    if not isinstance(raw, str) or not raw.strip():
        raise ValueError(f"{label} is required")
    return raw


def _validate_count(value: int | None, field: str) -> None:
    if value is not None and (
        isinstance(value, bool) or not isinstance(value, int) or value < 0
    ):
        raise ValueError(f"{field} must be a non-negative integer")


@dataclass(frozen=True, slots=True)
class CoursePackageChoice:
    target_slug: str
    provider: str
    package_name: str
    package_id: str | None
    package_url: str
    edition_note: str
    acquisition_method: AcquisitionMethod
    root_path: Path | None
    download_status: DownloadStatus
    downloader_name: str | None
    downloader_version: str | None
    acquisition_id: str | None
    catalog_checked_at: datetime
    download_started_at: datetime | None
    downloaded_at: datetime | None
    acquisition_manifest_path: Path | None
    expected_file_count: int | None
    observed_file_count: int | None
    failed_item_count: int | None

    def __post_init__(self) -> None:
        normalized_strings = {
            "target_slug": self.target_slug.strip(),
            "provider": self.provider.strip(),
            "package_name": self.package_name.strip(),
            "package_url": self.package_url.strip(),
            "edition_note": self.edition_note.strip(),
        }
        for field, value in normalized_strings.items():
            object.__setattr__(self, field, value)

        if not self.target_slug:
            raise ValueError("target is required")
        if not self.provider:
            raise ValueError("provider is required")
        if not self.package_name:
            raise ValueError("package name is required")

        parsed_url = urlparse(self.package_url)
        if parsed_url.scheme not in {"http", "https"} or not parsed_url.netloc:
            raise ValueError("package URL must be HTTP or HTTPS")
        if self.acquisition_method != "estrategia_downloader":
            raise ValueError("acquisition method must be estrategia_downloader")
        if self.download_status not in _DOWNLOAD_STATUSES:
            raise ValueError("invalid download status")

        for field, value in (
            ("expected file count", self.expected_file_count),
            ("observed file count", self.observed_file_count),
            ("failed item count", self.failed_item_count),
        ):
            _validate_count(value, field)

        for field in (
            "package_id",
            "downloader_name",
            "downloader_version",
            "acquisition_id",
        ):
            object.__setattr__(self, field, _optional_text(getattr(self, field)))

        catalog_checked_at = _utc_datetime(
            self.catalog_checked_at, "catalog check time", required=True
        )
        object.__setattr__(self, "catalog_checked_at", catalog_checked_at)

        root = None if self.root_path is None else Path(self.root_path).expanduser().resolve()
        object.__setattr__(self, "root_path", root)
        manifest = (
            None
            if self.acquisition_manifest_path is None
            else Path(self.acquisition_manifest_path).expanduser().resolve()
        )
        object.__setattr__(self, "acquisition_manifest_path", manifest)

        if self.download_status not in _DOWNLOADED_STATES:
            return

        if root is None or not root.is_dir():
            raise ValueError("downloaded package requires an existing directory")
        required_text = (
            ("package id", self.package_id),
            ("downloader name", self.downloader_name),
            ("downloader version", self.downloader_version),
            ("acquisition id", self.acquisition_id),
        )
        for label, value in required_text:
            if not value:
                raise ValueError(f"downloaded package requires a {label}")

        download_started_at = _utc_datetime(
            self.download_started_at, "download start time", required=True
        )
        downloaded_at = _utc_datetime(
            self.downloaded_at, "download completion time", required=True
        )
        object.__setattr__(self, "download_started_at", download_started_at)
        object.__setattr__(self, "downloaded_at", downloaded_at)
        if download_started_at < catalog_checked_at:
            raise ValueError("download start time must be after the catalog check")
        if downloaded_at < download_started_at:
            raise ValueError("download completion time must be after the start time")

        required_counts = (
            ("expected file count", self.expected_file_count),
            ("observed file count", self.observed_file_count),
            ("failed item count", self.failed_item_count),
        )
        for label, value in required_counts:
            if value is None:
                raise ValueError(f"downloaded package requires an {label}")

        canonical_manifest = (root / ".study-os-download.json").resolve()
        if manifest is None:
            raise ValueError("downloaded package requires a fresh acquisition manifest")
        try:
            manifest.relative_to(root)
        except ValueError as exc:
            raise ValueError("acquisition manifest must be inside the package root") from exc
        if manifest != canonical_manifest:
            raise ValueError("acquisition manifest must be root/.study-os-download.json")
        if not manifest.is_file():
            raise ValueError("downloaded package requires a fresh acquisition manifest")

        if self.download_status == "validated":
            if self.expected_file_count != self.observed_file_count:
                raise ValueError("validated package file counts must match")
            if self.failed_item_count != 0:
                raise ValueError("validated package requires zero failed items")

        pdf_files = [
            path
            for path in root.rglob("*")
            if path.is_file() and path.suffix.casefold() == ".pdf"
        ]
        if len(pdf_files) != self.observed_file_count:
            raise ValueError("observed file count does not match the real filesystem")
        for pdf_path in pdf_files:
            modified_at = datetime.fromtimestamp(pdf_path.stat().st_mtime, tz=UTC)
            if modified_at < download_started_at:
                raise ValueError(f"downloaded PDF predates the acquisition: {pdf_path.name}")

        self._validate_manifest(manifest)

    def _validate_manifest(self, path: Path) -> None:
        try:
            manifest = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise ValueError("fresh acquisition manifest must contain valid JSON") from exc
        if not isinstance(manifest, Mapping):
            raise ValueError("fresh acquisition manifest must contain a JSON object")

        expected_values = {
            "packageId": self.package_id,
            "acquisitionId": self.acquisition_id,
            "downloaderName": self.downloader_name,
            "downloaderVersion": self.downloader_version,
            "expectedFileCount": self.expected_file_count,
            "observedFileCount": self.observed_file_count,
            "failedItemCount": self.failed_item_count,
        }
        for key, expected in expected_values.items():
            if manifest.get(key) != expected:
                raise ValueError(f"acquisition manifest {key} does not match the package record")

        manifest_times = {
            "catalogCheckedAt": self.catalog_checked_at,
            "downloadStartedAt": self.download_started_at,
            "downloadedAt": self.downloaded_at,
        }
        for key, expected in manifest_times.items():
            parsed = _utc_datetime(_parse_datetime(manifest.get(key), key), key, required=True)
            if parsed != expected:
                raise ValueError(f"acquisition manifest {key} does not match the package record")

    def to_dict(self) -> dict[str, Any]:
        return {
            "targetSlug": self.target_slug,
            "provider": self.provider,
            "packageName": self.package_name,
            "packageId": self.package_id,
            "packageUrl": self.package_url,
            "editionNote": self.edition_note,
            "acquisitionMethod": self.acquisition_method,
            "rootPath": str(self.root_path) if self.root_path else None,
            "downloadStatus": self.download_status,
            "downloaderName": self.downloader_name,
            "downloaderVersion": self.downloader_version,
            "acquisitionId": self.acquisition_id,
            "catalogCheckedAt": self.catalog_checked_at.isoformat(),
            "downloadStartedAt": (
                self.download_started_at.isoformat() if self.download_started_at else None
            ),
            "downloadedAt": self.downloaded_at.isoformat() if self.downloaded_at else None,
            "acquisitionManifestPath": (
                str(self.acquisition_manifest_path) if self.acquisition_manifest_path else None
            ),
            "expectedFileCount": self.expected_file_count,
            "observedFileCount": self.observed_file_count,
            "failedItemCount": self.failed_item_count,
        }

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> "CoursePackageChoice":
        target_slug = _required_mapping_text(value, "targetSlug", "target")
        provider = _required_mapping_text(value, "provider", "provider")
        package_name = _required_mapping_text(value, "packageName", "package name")
        package_url = _required_mapping_text(value, "packageUrl", "package URL")
        root_value = value.get("rootPath")
        manifest_value = value.get("acquisitionManifestPath")
        return cls(
            target_slug=target_slug,
            provider=provider,
            package_name=package_name,
            package_id=(
                str(value["packageId"]) if value.get("packageId") is not None else None
            ),
            package_url=package_url,
            edition_note=str(value.get("editionNote") or ""),
            acquisition_method=value.get("acquisitionMethod"),
            root_path=Path(str(root_value)) if root_value else None,
            download_status=value.get("downloadStatus"),
            downloader_name=(
                str(value["downloaderName"])
                if value.get("downloaderName") is not None
                else None
            ),
            downloader_version=(
                str(value["downloaderVersion"])
                if value.get("downloaderVersion") is not None
                else None
            ),
            acquisition_id=(
                str(value["acquisitionId"])
                if value.get("acquisitionId") is not None
                else None
            ),
            catalog_checked_at=_parse_datetime(
                value.get("catalogCheckedAt"), "catalog check time"
            ),
            download_started_at=_parse_datetime(
                value.get("downloadStartedAt"), "download start time"
            ),
            downloaded_at=_parse_datetime(value.get("downloadedAt"), "download completion time"),
            acquisition_manifest_path=(
                Path(str(manifest_value)) if manifest_value else None
            ),
            expected_file_count=value.get("expectedFileCount"),
            observed_file_count=value.get("observedFileCount"),
            failed_item_count=value.get("failedItemCount"),
        )
