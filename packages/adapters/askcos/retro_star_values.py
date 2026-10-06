"""Native RetroStar AND/OR value backup, separate from whole-route priority."""

import math


def _difference(current, previous):
    return 0.0 if current == previous else current - previous


def propagate_priority(tree, chemical, delta):
    """Ancestor costs affect descendant reaction priorities, not subtree costs."""
    if delta == 0:
        return
    pending = list(tree.successors(chemical))
    seen = set()
    while pending:
        reaction = pending.pop()
        if reaction in seen:
            raise ValueError("RetroStar priority propagation requires a tree")
        seen.add(reaction)
        data = tree.nodes[reaction]
        if delta == math.inf or data["Vt"] == math.inf:
            data["Vt"] = math.inf
        else:
            data["Vt"] += delta
        for child in tree.successors(reaction):
            pending.extend(tree.successors(child))


def backup_search_values(tree, chemical, target):
    """Recompute OR minima and AND sums even when success changes at zero cost."""
    data = tree.nodes[chemical]
    reactions = list(tree.successors(chemical))
    data["rn"] = min((tree.nodes[r]["rn"] for r in reactions), default=math.inf)
    data["solved"] = any(tree.nodes[r]["solved"] for r in reactions)
    if not reactions:
        data["done"] = True
    ancestors, seen = [], {chemical}
    while chemical != target:
        parents = list(tree.predecessors(chemical))
        if len(parents) != 1:
            raise ValueError("RetroStar backup requires a unique parent reaction")
        reaction = parents[0]
        data = tree.nodes[reaction]
        precursors = list(tree.successors(reaction))
        previous = data["rn"]
        data["rn"] = 1.0 - data["rxn_score_from_model"] + sum(
            tree.nodes[c]["rn"] for c in precursors
        )
        data["solved"] = all(tree.nodes[c]["solved"] for c in precursors)
        reaction_delta = _difference(data["rn"], previous)
        data["Vt"] = (
            math.inf if data["rn"] == math.inf or data["Vt"] == math.inf
            else data["Vt"] + reaction_delta
        )
        for sibling in precursors:
            if sibling != chemical:
                propagate_priority(tree, sibling, reaction_delta)
        products = list(tree.predecessors(reaction))
        if len(products) != 1 or products[0] in seen:
            raise ValueError("RetroStar backup requires an acyclic parent chain")
        chemical = products[0]
        seen.add(chemical)
        data = tree.nodes[chemical]
        reactions = list(tree.successors(chemical))
        data["rn"] = min((tree.nodes[r]["rn"] for r in reactions), default=math.inf)
        data["solved"] = any(tree.nodes[r]["solved"] for r in reactions)
        ancestors.append(chemical)
    return ancestors
