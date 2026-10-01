from __future__ import annotations

from packages.route_schema.route_schema import RouteCandidate


def score_route(route: RouteCandidate) -> float:
    score = 0.0
    if route.closed:
        score += 100.0
    score += 30.0 - len(route.steps) * 3.0
    if route.closure_sources:
        score += 10.0
    if any(ref.startswith("exact") for ref in route.evidence_refs):
        score += 10.0
    score += _engine_prior(route.engine)
    score += _confidence_bonus(route)
    score -= _template_quality_penalty(route)
    return score


def _engine_prior(engine: str) -> float:
    if engine.startswith("askcos_retro_star"):
        return 8.0
    if engine.startswith("askcos_mcts"):
        return 6.0
    if engine.startswith("askcos"):
        return 5.0
    if engine == "aizynthfinder":
        return 2.0
    return 0.0


def _confidence_bonus(route: RouteCandidate) -> float:
    confidences = [
        step.confidence
        for step in route.steps
        if isinstance(step.confidence, int | float)
    ]
    if not confidences:
        return 0.0
    average_confidence = sum(float(value) for value in confidences) / len(confidences)
    return max(0.0, min(average_confidence, 1.0)) * 8.0


def _template_quality_penalty(route: RouteCandidate) -> float:
    penalty = 0.0
    for step in route.steps:
        classification = step.metadata.get("classification")
        if isinstance(classification, str) and "unrecognized" in classification.lower():
            penalty += 1.0
        if isinstance(step.confidence, int | float) and float(step.confidence) < 0.01:
            penalty += 2.0
    return penalty
