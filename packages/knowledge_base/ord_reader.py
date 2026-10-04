"""Validate the public ORD manifest and bind read-only, content-addressed inputs."""

from __future__ import annotations

import hashlib
import ipaddress
import json
import re
from collections import Counter
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from urllib.parse import urlsplit

ORD_REPOSITORY = "https://github.com/open-reaction-database/ord-data"
ORD_MIRROR = "https://huggingface.co/datasets/open-reaction-database/ord-data"
ORD_LICENSE = "CC-BY-SA-4.0"
_SOURCE_PATH = re.compile(r"data/([a-f0-9]{2})/ord_dataset-([a-f0-9]{32})\.parquet")
_SHA256 = re.compile(r"[a-f0-9]{64}")
_REVISION = re.compile(r"[a-f0-9]{40}")


class OrdRecordError(ValueError):
    """An explicitly rejected record, not an absent or successful experiment."""

    def __init__(self, code: str, detail: str = ""):
        self.code = code
        super().__init__(detail or code)


class OrdSourceError(ValueError):
    def __init__(self, issues: list[dict]):
        self.issues = issues
        self.reason_counts = dict(Counter(item["reason"] for item in issues))
        super().__init__("ORD source validation failed: " + str(self.reason_counts))


def validate_source_identity(source_path: str, sha256: str, revision: str) -> str:
    match = _SOURCE_PATH.fullmatch(source_path)
    if match is None or match[1] != match[2][:2]:
        raise ValueError("ORD source_path must identify an official Parquet dataset")
    if not _SHA256.fullmatch(sha256) or not _REVISION.fullmatch(revision):
        raise ValueError(
            "ORD source identity requires SHA256 and a pinned Git revision"
        )
    return match[2]


def official_source_url(source_path: str, revision: str) -> str:
    return f"{ORD_MIRROR}/blob/{revision}/{source_path}"


def public_publication_url(value: str) -> str | None:
    if not value:
        return None
    try:
        parsed = urlsplit(value)
        host = parsed.hostname or ""
        if (
            parsed.scheme not in ("https", "http")
            or parsed.username
            or parsed.password
            or not host
        ):
            raise ValueError("unsafe URL")
        try:
            address = ipaddress.ip_address(host)
        except ValueError:
            if "." not in host or host.endswith(
                (".local", ".localhost", ".internal", ".test", ".example", ".lan")
            ):
                raise ValueError("nonpublic host")
        else:
            if not address.is_global:
                raise ValueError("nonpublic address")
        if parsed.port is not None and not 0 < parsed.port <= 65535:
            raise ValueError("invalid port")
    except ValueError as exc:
        raise OrdRecordError("unsafe_publication_url") from exc
    return value


def file_fingerprint(path: Path) -> tuple[int, int, int, int, int]:
    info = path.stat()
    return info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns


@dataclass(frozen=True)
class VerifiedOrdSource:
    local_path: Path
    path: str
    size: int
    sha256: str
    revision: str
    url: str
    fingerprint: tuple[int, int, int, int, int]

    def check_unchanged(self) -> None:
        if file_fingerprint(self.local_path) != self.fingerprint:
            raise OrdSourceError([{"path": self.path, "reason": "source_changed"}])

    def as_source(self) -> dict:
        return {
            "source": "ORD",
            "repository": ORD_REPOSITORY,
            "mirror": ORD_MIRROR,
            "revision_repository": ORD_MIRROR,
            "revision": self.revision,
            "license": ORD_LICENSE,
            "path": self.path,
            "size": self.size,
            "sha256": self.sha256,
            "url": official_source_url(self.path, self.revision),
            "download_url": self.url,
        }


def _local_path(root: Path, source_path: str) -> Path:
    candidates = [
        root / PurePosixPath(source_path),
        root / PurePosixPath(source_path).name,
    ]
    existing = []
    for path in candidates:
        if path.exists():
            resolved = path.resolve()
            if not resolved.is_relative_to(root) or not resolved.is_file():
                raise ValueError("unsafe_source_path")
            existing.append(resolved)
    if not existing:
        raise FileNotFoundError(source_path)
    if len(set(existing)) != 1:
        raise ValueError("ambiguous_source_path")
    return existing[0]


def _verify_file(root: Path, entry: dict, revision: str) -> VerifiedOrdSource:
    path, sha256, size = entry.get("path"), entry.get("sha256"), entry.get("size")
    if not isinstance(path, str) or not isinstance(sha256, str):
        raise ValueError("invalid_source_identity")
    validate_source_identity(path, sha256, revision)
    if type(size) is not int or size <= 0:
        raise ValueError("invalid_source_size")
    official_urls = {
        official_source_url(path, revision),
        f"{ORD_REPOSITORY}/blob/{revision}/{path}",
        f"{ORD_MIRROR}/resolve/{revision}/{path}",
        f"https://raw.githubusercontent.com/open-reaction-database/ord-data/{revision}/{path}",
    }
    if entry.get("url") not in official_urls:
        raise ValueError("untrusted_source_url")
    local = _local_path(root, path)
    fingerprint = file_fingerprint(local)
    if fingerprint[2] != size:
        raise ValueError("source_size_mismatch")
    with local.open("rb") as handle:
        digest = hashlib.file_digest(handle, "sha256").hexdigest()
    if file_fingerprint(local) != fingerprint:
        raise ValueError("source_changed")
    if digest != sha256:
        raise ValueError("source_sha256_mismatch")
    return VerifiedOrdSource(
        local, path, size, sha256, revision, entry["url"], fingerprint
    )


def verify_ord_sources(
    manifest_path: Path, source_dir: Path
) -> list[VerifiedOrdSource]:
    """Verify every declared file before allowing any record to reach the compiler."""
    root = source_dir.resolve(strict=True)
    if not root.is_dir():
        raise ValueError("ORD source directory is not a directory")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
    if not isinstance(manifest, dict) or (
        manifest.get("source") != "ORD"
        or manifest.get("repository") != ORD_REPOSITORY
        or manifest.get("mirror") != ORD_MIRROR
        or manifest.get("license") != ORD_LICENSE
        or not isinstance(manifest.get("revision"), str)
        or not _REVISION.fullmatch(manifest["revision"])
    ):
        raise OrdSourceError(
            [{"path": "manifest", "reason": "invalid_manifest_identity"}]
        )
    entries = manifest.get("files")
    if not isinstance(entries, list) or not entries:
        raise OrdSourceError([{"path": "manifest", "reason": "empty_manifest"}])
    verified, issues, seen = [], [], set()
    for entry in entries:
        path = entry.get("path") if isinstance(entry, dict) else None
        try:
            if not isinstance(entry, dict):
                raise ValueError("invalid_source_entry")
            if not isinstance(path, str):
                raise ValueError("invalid_source_identity")
            if path in seen:
                raise ValueError("duplicate_source_path")
            seen.add(path)
            verified.append(_verify_file(root, entry, manifest["revision"]))
        except (OSError, ValueError, TypeError) as exc:
            reason = (
                "missing_source_file"
                if isinstance(exc, FileNotFoundError)
                else str(exc)
            )
            issues.append({"path": path, "reason": reason})
    if issues:
        raise OrdSourceError(issues)
    return sorted(verified, key=lambda item: item.path)
