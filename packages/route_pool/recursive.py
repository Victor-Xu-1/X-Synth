from __future__ import annotations

from dataclasses import replace
from hashlib import sha1
from typing import Iterable

from packages.route_schema.route_schema import RouteCandidate, RouteStep
from packages.scoring.route_scoring import score_route


def graft_subroute(
    parent: RouteCandidate,
    *,
    leaf_smiles: str,
    subroute: RouteCandidate,
    engine: str = "recursive_grafted",
) -> RouteCandidate:
    """Replace one unclosed parent leaf with a route that makes that leaf."""

    parent_unclosed = list(parent.metadata.get("unclosed_precursors") or [])
    if leaf_smiles not in parent_unclosed and leaf_smiles not in parent.starting_materials:
        raise ValueError(f"leaf is not present in parent route: {leaf_smiles}")

    starting_materials = _unique(
        [
            *(smi for smi in parent.starting_materials if smi != leaf_smiles),
            *subroute.starting_materials,
        ]
    )
    subroute_unclosed = list(subroute.metadata.get("unclosed_precursors") or [])
    unclosed = _unique(
        [
            *(smi for smi in parent_unclosed if smi != leaf_smiles),
            *subroute_unclosed,
        ]
    )
    steps = [
        *_renumber_steps(parent.steps, offset=0),
        *_renumber_steps(subroute.steps, offset=len(parent.steps)),
    ]
    raw_parent_depth = parent.metadata.get("recursive_graft_depth")
    if (
        isinstance(raw_parent_depth, int)
        and not isinstance(raw_parent_depth, bool)
        and raw_parent_depth >= 0
    ):
        parent_depth = raw_parent_depth
    else:
        parent_depth = int(bool(parent.metadata.get("recursive_graft")))
    metadata = {
        **parent.metadata,
        "unclosed_precursors": unclosed,
        "recursive_graft_depth": parent_depth + 1,
        "recursive_graft": {
            "leaf_smiles": leaf_smiles,
            "parent_route_id": parent.route_id,
            "subroute_id": subroute.route_id,
            "subroute_engine": subroute.engine,
            "subroute_family_key": subroute.family_key or subroute.route_id,
            "subroute_unclosed_precursors": subroute_unclosed,
        },
    }
    if unclosed:
        metadata["output_mode"] = "draft_unclosed"
        metadata["requires_closure_review"] = True
    else:
        metadata.pop("output_mode", None)
        metadata.pop("requires_closure_review", None)

    route = RouteCandidate(
        route_id=_route_id(parent.route_id, leaf_smiles, subroute.route_id),
        engine=engine,
        target_smiles=parent.target_smiles,
        steps=steps,
        starting_materials=starting_materials,
        closed=not unclosed and bool(starting_materials),
        closure_sources=_unique([*parent.closure_sources, *subroute.closure_sources]),
        route_score=None,
        family_key=parent.family_key or parent.route_id,
        evidence_refs=_unique([*parent.evidence_refs, *subroute.evidence_refs]),
        metadata=metadata,
    )
    return replace(route, route_score=score_route(route))


def _renumber_steps(steps: Iterable[RouteStep], *, offset: int) -> list[RouteStep]:
    return [
        replace(step, step_id=f"s{offset + index}")
        for index, step in enumerate(steps, start=1)
    ]


def _route_id(parent_route_id: str, leaf_smiles: str, subroute_id: str) -> str:
    digest = sha1(f"{parent_route_id}|{leaf_smiles}|{subroute_id}".encode("utf-8")).hexdigest()[:16]
    return f"recursive_grafted:{digest}"


def _unique(values: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if not value or value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result
