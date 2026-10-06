"""Iterative pruning plans and explicit source-occurrence bookkeeping."""

from collections import Counter, defaultdict, deque
from dataclasses import dataclass
import hashlib
import json
import re


@dataclass(frozen=True)
class PruningPlan:
    retained_ids: tuple[str, ...]
    representatives: dict[str, str]
    dropped_at: dict[str, str]
    materials: list[str]
    cut_products: tuple[str, ...]


def step_signature(step, canonical):
    identifier = getattr(step, "step_id", None)
    product = getattr(step, "product", None)
    reaction = getattr(step, "reaction_smiles", None)
    precursors = getattr(step, "precursors", None)
    if (not isinstance(identifier, str) or not identifier
            or not isinstance(product, str) or not isinstance(reaction, str)
            or not isinstance(precursors, list) or not precursors
            or any(not isinstance(value, str) or not canonical(value) for value in precursors)):
        return None
    signature = canonical(".".join(precursors)), canonical(product)
    sides = reaction.split(">")
    if (not all(signature) or len(sides) != 3
            or signature != (canonical(sides[0]), canonical(sides[2]))):
        return None
    return signature


def pruning_plan(steps, target, *, canonical, buyable):
    """Refuse ambiguity, cycles and disconnected steps before considering stock cuts."""
    groups, signatures = defaultdict(list), {}
    for step in steps:
        signature = step_signature(step, canonical)
        if signature is None or step.step_id in signatures:
            return None
        signatures[step.step_id] = signature
        groups[signature[1]].append(step)
    target = canonical(target)
    if target not in groups or any(
        len({(signatures[step.step_id], tuple(sorted(canonical(p) for p in step.precursors)))
             for step in group}) != 1 for group in groups.values()
    ):
        return None
    producers = {product: group[0] for product, group in groups.items()}
    dependencies = {product: {canonical(p) for p in step.precursors}
                    for product, step in producers.items()}
    reached, stack = set(), [target]
    while stack:
        product = stack.pop()
        if product not in reached:
            reached.add(product)
            stack.extend(dependencies.get(product, ()))
    if set(groups) - reached:
        return None
    incoming = Counter(child for children in dependencies.values() for child in children)
    remaining = set(groups) | set(incoming)
    queue = deque(value for value in remaining if not incoming[value])
    while queue:
        value = queue.popleft()
        remaining.remove(value)
        for child in dependencies.get(value, ()):
            incoming[child] -= 1
            if not incoming[child]:
                queue.append(child)
    if remaining:
        return None

    retained, visited, materials, material_keys, cuts = set(), set(), [], set(), set()
    stack = [target]
    while stack:
        product = stack.pop()
        if product in visited:
            continue
        visited.add(product)
        step = producers[product]
        retained.add(step.step_id)
        upstream = []
        for precursor in step.precursors:
            key = canonical(precursor)
            if key != target and buyable(precursor):
                if key in producers:
                    cuts.add(key)
            elif key in producers:
                upstream.append(key)
                continue
            if key not in material_keys:
                materials.append(precursor)
                material_keys.add(key)
        stack.extend(reversed(upstream))

    # Every omitted producer must be upstream of a documented stock boundary.
    ancestry = {}
    queue = deque((key, key) for key in sorted(cuts))
    while queue:
        product, boundary = queue.popleft()
        if product in ancestry:
            continue
        ancestry[product] = boundary
        queue.extend((child, boundary) for child in sorted(dependencies.get(product, ())))
    representatives = {step.step_id: producers[signatures[step.step_id][1]].step_id for step in steps}
    dropped_at = {}
    for step in steps:
        if representatives[step.step_id] not in retained:
            product = signatures[step.step_id][1]
            if product not in ancestry:
                return None
            dropped_at[step.step_id] = ancestry[product]
    return PruningPlan(tuple(step.step_id for step in steps if step.step_id in retained),
                       representatives, dropped_at, materials, tuple(sorted(cuts)))


