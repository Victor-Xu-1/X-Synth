#!/usr/bin/env python3
from __future__ import annotations

import argparse
import datetime as dt
import json
from dataclasses import asdict
from pathlib import Path
import sys

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from packages.adapters.aizynthfinder import AiZynthFinderAdapter
from packages.route_pool import UnifiedRoutePool, normalize_aizynthfinder_payload


ROOT = REPO_ROOT
RUNS_DIR = ROOT / "tests" / "real-cases" / "runs"


def main() -> int:
    parser = argparse.ArgumentParser(description="Run one real AiZynthFinder route-search case.")
    parser.add_argument("--smiles", required=True)
    parser.add_argument("--id", required=True)
    parser.add_argument("--model", default="USPTO")
    parser.add_argument("--timeout-sec", type=int, default=1800)
    parser.add_argument("--iteration-limit", type=int)
    parser.add_argument("--max-transforms", type=int)
    parser.add_argument("--time-limit", type=int)
    args = parser.parse_args()

    timestamp = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
    run_dir = RUNS_DIR / f"{timestamp}_aizynthfinder_{args.id}"
    output_path = run_dir / "result.json"
    run_dir.mkdir(parents=True, exist_ok=True)

    adapter = AiZynthFinderAdapter(
        executable="/home/victor_1/miniconda3/bin/conda",
        python_args=("run", "--no-capture-output", "-n", "deepretro", "python"),
        config_path=ROOT / "engines" / "aizynthfinder" / "models" / "config.yml",
        cwd=ROOT,
    )
    try:
        result = adapter.run(
            smiles=args.smiles,
            output_path=output_path,
            model_name=args.model,
            timeout_sec=args.timeout_sec,
            iteration_limit=args.iteration_limit,
            max_transforms=args.max_transforms,
            time_limit=args.time_limit,
        )
    except Exception as exc:
        summary = {
            "smiles": args.smiles,
            "model": args.model,
            "solved": False,
            "route_count": 0,
            "error": str(exc),
            "output_path": str(output_path),
        }
        (run_dir / "summary.json").write_text(
            json.dumps(summary, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(json.dumps(summary, ensure_ascii=False))
        return 1

    payload = json.loads(result.output_path.read_text(encoding="utf-8"))
    normalized_routes = normalize_aizynthfinder_payload(payload)
    pool = UnifiedRoutePool(min_routes=3, max_routes=10)
    pool.add_routes(normalized_routes)
    selected_routes = pool.final_candidates()
    unified_routes_path = run_dir / "unified_routes.json"
    selected_routes_path = run_dir / "selected_routes.json"
    unified_routes_path.write_text(
        json.dumps([asdict(route) for route in normalized_routes], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    selected_routes_path.write_text(
        json.dumps([asdict(route) for route in selected_routes], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    summary = {
        "smiles": args.smiles,
        "model": args.model,
        "solved": result.solved,
        "route_count": len(result.routes),
        "unified_route_count": len(normalized_routes),
        "selected_route_count": len(selected_routes),
        "closed_route_count": pool.closed_route_count(),
        "engine_counts": pool.engine_counts(),
        "stats": result.stats,
        "iteration_limit": args.iteration_limit,
        "max_transforms": args.max_transforms,
        "time_limit": args.time_limit,
        "output_path": str(result.output_path),
        "unified_routes_path": str(unified_routes_path),
        "selected_routes_path": str(selected_routes_path),
    }
    (run_dir / "summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(json.dumps(summary, ensure_ascii=False))
    return 0 if result.routes else 1


if __name__ == "__main__":
    raise SystemExit(main())
