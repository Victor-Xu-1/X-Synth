"""Keep only finite AND/OR routes grounded in actual terminal chemicals."""

from collections import deque

import networkx as nx


def grounded_route_graph(tree: nx.DiGraph, root: str) -> nx.DiGraph:
    """Prune impossible branches without enumerating their combinations.

    Native edges run product -> reaction -> precursors. A chemical is reachable
    if any producing reaction is reachable; a reaction needs every precursor.
    The least fixed point excludes self-supporting cycles with no terminal exit.
    The target cannot be its own starting material. The input graph is retained.
    """
    if not tree.is_directed() or tree.is_multigraph() or root not in tree:
        raise ValueError("A directed route graph with a target is required")
    if tree.nodes[root].get("type") != "chemical":
        raise ValueError("The route target must be a chemical node")
    if any(
        data.get("type") not in {"chemical", "reaction"}
        for _, data in tree.nodes(data=True)
    ):
        raise ValueError("Unknown native route node type")
    if any(tree.nodes[a]["type"] == tree.nodes[b]["type"] for a, b in tree.edges):
        raise ValueError("Route edges must alternate chemicals and reactions")

    excluded = set(tree.predecessors(root))
    grounded = {
        node for node, data in tree.nodes(data=True)
        if node != root and data.get("type") == "chemical"
        and data.get("terminal") is True
    }
    remaining = {
        node: tree.out_degree(node)
        for node, data in tree.nodes(data=True)
        if data.get("type") == "reaction" and node not in excluded
        and tree.out_degree(node) > 0
    }
    pending = deque(grounded)
    while pending:
        chemical = pending.popleft()
        for reaction in tree.predecessors(chemical):
            if reaction not in remaining:
                continue
            remaining[reaction] -= 1
            if remaining[reaction] != 0:
                continue
            grounded.add(reaction)
            for product in tree.predecessors(reaction):
                if (
                    tree.nodes[product].get("type") == "chemical"
                    and product not in grounded
                ):
                    grounded.add(product)
                    pending.append(product)

    selected = {root}
    edges = []
    if root in grounded:
        pending = deque([root])
        while pending:
            node = pending.popleft()
            data = tree.nodes[node]
            if node != root and data.get("terminal") is True:
                continue
            for child in tree.successors(node):
                if child not in grounded or child in excluded:
                    continue
                edges.append((node, child))
                if child not in selected:
                    selected.add(child)
                    pending.append(child)

    result = tree.subgraph(selected).copy()
    allowed = set(edges)
    result.remove_edges_from([edge for edge in result.edges if edge not in allowed])
    result.nodes[root]["terminal"] = False
    return result
