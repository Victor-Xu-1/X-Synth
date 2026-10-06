"""Private template compilation; existing data and manifests are never replaced."""

from __future__ import annotations

import json
import os
import sqlite3
import tempfile
from contextlib import closing
from pathlib import Path

from packages.platform.immutable_sqlite import ImmutableSQLite, file_identity
from .template_models import DEFAULT_TEMPLATE_STRATEGIES, _normalise_template_record
from .template_schema import _create_template_schema, _insert_template_record, validate_template_schema
from .template_sources import (
    count_template_records, infer_template_direction, infer_template_domain,
    infer_template_source_name, iter_template_records, sha256_file,
)
from .template_statistics import TemplateStatistics, read_summary, store_summary

MANIFEST_NAME = "template_library_manifest.json"


def _check_output(output, names):
    if output.is_symlink():
        raise ValueError("Template output directory cannot be a symlink")
    for name in names:
        path = output / name
        if path.exists() or path.is_symlink():
            raise FileExistsError("Template snapshots and manifests are immutable")


def _publish_files(staging, output, names):
    _check_output(output, names)
    existed = output.exists()
    output.mkdir(parents=True, exist_ok=True)
    published = []
    try:
        for name in names:
            source, target = staging / name, output / name
            os.chmod(source, 0o444)
            os.link(source, target)
            published.append((target, file_identity(target)))
    except BaseException:
        for target, identity in reversed(published):
            if target.exists() and file_identity(target) == identity:
                target.unlink()
        if not existed and not any(output.iterdir()):
            output.rmdir()
        raise


def _manifest(paths, version):
    sources, identities = {}, {}
    for path in paths:
        name = infer_template_source_name(path)
        if name in sources:
            raise ValueError("Template source namespaces must be distinct")
        identities[path] = file_identity(path)
        sources[name] = {
            "path": str(path), "template_count": count_template_records(path),
            "sha256": sha256_file(path), "direction": infer_template_direction(path),
            "domain": infer_template_domain(path),
        }
        if file_identity(path) != identities[path]:
            raise ValueError("Template source changed during compilation")
    names = sorted(sources)
    manifest = {
        "version": version,
        "total_templates": sum(entry["template_count"] for entry in sources.values()),
        "sources": sources,
        "artifacts": {
            "askcos": {
                "source_count": len(names), "sources": names,
                "format": "askcos.retro.templates.json.gz",
                "status": "knowledge_only_not_a_trained_model_index",
            },
            "aizynthfinder": {
                "source_count": len(names), "sources": names,
                "format": "aizynthfinder.policy.templates",
                "status": "manifest_only_compile_step_required",
            },
            "retrosim": {
                "source_count": len(names), "sources": names,
                "format": "retrosim.template_similarity_index",
                "status": "manifest_only_compile_step_required",
            },
        },
    }
    return manifest, identities


def _write_manifest(staging, manifest):
    with (staging / MANIFEST_NAME).open("x", encoding="utf-8") as handle:
        json.dump(manifest, handle, ensure_ascii=False, indent=2)
        handle.flush()
        os.fsync(handle.fileno())


def build_template_library_manifest(*, source_paths, output_dir, version):
    output = Path(output_dir).absolute()
    _check_output(output, (MANIFEST_NAME,))
    manifest, _ = _manifest([Path(path) for path in source_paths], version)
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".template-library-", dir=output.parent) as name:
        staging = Path(name)
        _write_manifest(staging, manifest)
        _publish_files(staging, output, (MANIFEST_NAME,))
    return manifest


def build_template_library_database(
    *, source_paths, output_dir, version, database_name="template_library.sqlite",
):
    if Path(database_name).name != database_name or database_name in {"", ".", "..", MANIFEST_NAME}:
        raise ValueError("Template database name must be a distinct plain filename")
    output = Path(output_dir).absolute()
    names = (database_name, MANIFEST_NAME)
    _check_output(output, names)
    paths = [Path(path) for path in source_paths]
    if not paths:
        raise ValueError("Template source files are required")
    manifest, identities = _manifest(paths, version)
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".template-library-", dir=output.parent) as name:
        staging = Path(name)
        database = staging / database_name
        statistics, skipped = TemplateStatistics(), 0
        with closing(sqlite3.connect(database)) as connection:
            _create_template_schema(connection)
            for source, entry in manifest["sources"].items():
                connection.execute("INSERT INTO template_sources VALUES (?,?,?,?,?,?)", (
                    source, entry["path"], entry["template_count"], entry["sha256"],
                    entry["direction"], entry["domain"],
                ))
            for path in paths:
                source = infer_template_source_name(path)
                entry = manifest["sources"][source]
                for raw in iter_template_records(path):
                    record = _normalise_template_record(
                        raw=raw, source=source, source_path=path,
                        direction=entry["direction"], domain=entry["domain"],
                    )
                    if record is None:
                        skipped += 1
                        continue
                    _insert_template_record(connection, record)
                    statistics.add(record.source, record.direction, record.domain, record.count)
                if file_identity(path) != identities[path]:
                    raise ValueError("Template source changed during compilation")
            store_summary(connection, statistics.summary(manifest["sources"]))
            connection.commit()
            if connection.execute("PRAGMA quick_check").fetchone() != ("ok",):
                raise ValueError("Compiled template index integrity check failed")
        snapshot = ImmutableSQLite(database)
        with snapshot.connect() as connection:
            validate_template_schema(connection)
            read_summary(connection)
        manifest["database"] = {
            "path": str(output / database_name), "format": "sqlite",
            "template_count": statistics.total, "skipped_records": skipped,
            "service": "TemplateLibraryService",
            "strategies": sorted(DEFAULT_TEMPLATE_STRATEGIES),
        }
        _write_manifest(staging, manifest)
        snapshot.check()
        for path, identity in identities.items():
            if file_identity(path) != identity:
                raise ValueError("Template source changed before publication")
        _publish_files(staging, output, names)
    return manifest
