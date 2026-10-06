"""Exact chemical DAG checks, independent of engine scores and catalog flags."""

from collections import Counter
from dataclasses import asdict
from functools import lru_cache
import re

from packages.adapters.stock.commercial_stock import canonicalize_smiles
from packages.adapters.stock.route_pruning import (
    projected_occurrences, pruning_plan, source_occurrences, source_path_digest,
    source_stock_snapshots, step_signature,
)
from packages.chemistry.precursor_occurrences import (
    PrecursorMultiplicityError, reconcile_precursor_occurrences,
)
from packages.route_schema.route_schema import RouteStep


@lru_cache(maxsize=8192)
def chemical_key(smiles):
    return canonicalize_smiles(smiles)


def reaction_key(step):
    return chemical_key(".".join(step.precursors)), chemical_key(step.product)


def route_signature(route):
    return chemical_key(route.target_smiles), tuple(sorted(reaction_key(step) for step in route.steps))


def source_path_reasons(route):
    if source_stock_snapshots(route.metadata, route.steps) is None:
        return ("invalid_source_provenance",)
    signatures, precursor_evidence, reason = _source_reactions(route)
    if reason:
        return (reason,)
    if source_path_digest(route.metadata) is None:
        return ("invalid_source_provenance",)
    projection = route.metadata.get("stock_route_projection")
    if projection is not None:
        return _projection_reasons(route, signatures, precursor_evidence)
    if signatures is None:
        return ()
    if Counter(signatures.values()) != Counter(reaction_key(step) for step in route.steps):
        return ("source_pathway_step_mismatch",)
    sources = source_occurrences(route.steps, route.metadata, chemical_key)
    if not _precursor_evidence_matches(route.steps, sources, precursor_evidence):
        return ("invalid_precursor_occurrence_evidence",)
    return ()


def _source_reactions(route):
    edges = route.metadata.get("pathway_edges")
    if edges is None:
        return None, {}, None
    nodes = route.metadata.get("pathway_node_smiles")
    kinds = route.metadata.get("pathway_node_kinds")
    if not isinstance(edges, list) or not isinstance(nodes, dict) or not isinstance(kinds, dict):
        return None, {}, "invalid_source_pathway"
    children, parents = {}, {}
    for edge in edges:
        if not isinstance(edge, dict):
            return None, {}, "invalid_source_pathway"
        source, target = edge.get("source"), edge.get("target")
        if not isinstance(source, str) or not isinstance(target, str) or (
            kinds.get(source), kinds.get(target)
        ) not in (("chemical", "reaction"), ("reaction", "chemical")):
            return None, {}, "invalid_source_pathway"
        children.setdefault(source, []).append(target)
        parents.setdefault(target, []).append(source)
    node_ids = set(children) | set(parents)
    if any(not isinstance(nodes.get(value), str) or not nodes[value] for value in node_ids):
        return None, {}, "invalid_source_pathway"
    roots = node_ids - set(parents)
    if len(roots) != 1 or chemical_key(nodes[next(iter(roots))]) != chemical_key(route.target_smiles):
        return None, {}, "source_pathway_target_mismatch"
    signatures, precursor_evidence = {}, {}
    for identifier in node_ids:
        if kinds[identifier] == "chemical":
            if not chemical_key(nodes[identifier]) or len(children.get(identifier, ())) > 1:
                return None, {}, "invalid_source_pathway"
            continue
        inputs = children.get(identifier, ())
        outputs = parents.get(identifier, ())
        if not inputs or len(outputs) != 1:
            return None, {}, "invalid_source_pathway"
        sides = nodes[identifier].split(">")
        if len(sides) != 3:
            return None, {}, "reaction_structure_mismatch"
        graph_precursors = [nodes[value] for value in inputs]
        try:
            occurrences = reconcile_precursor_occurrences(graph_precursors, sides[0], canonical=chemical_key)
        except PrecursorMultiplicityError as exc:
            return None, {}, str(exc)
        signature = (chemical_key(".".join(occurrences.precursors)), chemical_key(nodes[outputs[0]]))
        if signature != (chemical_key(sides[0]), chemical_key(sides[2])):
            return None, {}, "reaction_structure_mismatch"
        signatures[identifier] = signature
        precursor_evidence[identifier] = occurrences.evidence(graph_precursors, inputs, sides[0])
    return signatures, precursor_evidence, None


