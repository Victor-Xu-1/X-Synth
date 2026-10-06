"""SQLite/compiler controls based on public RDKit syntax, not a model provider."""

import json
import os
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing, contextmanager
from pathlib import Path

import pytest

from packages.knowledge_base import template_build, template_library
from packages.knowledge_base.template_library import TemplateLibraryService, build_template_library_database
from packages.knowledge_base.template_models import DEFAULT_TEMPLATE_STRATEGIES
from packages.platform import environment_dependencies
from packages.platform.immutable_sqlite import ImmutableSQLite, ImmutableSQLiteError
from test_template_contract_data import PUBLIC_SMARTS


def source(path, count=2, duplicate=False):
    records = [{
        "_id": f"example-{0 if duplicate else index}", "index": index,
        "reaction_smarts": PUBLIC_SMARTS[index % len(PUBLIC_SMARTS)],
        "count": 1 if index == 0 else 3,
        "attributes": {"interface_fixture": True},
    } for index in range(count)]
    path.write_text("".join(json.dumps(row) + "\n" for row in records), encoding="utf-8")
    return path


def compile_library(tmp_path, *, count=2, name="compiled"):
    input_path = source(tmp_path / f"retro.templates.{name}_pistachio.jsonl", count)
    output = tmp_path / name
    manifest = build_template_library_database(
        source_paths=[input_path], output_dir=output, version="interface-fixture"
    )
    return Path(manifest["database"]["path"])


def test_private_compilation_stores_exact_statistics_without_renumbering(tmp_path):
    input_path = source(tmp_path / "retro.templates.pistachio.jsonl")
    output = tmp_path / "compiled"
    manifest = build_template_library_database(
        source_paths=[input_path], output_dir=output, version="interface-fixture"
    )
    path = Path(manifest["database"]["path"])
    service = TemplateLibraryService(path)
    summary = service.summary()
    assert summary["template_count"] == 2
    assert summary["strategy_availability"]["high_precision"]["template_count"] == 1
    for name in DEFAULT_TEMPLATE_STRATEGIES:
        assert summary["strategy_availability"][name]["template_count"] == len(
            service.query_templates(strategy=name)
        )
    for index in range(2):
        row = service.get_template(source="pistachio", template_id=f"pistachio:example-{index}")
        assert row.raw["index"] == index
    assert path.stat().st_mode & 0o222 == 0
    assert (output / template_build.MANIFEST_NAME).stat().st_mode & 0o222 == 0
    assert manifest["artifacts"]["askcos"]["status"] == "knowledge_only_not_a_trained_model_index"


@pytest.mark.parametrize("existing", ["template_library.sqlite", "template_library_manifest.json"])
def test_compiler_does_not_touch_existing_destinations_or_read_sources(tmp_path, existing, monkeypatch):
    output = tmp_path / "compiled"
    output.mkdir()
    asset = output / existing
    asset.write_bytes(b"another-owner-output")

    def forbidden(*args):
        raise AssertionError("Existing destinations must be rejected before reading source bytes")

    monkeypatch.setattr(template_build, "_manifest", forbidden)
    with pytest.raises(FileExistsError):
        build_template_library_database(
            source_paths=[tmp_path / "missing.jsonl"], output_dir=output, version="fixture"
        )
    assert asset.read_bytes() == b"another-owner-output"
    assert list(output.iterdir()) == [asset]


def test_compiler_insert_failure_leaves_destination_absent(tmp_path):
    input_path = source(tmp_path / "retro.templates.pistachio.jsonl", duplicate=True)
    with pytest.raises(sqlite3.IntegrityError):
        build_template_library_database(
            source_paths=[input_path], output_dir=tmp_path / "compiled", version="fixture"
        )
    assert not (tmp_path / "compiled").exists()
    assert not list(tmp_path.glob(".template-library-*"))


def test_private_database_drift_after_validation_cannot_be_published(tmp_path, monkeypatch):
    input_path = source(tmp_path / "retro.templates.pistachio.jsonl")
    original = template_build._write_manifest

    def changed(staging, manifest):
        original(staging, manifest)
        with closing(sqlite3.connect(staging / "template_library.sqlite")) as connection:
            connection.execute("DROP INDEX idx_templates_direction_count")
            connection.commit()

    monkeypatch.setattr(template_build, "_write_manifest", changed)
    with pytest.raises(ImmutableSQLiteError, match="identity changed"):
        build_template_library_database(
            source_paths=[input_path], output_dir=tmp_path / "compiled", version="fixture"
        )
    assert not (tmp_path / "compiled").exists()


