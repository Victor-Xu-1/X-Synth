"""Finite, family-balanced qualification; failures never hide later alternatives."""

from collections import defaultdict, deque

from packages.validation.route_quality import RouteQualityPolicy
from packages.validation.route_topology import route_signature, topology_reasons
from packages.route_pool.strategy import potential_shortcut
from .operation_review import operation_rejection_ids


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

    def next(self, qualified_families, *, representatives=(), only_improvements=False):
        for _ in range(len(self.families)):
            family = self.families.popleft()
            group = self.groups[family]
            index = 0
            if only_improvements or family in qualified_families:
                index = next((index for index, route in enumerate(group)
                              if any(potential_shortcut(route, value) for value in representatives)), None)
                if index is None:
                    self.families.append(family)
                    continue
            group.rotate(-index)
            route = group.popleft()
            group.rotate(index)
            if group:
                self.families.append(family)
            return route
        return None


def rejected_reactions(routes):
    """Avoid reviewed failures in this job's repair, never blacklist chemistry.

    Unsupported inputs and missing providers cannot create search exclusions.
    """
    reactions = set()
    for route in routes:
        review = route.metadata.get("automated_review", {})
        records = review.get("forward", {}).get("records", [])
        checked = {row["step_id"] for row in records if type(row.get("matched")) is bool
                   and isinstance(row.get("record_id"), str) and row["record_id"] and not row.get("reason")}
        failed = {row["step_id"] for row in records if row.get("matched") is False
                  and row.get("record_id") and not row.get("reason")}
        failed.update(operation_rejection_ids(route.steps, review) & checked)
        reactions.update(step.reaction_smiles for step in route.steps if step.step_id in failed)
    return sorted(reactions)
