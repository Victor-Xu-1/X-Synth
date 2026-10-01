from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

RouteStatus = Literal["completed", "second_pass_required", "failed_unclosed"]


@dataclass(frozen=True)
class RouteLifecycle:
    min_routes: int = 3

    def next_status(self, closed_route_count: int, pass_number: int) -> RouteStatus:
        if closed_route_count >= self.min_routes:
            return "completed"
        if pass_number <= 1:
            return "second_pass_required"
        return "failed_unclosed"
