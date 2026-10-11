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


def _shortcut(shorter, longer, short_graph, long_graph):
    if chemical_key(shorter.target_smiles) != chemical_key(longer.target_smiles):
        return None
    direct_keys = short_graph.keys() - long_graph.keys()
    replacement_keys = long_graph.keys() - short_graph.keys()
    if len(direct_keys) != 1 or len(replacement_keys) < 2:
        return None
    key = next(iter(direct_keys))
    root, inputs = key
    segment = {product: Counter(dict(precursors)) for product, precursors in replacement_keys}
    internal = set(segment) - {root}
    if any(internal & set(dict(precursors)) for _product, precursors in short_graph.keys() & long_graph.keys()):
        return None
    replaced = {long_graph[value].step_id: long_graph[value] for value in replacement_keys}
    frontier = _segment_frontier(segment, root)
    if frontier is None or not Counter(dict(inputs)) <= frontier:
        return None
    return Shortcut(shorter.route_id, short_graph[key].step_id, tuple(sorted(replaced)))


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
