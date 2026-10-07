import ast
from collections import Counter
from collections.abc import Iterator
from copy import deepcopy
import json
from pathlib import Path
from typing import Any

import networkx as nx
import pytest

from packages.adapters.askcos.route_enumeration import enumerate_route_graphs
from packages.adapters.askcos.route_reachability import grounded_route_graph
from packages.route_pool.askcos import normalize_askcos_tree_result

ROOT = Path(__file__).resolve().parents[2]


def captured_native_graph():
    fixture = ROOT / "tests/fixtures/askcos/diphenhydramine_retrostar_result.json"
    payload = json.loads(fixture.read_text(encoding="utf-8"))
    while "uds" not in payload:
        payload = payload.get("result") or payload.get("results") or payload.get("payload")
    uds = payload["uds"]
    tree = nx.DiGraph()
    for node, data in uds["node_dict"].items():
        tree.add_node(node, **{**data, "purchase_price": data.get("purchase_price", data.get("ppg", 0))})
    tree.add_edges_from((edge["source"], edge["target"]) for edge in uds["graph"])
    target = "CN(C)CCOC(c1ccccc1)c1ccccc1"
    return uds, tree, target


def assert_closed_projection(source, path):
    assert nx.is_directed_acyclic_graph(path)
    assert all(source.has_edge(path.nodes[a]["smiles"], path.nodes[b]["smiles"]) for a, b in path.edges)
    assert all(data["type"] == "chemical" and data.get("terminal") is True
               for node, data in path.nodes(data=True) if path.out_degree(node) == 0)
    for node, data in path.nodes(data=True):
        assert data == source.nodes[data["smiles"]]
        if data["type"] == "reaction":
            assert Counter(path.nodes[child]["smiles"] for child in path.successors(node)) == Counter(
                source.successors(data["smiles"])
            )
        elif path.out_degree(node) == 0:
            assert data["terminal"] is True
        else:
            assert path.out_degree(node) == 1
        if data["type"] == "chemical":
            assert all(
                path.nodes[ancestor]["smiles"] != data["smiles"]
                for ancestor in nx.ancestors(path, node)
                if path.nodes[ancestor]["type"] == "chemical"
            )
    assert path.graph["score"] is None and path.graph["cluster_id"] is None


def native_projection_helpers(strategy):
    # Execute the actual pure native helpers without importing model/API clients.
    source = ROOT / f"apps/askcos-v2/tree_search/{strategy}/utils.py"
    names = {"get_paths", "clean_json", "nx_paths_to_json"}
    definitions = []
    for node in ast.parse(source.read_text(encoding="utf-8")).body:
        if isinstance(node, ast.FunctionDef) and node.name in names:
            definitions.append(node)
        elif isinstance(node, ast.Assign) and any(
            isinstance(target, ast.Name) and target.id in {"OUTPUT_KEYS", "PATH_KEY_DICT"}
            for target in node.targets
        ):
            definitions.append(node)
    namespace = {"nx": nx, "Any": Any, "Dict": dict, "List": list, "Iterator": Iterator,
                 "enumerate_route_graphs": enumerate_route_graphs}
    exec(compile(ast.Module(body=definitions, type_ignores=[]), str(source), "exec"), namespace)
    return namespace


def test_real_native_fixture_retains_each_closed_route_after_lazy_enumeration():
    uds, tree, target = captured_native_graph()
    actual = list(enumerate_route_graphs(grounded_route_graph(tree, target), target, "root", max_depth=12, max_trees=200))
    signatures = {frozenset((path.nodes[a]["smiles"], path.nodes[b]["smiles"]) for a, b in path.edges) for path in actual}
    for route in uds["pathways"]:
        assert frozenset((uds["uuid2smiles"][edge["source"]], uds["uuid2smiles"][edge["target"]]) for edge in route) in signatures
    for path in actual:
        assert nx.is_directed_acyclic_graph(path)
        assert all(path.nodes[node]["terminal"] is True for node, degree in path.out_degree() if degree == 0)
        assert path.graph["score"] is None


def graph(edges, terminals):
    tree = nx.DiGraph(edges)
    for node in tree:
        tree.nodes[node].update(type="reaction" if node.startswith("r:") else "chemical", smiles=node, terminal=node in terminals, purchase_price=1)
    return tree


