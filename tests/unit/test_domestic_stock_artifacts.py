import json
import gzip
import importlib.util
from pathlib import Path

from packages.adapters.stock.askcos_buyables import build_askcos_buyables_stock
from packages.adapters.stock.domestic_artifacts import build_domestic_stock_artifacts


def _load_askcos_buyables_import():
    module_path = (
        Path("apps")
        / "askcos-v2"
        / "askcos2_core"
        / "utils"
        / "buyables_import.py"
    )
    spec = importlib.util.spec_from_file_location("askcos_buyables_import", module_path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_domestic_stock_artifacts_compile_once_for_all_route_engines(tmp_path):
    source_file = tmp_path / "chemicalbook_export.csv"
    source_file.write_text(
        "SMILES,CAS号,供应商,货号,链接,库存,价格\n"
        "OC(C)=O,64-19-7,ChemicalBook,CB7854064,"
        "https://www.chemicalbook.com/ChemicalProductProperty_CN_CB7854064.htm,现货,12 元/g\n",
        encoding="utf-8",
    )

    result = build_domestic_stock_artifacts(
        source_paths=[source_file],
        output_dir=tmp_path / "compiled",
        default_source="chemicalbook_cn",
    )

    assert result.summary["accepted_records"] == 1
    assert result.summary["rejected_records"] == 0
    assert result.askcos_buyables_path.is_file()
    assert result.synon_stock_path.is_file()
    assert result.aizynth_stock_path.is_file()
    assert result.aizynth_stock_config_path.is_file()

    askcos_rows = json.loads(result.askcos_buyables_path.read_text(encoding="utf-8"))
    synon_rows = json.loads(result.synon_stock_path.read_text(encoding="utf-8"))
    aizynth_lines = result.aizynth_smiles_audit_path.read_text(encoding="utf-8").splitlines()
    aizynth_stock_config = result.aizynth_stock_config_path.read_text(encoding="utf-8")

    assert askcos_rows[0]["smiles"] == "CC(=O)O"
    assert askcos_rows[0]["source"] == "chemicalbook_cn"
    assert synon_rows[0]["decision"] == "accepted"
    assert synon_rows[0]["smiles"] == "CC(=O)O"
    assert synon_rows[0]["catalog_id"] == "CB7854064"
    assert synon_rows[0]["cas"] == "64-19-7"
    assert synon_rows[0]["url"].startswith("https://www.chemicalbook.com/")
    assert aizynth_lines == ["CC(=O)O CB7854064 chemicalbook_cn"]
    assert result.aizynth_stock_path.read_text(encoding="utf-8").strip() == "QTBSBXVTEAMEQO-UHFFFAOYSA-N"
    assert "domestic:" in aizynth_stock_config
    assert str(result.aizynth_stock_path) in aizynth_stock_config


def test_domestic_alias_covers_compiled_supplier_sources():
    expanded = _load_askcos_buyables_import().expand_buyables_source_aliases(["domestic"])

    for source in [
        "aladdin",
        "ambeed",
        "chemscene",
        "combi_blocks",
        "sigma_aldrich",
        "targetmol",
    ]:
        assert source in expanded


def test_domestic_stock_artifacts_reject_weak_rows_without_commercial_evidence(tmp_path):
    source_file = tmp_path / "weak.csv"
    source_file.write_text("smiles\nCCO\n", encoding="utf-8")

    result = build_domestic_stock_artifacts(
        source_paths=[source_file],
        output_dir=tmp_path / "compiled",
    )

    assert result.summary["accepted_records"] == 0
    assert result.summary["rejected_records"] == 1
    assert json.loads(result.askcos_buyables_path.read_text(encoding="utf-8")) == []
    assert json.loads(result.synon_stock_path.read_text(encoding="utf-8")) == []
    assert result.aizynth_stock_path.read_text(encoding="utf-8") == ""
    assert result.aizynth_smiles_audit_path.read_text(encoding="utf-8") == ""


def test_domestic_stock_artifacts_reject_invalid_supplier_smiles(tmp_path):
    source_file = tmp_path / "invalid.csv"
    source_file.write_text(
        "smiles,supplier,catalog_id\n"
        "Br(Br)(Br),Aladdin,A-invalid\n",
        encoding="utf-8",
    )

    result = build_domestic_stock_artifacts(
        source_paths=[source_file],
        output_dir=tmp_path / "compiled",
    )

    assert result.summary["accepted_records"] == 0
    assert result.summary["rejected_records"] == 1
    rejected = json.loads(result.rejected_path.read_text(encoding="utf-8"))
    assert rejected[0]["reason"] == "invalid_smiles"


def test_askcos_buyables_compile_into_shared_synon_stock(tmp_path):
    source_file = tmp_path / "chemspace_buyables.json.gz"
    with gzip.open(source_file, "wt", encoding="utf-8") as handle:
        json.dump(
            [
                {
                    "smiles": "CCO",
                    "source": "CS",
                    "lead_time": "",
                    "properties": [
                        {"link": "https://chem-space.com/CSSB00000000009"},
                        {"availability": "in stock"},
                    ],
                },
                {"smiles": "", "source": "CS", "properties": []},
            ],
            handle,
        )

    result = build_askcos_buyables_stock(
        source_paths=[source_file],
        output_dir=tmp_path / "compiled",
    )

    rows = json.loads(result.synon_stock_path.read_text(encoding="utf-8"))
    assert result.summary["accepted_records"] == 1
    assert result.summary["rejected_records"] == 1
    assert rows == [
        {
            "smiles": "CCO",
            "source": "chemspace",
            "decision": "accepted",
            "reason": "ASKCOS buyables exact structure with supplier catalog evidence",
            "catalog_id": "CSSB00000000009",
            "cas": None,
            "url": "https://chem-space.com/CSSB00000000009",
            "source_file": str(source_file),
        }
    ]
