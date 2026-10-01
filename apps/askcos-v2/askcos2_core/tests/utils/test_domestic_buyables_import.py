from utils.buyables_import import (
    expand_buyables_source_aliases,
    normalize_domestic_buyable_records,
)
from utils.pricer import MongoPricer
from configs import db_config


def test_normalizes_chemicalbook_columns_to_buyable_input():
    rows = [
        {
            "SMILES": "OC(C)=O",
            "CAS号": "64-19-7",
            "供应商": "ChemicalBook",
            "货号": "CB7854064",
            "链接": "https://www.chemicalbook.com/ChemicalProductProperty_CN_CB7854064.htm",
            "库存": "现货",
        }
    ]

    normalized, errors = normalize_domestic_buyable_records(
        rows,
        default_source="chemicalbook_cn",
    )

    assert errors == []
    assert normalized == [
        {
            "smiles": "CC(=O)O",
            "ppg": 1.0,
            "lead_time": "现货",
            "source": "chemicalbook_cn",
            "properties": [
                {"cas": "64-19-7"},
                {"supplier": "ChemicalBook"},
                {"catalog_no": "CB7854064"},
                {
                    "product_url": "https://www.chemicalbook.com/ChemicalProductProperty_CN_CB7854064.htm"
                },
                {"availability": "现货"},
                {"evidence_source": "chemicalbook_cn"},
                {"country": "CN"},
            ],
        }
    ]


def test_domestic_alias_includes_chemicalbook_and_cn_suppliers():
    expanded = expand_buyables_source_aliases(["domestic", "chemspace"])

    assert "chemicalbook_cn" in expanded
    assert "leyan" in expanded
    assert "bidepharm" in expanded
    assert "chemspace" in expanded


def test_pricer_domestic_alias_returns_ppg_for_retrostar_terminal():
    pricer = MongoPricer(
        config=db_config.MONGO,
        database="askcos_test",
        collection="buyables_domestic_import_test",
    )
    pricer.collection.delete_many({})
    pricer.dedup_collection.delete_many({})

    pricer.collection.insert_one(
        {
            "_id": "domestic-import-acetic-acid",
            "smiles": "CC(=O)O",
            "ppg": 1.0,
            "lead_time": "现货",
            "source": "chemicalbook_cn",
            "properties": [{"cas": "64-19-7"}],
        }
    )

    result = pricer.lookup_smiles("CC(=O)O", source="domestic")

    assert result is not None
    assert result["source"] == "chemicalbook_cn"
    assert result["ppg"] > 0


def test_pricer_preloaded_smarts_request_falls_back_when_cache_not_loaded():
    pricer = MongoPricer(
        config=db_config.MONGO,
        database="askcos_test",
        collection="buyables_preloaded_fallback_test",
        preload_buyables=False,
    )
    pricer.collection.delete_many({})
    pricer.dedup_collection.delete_many({})
    pricer.collection.insert_one(
        {
            "_id": "preloaded-fallback-acetic-acid",
            "smiles": "CC(=O)O",
            "ppg": 1.0,
            "lead_time": "现货",
            "source": "chemicalbook_cn",
            "properties": [{"cas": "64-19-7"}],
        }
    )

    result = pricer.lookup_smarts(
        smarts="CC(=O)O",
        limit=1,
        version="preloaded",
        convert_smiles=False,
    )

    assert result
    assert result[0]["smiles"] == "CC(=O)O"
