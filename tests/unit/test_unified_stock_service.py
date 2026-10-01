import json

from packages.adapters.stock.commercial_stock import EvidenceDecision
from packages.adapters.stock.unified_stock_service import UnifiedStockService


def test_unified_stock_service_discovers_project_stock_sources(tmp_path):
    repo_root = tmp_path
    commercial_dir = repo_root / "data" / "compiled" / "commercial_stock"
    domestic_dir = repo_root / "data" / "compiled" / "domestic_stock"
    buyables_dir = repo_root / "apps" / "askcos-v2" / "askcos2_core" / "data" / "db" / "buyables"
    aizynth_dir = repo_root / "engines" / "aizynthfinder" / "models"
    for path in [commercial_dir, domestic_dir, buyables_dir, aizynth_dir]:
        path.mkdir(parents=True)

    commercial_stock = commercial_dir / "synon_stock.json"
    domestic_stock = domestic_dir / "synon_stock.json"
    buyables = buyables_dir / "chemspace_buyables_2026Apr.json.gz"
    aizynth_stock = aizynth_dir / "zinc_stock.hdf5"
    commercial_stock.write_text(
        json.dumps(
            [
                {
                    "smiles": "CCO",
                    "source": "chemspace",
                    "decision": "accepted",
                    "reason": "exact",
                    "catalog_id": "CSSB1",
                }
            ]
        ),
        encoding="utf-8",
    )
    domestic_stock.write_text(
        json.dumps(
            [
                {
                    "smiles": "CCN",
                    "source": "chemicalbook_cn",
                    "decision": "accepted",
                    "reason": "exact",
                    "catalog_id": "CB1",
                }
            ]
        ),
        encoding="utf-8",
    )
    buyables.write_bytes(b"not-loaded-by-service")
    aizynth_stock.write_bytes(b"hdf5-placeholder")

    service = UnifiedStockService(repo_root=repo_root)

    summary = service.summary()
    names = {source["name"] for source in summary["sources"]}
    assert {
        "compiled_commercial_stock",
        "compiled_domestic_stock",
        "askcos_buyables_raw",
        "aizynthfinder_zinc_stock",
        "pubchem_suppliers",
        "operator_supplier_import_cache",
    }.issubset(names)
    assert service.external_stock_paths() == [str(commercial_stock), str(domestic_stock)]

    registry = service.load_registry()
    assert registry is not None
    assert registry.is_buyable("CCO")
    assert registry.is_buyable("CCN")


def test_unified_stock_service_uses_online_supplier_decisions_without_files(tmp_path):
    service = UnifiedStockService(
        repo_root=tmp_path,
        online_decisions=[
            EvidenceDecision(
                smiles="CCO",
                source="pubchem:Sigma-Aldrich",
                decision="accepted",
                reason="exact PubChem vendor evidence",
                catalog_id="459844",
            )
        ],
    )

    registry = service.load_registry()

    assert registry is not None
    assert registry.accepted_sources("CCO") == ["pubchem:Sigma-Aldrich"]
