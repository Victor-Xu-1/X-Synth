"""Import acceptance contracts through real parsers, never an online provider."""

import json

import pytest

from packages.adapters.stock.askcos_buyables import build_askcos_buyables_stock
from packages.adapters.stock.commercial_stock import load_commercial_stock_file
from packages.adapters.stock.domestic_artifacts import build_domestic_stock_artifacts
from packages.adapters.stock.pubchem_suppliers import _supplier_decision
from packages.adapters.stock.stock_index import supplier_record
from packages.adapters.stock.unified_aizynth_stock import build_unified_aizynth_stock
from test_stock_index import catalog_row

WEAK_ROWS = (
    {"smiles": "CCO", "source": "MC", "_id": "internal-only"},
    {"smiles": "CCO", "cas": "64-17-5"},
    {"smiles": "CCO", "supplier": "mcule"},
    {"smiles": "CCO", "source": "MC", "lead_time": "7 days"},
    {"smiles": "CCO", "source": "chemspace", "catalog_id": "PubChemCID:702"},
    {"smiles": "CC(=O)O", "source": "chemicalbook_cn", "catalog_id": "CB7854064",
     "url": "https://www.chemicalbook.com/ChemicalProductProperty_CN_CB7854064.htm"},
)


@pytest.mark.parametrize("row", WEAK_ROWS)
def test_all_retained_file_imports_reject_weak_procurement_evidence(tmp_path, row):
    path = tmp_path / "rows.json"
    path.write_text(json.dumps([row]), encoding="utf-8")
    assert not load_commercial_stock_file(path).is_buyable(row["smiles"])
    askcos = build_askcos_buyables_stock(source_paths=[path], output_dir=tmp_path / "askcos")
    assert askcos.summary["accepted_records"] == 0
    domestic = build_domestic_stock_artifacts(source_paths=[path], output_dir=tmp_path / "domestic")
    assert domestic.summary["accepted_records"] == 0
    aizynth = build_unified_aizynth_stock(source_paths=[path], output_dir=tmp_path / "aizynth")
    assert aizynth.summary["unique_structures"] == 0


def test_known_catalog_evidence_survives_each_import_without_guessing_price(tmp_path):
    row = catalog_row(ppg=None)
    row["url"] = row["properties"][0]["link"]
    path = tmp_path / "rows.json"
    path.write_text(json.dumps([row]), encoding="utf-8")
    assert load_commercial_stock_file(path).is_buyable("OCC")
    askcos = build_askcos_buyables_stock(source_paths=[path], output_dir=tmp_path / "askcos")
    domestic = build_domestic_stock_artifacts(
        source_paths=[path], output_dir=tmp_path / "domestic", default_source="mcule"
    )
    assert askcos.summary["accepted_records"] == domestic.summary["accepted_records"] == 1
    assert json.loads(domestic.askcos_buyables_path.read_text())[0]["ppg"] is None
    aizynth = build_unified_aizynth_stock(source_paths=[path], output_dir=tmp_path / "aizynth")
    assert aizynth.summary["unique_structures"] == 1


def test_default_price_and_boolean_price_cannot_become_recorded_prices(tmp_path):
    with pytest.raises(ValueError, match="default price"):
        build_domestic_stock_artifacts(
            source_paths=[], output_dir=tmp_path / "domestic", default_ppg=1,
        )
    assert supplier_record(catalog_row(ppg=True))["ppg"] is None


@pytest.mark.parametrize("field,value", [
    ("decision", "ambiguous"), ("decision", "rejected"),
    ("evidence_role", "structure_metadata"),
])
def test_explicit_non_procurement_rows_cannot_be_upgraded(field, value):
    assert supplier_record(catalog_row(**{field: value})) is None


@pytest.mark.parametrize("field,value", [
    ("decision", "ambiguous"), ("decision", "rejected"),
    ("evidence_role", "metadata"), ("evidence_role", "discovery"),
])
def test_explicit_roles_survive_import_normalization(tmp_path, field, value):
    row = catalog_row(**{field: value})
    row["url"] = row["properties"][0]["link"]
    test_all_retained_file_imports_reject_weak_procurement_evidence(tmp_path, row)


def test_json_ambiguous_metadata_keeps_canonical_identity(tmp_path):
    path = tmp_path / "metadata.json"
    path.write_text(json.dumps([{"smiles": "OCC", "cas": "64-17-5"}]), encoding="utf-8")
    registry = load_commercial_stock_file(path)
    assert not registry.is_buyable("CCO")
    assert registry.rejected_reasons("CCO")


def test_vendor_membership_and_sid_do_not_bypass_catalog_validation():
    assert _supplier_decision("CCO", {
        "SourceName": "mcule", "SID": 702, "SourceURL": "https://mcule.com",
    }) is None
    row = _supplier_decision("CCO", {
        "SourceName": "mcule", "SID": 702,
        "SourceRecordURL": catalog_row()["properties"][0]["link"],
    })
    assert row is not None and row.catalog_id == "MCULE-7654109565"
