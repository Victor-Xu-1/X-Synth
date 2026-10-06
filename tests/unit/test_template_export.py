"""Real local compiler/export contracts and filesystem fault injection only."""

import gzip
import json
import os
import sqlite3
import sys
from contextlib import closing
from pathlib import Path

import pytest

from packages.knowledge_base import template_export, template_export_publication
from packages.knowledge_base.template_library import TemplateLibraryService, export_template_runtime_assets
from packages.platform.immutable_sqlite import ImmutableSQLiteError, file_identity
from scripts.data_import import compile_template_library
from test_template_compilation import compile_library, source


def test_cli_optional_export_keeps_sealed_primary_manifest_and_console_contract(tmp_path, monkeypatch, capsys):
    input_path = source(tmp_path / "retro.templates.pistachio.jsonl")
    output = tmp_path / "compiled"
    primary = output / "template_library_manifest.json"
    before = []
    original = compile_template_library.export_template_runtime_assets

    def observed(**kwargs):
        before.append((primary.read_bytes(), file_identity(primary)))
        return original(**kwargs)

    monkeypatch.setattr(compile_template_library, "export_template_runtime_assets", observed)
    monkeypatch.setattr(sys, "argv", [
        "compile_template_library", "--source", str(input_path),
        "--output-dir", str(output), "--version", "interface-fixture",
        "--export-runtime-assets",
    ])
    assert compile_template_library.main() == 0
    console = json.loads(capsys.readouterr().out)
    assert (primary.read_bytes(), file_identity(primary)) == before[0]
    sealed = json.loads(primary.read_text())
    assert "runtime_assets" not in sealed and primary.stat().st_mode & 0o222 == 0
    assert {k:v for k,v in console.items() if k != "runtime_assets"} == sealed
    metadata = output / "runtime_assets/runtime_template_assets.json"
    assert json.loads(metadata.read_text()) == console["runtime_assets"]
    assert metadata.stat().st_mode & 0o222 == 0
    assert TemplateLibraryService(Path(console["database"]["path"])).summary()["template_count"] == 2


def test_export_metadata_uses_published_paths_and_preserves_original_records(tmp_path):
    database = compile_library(tmp_path)
    before = file_identity(database)
    output = tmp_path / "export"
    runtime = export_template_runtime_assets(database_path=database, output_dir=output)
    expected = [row.raw for row in TemplateLibraryService(database).query_templates()]
    files = [
        *runtime["askcos"]["template_files"].values(),
        runtime["askcos"]["unified_retro_templates"],
    ]
    for entry in files:
        path = Path(entry["path"])
        assert path.parent == output / "askcos_templates"
        assert path.stat().st_mode & 0o222 == 0
        with gzip.open(path, "rt", encoding="utf-8") as handle:
            assert json.load(handle) == expected
    assert runtime["template_database"] == str(database)
    assert runtime["evidence_role"] == "template_knowledge_not_a_trained_model_index"
    assert file_identity(database) == before
    assert not list(tmp_path.glob(".template-export-*"))


@pytest.mark.parametrize("kind", ["empty", "populated", "file", "symlink", "dangling_symlink"])
def test_export_refuses_every_existing_destination_before_source_access(tmp_path, kind):
    output = tmp_path / "export"
    if kind == "file":
        output.write_bytes(b"retained-owner-data")
    elif kind in {"symlink", "dangling_symlink"}:
        target = tmp_path / "target"
        if kind == "symlink":
            target.mkdir()
        output.symlink_to(target, target_is_directory=True)
    else:
        output.mkdir()
        if kind == "populated":
            (output / "retained.txt").write_bytes(b"retained-owner-data")
    before = output.lstat()
    with pytest.raises(FileExistsError, match="immutable"):
        export_template_runtime_assets(database_path=tmp_path / "missing.sqlite", output_dir=output)
    after = output.lstat()
    assert (after.st_ino, after.st_mtime_ns, after.st_ctime_ns) == (
        before.st_ino, before.st_mtime_ns, before.st_ctime_ns,
    )
    if kind == "populated":
        assert (output / "retained.txt").read_bytes() == b"retained-owner-data"


def test_private_write_failure_leaves_no_published_bundle(tmp_path, monkeypatch):
    database = compile_library(tmp_path)
    original = template_export._write_template_json_array_gzip
    calls = []

    def failed(path, rows):
        result = original(path, rows)
        calls.append(path)
        if len(calls) == 2:
            raise OSError("write-fault-control")
        return result

    monkeypatch.setattr(template_export, "_write_template_json_array_gzip", failed)
    with pytest.raises(OSError, match="write-fault"):
        export_template_runtime_assets(database_path=database, output_dir=tmp_path / "export")
    assert not (tmp_path / "export").exists()
    assert not list(tmp_path.glob(".template-export-*"))


@pytest.mark.parametrize("foreign", [False, True])
def test_partial_publication_rolls_back_only_own_files(tmp_path, monkeypatch, foreign):
    database = compile_library(tmp_path)
    output = tmp_path / "export"
    original = os.link

    def failed(source, target):
        target = Path(target)
        if target.name == template_export_publication.EXPORT_MANIFEST:
            if foreign:
                target.write_bytes(b"concurrent-owner-data")
                raise FileExistsError("destination-race-control")
            raise OSError("link-fault-control")
        return original(source, target)

    monkeypatch.setattr(template_export_publication.os, "link", failed)
    with pytest.raises(OSError):
        export_template_runtime_assets(database_path=database, output_dir=output)
    if foreign:
        assert (output / template_export_publication.EXPORT_MANIFEST).read_bytes() == b"concurrent-owner-data"
        assert list(output.iterdir()) == [output / template_export_publication.EXPORT_MANIFEST]
    else:
        assert not output.exists()
    assert not list(tmp_path.glob(".template-export-*"))


def test_destination_creation_race_cannot_replace_another_export(tmp_path, monkeypatch):
    database = compile_library(tmp_path)
    output = tmp_path / "export"
    original = template_export.publish_export

    def raced(staging, destination, snapshot):
        destination.mkdir()
        marker = destination / "retained.txt"
        marker.write_bytes(b"other-publisher")
        return original(staging, destination, snapshot)

    monkeypatch.setattr(template_export, "publish_export", raced)
    with pytest.raises(FileExistsError):
        export_template_runtime_assets(database_path=database, output_dir=output)
    assert (output / "retained.txt").read_bytes() == b"other-publisher"
    assert len(list(output.iterdir())) == 1


def test_source_drift_during_publication_cleans_partial_export(tmp_path, monkeypatch):
    database = compile_library(tmp_path)
    output = tmp_path / "export"
    original = os.link
    changed = []

    def drift(source, target):
        result = original(source, target)
        if not changed:
            changed.append(True)
            database.chmod(0o644)
            with closing(sqlite3.connect(database)) as connection:
                connection.execute("PRAGMA user_version=7")
                connection.commit()
        return result

    monkeypatch.setattr(template_export_publication.os, "link", drift)
    with pytest.raises(ImmutableSQLiteError, match="identity changed"):
        export_template_runtime_assets(database_path=database, output_dir=output)
    assert not output.exists()
    assert not list(tmp_path.glob(".template-export-*"))
