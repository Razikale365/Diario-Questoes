from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal, Mapping
from urllib.parse import urlparse


DownloadStatus = Literal["candidate", "selected", "downloaded", "validated"]
AcquisitionMethod = Literal["estrategia_downloader"]

_DOWNLOAD_STATUSES = {"candidate", "selected", "downloaded", "validated"}


@dataclass(frozen=True, slots=True)
class CoursePackageChoice:
    target_slug: str
    provider: str
    package_name: str
    package_url: str
    edition_note: str
    acquisition_method: AcquisitionMethod
    root_path: Path | None
    download_status: DownloadStatus
    downloader_version: str | None
    downloaded_at: datetime | None
    expected_file_count: int | None

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
        if self.expected_file_count is not None and (
            isinstance(self.expected_file_count, bool)
            or not isinstance(self.expected_file_count, int)
            or self.expected_file_count < 0
        ):
            raise ValueError("expected file count must be a non-negative integer")

        root = None if self.root_path is None else Path(self.root_path).expanduser().resolve()
        object.__setattr__(self, "root_path", root)
        version = self.downloader_version.strip() if self.downloader_version else None
        object.__setattr__(self, "downloader_version", version)

        if self.download_status in {"downloaded", "validated"}:
            if root is None or not root.is_dir():
                raise ValueError("downloaded package requires an existing directory")
            if not version:
                raise ValueError("downloaded package requires a downloader version")
            if self.downloaded_at is None:
                raise ValueError("downloaded package requires a completion time")
            if self.downloaded_at.tzinfo is None or self.downloaded_at.utcoffset() is None:
                raise ValueError("download completion time must be timezone-aware")
            object.__setattr__(self, "downloaded_at", self.downloaded_at.astimezone(UTC))

        if self.download_status == "validated" and self.expected_file_count is None:
            raise ValueError("validated package requires an observed file count")

    def to_dict(self) -> dict[str, Any]:
        return {
            "targetSlug": self.target_slug,
            "provider": self.provider,
            "packageName": self.package_name,
            "packageUrl": self.package_url,
            "editionNote": self.edition_note,
            "acquisitionMethod": self.acquisition_method,
            "rootPath": str(self.root_path) if self.root_path else None,
            "downloadStatus": self.download_status,
            "downloaderVersion": self.downloader_version,
            "downloadedAt": self.downloaded_at.isoformat() if self.downloaded_at else None,
            "expectedFileCount": self.expected_file_count,
        }

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> "CoursePackageChoice":
        downloaded_at_value = value.get("downloadedAt")
        downloaded_at = None
        if isinstance(downloaded_at_value, datetime):
            downloaded_at = downloaded_at_value
        elif downloaded_at_value is not None:
            downloaded_at = datetime.fromisoformat(str(downloaded_at_value).replace("Z", "+00:00"))

        root_value = value.get("rootPath")
        return cls(
            target_slug=str(value.get("targetSlug", "")),
            provider=str(value.get("provider", "")),
            package_name=str(value.get("packageName", "")),
            package_url=str(value.get("packageUrl", "")),
            edition_note=str(value.get("editionNote", "")),
            acquisition_method=value.get("acquisitionMethod"),
            root_path=Path(str(root_value)) if root_value else None,
            download_status=value.get("downloadStatus"),
            downloader_version=(
                str(value["downloaderVersion"])
                if value.get("downloaderVersion") is not None
                else None
            ),
            downloaded_at=downloaded_at,
            expected_file_count=value.get("expectedFileCount"),
        )
