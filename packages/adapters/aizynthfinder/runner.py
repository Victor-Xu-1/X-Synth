from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from aizynthfinder.aizynthfinder import AiZynthFinder

from packages.adapters.aizynthfinder.config import prepare_config_for_stock


def _json_default(value: Any) -> Any:
    if hasattr(value, "item"):
        return value.item()
    if isinstance(value, set):
        return sorted(value)
    if isinstance(value, Path):
        return str(value)
    return str(value)


def run_case(
    *,
    config: Path,
    smiles: str,
    output: Path,
    stock: str,
    stock_config: Path | None = None,
    expansion_policies: list[str],
    filter_policy: str,
    iteration_limit: int | None = None,
    max_transforms: int | None = None,
    time_limit: int | None = None,
) -> dict[str, Any]:
    if not config.is_file():
        raise FileNotFoundError(f"AiZynthFinder config not found: {config}")

    search_overrides = {
        key: value
        for key, value in {
            "iteration_limit": iteration_limit,
            "max_transforms": max_transforms,
            "time_limit": time_limit,
        }.items()
        if value is not None
    }
    effective_config = prepare_config_for_stock(
        config,
        stock=stock,
        output_dir=output.parent,
        stock_config_path=stock_config,
        search_overrides=search_overrides or None,
    )
    finder = AiZynthFinder(configfile=str(effective_config))
    finder.stock.select(stock)
    finder.expansion_policy.select(expansion_policies)
    finder.filter_policy.select(filter_policy)
    finder.target_smiles = smiles
    finder.tree_search()
    finder.build_routes()

    stats = finder.extract_statistics()
    routes = finder.routes.dict_with_extra(include_metadata=True, include_scores=True)
    payload = {
        "smiles": smiles,
        "config": str(config),
        "effective_config": str(effective_config),
        "stock": stock,
        "expansion_policies": expansion_policies,
        "filter_policy": filter_policy,
        "solved": bool(stats.get("is_solved")),
        "stats": stats,
        "routes": routes,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, default=_json_default),
        encoding="utf-8",
    )
    return payload


def main() -> int:
    parser = argparse.ArgumentParser(description="Run one real AiZynthFinder route-search case.")
    parser.add_argument("--config", required=True, type=Path)
    parser.add_argument("--smiles", required=True)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--stock", default="zinc")
    parser.add_argument("--stock-config", type=Path)
    parser.add_argument("--filter-policy", default="uspto")
    parser.add_argument("--expansion-policy", action="append", default=[])
    parser.add_argument("--iteration-limit", type=int)
    parser.add_argument("--max-transforms", type=int)
    parser.add_argument("--time-limit", type=int)
    args = parser.parse_args()

    policies = args.expansion_policy or ["uspto"]
    payload = run_case(
        config=args.config,
        smiles=args.smiles,
        output=args.output,
        stock=args.stock,
        stock_config=args.stock_config,
        expansion_policies=policies,
        filter_policy=args.filter_policy,
        iteration_limit=args.iteration_limit,
        max_transforms=args.max_transforms,
        time_limit=args.time_limit,
    )
    print(json.dumps({"solved": payload["solved"], "route_count": len(payload["routes"])}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
