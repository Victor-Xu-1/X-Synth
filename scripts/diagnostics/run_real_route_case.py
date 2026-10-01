#!/usr/bin/env python3
from __future__ import annotations

import argparse
import datetime as dt
import json
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

from dataclasses import asdict

from packages.route_pool import UnifiedRoutePool, normalize_askcos_tree_result


ROOT = Path(__file__).resolve().parents[2]
RUNS_DIR = ROOT / "tests" / "real-cases" / "runs"
_NO_PROXY_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))
DEFAULT_TEMPLATE_RELEVANCE_MODELS = (
    "reaxys",
    "pistachio",
    "uspto_higher_level",
)
TREE_SEARCH_PROFILE_VERSION = 2
TREE_SEARCH_TEMPLATE_COUNT = 200
TREE_SEARCH_TEMPLATE_CUMULATIVE_PROBABILITY = 0.995
TREE_SEARCH_MAX_BRANCHING = 30
DEFAULT_BUYABLES_SOURCE = (
    "chemicalbook_cn",
    "chemicalbook",
    "leyan",
    "bidepharm",
    "alichem",
    "energy_chemical",
    "macklin",
    "aladdin",
    "ambeed",
    "chemscene",
    "combi_blocks",
    "sigma_aldrich",
    "targetmol",
    "tansoole",
    "molbase",
    "ambeed_cn",
    "targetmol_cn",
    "medchemexpress_cn",
    "tcichemicals_cn",
    "labnetwork_cn",
    "CB",
    "CS",
    "MC",
    "LN",
    "EM",
    "SA",
)


