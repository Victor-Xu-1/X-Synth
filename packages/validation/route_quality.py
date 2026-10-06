from __future__ import annotations

import re
from dataclasses import dataclass

from packages.route_schema.route_schema import RouteCandidate
from packages.chemistry.material_scope import route_scope_exclusions
from .route_topology import topology_reasons

MetricValue = int | float


@dataclass(frozen=True)
class RouteQualityDecision:
    accepted: bool
    reasons: tuple[str, ...]
    metrics: dict[str, MetricValue]


@dataclass(frozen=True)
class RouteQualityPolicy:
    require_full_forward_validation: bool = False
    max_steps: int | None = None
    ultra_low_confidence_threshold: float = 0.05
    min_first_step_confidence: float = 0.05
    max_ultra_low_fraction: float = 0.20
    min_confidence_samples: int = 5
    max_recursive_atom_growth: int = 8

    def __post_init__(self) -> None:
        if self.max_steps is not None and self.max_steps < 1:
            raise ValueError("max_steps must be at least 1")
        if not 0.0 <= self.ultra_low_confidence_threshold <= 1.0:
            raise ValueError("ultra_low_confidence_threshold must be between 0 and 1")
        if not 0.0 <= self.min_first_step_confidence <= 1.0:
            raise ValueError("min_first_step_confidence must be between 0 and 1")
        if not 0.0 <= self.max_ultra_low_fraction <= 1.0:
            raise ValueError("max_ultra_low_fraction must be between 0 and 1")
        if self.min_confidence_samples < 1:
            raise ValueError("min_confidence_samples must be at least 1")
        if self.max_recursive_atom_growth < 0:
            raise ValueError("max_recursive_atom_growth must be non-negative")

    def evaluate_route(self, route: RouteCandidate) -> RouteQualityDecision:
        reasons: list[str] = []
        restricted_material_count = len(route_scope_exclusions(route))
        if restricted_material_count:
            reasons.append("material_outside_ordinary_research_scope")
        unclosed = list(route.metadata.get("unclosed_precursors") or [])
        if not route.closed or unclosed:
            reasons.append("route_not_closed")

        step_count = len(route.steps)
        if step_count == 0:
            reasons.append("empty_route")
        elif self.max_steps is not None and step_count > self.max_steps:
            reasons.append("too_many_steps")

        signatures = [
            step.reaction_smiles.strip()
            for step in route.steps
            if step.reaction_smiles.strip()
        ]
        repeated_reaction_count = len(signatures) - len(set(signatures))
        if repeated_reaction_count:
            reasons.append("repeated_reaction")

        dependencies: dict[str, set[str]] = {}
        for step in route.steps:
            precursor_keys = {
                precursor.strip() for precursor in step.precursors if precursor.strip()
            }
            product = step.product.strip()
            if product:
                dependencies.setdefault(product, set()).update(precursor_keys)
        cycle_count = _directed_cycle_count(dependencies)
        if cycle_count:
            reasons.append("reaction_cycle")

        confidences = [
            float(step.confidence)
            for step in route.steps
            if isinstance(step.confidence, int | float)
        ]
        ultra_low_count = sum(
            value < self.ultra_low_confidence_threshold for value in confidences
        )
        ultra_low_fraction = ultra_low_count / len(confidences) if confidences else 0.0
        if (
            len(confidences) >= self.min_confidence_samples
            and ultra_low_fraction > self.max_ultra_low_fraction
        ):
            reasons.append("ultra_low_confidence_fraction")
        first_step_confidence = -1.0
        if route.steps and isinstance(route.steps[0].confidence, int | float):
            first_step_confidence = float(route.steps[0].confidence)
            if first_step_confidence < self.min_first_step_confidence:
                reasons.append("low_first_step_confidence")

        forward_validation_min_score = -1.0
        raw_forward_score = route.metadata.get("forward_validation_min_score")
        if isinstance(raw_forward_score, int | float):
            forward_validation_min_score = float(raw_forward_score)
        if route.metadata.get("forward_validation_passed") is False:
            reasons.append("forward_validation_failed")
        if self.require_full_forward_validation and route.metadata.get("full_forward_prediction_validated") is not True:
            reasons.append("full_forward_validation_required")
        if self.require_full_forward_validation:
            reasons.extend(topology_reasons(route))

        recursive_atom_growth = 0
        graft = route.metadata.get("recursive_graft")
        if isinstance(graft, dict):
            replaced_leaf = str(graft.get("leaf_smiles") or "").strip()
            new_unclosed = graft.get("subroute_unclosed_precursors") or []
            if replaced_leaf and isinstance(new_unclosed, list) and new_unclosed:
                replaced_atom_count = smiles_atom_count(replaced_leaf)
                largest_new_atom_count = max(
                    (smiles_atom_count(str(smiles)) for smiles in new_unclosed),
                    default=0,
                )
                recursive_atom_growth = largest_new_atom_count - replaced_atom_count
                if recursive_atom_growth > self.max_recursive_atom_growth:
                    reasons.append("recursive_complexity_regression")

        metrics: dict[str, MetricValue] = {
            "step_count": step_count,
            "restricted_material_count": restricted_material_count,
            "unclosed_precursor_count": len(unclosed),
            "repeated_reaction_count": repeated_reaction_count,
            "reaction_cycle_count": cycle_count,
            "confidence_sample_count": len(confidences),
            "ultra_low_confidence_count": ultra_low_count,
            "ultra_low_confidence_fraction": ultra_low_fraction,
            "first_step_confidence": first_step_confidence,
            "forward_validation_min_score": forward_validation_min_score,
            "recursive_max_atom_growth": recursive_atom_growth,
        }
        return RouteQualityDecision(
            accepted=not reasons,
            reasons=tuple(dict.fromkeys(reasons)),
            metrics=metrics,
        )


def _directed_cycle_count(dependencies: dict[str, set[str]]) -> int:
    visited: set[str] = set()
    active: set[str] = set()
    cycle_edges = 0

    for root in dependencies:
        if root in visited:
            continue
        active.add(root)
        stack = [(root, iter(dependencies.get(root, ())))]
        while stack:
            node, children = stack[-1]
            child = next(children, None)
            if child is None:
                active.remove(node)
                visited.add(node)
                stack.pop()
            elif child in active:
                cycle_edges += 1
            elif child not in visited:
                active.add(child)
                stack.append((child, iter(dependencies.get(child, ()))))
    return cycle_edges


_SMILES_ATOM_PATTERN = re.compile(
    r"\[[^\]]+\]|Br|Cl|Si|Se|Na|Li|Mg|Al|Ca|Zn|Sn|[BCNOPSFIKbcnops]"
)


def smiles_atom_count(smiles: str) -> int:
    return len(_SMILES_ATOM_PATTERN.findall(smiles))
