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
from ord_schema.proto import reaction_pb2 as pb
from rdkit import Chem
from rdkit.Chem import inchi

from packages.knowledge_base.ord_import import iter_import_records
from packages.knowledge_base.ord_identifiers import (
    CURRENT_IDENTIFIER_POLICY,
    requires_source_recheck,
)
from packages.knowledge_base.ord_incremental import (
    OrdBaselineError,
    OrdBaselineLookup,
    VerifiedOrdBaseline,
    _GROUP_BUFFER_RECORDS,
    _record_requires_source_recheck,
)
from packages.knowledge_base.ord_reader import file_fingerprint, verify_ord_sources
from packages.knowledge_base.reaction_library import compile_reaction_library
from packages.knowledge_base.reaction_models import (
    ReactionEvidence,
    RecordedConditions,
    RecordedInput,
)
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


def _current_sources(sources):
    return [
        {**item.as_source(), "identity_policy": CURRENT_IDENTIFIER_POLICY}
        for item in sources
    ]


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
        records[:20], base, sources=_current_sources(sources)
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
        records, base, sources=_current_sources(sources)
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
        records, base, sources=_current_sources(sources)
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
        records[:1], base, sources=_current_sources(sources)
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
        records, base, sources=_current_sources(sources)
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


@pytest.mark.parametrize("source_path,sha256,valid,rows,withheld", [
    (PUBLIC_PATH, PUBLIC_SHA256, 39, 39, 0),
    (AZ_PATH, AZ_SHA256, 746, 750, 7),
])
def test_real_legacy_policy_upgrade_preserves_verified_public_records(
    public_files, tmp_path, capsys, source_path, sha256, valid, rows, withheld
):
    root = tmp_path / "sources"
    root.mkdir()
    path = root / Path(source_path).name
    shutil.copyfile(public_files[source_path], path)
    manifest = _write_manifest(root, [_entry(path, source_path)])
    sources = verify_ord_sources(manifest, root)
    records, _ = _extract(path, source_path, sha256)
    base = tmp_path / "legacy.sqlite"
    compile_reaction_library(
        records, base, sources=[source.as_source() for source in sources]
    )
    report = tmp_path / "audit/upgrade.json"
    output = tmp_path / "upgraded.sqlite"
    assert main([
        *_arguments(manifest, output, base, report), "--workers", "2",
        "--allow-rejected",
    ]) == 0
    capsys.readouterr()
    audit = json.loads(report.read_text())
    incremental = audit["incremental"]
    assert incremental["records_verified"] == valid
    assert incremental["records_reused"] == valid - withheld
    assert incremental["records_withheld"] == withheld
    assert incremental["records_rechecked_preserved"] == withheld
    assert incremental["records_rechecked_existing"] == withheld
    assert incremental["reactions_recheck_seen"] == withheld
    assert incremental["records_removed_on_recheck"] == 0
    assert incremental["new_records_emitted"] == incremental["new_records_indexed"] == 0
    assert incremental["rows_seen"] == rows and incremental["unread_rows"] == 0
    assert audit["library"]["record_count"] == valid
    assert all(
        source["identity_policy"] == CURRENT_IDENTIFIER_POLICY
        for source in audit["library"]["sources"]
    )
    with closing(sqlite3.connect(output)) as connection:
        restored = [
            ReactionEvidence.model_validate_json(row[0])
            for row in connection.execute("SELECT payload FROM reactions ORDER BY id")
        ]
    assert restored == sorted(records, key=lambda record: record.id)


@pytest.mark.parametrize("policy", [None, "", "unknown", "explicit-standard-inchi-v1"])
def test_unknown_explicit_baseline_policy_aborts_publication(
    public_import, tmp_path, capsys, policy
):
    _, manifest, _, _, base = public_import
    invalid = _mutated_base(
        base, tmp_path / "unknown-policy.sqlite",
        summary_change=lambda summary: summary["sources"][0].update(
            identity_policy=policy
        ),
    )
    output = tmp_path / "not-published.sqlite"
    assert main(_arguments(manifest, output, invalid)) == 1
    assert not output.exists()
    assert "sources disagree" in json.loads(capsys.readouterr().out)["error"]["message"]


def _legacy_charge_import(tmp_path, *, rejected: bool):
    root = tmp_path / "sources"
    charged = _reaction(identifier="1" * 32, product="CC(=O)[O-].[NH4+]")
    reactions = [
        _reaction(identifier="2" * 32), charged,
        _reaction(identifier="3" * 32, product="CCN"),
    ]
    path, entry = _write_dataset(root, reactions)
    legacy, _ = _extract(path, entry["path"], entry["sha256"])
    assert len(legacy) == 3
    if rejected:
        charged.outcomes[0].products[0].identifiers.add(
            type=pb.CompoundIdentifier.INCHI,
            value=inchi.MolToInchi(Chem.MolFromSmiles("CC(=O)[O-].[NH4+]")),
        )
        path, entry = _write_dataset(root, reactions)
    manifest = _write_manifest(root, [entry])
    sources = verify_ord_sources(manifest, root)
    # The legacy parser retained these explicit structures despite the redundant
    # normalized InChI. Pin those historical payloads to the final raw file.
    legacy = [record.model_copy(update={
        "provenance": record.provenance.model_copy(update={
            "source_sha256": entry["sha256"],
        }),
    }) for record in legacy[:2]]
    base = tmp_path / "legacy.sqlite"
    compile_reaction_library(
        legacy, base, sources=[source.as_source() for source in sources]
    )
    return manifest, sources, legacy, base


