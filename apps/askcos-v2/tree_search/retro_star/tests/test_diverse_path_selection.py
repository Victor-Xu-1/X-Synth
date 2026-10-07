import networkx as nx

from utils import select_diverse_paths, sort_paths


def _route(name, score, cluster_id):
    graph = nx.DiGraph()
    graph.graph["score"] = score
    graph.graph["cluster_id"] = cluster_id
    target = f"{name}-target"
    reaction = f"{name}-reaction"
    leaf = f"{name}-leaf"
    graph.add_node(target, type="chemical", smiles=f"C{name}", terminal=False)
    graph.add_node(
        reaction,
        type="reaction",
        smiles=f"C{name}>>O{name}",
        plausibility=0.9,
        reaction_properties={"cluster_id": cluster_id},
    )
    graph.add_node(leaf, type="chemical", smiles=f"O{name}", terminal=True)
    graph.add_edge(target, reaction)
    graph.add_edge(reaction, leaf)
    return graph


def _scored_route(name, score, leaves, reaction_count=1):
    graph = nx.DiGraph()
    graph.graph["score"] = score
    graph.graph["cluster_id"] = -1
    target = f"{name}-target"
    graph.add_node(target, type="chemical", smiles=f"T{name}", terminal=False)
    parent = target
    for index in range(reaction_count):
        reaction = f"{name}-reaction-{index}"
        product = f"P{name}{index}"
        graph.add_node(
            reaction,
            type="reaction",
            smiles=f"{'.'.join(leaves)}>>{product}",
            plausibility=0.9,
        )
        graph.add_edge(parent, reaction)
        if index == reaction_count - 1:
            for leaf in leaves:
                graph.add_node(
                    f"{name}-leaf-{leaf}",
                    type="chemical",
                    smiles=leaf,
                    terminal=True,
                    purchase_price=1,
                )
                graph.add_edge(reaction, f"{name}-leaf-{leaf}")
        else:
            intermediate = f"{name}-intermediate-{index}"
            graph.add_node(
                intermediate,
                type="chemical",
                smiles=product,
                terminal=False,
                purchase_price=0,
            )
            graph.add_edge(reaction, intermediate)
            parent = intermediate
    return graph


def test_select_diverse_paths_prefers_distinct_route_clusters_before_duplicates():
    paths = [
        _route("a1", 0.01, 0),
        _route("a2", 0.02, 0),
        _route("a3", 0.03, 0),
        _route("b1", 0.20, 1),
        _route("c1", 0.30, 2),
    ]

    selected = select_diverse_paths(paths, max_paths=3)

    assert [path.graph["cluster_id"] for path in selected] == [0, 1, 2]


def test_select_diverse_paths_fills_remaining_slots_by_existing_rank_order():
    paths = [
        _route("a1", 0.01, 0),
        _route("b1", 0.02, 1),
        _route("a2", 0.03, 0),
        _route("b2", 0.04, 1),
    ]

    selected = select_diverse_paths(paths, max_paths=3)

    assert [path.nodes[next(iter(path.nodes))]["smiles"] for path in selected] == [
        "Ca1",
        "Cb1",
        "Ca2",
    ]


def test_select_diverse_paths_retains_alternatives_for_independent_review():
    paths = [
        _route("a1", 0.01, 0),
        _route("a2", 0.02, 0),
        _route("a3", 0.03, 0),
        _route("b1", 0.20, 1),
        _route("c1", 0.30, 2),
    ]

    selected = select_diverse_paths(paths, max_paths=5)

    assert [path.graph["cluster_id"] for path in selected] == [0, 1, 2, 0, 0]


def test_sort_paths_orders_higher_scores_first():
    low_score_route = _scored_route(
        "low",
        score=-40,
        leaves=["CCO"],
    )
    high_score_route = _scored_route(
        "high",
        score=-10,
        leaves=["CCO"],
    )

    sorted_paths = sort_paths(
        [low_score_route, high_score_route],
        metric="score",
    )

    assert sorted_paths == [high_score_route, low_score_route]


def test_sort_paths_uses_route_quality_tiebreakers_for_equal_scores():
    long_route = _scored_route(
        "long",
        score=-1,
        leaves=["CCO", "O=C=O"],
        reaction_count=3,
    )
    charged_leaf_route = _scored_route(
        "charged",
        score=-1,
        leaves=["CC(=O)[O-]"],
        reaction_count=1,
    )
    short_clean_route = _scored_route(
        "clean",
        score=-1,
        leaves=["CCO"],
        reaction_count=1,
    )

    sorted_paths = sort_paths(
        [long_route, charged_leaf_route, short_clean_route],
        metric="score",
    )

    assert sorted_paths[0] is short_clean_route
    assert sorted_paths[-1] is long_route
