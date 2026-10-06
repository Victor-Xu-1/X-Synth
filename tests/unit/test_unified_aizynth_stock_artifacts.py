import json

import yaml

from packages.adapters.stock.unified_aizynth_stock import (
    build_unified_aizynth_stock,
)


def test_unified_aizynth_stock_merges_and_deduplicates_exact_sources(tmp_path):
    first = tmp_path / "commercial.json"
    second = tmp_path / "domestic.json"
    first.write_text(
        json.dumps(
            [
                {"smiles": "CCO", "source": "chemspace", "decision": "accepted",
                 "url": "https://chem-space.com/CSSB00000000009"},
                {"smiles": "CCN", "source": "mcule", "decision": "accepted",
                 "url": "https://mcule.com/MCULE-100"},
            ]
        ),
        encoding="utf-8",
    )
    second.write_text(
        json.dumps(
            [
                {"smiles": "OCC", "source": "aladdin", "decision": "accepted",
                 "url": "https://www.aladdin-e.com/zh_cn/entry-1.html"},
                {"smiles": "CCCl", "source": "ambeed", "decision": "accepted",
                 "url": "https://www.ambeed.com/products/entry-2.html"},
                {"smiles": "invalid", "source": "ambeed", "decision": "accepted"},
                {"smiles": "CCC", "source": "ambeed", "decision": "rejected"},
            ]
        ),
        encoding="utf-8",
    )

    artifacts = build_unified_aizynth_stock(
        source_paths=[first, second],
        output_dir=tmp_path / "compiled",
    )

    inchikeys = artifacts.stock_path.read_text(encoding="utf-8").splitlines()
    assert len(inchikeys) == 3
    assert inchikeys == sorted(set(inchikeys))
    config = yaml.safe_load(artifacts.config_path.read_text(encoding="utf-8"))
    assert config["stock"]["unified"]["type"] == "inchiset"
    assert config["stock"]["unified"]["path"] == str(artifacts.stock_path)
    assert artifacts.summary == {
        "accepted_input_records": 5,
        "invalid_smiles_records": 1,
        "rejected_evidence_records": 0,
        "unique_structures": 3,
        "source_paths": [str(first), str(second)],
        "stock_name": "unified",
        "stock_path": str(artifacts.stock_path),
        "config_path": str(artifacts.config_path),
    }
