from pathlib import Path


def test_required_config_files_exist():
    root = Path(__file__).resolve().parents[2]

    for rel in ["configs/data-sources.yaml", "configs/stock-sources.yaml", "configs/llm.yaml"]:
        assert (root / rel).is_file(), rel


def test_data_source_config_names_expected_sources():
    text = (Path(__file__).resolve().parents[2] / "configs/data-sources.yaml").read_text()

    for source in ["USPTO", "ORD", "Organic Syntheses", "Reaxys", "Pistachio", "BKMS"]:
        assert source in text


def test_aizynthfinder_pistachio_100_plus_is_not_marked_available_without_assets():
    text = (Path(__file__).resolve().parents[2] / "configs/engines.yaml").read_text()

    assert "askcos_v2" in text
    assert "secondary_route_generator" not in text
    assert "aizynthfinder:" not in text
    from packages.adapters.aizynthfinder import AiZynthFinderAdapter
    import pytest
    adapter = AiZynthFinderAdapter(executable="python", config_path=Path("engines/aizynthfinder/models/config.yml"))
    with pytest.raises(FileNotFoundError):
        adapter.validate_assets("Pistachio_100+")


def test_stock_source_config_names_unified_supplier_sources():
    text = (Path(__file__).resolve().parents[2] / "configs/stock-sources.yaml").read_text()

    assert "commercial_catalog" in text
    assert "X_SYNTH_STOCK_INDEX" in text
    assert "runtime_online_lookup: false" in text
    assert "pubchem_cid_is_catalog_id: false" in text
    assert "unknown_price_is_zero: false" in text
    assert "unsupported_free_bulk_sources" not in text
    assert "no verified free public bulk exact-structure API or dump found" not in text


def test_pubchem_supplier_importer_is_available():
    script = Path(__file__).resolve().parents[2] / "scripts/data_import/import_pubchem_supplier_stock.py"

    assert script.is_file()
    text = script.read_text(encoding="utf-8")
    assert "Aladdin[SourceName]" in text
    assert "Ambeed[SourceName]" in text
    assert "TargetMol[SourceName]" in text
    assert "ChemScene[SourceName]" in text
    assert "--extra-compile-source" in text
    assert "pubchem_supplier_import_summary.json" in text
