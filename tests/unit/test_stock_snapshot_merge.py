"""Snapshot composition is data ingestion, never a chemical model provider."""

import hashlib

import pytest

from packages.adapters.stock.stock_index import StockIndex
from packages.adapters.stock.stock_merge import merge_stock_snapshots, snapshot_records
from packages.adapters.stock.stock_snapshot import StockIndexError, compile_stock_index
from packages.adapters.stock.supplier_evidence import supplier_record


def catalog_row(smiles="N", identifier="294993", cas="7664-41-7"):
    return {"source": "sigma_aldrich", "catalog_id": identifier, "smiles": smiles,
            "cas": cas, "ppg": None,
            "url": "https://www.sigmaaldrich.com/US/en/product/aldrich/" + identifier}


def snapshot(path, rows):
    compile_stock_index(rows, output=path, source_id="unit-catalog",
                        source_sha256="a" * 64)
    return StockIndex(path)


def test_keyset_export_and_composition_preserve_every_existing_record(tmp_path):
    base = snapshot(tmp_path / "base.sqlite", [catalog_row(), catalog_row("O", "W4502", "7732-18-5")])
    before = hashlib.sha256(base.path.read_bytes()).hexdigest()
    rows = list(snapshot_records(base, batch_size=1))
    assert len(rows) == 2 and {row["smiles"] for row in rows} == {"N", "O"}
    output = tmp_path / "merged.sqlite"
    receipt = merge_stock_snapshots([base.path], [catalog_row("Cl", "H3162", "7647-01-0")],
        additional_sha256="b" * 64, output=output, source_id="unified-catalog")
    merged = StockIndex(output)
    assert merged.summary["accepted_records"] == 3
    assert merged.summary["unique_structures"] == 3
    assert all(merged.lookup(key) for key in ("N", "O", "Cl"))
    assert receipt["base_catalogs"][0]["catalog_sha256"] == before
    assert merged.summary["source_sha256"] != base.summary["source_sha256"]
    assert hashlib.sha256(base.path.read_bytes()).hexdigest() == before
    assert all(row["ppg"] is None for row in snapshot_records(merged))


def test_conflicting_price_is_not_silently_first_record_wins(tmp_path):
    first, second = catalog_row(), catalog_row()
    first["ppg"], second["ppg"] = 1.0, 2.0
    path = tmp_path / "conflict.sqlite"
    with pytest.raises(StockIndexError, match="Conflicting catalog"):
        compile_stock_index([first, second], output=path, source_id="unit-catalog", source_sha256="a" * 64)
    assert not path.exists() and not path.with_name(path.name + ".building").exists()


def test_identical_record_duplicates_remain_explicit(tmp_path):
    index = snapshot(tmp_path / "duplicate.sqlite", [catalog_row(), catalog_row()])
    assert index.summary["accepted_records"] == 1
    assert index.summary["duplicate_records"] == 1


def test_supplier_structure_and_claimed_inchikey_must_agree():
    valid = {**catalog_row(), "inchi_key": "QGZKDVFQNNGYKY-UHFFFAOYSA-N"}
    assert supplier_record(valid) is not None
    assert supplier_record({**valid, "smiles": "CCO"}) is None
    assert supplier_record({**valid, "inchi_key": []}) is None
    assert supplier_record({**valid, "inchikey": "conflicting-alias"}) is None
    assert supplier_record({**catalog_row(), "smiles": "*"}) is None
    assert supplier_record({**catalog_row(), "smiles": "C[*]"}) is None


@pytest.mark.parametrize("size", [0, -1, True, 5001])
def test_paging_cannot_disable_the_read_budget(tmp_path, size):
    base = snapshot(tmp_path / "base.sqlite", [catalog_row()])
    with pytest.raises(ValueError, match="batches"):
        list(snapshot_records(base, batch_size=size))


def test_failed_publication_guard_never_exposes_a_snapshot(tmp_path):
    def guard():
        raise StockIndexError("source changed")
    output = tmp_path / "unpublished.sqlite"
    with pytest.raises(StockIndexError, match="source changed"):
        compile_stock_index([catalog_row()], output=output, source_id="unit-catalog",
                            source_sha256="a" * 64, publication_guard=guard)
    assert not output.exists()


def test_composition_cannot_overwrite_any_input(tmp_path):
    base = snapshot(tmp_path / "base.sqlite", [catalog_row()])
    before = base.summary["catalog_sha256"]
    with pytest.raises(FileExistsError):
        merge_stock_snapshots([base.path], [], additional_sha256="b" * 64,
                              output=base.path, source_id="invalid-output")
    assert base.summary["catalog_sha256"] == before
