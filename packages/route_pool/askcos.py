from __future__ import annotations

from collections import defaultdict, deque
from collections.abc import Iterable
from dataclasses import replace
from hashlib import sha1
from typing import Any

from rdkit import Chem

from packages.route_schema.route_schema import RouteCandidate, RouteStep
from packages.scoring.route_scoring import score_route


def normalize_askcos_tree_result(payload: dict[str, Any], *, engine: str = "askcos") -> list[RouteCandidate]:
    """Convert an ASKCOS UDS tree-builder result into shared route candidates."""
    result = _as_dict(payload.get("result") or payload)
    uds = _as_dict(result.get("uds") or payload.get("uds"))
    original_target = str(payload.get("target_smiles") or "")
    target = _target_from_uds(uds) or original_target
    if not target:
        raise ValueError("ASKCOS payload is missing target smiles")
    frontier_candidates = _frontier_partial_routes(
        payload=payload,
        result=result,
        target=target,
        engine=engine,
    )
    if not uds:
        return frontier_candidates

    node_dict = _as_dict(uds.get("node_dict"))
    uuid2smiles = _as_dict(uds.get("uuid2smiles"))
    pathways = list(uds.get("pathways") or [])
    pathway_props = list(uds.get("pathways_properties") or [])
    stats = _as_dict(result.get("stats") or payload.get("stats"))
    review = _as_dict(result.get("route_quality_review") or payload.get("route_quality_review"))

    candidates: list[RouteCandidate] = []
    for index, edges in enumerate(pathways):
        if not isinstance(edges, list):
            continue
        steps = _path_steps(edges, uuid2smiles, node_dict)
        starting_materials = _path_starting_materials(edges, uuid2smiles, node_dict)
        unclosed = [
            smiles
            for smiles in starting_materials
            if not _is_commercial_terminal(_node_for_smiles(node_dict, smiles))
        ]
        closed = bool(starting_materials) and not unclosed
        path_metadata = _as_dict(pathway_props[index] if index < len(pathway_props) else {})
        route = RouteCandidate(
            route_id=_route_id(target, engine, steps, starting_materials, index),
            engine=engine,
            target_smiles=target,
            steps=steps,
            starting_materials=starting_materials,
            closed=closed,
            closure_sources=["askcos_buyables"] if closed else [],
            route_score=None,
            family_key=_family_key(steps, starting_materials),
            evidence_refs=_evidence_refs(steps, path_metadata),
            metadata={
                "source": "askcos",
                "original_target_smiles": original_target,
                "route_index": index,
                "pathway_properties": path_metadata,
                "unclosed_precursors": unclosed,
                "stats": {
                    key: stats[key]
                    for key in (
                        "total_iterations",
                        "total_chemicals",
                        "total_reactions",
                        "total_templates",
                        "total_paths",
                        "first_path_time",
                        "build_time",
                    )
                    if key in stats
                },
                "route_quality_review": review,
            },
        )
        candidates.append(replace(route, route_score=score_route(route)))
    route_ids = {route.route_id for route in candidates}
    candidates.extend(
        route for route in frontier_candidates if route.route_id not in route_ids
    )
    return candidates


