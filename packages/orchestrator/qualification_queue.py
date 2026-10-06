"""Finite, family-balanced qualification; failures never hide later alternatives."""

from collections import defaultdict, deque

from packages.validation.route_quality import RouteQualityPolicy
from packages.validation.route_topology import route_signature, topology_reasons


def family_key(route):
    return route.family_key or route.route_id


class QualificationQueue:
    def __init__(self, routes):
        self.groups = defaultdict(deque)
        self.ineligible = {}
        self.duplicate_ids = set()
        signatures = set()
        policy = RouteQualityPolicy()
        for route in routes:
            reasons = policy.evaluate_route(route).reasons + topology_reasons(route)
            if reasons:
                self.ineligible[route.route_id] = tuple(dict.fromkeys(reasons))
                continue
            signature = route_signature(route)
            if signature in signatures:
                self.duplicate_ids.add(route.route_id)
                continue
            signatures.add(signature)
            self.groups[family_key(route)].append(route)
        self.families = deque(self.groups)

    def next(self, qualified_families):
        while self.families:
            family = self.families.popleft()
            if family in qualified_families:
                continue
            group = self.groups[family]
            route = group.popleft()
            if group:
                self.families.append(family)
            return route
        return None


def rejected_reactions(routes):
    """Ban only actual model mismatches, not unsupported inputs or missing providers."""
    reactions = set()
    for route in routes:
        records = route.metadata.get("automated_review", {}).get("forward", {}).get("records", [])
        failed = {row["step_id"] for row in records if row.get("matched") is False
                  and row.get("record_id") and not row.get("reason")}
        reactions.update(step.reaction_smiles for step in route.steps if step.step_id in failed)
    return sorted(reactions)
