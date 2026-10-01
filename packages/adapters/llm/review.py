from __future__ import annotations

from dataclasses import dataclass, field

from packages.route_schema.route_schema import RouteCandidate


@dataclass(frozen=True)
class LLMRouteReviewRequest:
    target_smiles: str
    candidate_routes: list[RouteCandidate]
    review_goal: str = "rank_and_explain_existing_routes_only"


@dataclass(frozen=True)
class LLMRouteReview:
    selected_route_ids: list[str]
    notes: str
    rejected_route_ids: list[str] = field(default_factory=list)

    def validate_against(self, request: LLMRouteReviewRequest) -> "LLMRouteReview":
        known_ids = {route.route_id for route in request.candidate_routes}
        referenced = set(self.selected_route_ids) | set(self.rejected_route_ids)
        unknown = sorted(referenced - known_ids)
        if unknown:
            raise ValueError(f"unknown route id referenced by LLM review: {unknown}")
        return self