def _precursor_evidence_matches(steps, sources, precursor_evidence):
    if sources is None:
        return False
    originals = {step.step_id: step for step in steps}
    for row in sources:
        evidence = precursor_evidence.get(row["source_id"])
        if evidence is None:
            continue
        step = originals[row["source_step_id"]]
        expected = Counter(chemical_key(group) for group, count in zip(
            evidence["graph_precursors"], evidence["multiplicities"], strict=True) for _ in range(count))
        if expected != Counter(chemical_key(value) for value in step.precursors):
            return False
        saved = step.metadata.get("precursor_occurrences")
        if (saved is not None or any(count != 1 for count in evidence["multiplicities"])) and saved != evidence:
            return False
    return True


def _stock_cuts(route, rows, originals):
    if not isinstance(rows, list):
        raise ValueError("Invalid stock cuts")
    if not rows:
        return {}
    snapshot = route.metadata.get("stock_pruning_snapshot")
    if not isinstance(snapshot, dict):
        raise ValueError("Missing stock snapshot")
    fields = {"catalog": {"source_sha256", "catalog_sha256"}, "decisions": {"sha256"}}.get(snapshot.get("kind"))
    if (fields is None or set(snapshot) != fields | {"kind"}
            or any(not isinstance(snapshot[key], str) or not re.fullmatch(r"[a-f0-9]{64}", snapshot[key]) for key in fields)):
        raise ValueError("Invalid stock snapshot")
    bound = source_stock_snapshots(route.metadata, originals)
    if bound is None:
        raise ValueError("Malformed source stock evidence")
    if bound and (snapshot["kind"] != "catalog" or bound != {snapshot["source_sha256"]}):
        raise ValueError("Stock snapshot differs from source")
    cuts = {}
    for row in rows:
        if not isinstance(row, dict) or set(row) != {"smiles", "snapshot", "decisions"}:
            raise ValueError("Invalid stock evidence")
        product, decisions = row["smiles"], row["decisions"]
        if (not isinstance(product, str) or not product or chemical_key(product) != product
                or product in cuts or row["snapshot"] != snapshot
                or not isinstance(decisions, list) or not decisions):
            raise ValueError("Invalid stock evidence")
        for decision in decisions:
            if (not isinstance(decision, dict) or decision.get("decision") != "accepted"
                    or not isinstance(decision.get("smiles"), str) or chemical_key(decision["smiles"]) != product
                    or not isinstance(decision.get("source"), str) or not decision["source"]
                    or not isinstance(decision.get("reason"), str) or not decision["reason"]):
                raise ValueError("Stock evidence is not exact and accepted")
        cuts[product] = row
    return cuts


def _projection_reasons(route, signatures, precursor_evidence):
    try:
        proof = route.metadata["stock_route_projection"]
        if (not isinstance(proof, dict) or type(proof.get("version")) is not int or proof["version"] != 1
                or set(proof) != {"version", "source_path_sha256", "source_steps", "occurrences", "stock_cuts"}
                or proof["source_path_sha256"] != source_path_digest(route.metadata)
                or not isinstance(proof["source_steps"], list) or not proof["source_steps"]):
            raise ValueError("Invalid source projection")
        originals = [RouteStep(**row) for row in proof["source_steps"]]
        original_signatures = [step_signature(step, chemical_key) for step in originals]
        if any(signature is None for signature in original_signatures):
            raise ValueError("Invalid original steps")
        if signatures is not None and Counter(signatures.values()) != Counter(original_signatures):
            raise ValueError("Original steps do not match source occurrences")
        sources = source_occurrences(originals, route.metadata, chemical_key)
        if not _precursor_evidence_matches(originals, sources, precursor_evidence):
            raise ValueError("Invalid precursor occurrence evidence")
        cuts = _stock_cuts(route, proof["stock_cuts"], originals)
        plan = pruning_plan(originals, route.target_smiles, canonical=chemical_key,
                            buyable=lambda smiles: chemical_key(smiles) in cuts)
        if (plan is None or len(plan.retained_ids) >= len(originals) or set(plan.cut_products) != set(cuts)
                or proof["occurrences"] != projected_occurrences(sources, plan)
                or route.metadata.get("stock_pruned_step_count") != len(originals) - len(plan.retained_ids)
                or route.metadata.get("stock_pruned_intermediates") != list(plan.cut_products)):
            raise ValueError("Invalid occurrence mapping")
        retained_ids = set(plan.retained_ids)
        retained = {step.step_id: step for step in originals if step.step_id in retained_ids}
        expected = Counter(reaction_key(step) for step in retained.values())
        if expected != Counter(reaction_key(step) for step in route.steps):
            return ("source_pathway_step_mismatch",)
        if (len(route.steps) != len(retained) or any(step.step_id not in retained
                or asdict(step) != asdict(retained[step.step_id]) for step in route.steps)):
            raise ValueError("Retained source evidence changed")
    except (KeyError, TypeError, ValueError, AttributeError):
        return ("invalid_source_projection",)
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
