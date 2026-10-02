from __future__ import annotations

from collections import Counter
from collections.abc import Callable
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from packages.adapters.stock.commercial_stock import CommercialStockRegistry
from packages.platform.atomic_file import write_json
from packages.route_schema.route_schema import RouteCandidate
from packages.validation.route_quality import RouteQualityPolicy

from .aizynthfinder import normalize_aizynthfinder_payload
from .askcos import normalize_askcos_tree_result
from .pool import UnifiedRoutePool


@dataclass(frozen=True)
class AskcosRouteSource:
    source: str
    payload: dict[str, Any]
    engine: str
    task_id: str | None = None
    path: str | None = None


@dataclass(frozen=True)
class AizynthFinderRouteSource:
    source: str
    payload: dict[str, Any]
    path: str | None = None


@dataclass(frozen=True)
class UnifiedRoutePoolBuildResult:
    summary: dict[str, Any]
    all_routes: list[RouteCandidate]
    selected_routes: list[RouteCandidate]
    unified_routes_path: Path
    selected_routes_path: Path
    summary_path: Path


def build_unified_route_pool_artifacts(
    *,
    id: str,
    output_dir: Path,
    askcos_sources: list[AskcosRouteSource] | None = None,
    aizynthfinder_sources: list[AizynthFinderRouteSource] | None = None,
    extra_routes: list[RouteCandidate] | None = None,
    min_routes: int = 3,
    max_routes: int = 10,
    stock_registry: CommercialStockRegistry | None = None,
    quality_policy: RouteQualityPolicy | None = None,
    route_transform: Callable[
        [list[RouteCandidate]],
        list[RouteCandidate],
    ]
    | None = None,
) -> UnifiedRoutePoolBuildResult:
    output_dir.mkdir(parents=True, exist_ok=True)
    effective_quality_policy = quality_policy or RouteQualityPolicy()
    pool = UnifiedRoutePool(
        min_routes=min_routes,
        max_routes=max_routes,
        quality_policy=effective_quality_policy,
    )
    source_summaries: list[dict[str, Any]] = []

    for source in askcos_sources or []:
        routes = normalize_askcos_tree_result(source.payload, engine=source.engine)
        if hasattr(stock_registry, "prefetch"):
            stock_registry.prefetch(
                [smiles for route in routes for smiles in route.starting_materials]
            )
        routes = _apply_stock_registry(routes, stock_registry)
        if route_transform is not None:
            routes = route_transform(routes)
        pool.add_routes(routes)
        source_summaries.append(
            {
                "source": source.source,
                "task_id": source.task_id,
                "path": source.path,
                "engine": source.engine,
                "route_count": len(routes),
                **_askcos_frontier_summary(source.payload),
            }
        )

    if extra_routes:
        routes = _apply_stock_registry(extra_routes, stock_registry)
        if route_transform is not None:
            routes = route_transform(routes)
        pool.add_routes(routes)
        source_summaries.append(
            {
                "source": "extra_routes",
                "engine": "mixed",
                "route_count": len(routes),
                "engine_counts": _route_counts_by_engine(routes),
            }
        )

    for source in aizynthfinder_sources or []:
        routes = normalize_aizynthfinder_payload(source.payload)
        if hasattr(stock_registry, "prefetch"):
            stock_registry.prefetch(
                [smiles for route in routes for smiles in route.starting_materials]
            )
        routes = _apply_stock_registry(routes, stock_registry)
        if route_transform is not None:
            routes = route_transform(routes)
        pool.add_routes(routes)
        source_summaries.append(
            {
                "source": source.source,
                "path": source.path,
                "engine": "aizynthfinder",
                "route_count": len(routes),
            }
        )

    all_routes = pool.ranked_routes()
    selected_routes = pool.final_candidates()
    quality_decisions = [
        effective_quality_policy.evaluate_route(route) for route in all_routes
    ]
    quality_rejection_counts = Counter(
        reason
        for decision in quality_decisions
        if not decision.accepted
        for reason in decision.reasons
    )
    quality_rejected_route_count = sum(
        not decision.accepted for decision in quality_decisions
    )
    selected_closed_route_count = sum(1 for route in selected_routes if route.closed)
    unified_routes_path = output_dir / "unified_routes.json"
    selected_routes_path = output_dir / "selected_routes.json"
    summary_path = output_dir / "summary.json"

    write_json(unified_routes_path, [asdict(route) for route in all_routes])
    write_json(selected_routes_path, [asdict(route) for route in selected_routes])

    summary = {
        "id": id,
        "target_key": pool.target_key(),
        "source_summaries": [
            _compact_source_summary(item) for item in source_summaries
        ],
        "total_route_count": len(all_routes),
        "closed_route_count": pool.closed_route_count(),
        "quality_accepted_route_count": len(all_routes) - quality_rejected_route_count,
        "quality_rejected_route_count": quality_rejected_route_count,
        "quality_rejection_counts": dict(sorted(quality_rejection_counts.items())),
        "selected_route_count": len(selected_routes),
        "selected_closed_route_count": selected_closed_route_count,
        "draft_route_count": sum(1 for route in selected_routes if not route.closed),
        "output_mode": _output_mode(selected_routes),
        "engine_counts": pool.engine_counts(),
        "selected_engine_counts": _route_counts_by_engine(selected_routes),
        "selected_family_count": len(_route_family_keys(selected_routes)),
        "selected_first_step_source_count": len(_first_step_sources(selected_routes)),
        "selected_first_step_sources": sorted(_first_step_sources(selected_routes)),
        "min_routes": min_routes,
        "max_routes": max_routes,
        "meets_min_routes": selected_closed_route_count >= min_routes,
        "closure_diagnostics": _closure_diagnostics(
            all_routes=all_routes,
            selected_routes=selected_routes,
            source_summaries=source_summaries,
            min_routes=min_routes,
            quality_rejection_counts=quality_rejection_counts,
        ),
        "unified_routes_path": str(unified_routes_path),
        "selected_routes_path": str(selected_routes_path),
    }
    write_json(summary_path, summary)

    return UnifiedRoutePoolBuildResult(
        summary=summary,
        all_routes=all_routes,
        selected_routes=selected_routes,
        unified_routes_path=unified_routes_path,
        selected_routes_path=selected_routes_path,
        summary_path=summary_path,
    )


