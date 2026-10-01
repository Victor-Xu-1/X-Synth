from __future__ import annotations

from dataclasses import replace
from typing import Iterable

from packages.route_schema.route_schema import RouteCandidate
from packages.scoring.route_scoring import score_route
from packages.validation.route_quality import RouteQualityPolicy


class UnifiedRoutePool:
    """Shared candidate pool before route-family selection and final output."""

    def __init__(
        self,
        *,
        min_routes: int = 3,
        max_routes: int = 10,
        quality_policy: RouteQualityPolicy | None = None,
    ) -> None:
        if min_routes < 1:
            raise ValueError("min_routes must be at least 1")
        if max_routes < min_routes:
            raise ValueError("max_routes must be greater than or equal to min_routes")
        self.min_routes = min_routes
        self.max_routes = max_routes
        self.quality_policy = quality_policy
        self._routes: list[RouteCandidate] = []
        self._target_key: str | None = None

    def add_routes(self, routes: Iterable[RouteCandidate]) -> None:
        scored_routes = self._with_scores(routes)
        for route in scored_routes:
            key = _canonical_target_key(route.target_smiles)
            if self._target_key is None:
                self._target_key = key
            elif key != self._target_key:
                raise ValueError(
                    "cannot merge routes for different targets: "
                    f"{route.target_smiles!r} does not match existing target"
                )
        self._routes.extend(scored_routes)

    def ranked_routes(self) -> list[RouteCandidate]:
        return sorted(
            self._routes,
            key=lambda route: (
                route.closed,
                route.route_score if route.route_score is not None else score_route(route),
                -len(route.steps),
                route.engine,
                route.route_id,
            ),
            reverse=True,
        )

    def final_candidates(self) -> list[RouteCandidate]:
        ranked = self.ranked_routes()
        if self.quality_policy is not None:
            ranked = [
                route
                for route in ranked
                if self.quality_policy.evaluate_route(route).accepted
            ]
        if not ranked:
            return []
        selected: list[RouteCandidate] = []
        seen_families: set[str] = set()
        has_closed_routes = any(route.closed for route in ranked)
        if not has_closed_routes:
            return self._draft_candidates(ranked)
        best_score = (
            ranked[0].route_score if ranked and ranked[0].route_score is not None else None
        )

        for route in ranked:
            if has_closed_routes and not route.closed:
                continue
            if len(selected) >= self.min_routes and not _passes_optional_quality_floor(
                route, best_score
            ):
                continue
            _add_if_unique_family(
                route,
                selected,
                seen_families,
            )
            if len(selected) >= self.max_routes:
                break
        if len(selected) >= self.min_routes:
            return selected

        for route in ranked:
            if has_closed_routes and not route.closed:
                continue
            _add_if_unique_family(
                route,
                selected,
                seen_families,
            )
            if len(selected) >= self.min_routes or len(selected) >= self.max_routes:
                break
        return selected

    def closed_route_count(self) -> int:
        return sum(1 for route in self._routes if route.closed)

    def engine_counts(self) -> dict[str, int]:
        counts: dict[str, int] = {}
        for route in self._routes:
            counts[route.engine] = counts.get(route.engine, 0) + 1
        return counts

    def target_key(self) -> str | None:
        return self._target_key

    @staticmethod
    def _with_scores(routes: Iterable[RouteCandidate]) -> list[RouteCandidate]:
        scored: list[RouteCandidate] = []
        for route in routes:
            if route.route_score is None:
                route = replace(route, route_score=score_route(route))
            scored.append(route)
        return scored

    def _draft_candidates(self, ranked: list[RouteCandidate]) -> list[RouteCandidate]:
        selected: list[RouteCandidate] = []
        seen_families: set[str] = set()
        for route in ranked:
            metadata = dict(route.metadata)
            metadata["output_mode"] = "draft_unclosed"
            metadata.setdefault("requires_closure_review", True)
            if _add_if_unique_family(replace(route, metadata=metadata), selected, seen_families):
                if len(selected) >= self.max_routes:
                    break
        if len(selected) >= self.min_routes:
            return selected
        seen_route_ids = {route.route_id for route in selected}
        for route in ranked:
            if route.route_id in seen_route_ids:
                continue
            metadata = dict(route.metadata)
            metadata["output_mode"] = "draft_unclosed"
            metadata.setdefault("requires_closure_review", True)
            selected.append(replace(route, metadata=metadata))
            seen_route_ids.add(route.route_id)
            if len(selected) >= self.min_routes or len(selected) >= self.max_routes:
                break
        return selected


def _canonical_target_key(smiles: str) -> str:
    try:
        from rdkit import Chem

        mol = Chem.MolFromSmiles(smiles)
        if mol is not None:
            return Chem.MolToSmiles(mol, canonical=True)
    except Exception:
        pass
    return smiles


def _add_if_unique_family(
    route: RouteCandidate,
    selected: list[RouteCandidate],
    seen_families: set[str],
) -> bool:
    family = route.family_key or route.route_id
    if family in seen_families:
        return False
    selected.append(route)
    seen_families.add(family)
    return True


def _passes_optional_quality_floor(route: RouteCandidate, best_score: float | None) -> bool:
    if best_score is None:
        return True
    route_score = route.route_score
    if route_score is None:
        route_score = score_route(route)
    return route_score >= best_score - 10.0
