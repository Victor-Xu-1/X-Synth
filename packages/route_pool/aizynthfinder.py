from __future__ import annotations

from collections.abc import Iterable
from dataclasses import replace
from hashlib import sha1
from typing import Any

from packages.route_schema.route_schema import RouteCandidate, RouteStep
from packages.scoring.route_scoring import score_route


def normalize_aizynthfinder_payload(payload: dict[str, Any]) -> list[RouteCandidate]:
    """Convert real AiZynthFinder route-tree JSON into the shared route schema."""
    target = str(payload.get("smiles") or "")
    if not target:
        raise ValueError("AiZynthFinder payload is missing target smiles")

    routes = list(payload.get("routes") or [])
    stock = str(payload.get("stock") or "unknown_stock")
    model_name = _model_name_from_config(str(payload.get("config") or ""))
    stats = dict(payload.get("stats") or {})

    candidates: list[RouteCandidate] = []
    for index, route_tree in enumerate(routes):
        if not isinstance(route_tree, dict):
            continue
        steps: list[RouteStep] = []
        leaves: list[dict[str, Any]] = []
        _walk_mol_node(route_tree, steps=steps, leaves=leaves)
        starting_materials = _unique(
            str(leaf.get("smiles")) for leaf in leaves if leaf.get("smiles")
        )
        unclosed_precursors = [
            str(leaf.get("smiles"))
            for leaf in leaves
            if leaf.get("smiles") and not bool(leaf.get("in_stock"))
        ]
        closed = bool(route_tree.get("metadata", {}).get("is_solved")) and not unclosed_precursors
        evidence_refs = _route_evidence_refs(steps)
        family_key = _family_key(steps, starting_materials)
        route_id = _route_id(target, steps, starting_materials, index)
        engine_score = _state_score(route_tree)
        candidate = RouteCandidate(
            route_id=route_id,
            engine="aizynthfinder",
            target_smiles=target,
            steps=steps,
            starting_materials=starting_materials,
            closed=closed,
            closure_sources=[stock] if closed else [],
            route_score=None,
            family_key=family_key,
            evidence_refs=evidence_refs,
            metadata={
                "source": "aizynthfinder",
                "engine_model": model_name,
                "engine_score": engine_score,
                "route_index": index,
                "raw_scores": dict(route_tree.get("scores") or {}),
                "unclosed_precursors": _unique(unclosed_precursors),
                "stats": {
                    key: stats[key]
                    for key in (
                        "search_time",
                        "first_solution_time",
                        "number_of_nodes",
                        "number_of_routes",
                        "number_of_solved_routes",
                        "policy_used_counts",
                    )
                    if key in stats
                },
            },
        )
        candidate = replace(candidate, route_score=score_route(candidate))
        candidates.append(candidate)
    return candidates


def _walk_mol_node(
    node: dict[str, Any],
    *,
    steps: list[RouteStep],
    leaves: list[dict[str, Any]],
) -> None:
    reactions = [
        child
        for child in node.get("children", []) or []
        if isinstance(child, dict) and child.get("is_reaction")
    ]
    if not reactions:
        leaves.append(node)
        return

    product = str(node.get("smiles") or "")
    for reaction in reactions:
        precursor_nodes = [
            child
            for child in reaction.get("children", []) or []
            if isinstance(child, dict) and child.get("is_chemical")
        ]
        precursors = _unique(
            str(precursor.get("smiles"))
            for precursor in precursor_nodes
            if precursor.get("smiles")
        )
        metadata = dict(reaction.get("metadata") or {})
        template_smarts = str(reaction.get("smiles") or "")
        if template_smarts:
            metadata.setdefault("template_smarts", template_smarts)
        reaction_smiles = (
            f"{'.'.join(precursors)}>>{product}"
            if precursors and product
            else template_smarts
        )
        step_index = len(steps) + 1
        steps.append(
            RouteStep(
                step_id=f"s{step_index}",
                reaction_smiles=reaction_smiles,
                precursors=precursors,
                product=product,
                source=_reaction_source(metadata),
                confidence=_as_float(metadata.get("policy_probability")),
                metadata=metadata,
            )
        )
        for precursor in precursor_nodes:
            _walk_mol_node(precursor, steps=steps, leaves=leaves)


def _reaction_source(metadata: dict[str, Any]) -> str:
    policy = metadata.get("policy_name")
    if policy:
        return f"aizynthfinder:{policy}"
    return "aizynthfinder"


def _route_evidence_refs(steps: list[RouteStep]) -> list[str]:
    refs: list[str] = []
    for step in steps:
        template_hash = step.metadata.get("template_hash")
        if template_hash:
            refs.append(f"template_hash:{template_hash}")
        policy = step.metadata.get("policy_name")
        if policy:
            refs.append(f"policy:{policy}")
    return _unique(refs)


def _family_key(steps: list[RouteStep], starting_materials: list[str]) -> str:
    if steps:
        if steps[0].reaction_smiles:
            return f"route-family:first-reaction:{_short_hash([steps[0].reaction_smiles])}"
        first_template = steps[0].metadata.get("template_hash")
        if first_template:
            return f"route-family:first-template:{first_template}"
    return f"route-family:starting-materials:{_short_hash(starting_materials)}"


def _route_id(
    target: str,
    steps: list[RouteStep],
    starting_materials: list[str],
    index: int,
) -> str:
    parts = [target, str(index)]
    parts.extend(step.reaction_smiles for step in steps)
    parts.extend(starting_materials)
    return f"aizynthfinder:{_short_hash(parts)}"


def _state_score(route_tree: dict[str, Any]) -> float | None:
    return _as_float((route_tree.get("scores") or {}).get("state score"))


def _model_name_from_config(config: str) -> str:
    if not config:
        return "default"
    parts = [part for part in config.replace("\\", "/").split("/") if part]
    if len(parts) >= 2 and parts[-1] == "config.yml":
        parent = parts[-2]
        if parent != "models":
            return parent
    return "default"


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


def _as_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None