def _frontier_partial_routes(
    *,
    payload: dict[str, Any],
    result: dict[str, Any],
    target: str,
    engine: str,
) -> list[RouteCandidate]:
    storage = _as_dict(result.get("storage") or payload.get("storage"))
    summary = _as_dict(storage.get("frontier_summary"))
    reaction_summaries = summary.get("root_reactions") or summary.get("top_reactions") or []
    if not isinstance(reaction_summaries, list):
        return []

    canonical_target = _canonical_unmapped_smiles(target)
    if not canonical_target:
        return []

    candidates: list[RouteCandidate] = []
    seen_reactions: set[str] = set()
    for index, item in enumerate(reaction_summaries):
        reaction_node = _as_dict(item)
        raw_reaction = str(reaction_node.get("smiles") or reaction_node.get("id") or "")
        raw_precursors, separator, raw_product = raw_reaction.partition(">>")
        if not separator:
            continue
        canonical_product = _canonical_unmapped_smiles(
            str(reaction_node.get("product_smiles") or raw_product)
        )
        if canonical_product != canonical_target:
            continue

        precursor_values = reaction_node.get("precursors")
        if not isinstance(precursor_values, list):
            precursor_values = raw_precursors.split(".")
        precursors = _unique(
            canonical
            for value in precursor_values
            if (canonical := _canonical_unmapped_smiles(str(value)))
        )
        if not precursors or canonical_target in precursors:
            continue

        reaction_smiles = f"{'.'.join(precursors)}>>{canonical_target}"
        if reaction_smiles in seen_reactions:
            continue
        seen_reactions.add(reaction_smiles)
        step = RouteStep(
            step_id="s1",
            reaction_smiles=reaction_smiles,
            precursors=precursors,
            product=canonical_target,
            source=f"{engine}:frontier",
            confidence=_as_float(
                reaction_node.get("plausibility")
                or reaction_node.get("rxn_score_from_model")
                or reaction_node.get("template_score")
                or reaction_node.get("score")
            ),
            metadata=reaction_node,
        )
        route = RouteCandidate(
            route_id=_route_id(target, engine, [step], precursors, index),
            engine=engine,
            target_smiles=target,
            steps=[step],
            starting_materials=precursors,
            closed=False,
            closure_sources=[],
            route_score=None,
            family_key=_family_key([step], precursors),
            evidence_refs=[f"reaction:{_short_hash([reaction_smiles])}"],
            metadata={
                "source": "askcos_frontier",
                "frontier_partial": True,
                "storage_reason": storage.get("reason"),
                "unclosed_precursors": precursors,
                "frontier_reaction": reaction_node,
            },
        )
        candidates.append(replace(route, route_score=score_route(route)))
    return candidates


def _canonical_unmapped_smiles(smiles: str) -> str | None:
    if not smiles:
        return None
    try:
        mol = Chem.MolFromSmiles(smiles)
    except Exception:
        return None
    if mol is None:
        return None
    for atom in mol.GetAtoms():
        atom.SetAtomMapNum(0)
        atom.SetIsotope(0)
    return Chem.MolToSmiles(mol, canonical=True)


def _path_steps(
    edges: list[dict[str, Any]],
    uuid2smiles: dict[str, Any],
    node_dict: dict[str, Any],
) -> list[RouteStep]:
    children = _children(edges)
    parents = _parents(edges)
    ordered_reactions = _topological_reaction_uuids(edges, uuid2smiles, node_dict)
    steps: list[RouteStep] = []
    for reaction_uuid in ordered_reactions:
        reaction_smiles = str(uuid2smiles.get(reaction_uuid) or "")
        reaction_node = _node_for_smiles(node_dict, reaction_smiles)
        precursor_smiles = [
            str(uuid2smiles.get(child_uuid) or "")
            for child_uuid in children.get(reaction_uuid, [])
            if _node_for_smiles(node_dict, str(uuid2smiles.get(child_uuid) or "")).get("type") == "chemical"
        ]
        product = ""
        for parent_uuid in parents.get(reaction_uuid, []):
            candidate = str(uuid2smiles.get(parent_uuid) or "")
            if _node_for_smiles(node_dict, candidate).get("type") == "chemical":
                product = candidate
                break
        if not product:
            _, _, product = reaction_smiles.partition(">>")
        steps.append(
            RouteStep(
                step_id=f"s{len(steps) + 1}",
                reaction_smiles=reaction_smiles,
                precursors=_unique(precursor_smiles),
                product=product,
                source=_reaction_source(reaction_node),
                confidence=_as_float(
                    reaction_node.get("plausibility")
                    or reaction_node.get("rxn_score_from_model")
                    or reaction_node.get("template_score")
                ),
                metadata=reaction_node,
            )
        )
    return steps


def _path_starting_materials(
    edges: list[dict[str, Any]],
    uuid2smiles: dict[str, Any],
    node_dict: dict[str, Any],
) -> list[str]:
    children = _children(edges)
    node_ids = set(children)
    for edge in edges:
        node_ids.add(str(edge.get("target")))
    leaves: list[str] = []
    for node_id in node_ids:
        if children.get(node_id):
            continue
        smiles = str(uuid2smiles.get(node_id) or "")
        if not smiles:
            continue
        if _node_for_smiles(node_dict, smiles).get("type") == "chemical":
            leaves.append(smiles)
    return _unique(leaves)