def test_manifest_link_failure_rolls_back_only_own_new_database(tmp_path, monkeypatch):
    input_path = source(tmp_path / "retro.templates.pistachio.jsonl")
    output = tmp_path / "compiled"
    output.mkdir()
    retained = output / "retained.txt"
    retained.write_bytes(b"unrelated-output")
    original = os.link

    def fail_manifest(source, target):
        if Path(target).name == template_build.MANIFEST_NAME:
            raise OSError("link-fault-control")
        return original(source, target)

    monkeypatch.setattr(template_build.os, "link", fail_manifest)
    with pytest.raises(OSError, match="link-fault"):
        build_template_library_database(
            source_paths=[input_path], output_dir=output, version="fixture"
        )
    assert list(output.iterdir()) == [retained]
    assert retained.read_bytes() == b"unrelated-output"
    assert not list(tmp_path.glob(".template-library-*"))


def test_compiler_rejects_duplicate_source_namespaces_and_path_traversal(tmp_path):
    first = source(tmp_path / "retro.templates.pistachio.jsonl")
    nested = tmp_path / "nested"
    nested.mkdir()
    second = source(nested / first.name)
    with pytest.raises(ValueError, match="namespaces"):
        build_template_library_database(
            source_paths=[first, second], output_dir=tmp_path / "compiled", version="fixture"
        )
    with pytest.raises(ValueError, match="filename"):
        build_template_library_database(
            source_paths=[first], output_dir=tmp_path / "compiled",
            version="fixture", database_name="../escape.sqlite",
        )


def test_summary_never_reads_template_rows_when_statistics_are_persisted(tmp_path, monkeypatch):
    service = TemplateLibraryService(compile_library(tmp_path))
    original = ImmutableSQLite.connect

    @contextmanager
    def limited(snapshot, **kwargs):
        with original(snapshot, **kwargs) as connection:
            connection.set_authorizer(lambda operation, table, *_: (
                sqlite3.SQLITE_DENY
                if operation == sqlite3.SQLITE_READ and table == "templates"
                else sqlite3.SQLITE_OK
            ))
            yield connection

    monkeypatch.setattr(ImmutableSQLite, "connect", limited)
    assert service.summary()["template_count"] == 2
    with ThreadPoolExecutor(max_workers=4) as pool:
        assert all(value["template_count"] == 2 for value in pool.map(
            lambda _: service.summary(), range(16)
        ))


def test_large_legacy_summary_is_bounded_but_exact_detail_remains_available(tmp_path):
    path = compile_library(tmp_path, count=1025)
    path.chmod(0o644)
    with closing(sqlite3.connect(path)) as connection:
        connection.execute("DROP TABLE template_metadata")
        connection.commit()
    service = TemplateLibraryService(path)
    with pytest.raises(ImmutableSQLiteError, match="summary metadata is missing"):
        service.summary()
    assert service.get_template(
        source="compiled_pistachio", template_id="compiled_pistachio:example-0"
    ).raw["index"] == 0


def test_environment_polling_retains_instances_after_ttl_and_invalidates_on_replacement(tmp_path, monkeypatch):
    path = compile_library(tmp_path)
    now, reads = [100.0], []
    original = template_library.read_summary

    def counted(connection):
        reads.append(1)
        return original(connection)

    monkeypatch.setattr(template_library, "read_summary", counted)
    monkeypatch.setattr(environment_dependencies, "monotonic", lambda: now[0])
    monkeypatch.setattr(environment_dependencies, "_template_cache", None)
    # The production cache uses an LRU container, not an unbounded per-poll map.
    from collections import OrderedDict
    monkeypatch.setattr(environment_dependencies, "_template_services", OrderedDict())
    first = environment_dependencies.template_asset_status(str(path), cache_seconds=10)
    now[0] += 20
    assert environment_dependencies.template_asset_status(str(path), cache_seconds=10) == first
    assert len(reads) == 1
    other = compile_library(tmp_path, count=1, name="other")
    before = path.stat()
    os.utime(other, ns=(before.st_atime_ns, before.st_mtime_ns))
    other.replace(path)
    current = environment_dependencies.template_asset_status(str(path), cache_seconds=10)
    assert current["status"] == "ready" and current["template_count"] == 1
    assert len(reads) == 2
    path.with_name(path.name + "-wal").write_bytes(b"sidecar-control")
    assert environment_dependencies.template_asset_status(str(path), cache_seconds=10)["status"] == "unavailable"
