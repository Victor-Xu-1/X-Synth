from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from packages.route_schema.route_schema import RouteCandidate

Action = Literal["output_final", "second_pass", "output_best_available"]


@dataclass(frozen=True)
class SearchDecision:
    action: Action
    reason: str
    closed_route_count: int


class SearchStrategyManager:
    def __init__(self, min_routes: int = 3, max_routes: int = 10) -> None:
        if min_routes < 1:
            raise ValueError("min_routes must be at least 1")
        if max_routes < min_routes:
            raise ValueError("max_routes must be greater than or equal to min_routes")
        self.min_routes = min_routes
        self.max_routes = max_routes

    def evaluate(self, routes: list[RouteCandidate], pass_number: int) -> SearchDecision:
        closed_count = sum(1 for route in routes if route.closed)
        if closed_count >= self.min_routes:
            return SearchDecision("output_final", "enough_closed_routes", closed_count)
        if pass_number <= 1:
            return SearchDecision("second_pass", "insufficient_closed_routes", closed_count)
        return SearchDecision("output_best_available", "second_pass_completed", closed_count)
