"""Qualified exact shortcuts, not length-only or scaffold-similarity pruning."""

from collections import Counter, deque
from dataclasses import dataclass, replace

from packages.route_schema.route_schema import RouteCandidate
from packages.validation.route_topology import chemical_key
from .strategy_evidence import process_evidence_state


@dataclass(frozen=True)
class Shortcut:
    route_id: str
    step_id: str
    replaced_steps: tuple[str, ...]
    reason: str | None = None
    segments: dict[str, list[str]] | None = None


@dataclass(frozen=True)
class StrategySelection:
    routes: tuple[RouteCandidate, ...]
    dominated: dict[str, Shortcut]
    pending: dict[str, Shortcut]


def _inputs(values):
    return Counter(chemical_key(value) for value in values)


def _graph(route):
    return {(chemical_key(step.product), tuple(sorted(_inputs(step.precursors).items()))): step
            for step in route.steps}


def _segment_frontier(segment, root):
    if root not in segment:
        return None
    incoming = Counter(child for inputs in segment.values() for child in inputs if child in segment)
    if incoming[root]:
        return None
    queue, reached = deque([root]), set()
    amounts, frontier = Counter({root: 1}), Counter()
    while queue:
        product = queue.popleft()
        reached.add(product)
        for precursor, count in segment[product].items():
            amount = amounts[product] * count
            if precursor not in segment:
                frontier[precursor] += amount
                continue
            amounts[precursor] += amount
            incoming[precursor] -= 1
            if not incoming[precursor]:
                queue.append(precursor)
    return frontier if reached == set(segment) else None


def _replacement_segments(direct, replacement, retained_inputs):
    """Cut changed DAG steps at direct products without enumerating recipe paths."""
    remaining, segments = set(replacement), {}
    for root, inputs in sorted(direct.items()):
        if root not in remaining:
            return None
        segment, stack = {}, [root]
        while stack:
            product = stack.pop()
            if product in segment or (product != root and product in direct):
                continue
            if product not in replacement:
                continue
            # Segments may meet at direct products, never share replaced internals.
            if product not in remaining:
                return None
            segment[product] = replacement[product]
            remaining.remove(product)
            stack.extend(segment[product])
        if len(segment) < 2 or (set(segment) - {root}) & retained_inputs:
            return None
        frontier = _segment_frontier(segment, root)
        if frontier is None or not inputs <= frontier:
            return None
        segments[root] = tuple(sorted(segment))
    return segments if not remaining else None


def _shortcut(shorter, longer, short_graph, long_graph):
    target = chemical_key(shorter.target_smiles)
    if target != chemical_key(longer.target_smiles):
        return None
    direct_keys = short_graph.keys() - long_graph.keys()
    replacement_keys = long_graph.keys() - short_graph.keys()
    if not direct_keys or len(replacement_keys) < 2 * len(direct_keys):
        return None
    direct = {product: Counter(dict(inputs)) for product, inputs in direct_keys}
    replacement = {product: Counter(dict(inputs)) for product, inputs in replacement_keys}
    if len(direct) != len(direct_keys) or len(replacement) != len(replacement_keys):
        return None
    retained_inputs = {precursor for _product, inputs in short_graph.keys() & long_graph.keys()
                       for precursor, _count in inputs}
    segments = _replacement_segments(direct, replacement, retained_inputs)
    if segments is None:
        return None
    direct_steps = {key[0]: short_graph[key].step_id for key in direct_keys}
    replaced = {key[0]: long_graph[key].step_id for key in replacement_keys}
    witness = {direct_steps[root]: sorted(replaced[product] for product in products)
               for root, products in segments.items()}
    anchor = min(direct_keys, key=lambda key: (key[0] != target, key))
    return Shortcut(shorter.route_id, short_graph[anchor].step_id, tuple(sorted(replaced.values())),
                    segments=witness if len(witness) > 1 else None)


def select_strategies(routes):
    """Caller supplies accepted DAGs; raw or unsupported paths cannot dominate."""
    identifiers = Counter(route.route_id for route in routes)
    eligible = [route for route in routes if identifiers[route.route_id] == 1
                and route.closed and route.metadata.get("full_forward_prediction_validated") is True
                and route.metadata.get("operation_validation_passed") is True]
    prepared = [(route, _graph(route)) for route in sorted(eligible, key=lambda value: len(value.steps))]
    dominated, pending = {}, {}
    for index, (longer, long_graph) in enumerate(prepared):
        for shorter, short_graph in prepared[:index]:
            if shorter.route_id in dominated or shorter.route_id in pending or len(shorter.steps) == len(longer.steps):
                continue
            proof = _shortcut(shorter, longer, short_graph, long_graph)
            if proof is not None:
                replaced = {step.step_id: step for step in longer.steps if step.step_id in proof.replaced_steps}
                evidence = process_evidence_state(longer, replaced)
                if evidence == "documented":
                    continue
                if evidence == "unknown":
                    pending[longer.route_id] = replace(proof, reason="strategy_process_evidence_incomplete")
                else:
                    dominated[longer.route_id] = proof
                break
    return StrategySelection(tuple(route for route in routes
                                  if route.route_id not in dominated and route.route_id not in pending), dominated, pending)


def potential_shortcut(candidate, representative):
    """Scheduling only: an unchecked proposal cannot establish dominance."""
    if len(candidate.steps) >= len(representative.steps):
        return False
    proof = _shortcut(candidate, representative, _graph(candidate), _graph(representative))
    return proof is not None and process_evidence_state(representative, {
        step.step_id: step for step in representative.steps if step.step_id in proof.replaced_steps
    }) != "documented"
