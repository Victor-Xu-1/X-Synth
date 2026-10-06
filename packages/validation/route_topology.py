"""Exact chemical DAG checks, independent of engine scores and catalog flags."""

from collections import Counter
from functools import lru_cache

from packages.adapters.stock.commercial_stock import canonicalize_smiles


@lru_cache(maxsize=8192)
def chemical_key(smiles):
    return canonicalize_smiles(smiles)


def reaction_key(step):
    return chemical_key(".".join(step.precursors)), chemical_key(step.product)


def route_signature(route):
    return chemical_key(route.target_smiles), tuple(sorted(reaction_key(step) for step in route.steps))


def source_path_reasons(route):
    edges = route.metadata.get("pathway_edges")
    if edges is None:
        return ()
    nodes = route.metadata.get("pathway_node_smiles")
    kinds = route.metadata.get("pathway_node_kinds")
    if not isinstance(edges, list) or not isinstance(nodes, dict) or not isinstance(kinds, dict):
        return ("invalid_source_pathway",)
    children, parents = {}, {}
    for edge in edges:
        if not isinstance(edge, dict):
            return ("invalid_source_pathway",)
        source, target = edge.get("source"), edge.get("target")
        if not isinstance(source, str) or not isinstance(target, str) or (
            kinds.get(source), kinds.get(target)
        ) not in {("chemical", "reaction"), ("reaction", "chemical")}:
            return ("invalid_source_pathway",)
        children.setdefault(source, set()).add(target)
        parents.setdefault(target, set()).add(source)
    node_ids = set(children) | set(parents)
    if any(not isinstance(nodes.get(value), str) or not nodes[value] for value in node_ids):
        return ("invalid_source_pathway",)
    roots = node_ids - set(parents)
    if len(roots) != 1 or chemical_key(nodes[next(iter(roots))]) != chemical_key(route.target_smiles):
        return ("source_pathway_target_mismatch",)
    signatures = []
    for identifier in node_ids:
        if kinds[identifier] == "chemical":
            if not chemical_key(nodes[identifier]) or len(children.get(identifier, ())) > 1:
                return ("invalid_source_pathway",)
            continue
        inputs = children.get(identifier, ())
        outputs = parents.get(identifier, ())
        if not inputs or len(outputs) != 1:
            return ("invalid_source_pathway",)
        sides = nodes[identifier].split(">")
        signature = (chemical_key(".".join(nodes[value] for value in sorted(inputs))),
                     chemical_key(nodes[next(iter(outputs))]))
        if len(sides) != 3 or signature != (chemical_key(sides[0]), chemical_key(sides[2])):
            return ("reaction_structure_mismatch",)
        signatures.append(signature)
    if Counter(signatures) != Counter(reaction_key(step) for step in route.steps):
        return ("source_pathway_step_mismatch",)
    return ()


def topology_reasons(route):
    reasons = list(source_path_reasons(route))
    target = chemical_key(route.target_smiles)
    materials = {chemical_key(value) for value in route.starting_materials}
    products, dependencies, signatures = [], {}, []
    identifiers = [step.step_id for step in route.steps]
    if any(not value for value in identifiers) or len(set(identifiers)) != len(identifiers):
        reasons.append("invalid_step_identifiers")
    invalid = not target or not materials or "" in materials
    mismatch = False
    for step in route.steps:
        product = chemical_key(step.product)
        precursors = {chemical_key(value) for value in step.precursors}
        if not product or not precursors or "" in precursors:
            invalid = True
        products.append(product)
        dependencies.setdefault(product, set()).update(precursors)
        signatures.append(reaction_key(step))
        sides = step.reaction_smiles.split(">")
        if len(sides) != 3 or (
            chemical_key(sides[0]), chemical_key(sides[2])
        ) != reaction_key(step):
            mismatch = True
    if invalid:
        reasons.append("invalid_route_structure")
    if mismatch:
        reasons.append("reaction_structure_mismatch")
    if len(set(products)) != len(products):
        reasons.append("duplicate_product_synthesis")
    if len(set(signatures)) != len(signatures):
        reasons.append("repeated_reaction")
    if invalid:
        return tuple(dict.fromkeys(reasons))

    products_set = set(products)
    leaves = set().union(*dependencies.values()) - products_set if dependencies else set()
    if leaves != materials or products_set & materials:
        reasons.append("starting_materials_mismatch")
    if target not in products_set:
        reasons.append("target_not_synthesized")

    reached, stack = set(), [target]
    while stack:
        value = stack.pop()
        if value not in reached:
            reached.add(value)
            stack.extend(dependencies.get(value, ()))
    if products_set - reached:
        reasons.append("disconnected_synthesis_steps")

    # Kahn traversal is iterative: malformed long chains cannot exhaust recursion.
    incoming = Counter(child for children in dependencies.values() for child in children)
    remaining = products_set | set().union(*dependencies.values()) if dependencies else set()
    queue = [value for value in remaining if not incoming[value]]
    while queue:
        value = queue.pop()
        remaining.discard(value)
        for child in dependencies.get(value, ()):
            incoming[child] -= 1
            if not incoming[child]:
                queue.append(child)
    if remaining:
        reasons.append("reaction_cycle")
    return tuple(dict.fromkeys(reasons))
