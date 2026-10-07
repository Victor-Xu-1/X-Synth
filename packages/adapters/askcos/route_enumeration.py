"""Native route projection and explicit budgeted candidate ordering."""

from collections import deque
from itertools import chain, islice
from math import prod
from uuid import uuid4

import networkx as nx


def prioritize_candidate_paths(paths, max_paths, *, family_key):
    """Prioritize representatives without hiding budgeted variants from review."""
    if max_paths is None:
        return paths
    if max_paths <= 0:
        return []
    representatives, alternatives, seen = [], [], set()
    for path in paths:
        family = family_key(path)
        if family in seen:
            alternatives.append(path)
        else:
            seen.add(family)
            representatives.append(path)
    return (representatives + alternatives)[:max_paths]


def rank_paths_by_plausibility(paths, *, cluster_trees, error_type):
    """Explicit non-neural ranking after a ranker failure; higher remains better."""
    warning = f"pathway_ranker_failed: {error_type}"
    for path in paths:
        plausibilities = (data["plausibility"] for _, data in path.nodes(data=True)
                          if data.get("type") == "reaction" and data.get("plausibility") is not None)
        path.graph.update(
            score=float(prod(plausibilities)),
            score_fallback="overall_plausibility", ranking_warning=warning,
        )
        if cluster_trees:
            path.graph["cluster_id"] = None
    return paths


def enumerate_route_graphs(
    tree, root, root_uuid, max_depth=None, max_trees=None, validate_paths=True,
):
    """Keep ordered and diverse deep candidates within one root-balanced budget."""
    def interleave(streams):
        pending = deque(streams)
        while pending:
            stream = pending.popleft()
            try:
                branch = next(stream)
            except StopIteration:
                continue
            yield branch
            pending.append(stream)

    def reaction_paths(node, reaction, ancestors, balanced):
        precursors = tuple(tree.successors(reaction))
        if not precursors or set(precursors) & {*ancestors, node}:
            return
        for combination in precursor_paths(precursors, ancestors + (node,), balanced):
            yield node, ((reaction, combination),)

    def root_reaction_paths(node, reaction, ancestors):
        # Preserve ordered deep variants as well as OR representatives, without duplicates.
        streams = (reaction_paths(node, reaction, ancestors, False),
                   reaction_paths(node, reaction, ancestors, True))
        seen = set()
        for branch in interleave(streams):
            if branch not in seen:
                seen.add(branch)
                yield branch

    def chemical_paths(node, ancestors, balanced):
        terminal = tree.nodes[node].get("terminal") is True
        at_depth_limit = max_depth is not None and len(ancestors) >= max_depth
        if terminal or tree.out_degree(node) == 0 or at_depth_limit:
            if terminal or not validate_paths:
                yield node, ()
            return
        if node == root and not ancestors:
            streams = (root_reaction_paths(node, reaction, ancestors)
                       for reaction in tree.successors(node))
            alternatives = interleave(streams)
        else:
            streams = (reaction_paths(node, reaction, ancestors, balanced)
                       for reaction in tree.successors(node))
            alternatives = interleave(streams) if balanced else chain.from_iterable(streams)
        yield from islice(alternatives, max_trees)

    def precursor_paths(precursors, ancestors, balanced):
        if not precursors:
            yield ()
            return
        for first in chemical_paths(precursors[0], ancestors, balanced):
            for rest in precursor_paths(precursors[1:], ancestors, balanced):
                yield (first, *rest)

    def append(path, branch, identifier):
        node, children = branch
        path.add_node(identifier, **tree.nodes[node])
        for child in children:
            child_id = str(uuid4())
            append(path, child, child_id)
            path.add_edge(identifier, child_id)

    for branch in islice(chemical_paths(root, (), True), max_trees):
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
