#!/usr/bin/env python3
from __future__ import annotations

import argparse
import datetime as dt
import json
from pathlib import Path
import time
from typing import Any
import urllib.error
import urllib.request


TERMINAL_STATUSES = {"completed", "completed_not_enough_routes", "failed"}


def _json_dump(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _append_jsonl(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload, ensure_ascii=False) + "\n")


def _request_json(url: str, *, payload: dict[str, Any] | None = None, timeout_sec: int = 60) -> dict[str, Any]:
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    data = None
    headers = {"Accept": "application/json"}
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=data, headers=headers)
    try:
        with opener.open(request, timeout=timeout_sec) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code} from {url}: {body}") from exc


def _load_smiles(args: argparse.Namespace) -> list[str]:
    values: list[str] = []
    values.extend(args.smiles or [])
    if args.smiles_file:
        values.extend(
            line.strip()
            for line in args.smiles_file.read_text(encoding="utf-8-sig").splitlines()
            if line.strip() and not line.lstrip().startswith("#")
        )
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        smiles = value.strip().lstrip("\ufeff")
        if not smiles or smiles in seen:
            continue
        seen.add(smiles)
        result.append(smiles)
    if not result:
        raise ValueError("No SMILES values were provided")
    return result


def _submit_payload(args: argparse.Namespace, smiles: str, index: int) -> dict[str, Any]:
    return {
        "smiles": smiles,
        "description": f"{args.description_prefix}_{index:02d}_{dt.datetime.now().strftime('%Y%m%d_%H%M%S')}",
        "backend": args.backend,
        "expansion_time": args.expansion_time,
        "max_paths": args.max_paths,
        "askcos_timeout_sec": args.askcos_timeout_sec,
        "askcos_stall_timeout_sec": args.askcos_stall_timeout_sec,
        "poll_sec": args.askcos_poll_sec,
        "aizynth_model": args.aizynth_model,
        "aizynth_stock": args.aizynth_stock,
        "aizynth_timeout_sec": args.aizynth_timeout_sec,
        "min_routes": args.min_routes,
        "max_routes": args.max_routes,
        "public": True,
    }


def _summarize_job(index: int, smiles: str, job: dict[str, Any]) -> dict[str, Any]:
    summary = job.get("summary") or {}
    return {
        "idx": index,
        "smiles": smiles,
        "job_id": job.get("job_id"),
        "status": job.get("status"),
        "selected_route_count": job.get("selected_route_count"),
        "closed_route_count": summary.get("closed_route_count"),
        "meets_min_routes": summary.get("meets_min_routes"),
        "stage": summary.get("stage"),
        "askcos_task_id": job.get("askcos_task_id") or summary.get("askcos_task_id"),
        "engine_errors": summary.get("engine_errors"),
        "online_supplier_evidence": summary.get("online_supplier_evidence"),
        "run_dir": summary.get("run_dir") or job.get("run_dir"),
    }


def run_batch(args: argparse.Namespace) -> int:
    smiles_values = _load_smiles(args)
    output_jsonl = args.output_jsonl or Path(
        f"tests/real-cases/unified_route_batch_{dt.datetime.now().strftime('%Y%m%d_%H%M%S')}.jsonl"
    )
    summary_json = args.summary_json or output_jsonl.with_suffix(".summary.json")
    rows: list[dict[str, Any]] = []

    for index, smiles in enumerate(smiles_values, start=1):
        payload = _submit_payload(args, smiles, index)
        submitted_at = dt.datetime.now().isoformat()
        try:
            response = _request_json(
                f"{args.base_url.rstrip('/')}/synon-api/unified-route/call-async",
                payload=payload,
                timeout_sec=args.http_timeout_sec,
            )
        except Exception as exc:  # noqa: BLE001 - operator-facing diagnostics.
            row = {
                "idx": index,
                "smiles": smiles,
                "status": "submit_failed",
                "error": str(exc),
                "submitted_at": submitted_at,
            }
            rows.append(row)
            _append_jsonl(output_jsonl, {"event": "submit_failed", **row})
            continue

        job_id = response["job_id"]
        _append_jsonl(output_jsonl, {"event": "submitted", "idx": index, "smiles": smiles, "job_id": job_id})
        deadline = time.monotonic() + args.max_wait_sec
        latest: dict[str, Any] = {"job_id": job_id, "status": "running"}
        while time.monotonic() < deadline:
            latest = _request_json(
                f"{args.base_url.rstrip('/')}/synon-api/unified-route/jobs/{job_id}",
                timeout_sec=args.http_timeout_sec,
            )
            row = _summarize_job(index, smiles, latest)
            _append_jsonl(output_jsonl, {"event": "poll", **row})
            if latest.get("status") in TERMINAL_STATUSES:
                break
            time.sleep(args.poll_sec)
        else:
            latest["status"] = "batch_timeout"
            latest["summary"] = latest.get("summary") or {}
            latest["summary"]["engine_errors"] = {
                **(latest["summary"].get("engine_errors") or {}),
                "batch": f"job did not reach terminal state after {args.max_wait_sec}s",
            }
        row = _summarize_job(index, smiles, latest)
        rows.append(row)
        _json_dump(summary_json, {"generated_at": dt.datetime.now().isoformat(), "results": rows})
        time.sleep(args.submit_delay_sec)

    _json_dump(summary_json, {"generated_at": dt.datetime.now().isoformat(), "results": rows})
    return 0 if all(row.get("meets_min_routes") for row in rows) else 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Submit real unified route-search jobs serially and persist outcomes.")
    parser.add_argument("--smiles", action="append", default=[])
    parser.add_argument("--smiles-file", type=Path)
    parser.add_argument("--base-url", default="http://127.0.0.1:8769")
    parser.add_argument("--output-jsonl", type=Path)
    parser.add_argument("--summary-json", type=Path)
    parser.add_argument("--description-prefix", default="supplier_real_batch")
    parser.add_argument("--backend", choices=["mcts", "retro_star", "all"], default="all")
    parser.add_argument("--expansion-time", type=int, default=1800)
    parser.add_argument("--max-paths", type=int, default=200)
    parser.add_argument("--askcos-timeout-sec", type=int, default=7200)
    parser.add_argument("--askcos-stall-timeout-sec", type=int, default=None)
    parser.add_argument("--askcos-poll-sec", type=int, default=60)
    parser.add_argument("--aizynth-model", default="USPTO")
    parser.add_argument("--aizynth-stock", default="unified")
    parser.add_argument("--aizynth-timeout-sec", type=int, default=3600)
    parser.add_argument("--min-routes", type=int, default=3)
    parser.add_argument("--max-routes", type=int, default=10)
    parser.add_argument("--poll-sec", type=int, default=60)
    parser.add_argument("--max-wait-sec", type=int, default=10800)
    parser.add_argument("--http-timeout-sec", type=int, default=60)
    parser.add_argument("--submit-delay-sec", type=float, default=2.0)
    return parser


def main() -> int:
    return run_batch(build_parser().parse_args())


if __name__ == "__main__":
    raise SystemExit(main())
