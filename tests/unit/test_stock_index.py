from concurrent.futures import ThreadPoolExecutor

import pytest

from packages.adapters.stock.stock_index import (
    IndexedCommercialStockRegistry, StockIndex, StockIndexError, compile_stock_index, supplier_record,
)


def catalog_row(**updates):
    row = {"smiles": "CCO", "source": "MC", "ppg": 5.16,
           "properties": [{"link": "https://mcule.com/MCULE-7654109565"}]}
    return {**row, **updates}


def test_internal_id_and_lead_time_are_not_catalog_evidence():
    assert supplier_record(catalog_row(_id="mongo-object-id", properties=[], lead_time="7 days")) is None
    assert supplier_record(catalog_row(properties=[{"link": "https://mcule.com.evil.example/123"}])) is None
    assert supplier_record(catalog_row(properties=[{"link": "javascript:alert(1)"}])) is None
    assert supplier_record(catalog_row(properties=[{"link": "https://mcule.com/search?q=ethanol"}])) is None
    assert supplier_record(catalog_row(catalog_id="different-product")) is None


def test_real_sqlite_index_exact_matching_read_only_and_concurrency(tmp_path):
    path = tmp_path / "stock.sqlite"
    summary = compile_stock_index([catalog_row(), catalog_row(), catalog_row(smiles="not-a-structure")],
                                  output=path, source_id="catalog", source_sha256="a" * 64)
    assert summary["accepted_records"] == 1
    assert summary["duplicate_records"] == 1
    assert summary["rejected_records"] == 1
    index = StockIndex(path)
    assert index.lookup("OCC")[0]["ppg"] == 5.16
    assert not index.lookup("OC(C(F)=CC=C1)=C1C2=CC3=C(NCC34CCNCC4)N=N2")
    batch = index.lookup_many(["OCC", "CCO", "CCN"])
    assert set(batch) == {"CCO", "CCN"}
    assert len(batch["CCO"]) == 1
    assert batch["CCN"] == []
    with ThreadPoolExecutor(max_workers=4) as pool:
        assert all(pool.map(lambda _: bool(index.lookup("CCO")), range(12)))
    with index.connect() as connection, pytest.raises(Exception, match="readonly"):
        connection.execute("DELETE FROM evidence")
    registry = IndexedCommercialStockRegistry(index)
    assert registry.is_buyable("OCC")
    assert registry.accepted_sources("CCO") == ["mcule"]
    assert registry.accepted_decision_count(limit=10) == 1
    with pytest.raises(FileExistsError):
        compile_stock_index([catalog_row()], output=path, source_id="other", source_sha256="b" * 64)


def test_missing_damaged_and_empty_indexes_fail_not_no_match(tmp_path):
    with pytest.raises(StockIndexError):
        StockIndex(tmp_path / "missing.sqlite")
    output = tmp_path / "empty.sqlite"
    with pytest.raises(StockIndexError):
        compile_stock_index([], output=output, source_id="empty", source_sha256="a" * 64)
    assert not output.exists()
    assert not output.with_name(output.name + ".building").exists()


def test_unknown_price_is_not_fabricated():
    assert supplier_record(catalog_row(ppg=None))["ppg"] is None
    assert supplier_record(catalog_row(ppg=float("nan")))["ppg"] is None