@pytest.mark.parametrize("workers", [1, 2])
@pytest.mark.parametrize("rejected", [False, True])
def test_normalization_recheck_reemits_or_removes_existing_without_hiding_new(
    tmp_path, capsys, workers, rejected
):
    manifest, sources, _, base = _legacy_charge_import(tmp_path, rejected=rejected)
    baseline = VerifiedOrdBaseline(base, sources)
    reused = list(baseline.iter_records())
    assert [record.id for record in reused] == ["ord-" + "2" * 32]
    identity = baseline.freeze()
    assert identity.recheck_reaction_ids == frozenset({"ord-" + "1" * 32})
    with OrdBaselineLookup(identity) as lookup:
        assert not lookup.has_single_record(
            "ord-" + "1" * 32, sources[0].path, sources[0].sha256
        )
    output = tmp_path / "upgraded.sqlite"
    report = tmp_path / "audit/upgrade.json"
    assert main([
        *_arguments(manifest, output, base, report), "--workers", str(workers),
        "--allow-rejected",
    ]) == 0
    capsys.readouterr()
    audit = json.loads(report.read_text())
    incremental = audit["incremental"]
    assert incremental["records_verified"] == 2
    assert incremental["records_reused"] == incremental["records_withheld"] == 1
    assert incremental["records_rechecked_existing"] == int(not rejected)
    assert incremental["records_rechecked_preserved"] == int(not rejected)
    assert incremental["records_removed_on_recheck"] == int(rejected)
    assert incremental["new_records_emitted"] == incremental["new_records_indexed"] == 1
    assert incremental["reactions_recheck_required"] == incremental["reactions_recheck_seen"] == 1
    assert incremental["rows_seen"] == 3 and incremental["unread_rows"] == 0
    assert incremental["rows_skipped_verified"] == 1
    assert audit["library"]["record_count"] == (2 if rejected else 3)
    assert audit["extraction"]["totals"]["records_skipped_existing"] == 0


@pytest.mark.parametrize("workers", [1, 2])
def test_marked_reaction_absent_from_original_raw_source_aborts_publication(
    tmp_path, capsys, workers
):
    manifest, _, _, base = _legacy_charge_import(tmp_path, rejected=False)
    absent = "ord-" + "f" * 32

    def change_original_id(connection):
        original, raw = connection.execute(
            "SELECT id, payload FROM reactions ORDER BY id LIMIT 1"
        ).fetchone()
        record = json.loads(raw)
        record["id"] = record["provenance"]["record_id"] = absent
        record["provenance"]["original_reaction_id"] = absent
        connection.execute(
            "UPDATE reactions SET id=?,payload=? WHERE id=?",
            (absent, json.dumps(record), original),
        )

    invalid = _mutated_base(
        base, tmp_path / "absent.sqlite", database_change=change_original_id
    )
    output = tmp_path / "not-published.sqlite"
    assert main([
        *_arguments(manifest, output, invalid), "--workers", str(workers),
        "--allow-rejected",
    ]) == 1
    audit = json.loads(capsys.readouterr().out)
    assert "not found in their original raw sources" in audit["error"]["message"]
    assert audit["incremental"]["records_removed_on_recheck"] is None
    assert not output.exists()


@pytest.mark.parametrize("workers", [1, 2])
def test_rechecked_existing_payload_conflict_is_fatal(tmp_path, capsys, workers):
    manifest, _, _, base = _legacy_charge_import(tmp_path, rejected=False)
    conflicting = _mutated_base(
        base, tmp_path / "conflicting.sqlite",
        record_change=lambda record: record.update(procedure="Changed legacy payload"),
    )
    output = tmp_path / "not-published.sqlite"
    assert main([
        *_arguments(manifest, output, conflicting), "--workers", str(workers),
        "--allow-rejected",
    ]) == 1
    audit = json.loads(capsys.readouterr().out)
    assert "Conflicting ORD baseline payload" in (
        audit["error"]["message"] + str(audit["extraction"]["files"])
    )
    assert not output.exists()


def test_current_policy_baseline_does_not_withhold_valid_explicit_charge(tmp_path):
    _, sources, legacy, _ = _legacy_charge_import(tmp_path, rejected=False)
    base = tmp_path / "current.sqlite"
    compile_reaction_library(legacy, base, sources=_current_sources(sources))
    assert requires_source_recheck(legacy[1].products[0])
    baseline = VerifiedOrdBaseline(base, sources)
    assert len(list(baseline.iter_records())) == 2
    assert baseline.records_verified == baseline.records_reused == 2
    assert baseline.records_withheld == 0
    assert baseline.freeze().recheck_reaction_ids == frozenset()


