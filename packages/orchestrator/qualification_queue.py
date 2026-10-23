"""Finite, family-balanced qualification; failures never hide later alternatives."""

from collections import defaultdict, deque

from packages.validation.route_quality import RouteQualityPolicy
from packages.validation.route_topology import chemical_key, route_signature, topology_reasons
from packages.validation.template_forward import templates
from packages.route_pool.pool import is_unresolved_family
from packages.route_pool.strategy import potential_shortcut
from .operation_review import operation_rejection_ids, step_records


def family_key(route):
    return route.family_key or route.route_id


def _operation_evidence_key(route):
    """Bind compound groups and exact template strings without reconstruction."""
    return tuple(sorted(
        (chemical_key(step.product),
         tuple(sorted(chemical_key(group) for group in step.precursors)),
         tuple(sorted(set(templates(step)))))
        for step in route.steps
    ))


class QualificationQueue:
    def __init__(self, routes):
        self.groups = defaultdict(deque)
        self.ineligible = {}
        self.duplicate_ids = set()
        self._evidence_variants = defaultdict(deque)
        self._seen_evidence = defaultdict(set)
        self._active_evidence = {}
        self.evidence_retry_count = 0
        signatures = set()
        policy = RouteQualityPolicy()
        # Prefer a mapped source before chemical deduplication hides its variant.
        for route in sorted(routes, key=is_unresolved_family):
            reasons = policy.evaluate_route(route).reasons + topology_reasons(route)
            if reasons:
                self.ineligible[route.route_id] = tuple(dict.fromkeys(reasons))
                continue
            signature = route_signature(route)
            if signature in signatures:
                self.duplicate_ids.add(route.route_id)
                self._evidence_variants[signature].append(route)
                continue
            signatures.add(signature)
            self.groups[family_key(route)].append(route)
        self.families = deque(self.groups)
        self.chemical_unique_count = len(signatures)

    def retry_operation_evidence(self, route) -> bool:
        """Schedule one unseen variant; caller owns gap/matched-prefix review."""
        signature = route_signature(route)
        attempt = (route.route_id, _operation_evidence_key(route))
        if self._active_evidence.get(signature) != attempt:
            return False
        del self._active_evidence[signature]
        variants = self._evidence_variants.get(signature, ())
        while variants:
            alternative = variants.popleft()
            evidence = _operation_evidence_key(alternative)
            if evidence in self._seen_evidence[signature]:
                continue
            self._seen_evidence[signature].add(evidence)
            family = family_key(alternative)
            if not self.groups[family]:
                self.families.append(family)
            self.groups[family].append(alternative)
            self.evidence_retry_count += 1
            return True
        return False

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
            signature = route_signature(route)
            evidence = _operation_evidence_key(route)
            self._seen_evidence[signature].add(evidence)
            self._active_evidence[signature] = (route.route_id, evidence)
            return route
        return None


def rejected_reactions(routes):
    """Avoid reviewed failures in this job's repair, never blacklist chemistry.

    Unsupported inputs and missing providers cannot create search exclusions.
    """
    reactions = set()
    for route in routes:
        review = route.metadata.get("automated_review", {})
        if not isinstance(review, dict) or not isinstance(review.get("forward"), dict):
            continue
        records = step_records(review["forward"].get("records"))
        checked = {identifier for identifier, row in records.items() if type(row.get("matched")) is bool
                   and isinstance(row.get("record_id"), str) and row["record_id"] and not row.get("reason")}
        failed = {identifier for identifier in checked if records[identifier]["matched"] is False}
        failed.update(operation_rejection_ids(route.steps, review) & checked)
        reactions.update(step.reaction_smiles for step in route.steps if step.step_id in failed)
    return sorted(reactions)