def test_cartesian_product_is_capped_without_losing_required_precursors():
    tree = graph([("target", "r:make"), ("r:make", "a"), ("r:make", "b")] + [(chemical, f"r:{chemical}{i}") for chemical in ("a", "b") for i in range(100)] + [(f"r:{chemical}{i}", "stock") for chemical in ("a", "b") for i in range(100)], {"stock"})
    routes = list(enumerate_route_graphs(tree, "target", "root", max_trees=10))
    assert len(routes) == 10
    assert all(len(path) == 8 for path in routes)
    assert all(path.graph["depth"] == 2 for path in routes)


def test_cycles_and_depth_cutoffs_do_not_yield_unclosed_routes():
    tree = graph([("target", "r:make"), ("r:make", "a"), ("a", "r:cycle"), ("r:cycle", "target"), ("a", "r:exit"), ("r:exit", "stock")], {"stock"})
    assert len(list(enumerate_route_graphs(tree, "target", "root", max_depth=2))) == 1
    assert not list(enumerate_route_graphs(tree, "target", "root", max_depth=1))


@pytest.mark.parametrize("price", [None, 0, "missing"])
def test_quote_only_terminals_are_closed_without_fabricating_price(price):
    tree = graph([("target", "r:make"), ("r:make", "stock")], {"stock"})
    if price == "missing":
        del tree.nodes["stock"]["purchase_price"]
    else:
        tree.nodes["stock"]["purchase_price"] = price
    route = next(enumerate_route_graphs(tree, "target", "root"))
    assert route.graph["precursor_cost"] is None
    assert route.nodes[next(node for node, degree in route.out_degree() if degree == 0)]["terminal"] is True
    assert_closed_projection(tree, route)


def test_root_branches_are_not_lost_to_first_branch_combinations():
    tree = graph(
        [("target", "r:first"), ("r:first", "a")]
        + [("a", f"r:variant{i}") for i in range(100)]
        + [(f"r:variant{i}", "stock") for i in range(100)]
        + [("target", "r:second"), ("r:second", "stock")]
        + [("target", "r:third"), ("r:third", "stock")],
        {"stock"},
    )
    before = nx.node_link_data(tree, edges="links")
    routes = list(enumerate_route_graphs(tree, "target", "root", max_trees=3))
    steps = [route.nodes[next(route.successors("root"))]["smiles"] for route in routes]
    assert steps == ["r:first", "r:second", "r:third"]
    assert nx.node_link_data(tree, edges="links") == before
    assert all(nx.is_directed_acyclic_graph(route) for route in routes)
    assert len(list(enumerate_route_graphs(tree, "target", "root", max_trees=1))) == 1
    longer = list(enumerate_route_graphs(tree, "target", "root", max_trees=5))
    assert [route.nodes[next(route.successors("root"))]["smiles"] for route in longer] == [
        "r:first", "r:second", "r:third", "r:first", "r:first",
    ]


def test_empty_first_root_branch_does_not_block_closed_alternatives():
    tree = graph(
        [("target", "r:empty"), ("r:empty", "unclosed")]
        + [("target", "r:closed"), ("r:closed", "stock")],
        {"stock"},
    )
    routes = list(enumerate_route_graphs(tree, "target", "root", max_trees=2))
    assert len(routes) == 1
    assert routes[0].nodes[next(routes[0].successors("root"))]["smiles"] == "r:closed"


@pytest.mark.parametrize("prefix_depth", [1, 3])
@pytest.mark.parametrize("budget", [3, 5])
def test_deep_or_branches_are_not_lost_to_first_branch_combinations(prefix_depth, budget):
    prefix = ["target", *(f"prefix{i}" for i in range(prefix_depth))]
    edges = []
    for index, (product, precursor) in enumerate(zip(prefix, prefix[1:])):
        edges.extend([(product, f"r:prefix{index}"), (f"r:prefix{index}", precursor)])
    intermediate = prefix[-1]
    tree = graph(
        edges + [(intermediate, "r:first"), ("r:first", "a")]
        + [("a", f"r:variant{i}") for i in range(100)]
        + [(f"r:variant{i}", "stock") for i in range(100)]
        + [(intermediate, "r:second"), ("r:second", "stock")]
        + [(intermediate, "r:third"), ("r:third", "stock")],
        {"stock"},
    )
    routes = list(enumerate_route_graphs(tree, "target", "root", max_trees=budget))
    steps = []
    for path in routes:
        node = next(node for node, data in path.nodes(data=True) if data["smiles"] == intermediate)
        steps.append(path.nodes[next(path.successors(node))]["smiles"])
    assert steps == ["r:first", "r:second", "r:third", "r:first", "r:first"][:budget]


