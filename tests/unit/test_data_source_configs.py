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

    assert "Pistachio_100+" in text
    assert "missing_licensed_assets" in text
    assert "Only enable when the licensed ONNX/template assets are present" in text


def test_stock_source_config_names_unified_supplier_sources():
    text = (Path(__file__).resolve().parents[2] / "configs/stock-sources.yaml").read_text()

    for source in [
        "compiled_commercial_stock",
        "compiled_domestic_stock",
        "compiled_unified_aizynth_stock",
        "askcos_buyables_raw",
        "aizynthfinder_zinc_stock",
        "aladdin",
        "ambeed",
        "targetmol",
        "chemscene",
        "combi_blocks",
        "sigma_aldrich",
        "pubchem_suppliers",
    ]:
        assert source in text
    assert "native_engine_stock_must_be_compiled_for_synon_closure" in text
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
