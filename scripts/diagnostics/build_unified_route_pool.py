#!/usr/bin/env python3
from __future__ import annotations

import argparse
import datetime as dt
import json
import subprocess
import tempfile
from dataclasses import asdict
from pathlib import Path
from typing import Any

from packages.route_pool import (
    AizynthFinderRouteSource,
    AskcosRouteSource,
    build_unified_route_pool_artifacts,
)


ROOT = Path("/home/victor_1/synon-retrosynthesis-platform")
RUNS_DIR = ROOT / "tests" / "real-cases" / "runs"


def fetch_askcos_result(task_id: str) -> dict[str, Any]:
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
    if payload.get("result_state") != "completed":
        raise RuntimeError(f"ASKCOS task is not completed: {task_id} state={payload.get('result_state')}")
    return payload


def askcos_engine_name(payload: dict[str, Any]) -> str:
    backend = ((payload.get("settings") or {}).get("backend") or "tree_search").replace("-", "_")
    if backend.startswith("askcos"):
        return backend
    return f"askcos_{backend}"


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> int:
    parser = argparse.ArgumentParser(description="Build a cross-engine unified route pool from real route outputs.")
    parser.add_argument("--id", required=True)
    parser.add_argument("--askcos-task-id", action="append", default=[])
    parser.add_argument("--askcos-result", action="append", type=Path, default=[])
    parser.add_argument("--askcos-engine", help="Override ASKCOS engine label when persisted settings omit backend.")
    parser.add_argument("--aizynth-result", action="append", type=Path, default=[])
    parser.add_argument("--min-routes", type=int, default=3)
    parser.add_argument("--max-routes", type=int, default=10)
    parser.add_argument("--write-back-task-id", help="Persist selected unified routes into an existing ASKCOS result document.")
    parser.add_argument(
        "--public",
        action="store_true",
        help="When writing back, mark the ASKCOS result public so local workbench users can see it.",
    )
    parser.add_argument(
        "--share-with",
        action="append",
        default=[],
        help="When writing back, add a username to the ASKCOS result shared_with list.",
    )
    args = parser.parse_args()

    timestamp = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
    run_dir = RUNS_DIR / f"{timestamp}_unified_route_pool_{args.id}"
    run_dir.mkdir(parents=True, exist_ok=True)

    askcos_sources: list[AskcosRouteSource] = []
    aizynthfinder_sources: list[AizynthFinderRouteSource] = []

    for task_id in args.askcos_task_id:
        payload = fetch_askcos_result(task_id)
        askcos_sources.append(
            AskcosRouteSource(
                source="askcos_mongo",
                task_id=task_id,
                payload=payload,
                engine=args.askcos_engine or askcos_engine_name(payload),
            )
        )

    for path in args.askcos_result:
        payload = load_json(path)
        askcos_sources.append(
            AskcosRouteSource(
                source="askcos_file",
                path=str(path),
                payload=payload,
                engine=args.askcos_engine or askcos_engine_name(payload),
            )
        )

    for path in args.aizynth_result:
        payload = load_json(path)
        aizynthfinder_sources.append(
            AizynthFinderRouteSource(
                source="aizynthfinder_file",
                path=str(path),
                payload=payload,
            )
        )

    build_result = build_unified_route_pool_artifacts(
        id=args.id,
        output_dir=run_dir,
        askcos_sources=askcos_sources,
        aizynthfinder_sources=aizynthfinder_sources,
        min_routes=args.min_routes,
        max_routes=args.max_routes,
    )
    summary = dict(build_result.summary)
    if args.write_back_task_id:
        write_back = write_back_unified_route_pool(
            args.write_back_task_id,
            summary,
            build_result.selected_routes,
            public=args.public,
            share_with=args.share_with,
        )
        summary["write_back"] = write_back
    build_result.summary_path.write_text(
        json.dumps(summary, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(json.dumps(summary, ensure_ascii=False))
    return 0 if summary["meets_min_routes"] else 1


def write_back_unified_route_pool(
    task_id: str,
    summary: dict[str, Any],
    selected_routes: list[Any],
    *,
    public: bool = False,
    share_with: list[str] | None = None,
) -> dict[str, Any]:
    selected_payload = [asdict(route) for route in selected_routes]
    compact_summary = {
        "version": 1,
        "id": summary.get("id"),
        "target_key": summary["target_key"],
        "source_summaries": summary["source_summaries"],
        "total_route_count": summary["total_route_count"],
        "closed_route_count": summary["closed_route_count"],
        "selected_route_count": summary["selected_route_count"],
        "engine_counts": summary["engine_counts"],
        "selected_engine_counts": summary.get("selected_engine_counts", {}),
        "selected_family_count": summary.get("selected_family_count", summary["selected_route_count"]),
        "selected_first_step_source_count": summary.get("selected_first_step_source_count", 0),
        "selected_first_step_sources": summary.get("selected_first_step_sources", []),
        "min_routes": summary["min_routes"],
        "max_routes": summary["max_routes"],
        "meets_min_routes": summary["meets_min_routes"],
        "stage": summary.get("stage"),
        "description": summary.get("description"),
        "run_dir": summary.get("run_dir"),
        "engine_errors": summary.get("engine_errors", {}),
        "online_supplier_evidence": summary.get("online_supplier_evidence"),
    }
    payload = {
        **compact_summary,
        "selected_routes": selected_payload,
    }
    js = _mongo_write_back_script(
        task_id=task_id,
        compact_summary=compact_summary,
        payload=payload,
        public=public,
        share_with=share_with or [],
    )
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
    result = json.loads(proc.stdout.strip().splitlines()[-1])
    if result.get("matched") != 1:
        raise FileNotFoundError(f"ASKCOS task not found for unified route pool write-back: {task_id}")
    return result


def _mongo_write_back_script(
    *,
    task_id: str,
    compact_summary: dict[str, Any],
    payload: dict[str, Any],
    public: bool,
    share_with: list[str],
) -> str:
    return f"""
const c = db.getSiblingDB("results").results;
const taskId = {json.dumps(task_id)};
const summary = {json.dumps(compact_summary, ensure_ascii=False)};
const payload = {json.dumps(payload, ensure_ascii=False)};
const shareWith = {json.dumps(sorted(set(share_with)), ensure_ascii=False)};
const existing = c.findOne({{task_id: taskId}});
if (!existing) {{
  print(JSON.stringify({{matched: 0, modified: 0, task_id: taskId}}));
  quit(0);
}}
const setFields = {{
  "unified_route_pool_summary": summary,
  "unified_route_pool": payload,
  "modified": new Date()
}};
if (existing.result && typeof existing.result === "object" && !Array.isArray(existing.result)) {{
  setFields["result.unified_route_pool"] = payload;
}}
if ({json.dumps(public)}) {{
  setFields.public = true;
}}
const update = {{$set: setFields}};
if (shareWith.length) {{
  update.$addToSet = {{shared_with: {{$each: shareWith}}}};
}}
const res = c.updateOne(
  {{task_id: taskId}},
  update
);
print(JSON.stringify({{matched: res.matchedCount, modified: res.modifiedCount, task_id: taskId}}));
"""


if __name__ == "__main__":
    raise SystemExit(main())