@pytest.mark.parametrize("max_depth", [3, 6])
def test_captured_deep_or_representative_survives_the_same_200_path_budget(max_depth):
    uds, tree, target = captured_native_graph()
    before = deepcopy(nx.node_link_data(tree, edges="links"))
    # Pin an actual deep OR witness in the captured node_dict insertion order.
    intermediate, reaction = (list(uds["node_dict"])[index] for index in (49, 810))
    assert intermediate != target and tree.has_edge(intermediate, reaction)
    grounded = grounded_route_graph(tree, target)
    grounded_before = deepcopy(nx.node_link_data(grounded, edges="links"))
    routes = list(enumerate_route_graphs(grounded, target, "root", max_depth=max_depth, max_trees=200))
    root_reactions = {path.nodes[next(path.successors("root"))]["smiles"] for path in routes}
    deep_reactions = {
        data["smiles"] for path in routes for node, data in path.nodes(data=True)
        if data["type"] == "reaction" and node not in path.successors("root")
    }
    assert reaction in deep_reactions
    assert len(routes) == 200
    assert len(root_reactions) == 28
    assert len(deep_reactions) == 114
    if max_depth == 6:
        assert next(index for index, path in enumerate(routes)
                    if any(data["smiles"] == reaction for _, data in path.nodes(data=True))) == 111
    assert any(path.out_degree(node) > 1 for path in routes for node, data in path.nodes(data=True)
               if data["type"] == "reaction")
    for path in routes:
        assert_closed_projection(grounded, path)
        assert path.graph["depth"] <= max_depth
    assert nx.node_link_data(grounded, edges="links") == grounded_before
    assert nx.node_link_data(tree, edges="links") == before


@pytest.mark.parametrize("budget", [0, 1, 2, 4, None])
def test_or_rotation_preserves_nested_and_cartesian_order_and_budget(budget):
    tree = graph(
        [("target", "r:make"), ("r:make", "a"), ("r:make", "b")]
        + [(chemical, f"r:{chemical}{i}") for chemical in ("a", "b") for i in range(3)]
        + [(f"r:{chemical}{i}", "stock") for chemical in ("a", "b") for i in range(3)],
        {"stock"},
    )
    routes = list(enumerate_route_graphs(tree, "target", "root", max_trees=budget))
    combinations = [
        tuple(next(data["smiles"] for _, data in path.nodes(data=True)
                   if data["smiles"].startswith(f"r:{chemical}")) for chemical in ("a", "b"))
        for path in routes
    ]
    assert combinations == [(f"r:a{i}", f"r:b{j}") for i in range(3) for j in range(3)][:budget]
    for path in routes:
        assert_closed_projection(tree, path)
        assert path.graph["depth"] == 2


def test_empty_and_cyclic_deep_or_streams_do_not_block_closed_alternatives():
    tree = graph([
        ("target", "r:make"), ("r:make", "a"), ("a", "r:empty"),
        ("a", "r:unclosed"), ("r:unclosed", "missing"),
        ("a", "r:cycle"), ("r:cycle", "target"),
        ("a", "r:closed"), ("r:closed", "stock"),
    ], {"stock"})
    route, = enumerate_route_graphs(tree, "target", "root", max_trees=2)
    assert {data["smiles"] for _, data in route.nodes(data=True) if data["type"] == "reaction"} == {
        "r:make", "r:closed",
    }
    assert_closed_projection(tree, route)


def test_deep_or_ancestor_exclusion_and_depth_cutoff_remain_exact():
    tree = graph([
        ("target", "r:make"), ("r:make", "a"), ("a", "r:next"), ("r:next", "b"),
        ("b", "r:back"), ("r:back", "a"), ("b", "r:exit"), ("r:exit", "stock"),
    ], {"stock"})
    route, = enumerate_route_graphs(tree, "target", "root", max_depth=3, max_trees=2)
    assert route.graph["depth"] == 3
    assert_closed_projection(tree, route)
    assert not list(enumerate_route_graphs(tree, "target", "root", max_depth=2, max_trees=2))


