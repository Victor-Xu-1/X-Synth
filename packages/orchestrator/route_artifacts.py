"""Immutable files become visible only through a committed job publication pointer."""

import hashlib
import json
import os
import tempfile
from pathlib import Path

from packages.platform.atomic_file import write_json

from .route_artifact_manifest import (
    FILES, JOB_ID, SCHEMA, RouteArtifactError,
    publication_id, validate_manifest, validate_selected,
)

MANIFEST_LIMIT = 64 * 1024


def _digest(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _read(path, *, limit, descriptor=None, expected_digest=None):
    if not path.is_file() or path.is_symlink():
        raise RouteArtifactError("Published result artifact is unavailable")
    with path.open("rb") as stream:
        raw = stream.read(limit + 1)
    if len(raw) > limit:
        raise RouteArtifactError("Result exceeds the response budget", oversized=True)
    if descriptor and (
        descriptor["bytes"] != len(raw)
        or descriptor["sha256"] != hashlib.sha256(raw).hexdigest()
    ):
        raise RouteArtifactError("Published result artifact identity changed")
    if expected_digest and hashlib.sha256(raw).hexdigest() != expected_digest:
        raise RouteArtifactError("Published result manifest identity changed")
    try:
        return json.loads(raw)
    except (ValueError, UnicodeError) as exc:
        raise RouteArtifactError("Published result artifact is invalid") from exc


def _sync_directory(path):
    if os.name == "posix":
        descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)


class RouteArtifactStore:
    def __init__(self, root):
        self.root = Path(root).resolve()

    def _directory(self, identifier):
        if not isinstance(identifier, str) or not JOB_ID.fullmatch(identifier):
            raise RouteArtifactError("Invalid published job identity")
        return self.root / identifier / "results"

    def stage(self, identifier, *, all_routes, selected_routes, summary):
        validate_selected(identifier, selected_routes, summary)
        root = self._directory(identifier)
        root.mkdir(parents=True, exist_ok=True, mode=0o700)
        with tempfile.TemporaryDirectory(prefix="staging-", dir=root) as temporary:
            directory = Path(temporary)
            values = dict(zip(FILES, (all_routes, selected_routes, summary), strict=True))
            for filename, value in values.items():
                write_json(directory / filename, value, sort_keys=True)
            manifest = {
                "schema_version": SCHEMA, "job_id": identifier,
                "target_smiles": summary["target_key"],
                "files": {name: {"sha256": _digest(directory / name),
                                 "bytes": (directory / name).stat().st_size} for name in FILES},
            }
            manifest_path = directory / "manifest.json"
            write_json(manifest_path, manifest, sort_keys=True)
            identifier_hash = _digest(manifest_path)
            destination = root / identifier_hash
            if destination.exists():
                if destination.is_symlink():
                    raise RouteArtifactError("Invalid existing result generation")
                if _digest(destination / "manifest.json") != identifier_hash:
                    raise RouteArtifactError("Existing result manifest changed")
                for name, descriptor in manifest["files"].items():
                    path = destination / name
                    if path.is_symlink() or path.stat().st_size != descriptor["bytes"] or _digest(path) != descriptor["sha256"]:
                        raise RouteArtifactError("Existing result artifact changed")
            else:
                directory.rename(destination)
                _sync_directory(root)
        return {"schema_version": SCHEMA, "snapshot_id": identifier_hash}

    def read(self, job, *, limit):
        checkpoint = job.get("checkpoint") or {}
        schema = checkpoint.get("result_artifact_schema")
        if schema is not None and (type(schema) is not int or schema != SCHEMA):
            raise RouteArtifactError("Unsupported result artifact schema")
        pointer = checkpoint.get("published_result")
        if pointer is None:
            return [] if schema == SCHEMA else None
        generation_id = publication_id(pointer)
        directory = self._directory(job["id"]) / generation_id
        if directory.is_symlink():
            raise RouteArtifactError("Invalid result generation directory")
        manifest_path = directory / "manifest.json"
        manifest = _read(manifest_path, limit=MANIFEST_LIMIT, expected_digest=generation_id)
        manifest = validate_manifest(manifest, job["id"])
        if manifest["target_smiles"] != job["request"]["smiles"]:
            raise RouteArtifactError("Published result target changed")
        descriptors = manifest["files"]
        total_bytes = sum(descriptors[name]["bytes"] for name in ("selected_routes.json", "summary.json"))
        if total_bytes > limit:
            raise RouteArtifactError("Result exceeds the response budget", oversized=True)
        summary = _read(directory / "summary.json", limit=limit, descriptor=descriptors["summary.json"])
        if summary != job.get("summary"):
            raise RouteArtifactError("Published summary and job commit disagree")
        selected = _read(directory / "selected_routes.json", limit=limit, descriptor=descriptors["selected_routes.json"])
        validate_selected(job["id"], selected, summary)
        return selected
