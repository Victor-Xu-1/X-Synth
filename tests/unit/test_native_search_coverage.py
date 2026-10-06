"""Native search regressions without inference or live search workers."""

import ast
import importlib.util
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Dict, List, Optional, Set, Tuple

import networkx as nx
import pytest
from rdkit import Chem

from packages.adapters.askcos.catalog_pricer import CatalogPricer
from packages.adapters.askcos.native_price_client import PriceServiceUnavailable
from packages.adapters.askcos.retro_star_values import backup_search_values
from packages.adapters.stock.stock_index import compile_stock_index


NATIVE = Path(__file__).resolve().parents[2] / "apps/askcos-v2/tree_search"


def source_module(relative, name):
    spec = importlib.util.spec_from_file_location(name, NATIVE / relative)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def native_functions(relative, names, **dependencies):
    path = NATIVE / relative
    parsed = ast.parse(path.read_text())
    body = [
        node for node in parsed.body
        if isinstance(node, ast.FunctionDef) and node.name in names
    ]
    namespace = {
        "Any": Any, "Dict": Dict, "List": List, "Optional": Optional,
        "Set": Set, "Tuple": Tuple, **dependencies,
    }
    exec(compile(ast.Module(body=body, type_ignores=[]), str(path), "exec"), namespace)
    return namespace


def native_controller(strategy, name, names):
    path = NATIVE / strategy / (strategy + "_controller.py")
    parsed = ast.parse(path.read_text())
    declaration = next(
        node for node in parsed.body
        if isinstance(node, ast.ClassDef) and node.name == name
    )
    declaration.body = [
        node for node in declaration.body
        if isinstance(node, ast.FunctionDef) and node.name in names
    ]
    terminal = native_functions(
        strategy + "/utils.py", {"is_terminal"}, SCScorerAPI=object,
    )["is_terminal"]
    namespace = {
        "Chem": Chem, "nx": nx, "List": List, "Optional": Optional,
        "Set": Set, "Tuple": Tuple, "is_terminal": terminal,
        "canonicalize_smiles": lambda smiles: Chem.MolToSmiles(Chem.MolFromSmiles(smiles)),
        "backup_search_values": backup_search_values,
    }
    exec(compile(ast.Module(body=[declaration], type_ignores=[]), str(path), "exec"), namespace)
    return namespace[name]()


@pytest.fixture
def batch_pricer(tmp_path):
    # A controlled catalog contract, not scientific or supplier acceptance evidence.
    path = tmp_path / "stock.sqlite"
    compile_stock_index(
        [{"smiles": "CCO", "source": "MC", "ppg": None,
          "properties": [{"link": "https://mcule.com/MCULE-7654109565"}]}],
        output=path, source_id="contract", source_sha256="a" * 64,
    )
    catalog = CatalogPricer(path)
    wrapper = source_module("expand_one/api/pricer_api.py", "expand_one_stock_contract")
    api = wrapper.PricerAPI("http://127.0.0.1:1/unused")
    api.client = SimpleNamespace(
        lookup_many=lambda smiles, **options: catalog.lookup_smiles_list(smiles),
        lookup=lambda smiles, **options: catalog.lookup_smiles(smiles),
    )
    return api, catalog


def test_expand_one_batch_retains_exact_catalog_evidence_and_unknown_price(batch_pricer):
    api, catalog = batch_pricer
    rows = api.lookup_many(["CCO", "CN", "[13CH3]CO"])
    assert rows["CCO"] == catalog.lookup_smiles("CCO")
    assert rows["CCO"]["ppg"] is None
    assert rows["CCO"]["buyable"] is True
    assert "CN" not in rows and "[13CH3]CO" not in rows