@pytest.mark.parametrize("field", ["reactants", "products", "agents", "condition_inputs"])
def test_normalization_walk_includes_each_typed_structure_field(tmp_path, field):
    path, entry = _write_dataset(tmp_path / "sources", [_reaction()])
    records, _ = _extract(path, entry["path"], entry["sha256"])
    charged = "CC(=O)[O-].[NH4+]"
    record = records[0]
    assert not _record_requires_source_recheck(record)
    if field == "condition_inputs":
        record = record.model_copy(update={"conditions": RecordedConditions(inputs=[
            RecordedInput(role="REAGENT", smiles=charged, source_field="inputs.salt")
        ])})
    else:
        record = record.model_copy(update={field: [charged]})
    assert _record_requires_source_recheck(record)


@pytest.mark.parametrize("workers", [1, 2])
def test_one_sensitive_outcome_withholds_the_entire_original_reaction(
    tmp_path, workers
):
    root = tmp_path / "sources"
    reaction = _reaction(identifier="1" * 32, product="CC(=O)[O-].[NH4+]")
    reaction.outcomes.add().CopyFrom(_reaction(product="CC=O").outcomes[0])
    path, entry = _write_dataset(root, [reaction, _reaction(identifier="2" * 32)])
    sources = verify_ord_sources(_write_manifest(root, [entry]), root)
    records, _ = _extract(path, entry["path"], entry["sha256"])
    affected = [
        record for record in records
        if record.provenance.original_reaction_id == reaction.reaction_id
    ]
    assert len(affected) == 2
    assert sum(_record_requires_source_recheck(record) for record in affected) == 1
    base = tmp_path / "legacy.sqlite"
    compile_reaction_library(
        records, base, sources=[source.as_source() for source in sources]
    )
    checked = VerifiedOrdBaseline(base, sources)
    seed = list(checked.iter_records())
    assert [record.id for record in seed] == ["ord-" + "2" * 32]
    assert checked.records_verified == 3 and checked.records_withheld == 2
    reports = []
    baseline = VerifiedOrdBaseline(base, sources)
    output = tmp_path / "upgraded.sqlite"
    library = compile_reaction_library(iter_import_records(
        sources, reports=reports, workers=workers, staging_root=tmp_path,
        allow_rejected=False, base_library=baseline,
    ), output, sources=_current_sources(sources))
    assert library["record_count"] == 3
    assert reports[0]["records_rechecked_existing"] == 2
    assert reports[0]["records_skipped_existing"] == 0
    assert reports[0]["rechecked_reaction_ids_seen"] == [reaction.reaction_id]
    audit = baseline.audit(totals=reports[0], library=library)
    assert audit["records_rechecked_preserved"] == 2
    assert audit["records_removed_on_recheck"] == audit["new_records_indexed"] == 0


@pytest.mark.parametrize("workers", [1, 2])
def test_large_contiguous_group_reuses_without_unbounded_payload_buffer(
    tmp_path, workers
):
    root = tmp_path / "sources"
    reaction = _reaction(product="CO")
    for length in range(2, _GROUP_BUFFER_RECORDS + 2):
        reaction.outcomes.add().CopyFrom(
            _reaction(product="C" * length + "O").outcomes[0]
        )
    path, entry = _write_dataset(root, [reaction])
    sources = verify_ord_sources(_write_manifest(root, [entry]), root)
    records, _ = _extract(path, entry["path"], entry["sha256"])
    assert len(records) > _GROUP_BUFFER_RECORDS
    base = tmp_path / "legacy.sqlite"
    compile_reaction_library(
        records, base, sources=[source.as_source() for source in sources]
    )
    checked = VerifiedOrdBaseline(base, sources)
    assert list(checked.iter_records()) == sorted(records, key=lambda record: record.id)
    assert checked.records_verified == checked.records_reused == len(records)
    assert checked.records_withheld == 0
    reports = []
    baseline = VerifiedOrdBaseline(base, sources)
    library = compile_reaction_library(iter_import_records(
        sources, reports=reports, workers=workers, staging_root=tmp_path,
        allow_rejected=False, base_library=baseline,
    ), tmp_path / "upgraded.sqlite", sources=_current_sources(sources))
    assert library["record_count"] == len(records)
    assert reports[0]["records_skipped_existing"] == len(records)
    assert reports[0]["records_rechecked_existing"] == 0


def test_rechecked_preserved_count_is_unique_for_the_withheld_subset(tmp_path):
    _, sources, records, base = _legacy_charge_import(tmp_path, rejected=False)
    baseline = VerifiedOrdBaseline(base, sources)
    list(baseline.iter_records())
    with OrdBaselineLookup(baseline.freeze()) as lookup:
        for _ in range(2):
            baseline.note_rechecked_record(records[1], lookup)
    audit = baseline.audit(totals={}, library=None)
    assert audit["records_rechecked_preserved"] == 1
    assert audit["records_removed_on_recheck"] is None
