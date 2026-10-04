"""Real public ORD resume acceptance and real SQLite/ORD boundary checks."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import sqlite3
from contextlib import closing
from pathlib import Path

import pytest

from packages.knowledge_base.ord_import import iter_import_records
from packages.knowledge_base.ord_incremental import (
    OrdBaselineError,
    OrdBaselineLookup,
    VerifiedOrdBaseline,
)
from packages.knowledge_base.ord_reader import file_fingerprint, verify_ord_sources
from packages.knowledge_base.reaction_library import compile_reaction_library
from packages.knowledge_base.reaction_models import ReactionEvidence
from scripts.data_import.compile_reaction_library import main
from test_ord_extraction import (
    AZ_PATH,
    AZ_SHA256,
    PUBLIC_PATH,
    PUBLIC_SHA256,
    _entry,
    _extract,
    _reaction,
    _write_dataset,
    _write_manifest,
    public_files,  # noqa: F401 - register the existing checksummed public fixture
)


@pytest.fixture
def public_import(public_files, tmp_path):
    root = tmp_path / "sources"
    root.mkdir()
    path = root / Path(PUBLIC_PATH).name
    shutil.copyfile(public_files[PUBLIC_PATH], path)
    manifest = _write_manifest(root, [_entry(path, PUBLIC_PATH)])
    sources = verify_ord_sources(manifest, root)
    records, _ = _extract(path, PUBLIC_PATH, PUBLIC_SHA256)
    base = tmp_path / "base.sqlite"
    compile_reaction_library(
        records[:20], base, sources=[item.as_source() for item in sources]
    )
    return root, manifest, sources, records, base


def _mutated_base(
    base, destination, *, summary_change=None, record_change=None, database_change=None
):
    shutil.copyfile(base, destination)
    with closing(sqlite3.connect(destination)) as connection:
        if summary_change is not None:
            summary = json.loads(connection.execute(
                "SELECT value FROM metadata WHERE key='summary'"
            ).fetchone()[0])
            summary_change(summary)
            connection.execute(
                "UPDATE metadata SET value=? WHERE key='summary'", (json.dumps(summary),)
            )
        if record_change is not None:
            record_id, raw = connection.execute(
                "SELECT id, payload FROM reactions ORDER BY id LIMIT 1"
            ).fetchone()
            payload = json.loads(raw)
            record_change(payload)
            connection.execute(
                "UPDATE reactions SET payload=? WHERE id=?",
                (json.dumps(payload, sort_keys=True), record_id),
            )
        if database_change is not None:
            database_change(connection)
        connection.commit()
    destination.chmod(0o444)
    return destination


def _arguments(manifest, output, base, report=None):
    arguments = [
        "--manifest", str(manifest), "--output", str(output), "--base-library", str(base)
    ]
    return arguments + (["--report", str(report)] if report else [])


@pytest.mark.parametrize("workers", [1, 2, 4])
def test_real_public_partial_baseline_restores_all_records(
    public_import, tmp_path, capsys, workers
):
    root, manifest, sources, records, base = public_import
    base_before = file_fingerprint(base), hashlib.sha256(base.read_bytes()).hexdigest()
    raw_before = file_fingerprint(sources[0].local_path), sources[0].sha256
    output = tmp_path / "assets/resumed.sqlite"
    report = tmp_path / "audit/resumed.json"
    assert main([
        *_arguments(manifest, output, base, report), "--workers", str(workers)
    ]) == 0
    assert json.loads(capsys.readouterr().out)["success"]
    audit = json.loads(report.read_text())
    incremental = audit["incremental"]
    assert incremental["base_sha256"] == base_before[1]
    assert len(incremental["base_snapshot"]) == 64
    assert incremental["base_record_count"] == incremental["records_reused"] == 20
    assert incremental["base_records_verified"]
    assert incremental["rows_skipped_verified"] == 20
    assert incremental["new_records_emitted"] == incremental["new_records_indexed"] == 19
    assert incremental["records_skipped_existing"] == 0
    assert incremental["rows_seen"] == 39 and incremental["unread_rows"] == 0
    assert audit["files_verified"] == audit["files_selected"] == 1
    assert audit["excluded_sources"] == []
    assert audit["extraction"]["totals"]["records_emitted"] == 19
    assert audit["library"]["record_count"] == 39
    with closing(sqlite3.connect(output)) as connection:
        restored = [
            ReactionEvidence.model_validate_json(row[0])
            for row in connection.execute("SELECT payload FROM reactions ORDER BY id")
        ]
    assert restored == sorted(records, key=lambda item: item.id)
    assert sum(len(item.reported_yields) for item in restored) == 78
    assert (
        file_fingerprint(base), hashlib.sha256(base.read_bytes()).hexdigest()
    ) == base_before
    assert (
        file_fingerprint(sources[0].local_path),
        hashlib.sha256(sources[0].local_path.read_bytes()).hexdigest(),
    ) == raw_before
    assert list(output.parent.glob(".ord-extract-*")) == []
    assert list(output.parent.glob(".reaction-library-*")) == []
    assert sorted(path.name for path in root.iterdir()) == [
        Path(PUBLIC_PATH).name, "source-manifest.json"
    ]


def test_real_complete_baseline_has_no_newly_extracted_records(
    public_import, tmp_path, capsys
):
    _, manifest, sources, records, _ = public_import
    base = tmp_path / "complete.sqlite"
    compile_reaction_library(
        records, base, sources=[item.as_source() for item in sources]
    )
    assert main(_arguments(manifest, tmp_path / "resumed.sqlite", base)) == 0
    audit = json.loads(capsys.readouterr().out)
    assert audit["incremental"]["records_reused"] == 39
    assert audit["incremental"]["rows_skipped_verified"] == 39
    assert (
        audit["incremental"]["new_records_emitted"]
        == audit["incremental"]["new_records_indexed"] == 0
    )
    assert audit["extraction"]["totals"]["records_emitted"] == 0
    assert audit["extraction"]["totals"]["rows_seen"] == 39


@pytest.mark.parametrize("allow_rejected", [False, True])
def test_real_az_resume_still_audits_four_invalid_rows(
    public_files, tmp_path, capsys, allow_rejected
):
    root = tmp_path / "sources"
    root.mkdir()
    path = root / Path(AZ_PATH).name
    shutil.copyfile(public_files[AZ_PATH], path)
    manifest = _write_manifest(root, [_entry(path, AZ_PATH)])
    sources = verify_ord_sources(manifest, root)
    records, _ = _extract(path, AZ_PATH, AZ_SHA256)
    base = tmp_path / "az-base.sqlite"
    compile_reaction_library(
        records, base, sources=[item.as_source() for item in sources]
    )
    output = tmp_path / "az-resumed.sqlite"
    arguments = _arguments(manifest, output, base)
    if allow_rejected:
        arguments.append("--allow-rejected")
    assert main(arguments) == (0 if allow_rejected else 1)
    audit = json.loads(capsys.readouterr().out)
    assert output.exists() == allow_rejected
    assert audit["incremental"]["records_reused"] == 746
    assert audit["incremental"]["rows_skipped_verified"] == 746
    assert audit["incremental"]["rows_seen"] == 750
    assert audit["incremental"]["unread_rows"] == 0
    assert audit["incremental"]["new_records_emitted"] == 0
    totals = audit["extraction"]["totals"]
    assert totals["rejected_reactions"] == 4
    assert totals["rejection_reasons"]["nonfinite_recorded_parameter"] == 4


@pytest.mark.parametrize("change", [
    {"schema_version": 99},
    {"snapshot": "not-a-snapshot"},
    {"license": "Apache-2.0"},
    {"source": "USPTO_FULL"},
    {"record_count": 21},
    {"yields_count": True},
    {"conditions_count": 21},
])
def test_invalid_base_metadata_aborts_publication(
    public_import, tmp_path, capsys, change
):
    _, manifest, _, _, base = public_import
    invalid = _mutated_base(
        base, tmp_path / "invalid.sqlite",
        summary_change=lambda summary: summary.update(change),
    )
    output = tmp_path / "not-published.sqlite"
    assert main(_arguments(manifest, output, invalid)) == 1
    assert not output.exists()
    assert not json.loads(capsys.readouterr().out)["success"]


@pytest.mark.parametrize("statement", [
    "PRAGMA user_version=99",
    "DROP INDEX reaction_product",
    "ALTER TABLE reactions RENAME COLUMN product TO other_product",
])
def test_base_requires_the_compiler_sqlite_schema(
    public_import, tmp_path, capsys, statement
):
    _, manifest, _, _, base = public_import
    invalid = _mutated_base(
        base, tmp_path / "invalid.sqlite",
        database_change=lambda connection: connection.execute(statement),
    )
    output = tmp_path / "not-published.sqlite"
    assert main(_arguments(manifest, output, invalid)) == 1
    assert not output.exists()
    assert "schema" in json.loads(capsys.readouterr().out)["error"]["message"]


@pytest.mark.parametrize("field,value", [
    ("sha256", "0" * 64),
    ("revision", "0" * 40),
    ("license", "Apache-2.0"),
    ("size", 1),
    ("repository", "https://example.com/untrusted"),
])
def test_base_manifest_identity_must_match_exactly(
    public_import, tmp_path, field, value
):
    _, _, sources, _, base = public_import
    invalid = _mutated_base(
        base, tmp_path / "invalid.sqlite",
        summary_change=lambda summary: summary["sources"][0].update({field: value}),
    )
    with pytest.raises(OrdBaselineError, match="sources disagree"):
        VerifiedOrdBaseline(invalid, sources)


@pytest.mark.parametrize("field,value", [
    ("source_sha256", "0" * 64),
    ("source_path", AZ_PATH),
    ("dataset_id", "ord_dataset-" + "a" * 32),
    ("original_reaction_id", "ord-" + "0" * 32),
    ("license", None),
])
def test_each_reused_record_is_manifest_bound(
    public_import, tmp_path, capsys, field, value
):
    _, manifest, _, _, base = public_import
    invalid = _mutated_base(
        base, tmp_path / "invalid.sqlite",
        record_change=lambda record: record["provenance"].update({field: value}),
    )
    output = tmp_path / "not-published.sqlite"
    assert main(_arguments(manifest, output, invalid)) == 1
    assert not output.exists()
    audit = json.loads(capsys.readouterr().out)
    assert not audit["incremental"]["base_records_verified"]


def test_freeze_requires_completed_typed_base_stream(public_import):
    _, _, sources, _, base = public_import
    baseline = VerifiedOrdBaseline(base, sources)
    with pytest.raises(OrdBaselineError, match="validated before extraction"):
        baseline.freeze()
    assert len(list(baseline.iter_records())) == 20
    with OrdBaselineLookup(baseline.freeze()) as lookup:
        with pytest.raises(sqlite3.OperationalError):
            lookup.connection.execute("DELETE FROM reactions")
    with pytest.raises(OrdBaselineError, match="exactly once"):
        list(baseline.iter_records())


def test_payload_equivalence_ignores_json_serialization_order(public_import, tmp_path):
    _, _, sources, records, base = public_import
    reformatted = _mutated_base(
        base, tmp_path / "formatted.sqlite", record_change=lambda record: None
    )
    baseline = VerifiedOrdBaseline(reformatted, sources)
    reused = list(baseline.iter_records())
    with OrdBaselineLookup(baseline.freeze()) as lookup:
        assert all(lookup.matches_existing(record) for record in reused)
        assert not lookup.matches_existing(records[-1])
        assert not lookup.has_single_record(reused[0].id, AZ_PATH, sources[0].sha256)


@pytest.mark.parametrize("workers", [1, 2])
@pytest.mark.parametrize("different_products", [False, True])
def test_multi_outcome_reactions_are_reparsed_and_deduplicated(
    tmp_path, workers, different_products
):
    root = tmp_path / "sources"
    reaction = _reaction()
    reaction.outcomes.add().CopyFrom(
        _reaction(product="CC(=O)O" if different_products else "CC=O").outcomes[0]
    )
    path, entry = _write_dataset(root, [reaction])
    manifest = _write_manifest(root, [entry])
    sources = verify_ord_sources(manifest, root)
    records, _ = _extract(path, entry["path"], entry["sha256"])
    base = tmp_path / "base.sqlite"
    compile_reaction_library(
        records[:1], base, sources=[item.as_source() for item in sources]
    )
    baseline = VerifiedOrdBaseline(base, sources)
    reports = []
    stream = iter_import_records(
        sources, reports=reports, workers=workers, staging_root=tmp_path,
        allow_rejected=False, base_library=baseline,
    )
    summary = compile_reaction_library(
        stream, tmp_path / "resumed.sqlite",
        sources=[item.as_source() for item in sources],
    )
    assert reports[0]["rows_seen"] == reports[0]["multiple_outcome_reactions"] == 1
    assert reports[0]["rows_skipped_verified"] == 0
    assert reports[0]["records_emitted"] == len(records)
    assert reports[0]["records_skipped_existing"] == 1
    assert summary["record_count"] == len(records)
    assert baseline.records_reused == 1


@pytest.mark.parametrize("workers", [1, 2])
def test_multi_outcome_payload_conflict_is_fatal_even_with_allow_rejected(
    tmp_path, capsys, workers
):
    root = tmp_path / "sources"
    reaction = _reaction()
    reaction.outcomes.add().CopyFrom(reaction.outcomes[0])
    path, entry = _write_dataset(root, [reaction])
    manifest = _write_manifest(root, [entry])
    sources = verify_ord_sources(manifest, root)
    records, _ = _extract(path, entry["path"], entry["sha256"])
    base = tmp_path / "original.sqlite"
    compile_reaction_library(
        records, base, sources=[item.as_source() for item in sources]
    )
    invalid = _mutated_base(
        base, tmp_path / "conflicting.sqlite",
        record_change=lambda record: record.update(
            procedure="Altered prior payload; not experimental evidence"
        ),
    )
    output = tmp_path / "not-published.sqlite"
    report = tmp_path / "audit/conflict.json"
    assert main([
        *_arguments(manifest, output, invalid, report),
        "--workers", str(workers), "--allow-rejected",
    ]) == 1
    assert not output.exists()
    capsys.readouterr()
    audit = json.loads(report.read_text())
    assert "Conflicting ORD baseline payload" in (
        audit["error"]["message"] + str(audit["extraction"]["files"])
    )
    assert list(tmp_path.glob(".ord-extract-*")) == []
    assert list(tmp_path.glob(".reaction-library-*")) == []


@pytest.mark.parametrize("selection", ["--source", "--exclude-source"])
def test_incremental_source_filters_are_explicitly_refused(
    public_import, tmp_path, capsys, selection
):
    _, manifest, _, _, base = public_import
    output = tmp_path / "not-published.sqlite"
    assert main([*_arguments(manifest, output, base), selection, PUBLIC_PATH]) == 1
    audit = json.loads(capsys.readouterr().out)
    assert audit["files_verified"] == 1
    assert "cannot be combined" in audit["error"]["message"]
    assert not output.exists()


def test_all_manifest_hashes_are_verified_before_base_or_selection(
    public_import, public_files, tmp_path, capsys
):
    root, _, _, _, base = public_import
    other = root / Path(AZ_PATH).name
    shutil.copyfile(public_files[AZ_PATH], other)
    entries = [
        _entry(root / Path(PUBLIC_PATH).name, PUBLIC_PATH),
        {**_entry(other, AZ_PATH), "sha256": "0" * 64},
    ]
    manifest = _write_manifest(root, entries)
    output = tmp_path / "not-published.sqlite"
    assert main([*_arguments(manifest, output, base), "--source", PUBLIC_PATH]) == 1
    audit = json.loads(capsys.readouterr().out)
    assert audit["source_errors"]["reason_counts"]["source_sha256_mismatch"] == 1
    assert not output.exists()


def test_base_source_set_cannot_be_expanded_or_reduced(
    public_import, public_files, tmp_path
):
    root, _, _, _, base = public_import
    other = root / Path(AZ_PATH).name
    shutil.copyfile(public_files[AZ_PATH], other)
    manifest = _write_manifest(root, [
        _entry(root / Path(PUBLIC_PATH).name, PUBLIC_PATH), _entry(other, AZ_PATH)
    ])
    with pytest.raises(OrdBaselineError, match="complete verified manifest"):
        VerifiedOrdBaseline(base, verify_ord_sources(manifest, root))


@pytest.mark.parametrize("changed_asset", ["base", "source"])
def test_input_fingerprint_drift_aborts_before_publication(
    public_import, tmp_path, changed_asset
):
    _, _, sources, _, base = public_import
    baseline = VerifiedOrdBaseline(base, sources)
    records = iter_import_records(
        sources, reports=[], workers=1, staging_root=tmp_path,
        allow_rejected=False, base_library=baseline,
    )

    def changed_records():
        for index, record in enumerate(records):
            yield record
            if index == 0:
                changed = base if changed_asset == "base" else sources[0].local_path
                info = changed.stat()
                os.utime(changed, ns=(info.st_atime_ns, info.st_mtime_ns + 1))

    output = tmp_path / "not-published.sqlite"
    with pytest.raises(ValueError, match="changed"):
        compile_reaction_library(
            changed_records(), output, sources=[item.as_source() for item in sources]
        )
    assert not output.exists()
    assert list(tmp_path.glob(".reaction-library-*")) == []


@pytest.mark.parametrize("sidecar", ["-wal", "-shm", "-journal"])
def test_sqlite_sidecars_make_baseline_ineligible(public_import, sidecar):
    _, _, sources, _, base = public_import
    Path(str(base) + sidecar).touch()
    with pytest.raises(OrdBaselineError, match="sidecars"):
        VerifiedOrdBaseline(base, sources)


def test_mutable_baseline_is_refused(public_import):
    _, _, sources, _, base = public_import
    base.chmod(0o644)
    with pytest.raises(OrdBaselineError, match="read-only immutable"):
        VerifiedOrdBaseline(base, sources)


def test_incremental_never_replaces_base_or_external_audit(public_import, tmp_path, capsys):
    _, manifest, _, _, base = public_import
    before = base.read_bytes()
    assert main(_arguments(manifest, base, base)) == 1
    assert base.read_bytes() == before
    capsys.readouterr()
    output = tmp_path / "not-published.sqlite"
    assert main(_arguments(manifest, output, base, base)) == 1
    assert base.read_bytes() == before and not output.exists()
    assert "distinct" in json.loads(capsys.readouterr().out)["error"]["message"]


@pytest.mark.parametrize("workers", [0, 5])
def test_incremental_worker_bound_is_enforced_before_reuse(public_import, tmp_path, workers):
    _, _, sources, _, base = public_import
    baseline = VerifiedOrdBaseline(base, sources)
    with pytest.raises(ValueError, match="between 1 and 4"):
        list(iter_import_records(
            sources, reports=[], workers=workers, staging_root=tmp_path,
            allow_rejected=False, base_library=baseline,
        ))
    assert baseline.records_reused == 0
