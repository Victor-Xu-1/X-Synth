"""Graph correctness checks, plus a retained genuine native route benchmark."""

import ast
import json
from pathlib import Path
from types import SimpleNamespace

import networkx as nx
import pytest

from packages.adapters.askcos.route_reachability import grounded_route_graph

ROOT = Path(__file__).resolve().parents[2]


def graph(edges, terminals=()):
    tree = nx.DiGraph(edges)
    for node in tree:
        tree.nodes[node].update(type="reaction" if node.startswith("r:") else "chemical", terminal=node in terminals)
    return tree


def test_unanchored_cycle_cannot_become_a_route():
    tree = graph([("target", "r:make"), ("r:make", "a"), ("a", "r:back"), ("r:back", "a")])
    before = nx.node_link_data(tree, edges="links")
    assert set(grounded_route_graph(tree, "target")) == {"target"}
    assert nx.node_link_data(tree, edges="links") == before


def test_reaction_requires_every_precursor_not_just_one_buyable():
    tree = graph([("target", "r:make"), ("r:make", "a"), ("r:make", "missing")], terminals={"a"})
    assert set(grounded_route_graph(tree, "target")) == {"target"}


def test_stock_exit_preserves_the_complete_path_and_removes_dead_cycle():
    tree = graph([
        ("target", "r:make"), ("r:make", "a"), ("a", "r:exit"), ("r:exit", "stock"),
        ("target", "r:bad"), ("r:bad", "loop"), ("loop", "r:cycle"), ("r:cycle", "loop"),
    ], terminals={"stock"})
    result = grounded_route_graph(tree, "target")
    assert set(result) == {"target", "r:make", "a", "r:exit", "stock"}
    assert nx.has_path(result, "target", "stock")


def test_target_cannot_supply_itself_and_stock_expansion_stops():
    tree = graph([
        ("target", "r:make"), ("r:make", "stock"),
        ("stock", "r:extra"), ("r:extra", "other"),
        ("target", "r:self"), ("r:self", "target"),
    ], terminals={"target", "stock", "other"})
    result = grounded_route_graph(tree, "target")
    assert set(result) == {"target", "r:make", "stock"}
    assert result.out_degree("stock") == 0
    assert tree.nodes["target"]["terminal"] is True


def test_invalid_native_topology_is_not_hidden_as_an_empty_search():
    with pytest.raises(ValueError, match="alternate"):
        grounded_route_graph(graph([("target", "other")]), "target")


def test_real_native_benchmark_keeps_all_routes_grounded_in_terminals():
    payload = json.loads((ROOT / "tests/fixtures/askcos/diphenhydramine_retrostar_result.json").read_text())
    while "uds" not in payload:
        payload = payload.get("result") or payload.get("results") or payload.get("payload")
    uds = payload["uds"]
    tree = nx.DiGraph()
    for key, value in uds["node_dict"].items():
        tree.add_node(key, **value)
    tree.add_edges_from((edge["source"], edge["target"]) for edge in uds["graph"])
    target = "CN(C)CCOC(c1ccccc1)c1ccccc1"
    pruned = grounded_route_graph(tree, target)
    assert len(pruned) > 1
    for pathway in uds["pathways"]:
        smiles = {uds["uuid2smiles"][edge[key]] for edge in pathway for key in ("source", "target")}
        assert smiles <= set(pruned)


def test_unsolved_retrostar_returns_before_any_combinatorial_work():
    source = ROOT / "apps/askcos-v2/tree_search/retro_star/retro_star_controller.py"
    module = ast.parse(source.read_text())
    controller = next(node for node in module.body if isinstance(node, ast.ClassDef) and node.name == "RetroStar")
    method = next(node for node in controller.body if isinstance(node, ast.FunctionDef) and node.name == "enumerate_paths")
    namespace = {"List": list}
    exec(compile(ast.Module(body=[method], type_ignores=[]), str(source), "exec"), namespace)
    tree = graph([("target", "r:dead"), ("r:dead", "missing")])
    tree.nodes["target"]["solved"] = False
    instance = SimpleNamespace(tree=tree, target="target", paths=None)
    assert namespace["enumerate_paths"](instance) == []
    assert instance.paths == []