def _output_mode(selected_routes: list[RouteCandidate]) -> str:
    if not selected_routes:
        return "empty"
    if all(route.closed for route in selected_routes):
        return "closed"
    return "draft_unclosed"


def _compact_source_summary(item: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in item.items() if value is not None}


def _askcos_frontier_summary(payload: dict[str, Any]) -> dict[str, Any]:
    result = payload.get("result") if isinstance(payload, dict) else None
    stats = result.get("stats") if isinstance(result, dict) else None
    storage = result.get("storage") if isinstance(result, dict) else None
    frontier = storage.get("frontier_summary") if isinstance(storage, dict) else None
    summary: dict[str, Any] = {}
    if isinstance(stats, dict):
        stat_names = (
            "total_iterations",
            "total_chemicals",
            "total_reactions",
            "total_templates",
            "total_paths",
            "first_path_time",
            "build_time",
        )
        summary["search_stats"] = {
            name: stats[name] for name in stat_names if stats.get(name) is not None
        }
    if not isinstance(frontier, dict):
        return summary
    top_leaves = frontier.get("top_frontier_leaves")
    if not isinstance(top_leaves, list):
        top_leaves = []
    summary.update(
        {
            "frontier_leaf_count": frontier.get("frontier_leaf_count"),
            "frontier_reaction_node_count": frontier.get("reaction_node_count"),
            "frontier_examples": [
                {
                    "smiles": item.get("smiles"),
                    "heavy_atom_count": item.get("heavy_atom_count"),
                    "score": item.get("score"),
                }
                for item in top_leaves[:5]
                if isinstance(item, dict)
            ],
        }
    )
    return summary


