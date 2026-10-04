"""Real ORD Parquet acceptance and real-schema boundary tests; no parser mocks."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

import pyarrow as pa
import pyarrow.parquet as pq
import pytest
from ord_schema import parquet
from ord_schema.proto import reaction_pb2 as pb

from packages.adapters.askcos.reference_identity import canonical_reference_query
from packages.adapters.askcos.reference_models import ReferenceSearchInput
from packages.knowledge_base.ord_extract import OrdExtractionStats, OrdReadError, iter_ord_evidence
from packages.knowledge_base.ord_import import OrdImportError, iter_import_records
from packages.knowledge_base.ord_reader import (
    ORD_LICENSE, ORD_MIRROR, ORD_REPOSITORY, OrdSourceError, verify_ord_sources,
)
from packages.knowledge_base.reaction_library import ReactionLibrary, compile_reaction_library
from scripts.data_import.compile_reaction_library import main

REVISION = "93475c46949f9218e1dfb6624096025135db2add"
PUBLIC_PATH = "data/5e/ord_dataset-5eb7f2689f4a42eba63ad9e37e49a5cd.parquet"
PUBLIC_SHA256 = "2f478e163ab9f9ee2f001172fc9f0c33b0a65ec2dc787c12298f6e85bc86f7a6"
AZ_PATH = "data/00/ord_dataset-00005539a1e04c809a9a78647bea649c.parquet"
AZ_SHA256 = "bf1686ca6edac300a61acb5a5ee006ab5fd61007962ae19062b3d3c7879f84a9"


class _PublicOrdRedirects(HTTPRedirectHandler):
    max_redirections = 3
    max_repeats = 1

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        target = urlsplit(newurl)
        host = target.hostname or ""
        if target.scheme != "https" or target.username or target.password or not (
            host == "huggingface.co" or host.endswith(".huggingface.co") or host.endswith(".hf.co")
        ):
            raise ValueError("ORD test download redirect left the official public mirror/CDN")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _manifest(entries: list[dict]) -> dict:
    return {"source": "ORD", "repository": ORD_REPOSITORY, "mirror": ORD_MIRROR,
            "revision": REVISION, "license": ORD_LICENSE, "files": entries}


def _entry(path: Path, source_path: str) -> dict:
    return {"path": source_path, "size": path.stat().st_size,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "url": f"{ORD_MIRROR}/resolve/{REVISION}/{source_path}"}


@pytest.fixture(scope="session")
def public_files(tmp_path_factory):
    configured = os.environ.get("X_SYNTH_ORD_TEST_SOURCE_DIR")
    local = Path(configured) if configured else Path.home() / ".local/share/x-synth/sources/ord-93475c4"
    cache = tmp_path_factory.mktemp("public-ord")
    result = {}
    for source_path, expected_sha, expected_size in ((PUBLIC_PATH, PUBLIC_SHA256, 11134), (AZ_PATH, AZ_SHA256, 274285)):
        path = local / Path(source_path).name
        if not path.is_file() and configured:
            pytest.fail(f"Explicit ORD test directory lacks {source_path}")
        if not path.is_file():
            path = cache / Path(source_path).name
            url = f"{ORD_MIRROR}/resolve/{REVISION}/{source_path}"
            with build_opener(_PublicOrdRedirects()).open(url, timeout=60) as response:
                length = response.headers.get("Content-Length")
                if length and int(length) != expected_size:
                    pytest.fail("ORD public fixture response size disagrees with the source manifest")
                payload = response.read(expected_size + 1)
            assert len(payload) == expected_size
            assert hashlib.sha256(payload).hexdigest() == expected_sha
            path.write_bytes(payload)
        assert path.stat().st_size == expected_size
        assert hashlib.sha256(path.read_bytes()).hexdigest() == expected_sha
        result[source_path] = path
    return result


def _extract(path: Path, source_path: str, sha256: str):
    stats = OrdExtractionStats()
    records = list(iter_ord_evidence(path, source_path=source_path, source_sha256=sha256,
                                     source_revision=REVISION, stats=stats))
    return records, stats


def _reaction(*, identifier: str = "1" * 32, product: str = "CC=O"):
    reaction = pb.Reaction(reaction_id="ord-" + identifier)
    substrate = reaction.inputs["substrate"].components.add(reaction_role=pb.ReactionRole.REACTANT)
    substrate.identifiers.add(type=pb.CompoundIdentifier.SMILES, value="CCO")
    outcome = reaction.outcomes.add()
    outcome.reaction_time.CopyFrom(pb.Time(value=10, units=pb.Time.MINUTE))
    compound = outcome.products.add(reaction_role=pb.ReactionRole.PRODUCT)
    compound.identifiers.add(type=pb.CompoundIdentifier.SMILES, value=product)
    compound.measurements.add(type=pb.ProductMeasurement.YIELD, percentage=pb.Percentage(value=42))
    return reaction


def _write_dataset(root: Path, reactions, *, dataset_hex: str = "a" * 32):
    root.mkdir(parents=True, exist_ok=True)
    source_path = f"data/{dataset_hex[:2]}/ord_dataset-{dataset_hex}.parquet"
    path = root / Path(source_path).name
    with parquet.DatasetWriter(path, name="Generated boundary fixture, not public experimental evidence",
                               description="Exercise real ORD serialization and extraction",
                               dataset_id="ord_dataset-" + dataset_hex, row_group_size=1) as writer:
        writer.write_all(reactions)
    return path, _entry(path, source_path)


def _write_manifest(root: Path, entries: list[dict], *, bom: bool = False):
    path = root / "source-manifest.json"
    path.write_text(json.dumps(_manifest(entries)), encoding="utf-8-sig" if bom else "utf-8")
    return path


def test_real_public_sulfonamide_file_preserves_measurements(public_files):
    path = public_files[PUBLIC_PATH]
    before = hashlib.sha256(path.read_bytes()).hexdigest()
    records, stats = _extract(path, PUBLIC_PATH, PUBLIC_SHA256)
    assert stats.rows_seen == stats.source_rows == stats.records_emitted == 39
    assert stats.rejected_reactions == stats.rejected_outcomes == 0
    assert stats.yield_measurements == 78
    first = records[0]
    assert first.id == "ord-360f0e1373444a2b9571017ab7c7e186"
    assert first.doi == "10.1021/co400012m"
    assert first.publication_url == "https://pubs.acs.org/doi/full/10.1021/co400012m"
    assert [item.value for item in first.reported_yields] == [92.0, 98.0]
    assert [json.loads(item.analysis)["type"] for item in first.reported_yields] == ["WEIGHT", "NMR_1H"]
    assert first.conditions.temperature[0].value == 25
    assert first.conditions.pressure[0].value == 100
    assert first.conditions.pressure[0].unit == "PSI"
    assert first.conditions.time[0].value == 20
    assert {item.role for item in first.conditions.inputs} == {"REACTANT", "REAGENT", "SOLVENT"}
    assert first.provenance.source_path == PUBLIC_PATH
    assert first.provenance.source_sha256 == PUBLIC_SHA256
    assert first.provenance.license == ORD_LICENSE
    assert REVISION in first.source_url
    assert hashlib.sha256(path.read_bytes()).hexdigest() == before


def test_real_az_file_preserves_source_precision_and_procedure(public_files):
    records, stats = _extract(public_files[AZ_PATH], AZ_PATH, AZ_SHA256)
    first = next(item for item in records if item.id.startswith("ord-56b1f4b"))
    assert first.conditions.temperature[0].value == 110.0
    assert first.conditions.temperature[0].precision == 10.0
    assert first.reported_yields[0].value == pytest.approx(65.39, abs=0.00001)
    original = next(parquet.DatasetView(public_files[AZ_PATH]).iter_reactions())[1]
    assert first.procedure == original.notes.procedure_details
    assert first.publication_url == original.provenance.publication_url
    assert first.doi == (original.provenance.doi or None)
    assert stats.rows_seen == 750
    assert stats.records_emitted == 746
    assert stats.rejection_reasons["nonfinite_recorded_parameter"] == 4
    assert stats.zero_yield_measurements == 132
    assert stats.reactions_emitted + stats.rejected_reactions == stats.reactions_seen


def test_real_public_records_query_through_shared_index(public_files, tmp_path):
    records, _ = _extract(public_files[PUBLIC_PATH], PUBLIC_PATH, PUBLIC_SHA256)
    output = tmp_path / "public.sqlite"
    summary = compile_reaction_library(records, output, sources=[{"path": PUBLIC_PATH, "sha256": PUBLIC_SHA256}])
    assert summary["record_count"] == 39
    query = canonical_reference_query(ReferenceSearchInput(product=records[0].products[0], reactants=records[0].reactants))
    found, _ = ReactionLibrary(output).search(query, limit=30)
    matched = next(item for item in found if item.id == records[0].id)
    assert matched.match_scope == "reaction_identity"
    assert matched.reported_yields == records[0].reported_yields
    with pytest.raises(FileExistsError):
        compile_reaction_library(records, output, sources=[{"path": PUBLIC_PATH, "sha256": PUBLIC_SHA256}])


@pytest.mark.parametrize("bom", [False, True])
def test_manifest_checksum_and_bom(tmp_path, bom):
    root = tmp_path / "sources"
    path, entry = _write_dataset(root, [_reaction()])
    sources = verify_ord_sources(_write_manifest(root, [entry], bom=bom), root)
    assert sources[0].local_path == path
    assert sources[0].as_source()["path"] == entry["path"]


@pytest.mark.parametrize("change,reason", [
    ({"sha256": "0" * 64}, "source_sha256_mismatch"),
    ({"size": 1}, "source_size_mismatch"),
    ({"size": True}, "invalid_source_size"),
    ({"url": "https://private.example/dataset.parquet"}, "untrusted_source_url"),
])
def test_manifest_rejects_unverified_sources(tmp_path, change, reason):
    root = tmp_path / "sources"
    _, entry = _write_dataset(root, [_reaction()])
    with pytest.raises(OrdSourceError) as caught:
        verify_ord_sources(_write_manifest(root, [{**entry, **change}]), root)
    assert caught.value.reason_counts[reason] == 1


def test_manifest_verifies_all_before_selection(tmp_path, capsys):
    root = tmp_path / "sources"
    _, first = _write_dataset(root, [_reaction()])
    _, second = _write_dataset(root, [_reaction(identifier="2" * 32)], dataset_hex="b" * 32)
    manifest = _write_manifest(root, [first, {**second, "sha256": "0" * 64}])
    output = tmp_path / "not-published.sqlite"
    assert main(["--manifest", str(manifest), "--source", first["path"], "--output", str(output)]) == 1
    report = json.loads(capsys.readouterr().out)
    assert report["source_errors"]["reason_counts"]["source_sha256_mismatch"] == 1
    assert not output.exists()


def test_zero_text_yields_and_repeated_outcomes_are_not_dropped(tmp_path):
    reaction = _reaction()
    reaction.outcomes[0].products[0].measurements[0].percentage.value = 0.0
    second = reaction.outcomes.add()
    second.CopyFrom(reaction.outcomes[0])
    second.reaction_time.value = 20
    second.products[0].measurements[0].ClearField("percentage")
    second.products[0].measurements[0].string_value = "trace; below quantification limit"
    path, entry = _write_dataset(tmp_path, [reaction])
    records, stats = _extract(path, entry["path"], entry["sha256"])
    assert len(records) == 1
    assert [item.value for item in records[0].reported_yields] == [0.0, None]
    assert "below quantification limit" in records[0].reported_yields[1].text
    assert [item.source_field for item in records[0].conditions.time] == ["outcomes[0].reaction_time", "outcomes[1].reaction_time"]
    assert stats.zero_yield_measurements == stats.text_only_yield_measurements == 1
    assert stats.multiple_outcome_reactions == 1


def test_different_product_sets_keep_separate_identity(tmp_path):
    reaction = _reaction()
    reaction.outcomes.add().CopyFrom(_reaction(product="CC(=O)O").outcomes[0])
    path, entry = _write_dataset(tmp_path, [reaction])
    records, stats = _extract(path, entry["path"], entry["sha256"])
    assert len(records) == 2
    assert len({item.id for item in records}) == 2
    assert all(":products:" in item.id for item in records)
    assert all(item.provenance.original_reaction_id == reaction.reaction_id for item in records)
    assert {tuple(item.provenance.outcome_indices) for item in records} == {(0,), (1,)}
    assert {tuple(item.products) for item in records} == {("CC=O",), ("CC(=O)O",)}
    assert stats.outcomes_seen == 2


def test_salt_isotope_and_stereochemistry_survive_shared_lookup(tmp_path):
    product = "[13CH3][C@H](O)C(=O)[O-].[Na+]"
    reaction = _reaction(product=product)
    reaction.inputs["substrate"].components[0].identifiers[0].value = product
    path, entry = _write_dataset(tmp_path / "sources", [reaction])
    records, stats = _extract(path, entry["path"], entry["sha256"])
    assert stats.records_emitted == 1
    assert "[13CH3]" in records[0].products[0]
    assert "@" in records[0].products[0]
    assert "[Na+]" in records[0].products[0]
    output = tmp_path / "salts.sqlite"
    compile_reaction_library(records, output, sources=[entry])
    query = canonical_reference_query(ReferenceSearchInput(product=product))
    found, _ = ReactionLibrary(output).search(query, limit=30)
    assert found[0].reported_yields[0].product_smiles == records[0].products[0]
    wrong = canonical_reference_query(ReferenceSearchInput(product="C[C@H](O)C(=O)[O-].[Na+]"))
    assert ReactionLibrary(output).search(wrong, limit=30)[0] == []


def test_name_only_agent_is_not_a_reactant(tmp_path):
    reaction = _reaction()
    agent = reaction.inputs["ligand"].components.add(reaction_role=pb.ReactionRole.CATALYST)
    agent.identifiers.add(type=pb.CompoundIdentifier.NAME, value="deposited ligand name")
    path, entry = _write_dataset(tmp_path, [reaction])
    records, _ = _extract(path, entry["path"], entry["sha256"])
    assert records[0].reactants == ["CCO"]
    assert any(item.name == "deposited ligand name" and item.smiles is None for item in records[0].conditions.inputs)


def test_cas_only_agent_retains_literal_identity_without_lookup(tmp_path):
    reaction = _reaction()
    agent = reaction.inputs["salt"].components.add(reaction_role=pb.ReactionRole.REAGENT)
    agent.identifiers.add(type=pb.CompoundIdentifier.CAS_NUMBER, value="7647-14-5")
    path, entry = _write_dataset(tmp_path, [reaction])
    records, _ = _extract(path, entry["path"], entry["sha256"])
    item = next(item for item in records[0].conditions.inputs if item.role == "REAGENT")
    assert item.name == "CAS_NUMBER: 7647-14-5"
    assert item.smiles is None


def test_empty_agent_identity_is_counted_not_accepted(tmp_path):
    reaction = _reaction()
    reaction.inputs["unknown"].components.add(reaction_role=pb.ReactionRole.REAGENT)
    path, entry = _write_dataset(tmp_path, [reaction])
    records, stats = _extract(path, entry["path"], entry["sha256"])
    assert records == []
    assert stats.rejection_reasons["empty_recorded_input_identity"] == 1


def test_private_download_redirect_is_refused():
    request = Request(f"{ORD_MIRROR}/resolve/{REVISION}/{PUBLIC_PATH}")
    with pytest.raises(ValueError):
        _PublicOrdRedirects().redirect_request(request, None, 302, "redirect", {}, "https://127.0.0.1/data")


def test_row_group_streams_match_full_stream(tmp_path):
    path, entry = _write_dataset(tmp_path, [_reaction(), _reaction(identifier="2" * 32)])
    full, _ = _extract(path, entry["path"], entry["sha256"])
    stats = OrdExtractionStats()
    grouped = [record for group in (0, 1) for record in iter_ord_evidence(
        path, source_path=entry["path"], source_sha256=entry["sha256"], source_revision=REVISION,
        row_group=group, stats=stats,
    )]
    assert grouped == full
    assert stats.source_rows == stats.rows_seen == 2


@pytest.mark.parametrize("product", ["*CC", "not a SMILES", "N[C@H](C)F |&1:1|"])
def test_undefined_or_invalid_structures_are_explicit_rejections(tmp_path, product):
    path, entry = _write_dataset(tmp_path, [_reaction(product=product)])
    records, stats = _extract(path, entry["path"], entry["sha256"])
    assert records == []
    assert stats.rejected_reactions == stats.rejected_outcomes == 1
    assert stats.rejection_reasons


def test_recorded_reaction_conflict_is_not_overridden(tmp_path):
    reaction = _reaction()
    reaction.identifiers.add(type=pb.ReactionIdentifier.REACTION_SMILES, value="CCO>>CCN")
    path, entry = _write_dataset(tmp_path, [reaction])
    records, stats = _extract(path, entry["path"], entry["sha256"])
    assert records == []
    assert stats.rejection_reasons["derived_product_mismatch"] == 1


def test_mapping_bookkeeping_does_not_make_identical_compound_conflict(tmp_path):
    reaction = _reaction()
    reaction.inputs["substrate"].components[0].identifiers.add(
        type=pb.CompoundIdentifier.SMILES, value="[CH3:1][CH2:2][OH:3]",
    )
    path, entry = _write_dataset(tmp_path, [reaction])
    records, stats = _extract(path, entry["path"], entry["sha256"])
    assert records[0].reactants == ["CCO"]
    assert stats.rejected_reactions == 0


def test_conflicting_compound_identity_is_not_selected_by_preference(tmp_path):
    reaction = _reaction()
    reaction.inputs["substrate"].components[0].identifiers.add(type=pb.CompoundIdentifier.SMILES, value="CCN")
    path, entry = _write_dataset(tmp_path, [reaction])
    records, stats = _extract(path, entry["path"], entry["sha256"])
    assert records == []
    assert stats.rejection_reasons["inconsistent_compound_identifiers"] == 1


@pytest.mark.parametrize("url", ["https://127.0.0.1/paper", "http://localhost/paper", "javascript:alert(1)"])
def test_publication_url_never_exposes_private_or_script_urls(tmp_path, url):
    reaction = _reaction()
    reaction.provenance.publication_url = url
    path, entry = _write_dataset(tmp_path, [reaction])
    records, stats = _extract(path, entry["path"], entry["sha256"])
    assert records == []
    assert stats.rejection_reasons["unsafe_publication_url"] == 1


def test_corrupt_protobuf_aborts_and_counts_unread_rows(tmp_path):
    path, entry = _write_dataset(tmp_path, [_reaction()])
    table = pq.read_table(path)
    table = table.set_column(1, "reaction", pa.array([b"\xff"], type=pa.binary()))
    pq.write_table(table, path)
    stats = OrdExtractionStats()
    with pytest.raises(OrdReadError):
        list(iter_ord_evidence(path, source_path=entry["path"], source_sha256=entry["sha256"],
                               source_revision=REVISION, stats=stats))
    assert stats.as_dict()["unread_rows"] == 1
    assert stats.rejection_reasons["parquet_or_protobuf_read_error"] == 1


@pytest.mark.parametrize("workers", [1, 2])
def test_worker_policy_keeps_atomic_publication(tmp_path, workers):
    root = tmp_path / "sources"
    _, entry = _write_dataset(root, [_reaction(), _reaction(identifier="2" * 32, product="*CC")])
    sources = verify_ord_sources(_write_manifest(root, [entry]), root)
    reports = []
    output = tmp_path / "strict.sqlite"
    stream = iter_import_records(sources, reports=reports, workers=workers, staging_root=tmp_path, allow_rejected=False)
    with pytest.raises(OrdImportError):
        compile_reaction_library(stream, output, sources=[entry])
    assert not output.exists()
    assert reports[0]["rejected_reactions"] == 1
    output = tmp_path / "explicit-partial.sqlite"
    stream = iter_import_records(sources, reports=[], workers=workers, staging_root=tmp_path, allow_rejected=True)
    assert compile_reaction_library(stream, output, sources=[entry])["record_count"] == 1
    assert list(tmp_path.glob(".ord-extract-*")) == []