def source_occurrences(steps, metadata, canonical):
    if (not isinstance(steps, (list, tuple)) or source_path_digest(metadata) is None
            or source_stock_snapshots(metadata, steps) is None):
        return None
    signatures = [step_signature(step, canonical) for step in steps]
    if (any(signature is None for signature in signatures)
            or len({step.step_id for step in steps}) != len(steps)):
        return None
    edges, nodes, kinds = _source_graph(metadata)
    if edges is None:
        return [{"source_id": "step:" + step.step_id, "source_step_id": step.step_id} for step in steps]
    children, parents, identifiers = defaultdict(list), set(), set()
    for edge in edges:
        children[edge["source"]].append(edge["target"])
        parents.add(edge["target"])
        identifiers.update((edge["source"], edge["target"]))
    def key(value):
        return nodes[value], value

    roots = sorted(identifiers - parents, key=key)
    buckets, seen = defaultdict(deque), set()
    for root in [*roots, *sorted(identifiers, key=key)]:
        queue = deque([root])
        while queue:
            identifier = queue.popleft()
            if identifier in seen:
                continue
            seen.add(identifier)
            if kinds.get(identifier) == "reaction":
                sides = nodes[identifier].split(">")
                if len(sides) != 3:
                    return None
                buckets[canonical(sides[0]), canonical(sides[2])].append(identifier)
            queue.extend(sorted(children[identifier], key=key))
    result = []
    for step, signature in zip(steps, signatures, strict=True):
        if not buckets[signature]:
            return None
        result.append({"source_id": buckets[signature].popleft(), "source_step_id": step.step_id})
    return None if any(buckets.values()) else result


def projected_occurrences(sources, plan):
    retained = set(plan.retained_ids)
    return [{**row,
             "retained_step_id": plan.representatives[row["source_step_id"]]
             if plan.representatives[row["source_step_id"]] in retained else None,
             "stock_cut": plan.dropped_at.get(row["source_step_id"])} for row in sources]


def source_path_digest(metadata):
    if (_source_graph(metadata) is None or source_stock_snapshots(metadata, []) is None):
        return None
    for name, expected in (("pathway_properties", dict), ("original_target_smiles", str),
                           ("source", str), ("route_index", int)):
        if name in metadata and type(metadata[name]) is not expected:
            return None
    names = ("pathway_edges", "pathway_node_smiles", "pathway_node_kinds", "pathway_properties",
             "starting_material_nodes", "original_target_smiles", "source", "route_index", "stock_snapshot")
    value = {name: metadata[name] for name in names if name in metadata}
    try:
        content = json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)
    except (TypeError, ValueError, RecursionError):
        return None
    return hashlib.sha256(content.encode()).hexdigest()


def _source_graph(metadata):
    if not isinstance(metadata, dict):
        return None
    names = ("pathway_edges", "pathway_node_smiles", "pathway_node_kinds")
    if not any(name in metadata for name in names):
        return None, None, None
    edges, nodes, kinds = (metadata.get(name) for name in names)
    if not isinstance(edges, list) or not isinstance(nodes, dict) or not isinstance(kinds, dict):
        return None
    if (any(not isinstance(key, str) or not key or not isinstance(value, str) or not value
            for key, value in nodes.items())
            or any(not isinstance(key, str) or value not in ("chemical", "reaction")
                   for key, value in kinds.items())):
        return None
    for edge in edges:
        if not isinstance(edge, dict):
            return None
        source, target = edge.get("source"), edge.get("target")
        if (not isinstance(source, str) or not isinstance(target, str)
                or source not in nodes or target not in nodes
                or (kinds.get(source), kinds.get(target)) not in
                   (("chemical", "reaction"), ("reaction", "chemical"))):
            return None
    return edges, nodes, kinds


def _snapshot_digest(value):
    if isinstance(value, dict):
        catalog = value.get("catalog_sha256")
        if "catalog_sha256" in value and (not isinstance(catalog, str) or not re.fullmatch(r"[a-f0-9]{64}", catalog)):
            return None
        value = value.get("source_sha256")
    return value if isinstance(value, str) and re.fullmatch(r"[a-f0-9]{64}", value) else None


def source_stock_snapshots(metadata, steps):
    if not isinstance(metadata, dict) or not isinstance(steps, (list, tuple)):
        return None
    snapshots = set()
    if "stock_snapshot" in metadata:
        bound = _snapshot_digest(metadata["stock_snapshot"])
        if bound is None:
            return None
        snapshots.add(bound)
    material_nodes = metadata.get("starting_material_nodes", {})
    if (not isinstance(material_nodes, dict)
            or any(not isinstance(key, str) or not key for key in material_nodes)):
        return None
    nodes = list(material_nodes.values())
    for step in steps:
        step_metadata = getattr(step, "metadata", None)
        if not isinstance(step_metadata, dict):
            return None
        properties = step_metadata.get("precursor_properties", {})
        if not isinstance(properties, dict):
            return None
        prices = properties.get("precursor_prices", {})
        if not isinstance(prices, dict) or any(not isinstance(key, str) or not key for key in prices):
            return None
        nodes.extend(prices.values())
    for node in nodes:
        if not isinstance(node, dict) or not isinstance(node.get("properties", []), list):
            return None
        for prop in node.get("properties", []):
            if not isinstance(prop, dict):
                return None
            if "stock_snapshot" in prop:
                bound = _snapshot_digest(prop["stock_snapshot"])
                if bound is None:
                    return None
                snapshots.add(bound)
    return snapshots