def _route_counts_by_engine(routes: list[RouteCandidate]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for route in routes:
        counts[route.engine] = counts.get(route.engine, 0) + 1
    return counts


def _route_family_keys(routes: list[RouteCandidate]) -> set[str]:
    return {route.family_key or route.route_id for route in routes}


def _first_step_sources(routes: list[RouteCandidate]) -> set[str]:
    return {route.steps[0].source for route in routes if route.steps}


def _closure_diagnostics(
    *,
    all_routes: list[RouteCandidate],
    selected_routes: list[RouteCandidate],
    source_summaries: list[dict[str, Any]],
    min_routes: int,
    quality_rejection_counts: Counter[str],
) -> dict[str, Any]:
    selected_closed = [route for route in selected_routes if route.closed]
    top_unclosed = _top_unclosed_precursors(selected_routes or all_routes)
    route_count_by_engine = _route_counts_by_engine(all_routes)
    closed_count_by_engine = _route_counts_by_engine(
        [route for route in all_routes if route.closed]
    )
    askcos_route_count = sum(
        int(item.get("route_count") or 0)
        for item in source_summaries
        if str(item.get("engine") or item.get("source") or "").startswith("askcos")
    )

    blockers: list[str] = []
    if not all_routes:
        blockers.append("no_candidate_routes_from_any_engine")
    elif len(selected_closed) < min_routes:
        blockers.append("minimum_closed_route_count_not_met")
    if quality_rejection_counts and len(selected_closed) < min_routes:
        blockers.append("delivery_quality_gate_not_met")
    if all_routes and not any(route.closed for route in all_routes):
        blockers.append("no_closed_routes_after_stock_evidence_check")
    if top_unclosed:
        blockers.append("unclosed_advanced_precursors_remain")
    if askcos_route_count == 0:
        blockers.append("askcos_tree_search_returned_zero_routes")

    return {
        "blockers": blockers,
        "selected_closed_route_count": len(selected_closed),
        "selected_unclosed_route_count": len(
            [route for route in selected_routes if not route.closed]
        ),
        "top_unclosed_precursors": top_unclosed,
        "route_count_by_engine": route_count_by_engine,
        "closed_count_by_engine": closed_count_by_engine,
        "askcos_route_count": askcos_route_count,
    }


def _top_unclosed_precursors(
    routes: list[RouteCandidate], *, limit: int = 10
) -> list[dict[str, Any]]:
    counts: dict[str, dict[str, Any]] = {}
    for route in routes:
        unclosed = route.metadata.get("unclosed_precursors") or []
        if not isinstance(unclosed, list):
            continue
        for smiles in unclosed:
            if not isinstance(smiles, str) or not smiles.strip():
                continue
            item = counts.setdefault(
                smiles,
                {
                    "smiles": smiles,
                    "route_count": 0,
                    "engines": set(),
                    "route_ids": [],
                },
            )
            item["route_count"] += 1
            item["engines"].add(route.engine)
            if len(item["route_ids"]) < 5:
                item["route_ids"].append(route.route_id)

    ranked = sorted(
        counts.values(),
        key=lambda item: (int(item["route_count"]), str(item["smiles"])),
        reverse=True,
    )
    return [
        {
            "smiles": item["smiles"],
            "route_count": item["route_count"],
            "engines": sorted(item["engines"]),
            "example_route_ids": item["route_ids"],
        }
        for item in ranked[:limit]
    ]


def _apply_stock_registry(
    routes: list[RouteCandidate],
    stock_registry: CommercialStockRegistry | None,
) -> list[RouteCandidate]:
    if stock_registry is None:
        return routes
    return [stock_registry.close_route_if_buyable(route) for route in routes]