@pytest.mark.parametrize("terminal", [True, False, 1, "true", None])
def test_only_exact_terminals_close_at_the_depth_limit_and_stop_expansion(terminal):
    tree = graph([
        ("target", "r:make"), ("r:make", "stock"),
        ("stock", "r:extra"), ("r:extra", "other"),
    ], {"stock", "other"})
    tree.nodes["stock"]["terminal"] = terminal
    routes = list(enumerate_route_graphs(tree, "target", "root", max_depth=1, max_trees=2))
    assert len(routes) == int(terminal is True)
    for path in routes:
        assert {data["smiles"] for _, data in path.nodes(data=True)} == {"target", "r:make", "stock"}
        assert_closed_projection(tree, path)


@pytest.mark.parametrize("strategy", ["mcts", "retro_star"])
@pytest.mark.parametrize("json_format", ["nodelink", "treedata"])
def test_captured_paths_keep_native_json_metadata(strategy, json_format):
    _, tree, target = captured_native_graph()
    helpers = native_projection_helpers(strategy)
    paths = list(helpers["get_paths"](
        grounded_route_graph(tree, target), target, "root", max_depth=6, max_trees=8,
    ))
    exported = json.loads(json.dumps(helpers["nx_paths_to_json"](paths, "root", json_format)))
    properties_key = "graph" if json_format == "nodelink" else "attributes"
    assert [item[properties_key] for item in exported] == [path.graph for path in paths]


def test_captured_path_properties_survive_the_existing_uds_contract():
    uds, tree, target = captured_native_graph()
    paths = list(enumerate_route_graphs(
        grounded_route_graph(tree, target), target, "root", max_depth=6, max_trees=200,
    ))
    # UDS uses explicit links, independent of NetworkX's default node-link key.
    exported = json.loads(json.dumps([nx.node_link_data(path, edges="links") for path in paths]))
    projected_uds = {
        **uds,
        "pathways": [item["links"] for item in exported],
        "uuid2smiles": {node["id"]: node["smiles"] for item in exported for node in item["nodes"]},
        "pathways_properties": [item["graph"] for item in exported],
    }
    routes = normalize_askcos_tree_result({"target_smiles": target, "result": {"uds": projected_uds}})
    assert len(routes) == len(paths) == 200
    for route, path, item in zip(routes, paths, exported, strict=True):
        assert route.closed and not route.metadata["unclosed_precursors"]
        assert route.metadata["pathway_properties"] == path.graph
        assert route.metadata["pathway_edges"] == item["links"]


@pytest.mark.parametrize("price", [None, 0])
def test_captured_terminal_with_unknown_price_remains_unknown(price):
    _, tree, target = captured_native_graph()
    first = next(enumerate_route_graphs(grounded_route_graph(tree, target), target, "root", max_trees=1))
    leaf = next(data["smiles"] for node, data in first.nodes(data=True) if first.out_degree(node) == 0)
    # Change only price metadata on a real captured terminal, not the topology.
    tree.nodes[leaf]["purchase_price"] = price
    grounded = grounded_route_graph(tree, target)
    route = next(enumerate_route_graphs(grounded, target, "root", max_trees=1))
    assert route.graph["precursor_cost"] is None
    assert next(data["purchase_price"] for _, data in route.nodes(data=True) if data["smiles"] == leaf) == price
    assert_closed_projection(grounded, route)


@pytest.mark.parametrize("max_depth", [0, 1])
def test_unvalidated_depth_cutoffs_keep_the_explicit_existing_behavior(max_depth):
    tree = graph([("target", "r:make"), ("r:make", "stock"), ("r:make", "missing")], {"stock"})
    assert not list(enumerate_route_graphs(tree, "target", "root", max_depth=max_depth))
    route, = enumerate_route_graphs(tree, "target", "root", max_depth=max_depth, validate_paths=False)
    assert route.graph["depth"] == max_depth
    assert any(route.nodes[node]["terminal"] is not True for node, degree in route.out_degree() if degree == 0)
