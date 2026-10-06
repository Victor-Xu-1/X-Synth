"""Lazy native route projection without caching failed path combinations."""

from itertools import islice
from uuid import uuid4

import networkx as nx


def enumerate_route_graphs(
    tree, root, root_uuid, max_depth=None, max_trees=None, validate_paths=True,
):
    """Retain native ordering and path limits; assign IDs only to yielded routes."""
    def chemical_paths(node, ancestors):
        terminal = tree.nodes[node].get("terminal") is True
        at_depth_limit = max_depth is not None and len(ancestors) >= max_depth
        if terminal or tree.out_degree(node) == 0 or at_depth_limit:
            if terminal or not validate_paths:
                yield node, ()
            return
        count = 0
        for reaction in tree.successors(node):
            precursors = tuple(tree.successors(reaction))
            if not precursors or set(precursors) & {*ancestors, node}:
                continue
            for combination in precursor_paths(precursors, ancestors + (node,)):
                if max_trees is not None and count >= max_trees:
                    return
                count += 1
                yield node, ((reaction, combination),)

    def precursor_paths(precursors, ancestors):
        if not precursors:
            yield ()
            return
        for first in chemical_paths(precursors[0], ancestors):
            for rest in precursor_paths(precursors[1:], ancestors):
                yield (first, *rest)

    def append(path, branch, identifier):
        node, children = branch
        path.add_node(identifier, **tree.nodes[node])
        for child in children:
            child_id = str(uuid4())
            append(path, child, child_id)
            path.add_edge(identifier, child_id)

    for branch in islice(chemical_paths(root, ()), max_trees):
        path = nx.DiGraph()
        append(path, branch, root_uuid)
        path.graph["depth"] = sum(
            path.nodes[node]["type"] == "reaction"
            for node in nx.dag_longest_path(path)
        )
        prices = [
            path.nodes[node].get("purchase_price", 0)
            for node, degree in path.out_degree() if degree == 0
        ]
        path.graph["precursor_cost"] = (
            None if any(price is None or price == 0 for price in prices)
            else sum(prices)
        )
        path.graph.update(score=None, cluster_id=None)
        yield path