def _topological_reaction_uuids(
    edges: list[dict[str, Any]],
    uuid2smiles: dict[str, Any],
    node_dict: dict[str, Any],
) -> list[str]:
    children = _children(edges)
    incoming = _parents(edges)
    node_ids = set(children)
    for edge in edges:
        node_ids.add(str(edge.get("target")))
    roots = sorted(node_id for node_id in node_ids if not incoming.get(node_id))
    queue: deque[str] = deque(roots)
    seen: set[str] = set()
    reactions: list[str] = []
    while queue:
        node_id = queue.popleft()
        if node_id in seen:
            continue
        seen.add(node_id)
        smiles = str(uuid2smiles.get(node_id) or "")
        if _node_for_smiles(node_dict, smiles).get("type") == "reaction":
            reactions.append(node_id)
        for child in children.get(node_id, []):
            queue.append(child)
    return reactions


def _children(edges: list[dict[str, Any]]) -> dict[str, list[str]]:
    children: dict[str, list[str]] = defaultdict(list)
    for edge in edges:
        source = str(edge.get("source"))
        target = str(edge.get("target"))
        if source and target:
            children[source].append(target)
    return children


def _parents(edges: list[dict[str, Any]]) -> dict[str, list[str]]:
    parents: dict[str, list[str]] = defaultdict(list)
    for edge in edges:
        source = str(edge.get("source"))
        target = str(edge.get("target"))
        if source and target:
            parents[target].append(source)
    return parents


def _node_for_smiles(node_dict: dict[str, Any], smiles: str) -> dict[str, Any]:
    return _as_dict(node_dict.get(smiles))


def _target_from_uds(uds: dict[str, Any]) -> str:
    uuid2smiles = _as_dict(uds.get("uuid2smiles"))
    return str(uuid2smiles.get("00000000-0000-0000-0000-000000000000") or "")


def _reaction_source(reaction_node: dict[str, Any]) -> str:
    metadata = reaction_node.get("model_metadata")
    if isinstance(metadata, list) and metadata:
        first = _as_dict(metadata[0])
        backend = first.get("backend")
        model_name = first.get("model_name")
        if backend and model_name:
            return f"askcos:{backend}:{model_name}"
    cluster = _as_dict(reaction_node.get("reaction_properties")).get("cluster_name")
    if cluster:
        return f"askcos:{cluster}"
    return "askcos"


def _is_commercial_terminal(node: dict[str, Any]) -> bool:
    if not node:
        return False
    if not bool(node.get("terminal")):
        return False
    price = _as_float(node.get("purchase_price"))
    if price is not None and price > 0:
        return True
    return bool(node.get("as_reactant") or node.get("as_product"))


def _evidence_refs(steps: list[RouteStep], path_metadata: dict[str, Any]) -> list[str]:
    refs: list[str] = []
    cluster_id = path_metadata.get("cluster_id")
    if cluster_id is not None:
        refs.append(f"askcos_cluster:{cluster_id}")
    for step in steps:
        props = _as_dict(step.metadata.get("reaction_properties"))
        if props.get("cluster_id") is not None:
            refs.append(f"reaction_cluster:{props['cluster_id']}")
        refs.append(f"reaction:{_short_hash([step.reaction_smiles])}")
    return _unique(refs)


def _family_key(steps: list[RouteStep], starting_materials: list[str]) -> str:
    if steps and steps[0].reaction_smiles:
        return f"route-family:first-reaction:{_short_hash([steps[0].reaction_smiles])}"
    return f"route-family:starting-materials:{_short_hash(starting_materials)}"


def _route_id(
    target: str,
    engine: str,
    steps: list[RouteStep],
    starting_materials: list[str],
    index: int,
) -> str:
    values = [target, engine, str(index), *(step.reaction_smiles for step in steps), *starting_materials]
    return f"{engine}:{_short_hash(values)}"


def _as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _as_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _short_hash(values: Iterable[str]) -> str:
    digest = sha1()
    for value in values:
        digest.update(value.encode("utf-8"))
        digest.update(b"\0")
    return digest.hexdigest()[:16]


def _unique(values: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result
