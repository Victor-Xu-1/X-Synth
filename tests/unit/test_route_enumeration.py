import json
from pathlib import Path

import networkx as nx

from packages.adapters.askcos.route_enumeration import enumerate_route_graphs
from packages.adapters.askcos.route_reachability import grounded_route_graph


def test_real_native_fixture_retains_each_closed_route_after_lazy_enumeration():
    fixture = Path(__file__).resolve().parents[1] / "fixtures/askcos/diphenhydramine_retrostar_result.json"
    payload = json.loads(fixture.read_text())
    while "uds" not in payload:
        payload = payload.get("result") or payload.get("results") or payload.get("payload")
    uds = payload["uds"]
    tree = nx.DiGraph()
    for node, data in uds["node_dict"].items():
        tree.add_node(node, **{**data, "purchase_price": data.get("purchase_price", data.get("ppg", 0))})
    tree.add_edges_from((edge["source"], edge["target"]) for edge in uds["graph"])
    target = "CN(C)CCOC(c1ccccc1)c1ccccc1"
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


def test_quote_only_terminals_are_closed_without_fabricating_price():
    tree = graph([("target", "r:make"), ("r:make", "stock")], {"stock"})
    tree.nodes["stock"]["purchase_price"] = None
    route = next(enumerate_route_graphs(tree, "target", "root"))
    assert route.graph["precursor_cost"] is None
    assert route.nodes[next(node for node, degree in route.out_degree() if degree == 0)]["terminal"] is True


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