def post_json(url: str, payload: dict[str, Any], token: str | None = None) -> Any:
    body = json.dumps(payload).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    with _NO_PROXY_OPENER.open(req, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8"))


def get_token(base_url: str, username: str, password: str) -> str:
    data = urllib.parse.urlencode({"username": username, "password": password}).encode("utf-8")
    req = urllib.request.Request(
        f"{base_url}/api/admin/token",
        data=data,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    with _NO_PROXY_OPENER.open(req, timeout=60) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    return payload["access_token"]


def route_payload(
    smiles: str,
    description: str,
    expansion_time: int,
    max_paths: int,
    backend: str,
    template_relevance_models: tuple[str, ...] = DEFAULT_TEMPLATE_RELEVANCE_MODELS,
    custom_buyables: list[str] | None = None,
    buyables_source: list[str] | None = None,
    include_retrieval_backends: bool = False,
) -> dict[str, Any]:
    retro_backend_options = [
        {
            "retro_backend": "template_relevance",
            "retro_model_name": model_name,
            "max_num_templates": TREE_SEARCH_TEMPLATE_COUNT,
            "max_cum_prob": TREE_SEARCH_TEMPLATE_CUMULATIVE_PROBABILITY,
            "attribute_filter": [],
        }
        for model_name in template_relevance_models
    ]
    if include_retrieval_backends:
        retro_backend_options.extend(
            [
                {
                    "retro_backend": "exact_match",
                    "retro_model_name": "USPTO_FULL",
                    "max_num_templates": TREE_SEARCH_TEMPLATE_COUNT,
                    "max_cum_prob": 1.0,
                    "attribute_filter": [],
                },
                {
                    "retro_backend": "retrosim",
                    "retro_model_name": "USPTO_FULL",
                    "max_num_templates": TREE_SEARCH_TEMPLATE_COUNT,
                    "max_cum_prob": 1.0,
                    "attribute_filter": [],
                },
            ]
        )
    build_tree_options: dict[str, Any] = {
        "expansion_time": expansion_time,
        "max_branching": TREE_SEARCH_MAX_BRANCHING,
        "max_depth": 14,
        "max_iterations": 5000,
        "exploration_weight": 1,
        "return_first": False,
        "max_trees": 300,
        "use_value_network": True,
    }
    if buyables_source is not None:
        build_tree_options["buyables_source"] = buyables_source
    if custom_buyables:
        build_tree_options["custom_buyables"] = custom_buyables

    return {
        "backend": backend,
        "smiles": smiles,
        "description": description,
        "expand_one_options": {
            "template_max_count": TREE_SEARCH_TEMPLATE_COUNT,
            "template_max_cum_prob": TREE_SEARCH_TEMPLATE_CUMULATIVE_PROBABILITY,
            "banned_chemicals": [],
            "banned_reactions": [],
            "retro_backend_options": retro_backend_options,
            "use_fast_filter": True,
            "filter_threshold": 0.75,
            "cluster_precursors": True,
            "cluster_setting": {
                "feature": "original",
                "cluster_method": "hdbscan",
                "fp_type": "morgan",
                "fp_length": 512,
                "fp_radius": 1,
                "classification_threshold": 0.2,
            },
            "extract_template": False,
            "return_reacting_atoms": False,
            "selectivity_check": False,
        },
        "build_tree_options": build_tree_options,
        "enumerate_paths_options": {
            "path_format": "json",
            "json_format": "nodelink",
            "sorting_metric": "score",
            "validate_paths": True,
            "score_trees": True,
            "cluster_trees": True,
            "cluster_method": "hdbscan",
            "min_samples": 5,
            "min_cluster_size": 5,
            "paths_only": False,
            "max_paths": max_paths,
        },
    }


def mongo_result(task_id: str) -> dict[str, Any]:
    js = f"""
const c = db.getSiblingDB("results").results;
const d = c.findOne({{task_id: "{task_id}"}});
if (!d) {{
  print(JSON.stringify({{found: false}}));
}} else {{
  print(EJSON.stringify({{
    found: true,
    description: d.description,
    task_id: d.task_id,
    result_id: d.result_id,
    result_state: d.result_state,
    result_type: d.result_type,
    target_smiles: d.target_smiles,
    num_trees: d.num_trees,
    created: d.created,
    modified: d.modified,
    stats: d.result && d.result.stats,
    status: d.result && d.result.status,
    error: d.result && d.result.error,
    route_quality_review: d.result && d.result.route_quality_review,
    route_quality_repair: d.result && d.result.route_quality_repair
  }}));
}}
"""
    proc = subprocess.run(
        [
            "docker",
            "exec",
            "synonrt-mongo-1",
            "mongosh",
            "--quiet",
            "-u",
            "askcos",
            "-p",
            "askcos",
            "--authenticationDatabase",
            "admin",
            "--eval",
            js,
        ],
        cwd=ROOT,
        check=True,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    return json.loads(proc.stdout.strip().splitlines()[-1])


def mongo_full_result(task_id: str) -> dict[str, Any]:
    js = f"""
const c = db.getSiblingDB("results").results;
const d = c.findOne({{task_id: "{task_id}"}});
if (!d) {{
  print(JSON.stringify({{found: false, task_id: "{task_id}"}}));
}} else {{
  print(EJSON.stringify({{
    found: true,
    task_id: d.task_id,
    result_id: d.result_id,
    description: d.description,
    result_state: d.result_state,
    result_type: d.result_type,
    target_smiles: d.target_smiles,
    num_trees: d.num_trees,
    settings: d.settings,
    result: d.result
  }}));
}}
"""
    with tempfile.NamedTemporaryFile("w", suffix=".js", encoding="utf-8", delete=False) as handle:
        handle.write(js)
        host_script = Path(handle.name)
    container_script = f"/tmp/{host_script.name}"
    subprocess.run(
        ["docker", "cp", str(host_script), f"synonrt-mongo-1:{container_script}"],
        cwd=ROOT,
        check=True,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    host_script.unlink(missing_ok=True)
    proc = subprocess.run(
        [
            "docker",
            "exec",
            "synonrt-mongo-1",
            "mongosh",
            "--quiet",
            "-u",
            "askcos",
            "-p",
            "askcos",
            "--authenticationDatabase",
            "admin",
            container_script,
        ],
        cwd=ROOT,
        check=True,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    payload = json.loads(proc.stdout.strip().splitlines()[-1])
    if not payload.get("found"):
        raise FileNotFoundError(f"ASKCOS task not found in Mongo results: {task_id}")
    return payload


def write_unified_artifacts(task_id: str, run_dir: Path, backend: str) -> dict[str, Any]:
    payload = mongo_full_result(task_id)
    result_path = run_dir / "askcos_result.json"
    result_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    routes = normalize_askcos_tree_result(payload, engine=f"askcos_{backend}")
    pool = UnifiedRoutePool(min_routes=3, max_routes=10)
    pool.add_routes(routes)
    selected = pool.final_candidates()
    unified_routes_path = run_dir / "unified_routes.json"
    selected_routes_path = run_dir / "selected_routes.json"
    unified_routes_path.write_text(
        json.dumps([asdict(route) for route in pool.ranked_routes()], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    selected_routes_path.write_text(
        json.dumps([asdict(route) for route in selected], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return {
        "askcos_result_path": str(result_path),
        "unified_route_count": len(routes),
        "selected_route_count": len(selected),
        "closed_route_count": pool.closed_route_count(),
        "engine_counts": pool.engine_counts(),
        "unified_routes_path": str(unified_routes_path),
        "selected_routes_path": str(selected_routes_path),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Run one real ASKCOS route-tree case and persist artifacts.")
    parser.add_argument("--smiles", required=True)
    parser.add_argument("--id", required=True)
    parser.add_argument("--description")
    parser.add_argument("--backend", choices=["mcts", "retro_star"], default="mcts")
    parser.add_argument("--base-url", default="http://127.0.0.1:9100")
    parser.add_argument("--username", default="askcos_admin")
    parser.add_argument("--password", default="reallybadpassword")
    parser.add_argument("--expansion-time", type=int, default=1800)
    parser.add_argument("--max-paths", type=int, default=10)
    parser.add_argument("--timeout-sec", type=int, default=7200)
    parser.add_argument("--poll-sec", type=int, default=30)
    args = parser.parse_args()

    timestamp = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
    description = args.description or f"synon_real_{args.id}_{timestamp}"
    run_dir = RUNS_DIR / f"{timestamp}_{args.id}"
    run_dir.mkdir(parents=True, exist_ok=True)

    payload = route_payload(
        smiles=args.smiles,
        description=description,
        expansion_time=args.expansion_time,
        max_paths=args.max_paths,
        backend=args.backend,
    )
    (run_dir / "request.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    token = get_token(args.base_url, args.username, args.password)
    task_id = post_json(f"{args.base_url}/api/tree-search/controller/call-async", payload, token)
    (run_dir / "task_id.txt").write_text(str(task_id), encoding="utf-8")

    deadline = time.monotonic() + args.timeout_sec
    latest: dict[str, Any] = {"found": False}
    while time.monotonic() < deadline:
        latest = mongo_result(str(task_id))
        (run_dir / "summary.json").write_text(json.dumps(latest, ensure_ascii=False, indent=2), encoding="utf-8")
        state = latest.get("result_state")
        print(json.dumps({"task_id": task_id, "state": state, "num_trees": latest.get("num_trees"), "stats": latest.get("stats")}, ensure_ascii=False))
        if state not in {None, "submitted", "started"}:
            break
        time.sleep(args.poll_sec)
    else:
        latest["timeout"] = True
        (run_dir / "summary.json").write_text(json.dumps(latest, ensure_ascii=False, indent=2), encoding="utf-8")
        return 2

    if latest.get("result_state") == "completed":
        latest["unified_route_pool"] = write_unified_artifacts(str(task_id), run_dir, args.backend)
        (run_dir / "summary.json").write_text(json.dumps(latest, ensure_ascii=False, indent=2), encoding="utf-8")

    return 0 if latest.get("result_state") == "completed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
