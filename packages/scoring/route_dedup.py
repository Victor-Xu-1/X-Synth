from __future__ import annotations

from packages.route_schema.route_schema import RouteCandidate


def select_diverse_routes(routes: list[RouteCandidate], max_routes: int = 10) -> list[RouteCandidate]:
    selected: list[RouteCandidate] = []
    seen_families: set[str] = set()
    for route in routes:
        family = route.family_key or route.route_id
        if family in seen_families:
            continue
        seen_families.add(family)
        selected.append(route)
        if len(selected) >= max_routes:
            break
    return selected
