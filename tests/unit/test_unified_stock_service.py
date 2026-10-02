import pytest
from packages.adapters.stock.stock_index import compile_stock_index
from packages.adapters.stock.unified_stock_service import UnifiedStockService


def test_one_index_is_shared_by_runtime_and_closure(tmp_path):
    path = tmp_path / "catalog.sqlite"
    compile_stock_index([{"smiles": "CCO", "source": "chemspace",
                          "url": "https://chem-space.com/CSSB20785368330", "ppg": 253}],
                        output=path, source_id="real-catalog-row", source_sha256="a" * 64)
    service = UnifiedStockService(repo_root=tmp_path, env={"X_SYNTH_STOCK_INDEX": str(path)})
    assert service.summary()["status"] == "ready"
    assert [row["name"] for row in service.summary()["sources"]] == ["commercial_catalog"]
    assert service.load_registry().accepted_sources("OCC") == ["chemspace"]


def test_missing_index_does_not_advertise_unavailable_suppliers(tmp_path):
    service = UnifiedStockService(repo_root=tmp_path, env={})
    assert service.summary()["sources"] == []
    assert service.summary()["status"] == "unavailable"
    assert service.load_registry() is None


def test_unsealed_online_or_json_evidence_cannot_change_a_runtime_snapshot(tmp_path):
    with pytest.raises(ValueError, match="Compile"):
        UnifiedStockService(repo_root=tmp_path, external_stock_paths=["unverified.json"], env={})