def test_cached_expand_one_stock_record_closes_mcts_without_inventing_price(batch_pricer):
    api, catalog = batch_pricer
    functions = native_functions(
        "expand_one/expand_one_controller.py",
        {"_prefetch_exact_fragment_prices", "_price_fragment"},
        PricerAPI=type(api), pricer=api,
    )
    cache = {}
    functions["_prefetch_exact_fragment_prices"](
        ["CCO.CN", "CCO"], use_smarts=False, price_client=api, cache=cache,
    )
    cached = functions["_price_fragment"]("CCO", use_smarts=False, cache=cache)
    assert cached == catalog.lookup_smiles("CCO")
    assert cached["ppg"] is None
    controller = native_controller("mcts", "MCTS", {
        "create_chemical_node", "create_reaction_node", "_initialize", "_expand",
        "_get_ancestors", "_update_value",
    })
    controller.tree, controller.chemicals = nx.DiGraph(), []
    controller.build_tree_options = SimpleNamespace(
        buyables_source="unified_commercial", termination_logic={"and": ["buyable"]},
        custom_buyables=None,
    )
    controller.expand_one_options = SimpleNamespace(
        retro_backend_options=[SimpleNamespace(retro_model_name="pistachio")],
    )
    controller.historian = lambda **options: {"as_reactant": 0, "as_product": 0}
    controller.scscorer = None
    controller.pricer = lambda **options: pytest.fail("Batch evidence should not be fetched again")
    controller.create_chemical_node("CCO", price_info=cached)
    node = controller.tree.nodes["CCO"]
    assert node["terminal"] and node["solved"] and node["done"]
    assert node["purchase_price"] is None
    assert node["properties"] == cached["properties"]
    controller.create_chemical_node("CN", price_info=cache["CN"])
    assert not controller.tree.nodes["CN"]["terminal"]
    controller.pricer = lambda **options: (0.0, None)
    controller.reactions, controller.cancel_event, controller.rpc_deadline = [], None, None
    controller._initialize("CCOC")
    controller.expand_one = lambda **options: [{
        "outcome": "CCO", "average_model_score": 0.8, "model_metadata": [],
        "precursor_properties": {"precursor_prices": {"CCO": cached}},
        "precursor_rank": 1, "precursor_score": 1.0,
        "reaction_properties": {"canonical_reaction_smiles": "CCO>>CCOC", "plausibility": 0.9},
    }]
    controller._expand([controller.target])
    assert controller.tree.nodes[controller.target]["solved"] is True


def test_mcts_preserves_supplied_buyable_properties_without_a_price():
    controller = native_controller("mcts", "MCTS", {"create_chemical_node"})
    controller.tree, controller.chemicals = nx.DiGraph(), []
    controller.build_tree_options = SimpleNamespace(
        termination_logic={"and": ["buyable"]}, custom_buyables=None,
    )
    controller.expand_one_options = SimpleNamespace(retro_backend_options=[])
    controller.historian = lambda **options: {"as_reactant": 0, "as_product": 0}
    controller.scscorer = None
    controller.create_chemical_node("CCO", price_info={
        "ppg": None, "properties": [{"buyable": True}, {"stock_snapshot": "a" * 64}],
    })
    assert controller.tree.nodes["CCO"]["terminal"] is True


def test_batch_stock_outage_is_not_cached_as_negative_evidence():
    def unavailable(*args, **kwargs):
        raise PriceServiceUnavailable("Stock unavailable")

    functions = native_functions(
        "expand_one/expand_one_controller.py", {"_prefetch_exact_fragment_prices"},
        PricerAPI=object,
    )
    cache = {}
    with pytest.raises(PriceServiceUnavailable):
        functions["_prefetch_exact_fragment_prices"](
            ["CCO"], use_smarts=False,
            price_client=SimpleNamespace(lookup_many=unavailable), cache=cache,
        )
    assert cache == {}


@pytest.mark.parametrize("maximum,allowed", [(1, False), (2, True), (3, True)])
def test_retrostar_reaches_the_full_reaction_depth_budget(maximum, allowed):
    controller = native_controller("retro_star", "RetroStar", {
        "_initialize", "create_chemical_node", "create_reaction_node", "_expand",
        "_select", "_get_ancestors", "_update", "is_reaction_done",
    })
    controller.tree = nx.DiGraph()
    controller.chemicals, controller.reactions = set(), set()
    controller.build_tree_options = SimpleNamespace(
        buyables_source="unified_commercial", termination_logic={"and": ["buyable"]},
        custom_buyables=None, max_depth=maximum, max_branching=50,
    )
    controller.expand_one_options = SimpleNamespace(retro_backend_options=[])
    controller.pricer = lambda **options: (0.0, None)
    controller.historian = lambda **options: {"as_reactant": 0, "as_product": 0}
    controller.scscorer, controller.value_fn = None, lambda smiles: 0.0
    controller.check_cancelled = lambda: None
    controller.cancel_event, controller.rpc_deadline = None, None
    # Controlled topology only. No generated reaction is claimed to be chemical evidence.
    controller.expand_one = lambda **options: [{
        "outcome": "CO", "average_model_score": 0.8, "model_metadata": [],
        "precursor_properties": {}, "precursor_rank": 1, "precursor_score": 1.0,
        "reaction_properties": {"canonical_reaction_smiles": "CO>>CCO", "plausibility": 0.9},
    }]
    controller._initialize("CCO")
    assert controller.tree.nodes[controller.target]["min_depth"] == 0
    controller._expand(controller.target)
    controller._update(controller.target)
    assert controller.tree.nodes["CO"]["min_depth"] == 1
    assert (controller._select() == "CO") is allowed
