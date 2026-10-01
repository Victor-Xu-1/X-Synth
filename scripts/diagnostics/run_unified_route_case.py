#!/usr/bin/env python3
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass, replace
import datetime as dt
import fcntl
from hashlib import sha1
import json
import os
import sys
from pathlib import Path
from threading import Event
import time
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import urllib.parse
import urllib.request

from packages.adapters.stock.commercial_stock import (
    CommercialStockRegistry,
    EvidenceDecision,
    canonicalize_smiles,
    merge_commercial_stock_registries,
)
from packages.adapters.stock.pubchem_suppliers import build_pubchem_supplier_registry
from packages.adapters.stock.unified_stock_service import UnifiedStockService
from packages.adapters.aizynthfinder import AiZynthFinderAdapter
from packages.chemistry.normalization import structure_identity_key
from packages.route_pool import (
    AizynthFinderRouteSource,
    AskcosRouteSource,
    UnifiedRoutePool,
    build_unified_route_pool_artifacts,
    normalize_aizynthfinder_payload,
    normalize_askcos_tree_result,
)
from packages.route_pool.family import strategic_first_step_family
from packages.route_pool.recursive import graft_subroute
from packages.route_schema.route_schema import RouteCandidate, RouteStep
from packages.validation.route_quality import RouteQualityPolicy, smiles_atom_count

from scripts.diagnostics.build_unified_route_pool import write_back_unified_route_pool
from scripts.diagnostics.run_real_route_case import (
    ROOT,
    RUNS_DIR,
    TREE_SEARCH_PROFILE_VERSION,
    get_token,
    mongo_full_result,
    mongo_result,
    post_json,
    route_payload,
)


_NO_PROXY_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


@dataclass(frozen=True)
class SearchPass:
    name: str
    askcos_backends: list[str]
    expansion_time: int
    max_paths: int
    askcos_timeout_sec: int = 2400
    run_aizynthfinder: bool = True


@dataclass(frozen=True)
class RuntimeBudget:
    total_timeout_sec: int
    started_at: float

    @classmethod
    def start(cls, total_timeout_sec: int) -> "RuntimeBudget":
        return cls(total_timeout_sec=max(1, total_timeout_sec), started_at=time.monotonic())

    def remaining_seconds(self, *, now: float | None = None) -> int:
        current = time.monotonic() if now is None else now
        elapsed = max(0.0, current - self.started_at)
        return max(0, int(self.total_timeout_sec - elapsed))

    def phase_timeout(
        self,
        requested_sec: int,
        *,
        now: float | None = None,
        reserve_sec: int = 60,
    ) -> int:
        available = max(0, self.remaining_seconds(now=now) - max(0, reserve_sec))
        return min(max(0, requested_sec), available)


ASKCOS_IN_PROGRESS_STATES = {None, "pending", "submitted", "started"}
ASKCOS_ACTIVE_SEARCH_STATES = {"started"}
ASKCOS_NO_PROGRESS_STALL_TEXT = "stalled without route-tree progress"
ASKCOS_EARLY_STOP_TEXT = "stopped because another ASKCOS backend produced enough routes"
ASKCOS_TREE_POSTPROCESS_RESERVE_SEC = 600


def has_askcos_no_progress_stall(engine_errors: dict[str, str]) -> bool:
    return any(
        engine.startswith("askcos") and ASKCOS_NO_PROGRESS_STALL_TEXT in error
        for engine, error in engine_errors.items()
    )


def should_skip_search_pass(search_pass: SearchPass, engine_errors: dict[str, str]) -> bool:
    """Return whether a bounded follow-up search pass should be skipped.

    Even when the primary ASKCOS pass stalls with no closed trees, the repair
    pass is still useful because it can reuse supplier evidence collected from
    already completed engines. The attempt budget, per-pass timeout, and
    no-progress detector remain the stability guardrails.
    """

    return False


def _should_raise_no_progress_stall(
    *,
    state: str | None,
    num_trees: int | None,
    now: float,
    no_progress_deadline: float | None,
) -> bool:
    if no_progress_deadline is None or now < no_progress_deadline:
        return False
    if state in {None, "pending", "submitted"}:
        return num_trees is None or num_trees <= 0
    return False


def _askcos_task_has_usable_result(summary: dict[str, Any], full_result: dict[str, Any] | None) -> bool:
    if summary.get("result_state") == "completed":
        return True
    if summary.get("result_state") != "failed":
        return False
    result = full_result.get("result") if isinstance(full_result, dict) else None
    if not isinstance(result, dict):
        return False
    return bool(result.get("stats") or result.get("status") or result.get("uds"))


def _custom_buyables_from_stock_registry(
    stock_registry: CommercialStockRegistry | None,
    *,
    max_count: int = 5000,
) -> list[str] | None:
    if stock_registry is None:
        return None
    if max_count <= 0:
        return None
    buyables = stock_registry.accepted_smiles(limit=max_count + 1)
    if len(buyables) > max_count:
        return None
    return buyables or None


def _askcos_buyables_sources(args: argparse.Namespace) -> list[str] | None:
    """Return the native ASKCOS stock sources used during tree termination.

    The unified commercial stock is imported into ASKCOS MongoDB. Passing its
    source alias makes the terminal policy explicit and auditable without
    embedding hundreds of thousands of structures in every request.
    """

    raw = str(
        getattr(args, "askcos_buyables_source", "unified_commercial") or ""
    )
    sources = list(
        dict.fromkeys(item.strip() for item in raw.split(",") if item.strip())
    )
    return sources or None


def _custom_buyables_request_summary(
    stock_registry: CommercialStockRegistry | None,
    custom_buyables: list[str] | None,
    *,
    max_count: int,
) -> dict[str, Any]:
    if stock_registry is None:
        return {"mode": "none", "sent_count": 0, "limit": max_count}
    if custom_buyables is not None:
        return {
            "mode": "sent",
            "sent_count": len(custom_buyables),
            "limit": max_count,
        }
    if max_count <= 0:
        return {"mode": "disabled", "sent_count": 0, "limit": max_count}
    accepted_count = stock_registry.accepted_decision_count(limit=max_count + 1)
    mode = "skipped_large_stock" if accepted_count > max_count else "empty"
    return {
        "mode": mode,
        "sent_count": 0,
        "limit": max_count,
        "accepted_count_sample": accepted_count,
    }


def _json_dump(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _safe_lock_name(value: str) -> str:
    safe = "".join(ch if ch.isalnum() or ch in "._-" else "_" for ch in value.strip())
    return (safe[:120] or "route_job")


def _acquire_exclusive_job_lock(job_id: str):
    lock_dir = RUNS_DIR / ".locks"
    lock_dir.mkdir(parents=True, exist_ok=True)
    lock_path = lock_dir / f"{_safe_lock_name(job_id)}.lock"
    handle = lock_path.open("w", encoding="utf-8")
    try:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError as exc:
        handle.close()
        raise RuntimeError(f"route job is already running for id: {job_id}") from exc
    handle.write(str(os.getpid()))
    handle.flush()
    return handle


def revoke_askcos_task(base_url: str, task_id: str, token: str | None = None) -> dict[str, Any]:
    query = urllib.parse.urlencode({"task_id": task_id})
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(
        f"{base_url.rstrip('/')}/api/celery/task/revoke?{query}",
        headers=headers,
        method="GET",
    )
    with _NO_PROXY_OPENER.open(request, timeout=60) as response:
        body = response.read().decode("utf-8")
    if not body.strip():
        return {"message": f"Revoked task {task_id}"}
    return json.loads(body)


def _write_askcos_revoke_record(
    *,
    base_url: str,
    task_id: str,
    token: str | None,
    run_dir: Path,
    file_prefix: str,
    reason: str,
) -> None:
    try:
        response = revoke_askcos_task(base_url, task_id, token)
        payload: dict[str, Any] = {"task_id": task_id, "reason": reason, "response": response}
    except Exception as exc:  # noqa: BLE001 - the original timeout/stall remains authoritative.
        payload = {"task_id": task_id, "reason": reason, "revoke_error": str(exc)}
    _json_dump(run_dir / f"{file_prefix}_revoke.json", payload)


def _askcos_engine_name(backend: str) -> str:
    normalized = backend.replace("-", "_")
    if normalized.startswith("askcos"):
        return normalized
    return f"askcos_{normalized}"


def _askcos_file_prefix(backend: str) -> str:
    return _askcos_engine_name(backend)


def _selected_askcos_backends(backend: str) -> list[str]:
    if backend == "all":
        return ["retro_star", "mcts"]
    return [backend]


def _askcos_call_async_url(base_url: str, backend: str) -> str:
    endpoint_by_backend = {
        "retro_star": "retro-star",
        "mcts": "mcts",
    }
    endpoint = endpoint_by_backend.get(backend)
    if not endpoint:
        raise ValueError(f"unsupported ASKCOS backend: {backend}")
    return f"{base_url.rstrip('/')}/api/tree-search/{endpoint}/call-async"


def _direct_backend_payload(payload: dict[str, Any], backend: str) -> dict[str, Any]:
    direct_payload = dict(payload)
    direct_payload.pop("backend", None)
    direct_payload.pop("_synon_custom_buyables", None)
    if backend == "mcts":
        build_tree_options = dict(direct_payload.get("build_tree_options") or {})
        build_tree_options.pop("use_value_network", None)
        direct_payload["build_tree_options"] = build_tree_options
    return direct_payload


def _askcos_request_record(
    payload: dict[str, Any],
    *,
    backend: str,
    stock_registry: CommercialStockRegistry | None,
    custom_buyables: list[str] | None,
    custom_buyables_limit: int,
) -> dict[str, Any]:
    return {
        **_direct_backend_payload(payload, backend),
        "_synon_custom_buyables": _custom_buyables_request_summary(
            stock_registry,
            custom_buyables,
            max_count=custom_buyables_limit,
        ),
    }


def build_search_passes(args: argparse.Namespace) -> list[SearchPass]:
    primary_backends = _selected_askcos_backends(args.backend)
    repair_backends = primary_backends
    if args.askcos_timeout_sec <= 0:
        primary_timeout = 0
    else:
        primary_timeout = min(args.askcos_timeout_sec, args.expansion_time + 600)
    primary = SearchPass(
        name="primary",
        askcos_backends=primary_backends,
        expansion_time=args.expansion_time,
        max_paths=args.max_paths,
        askcos_timeout_sec=primary_timeout,
    )
    search_passes = [primary]
    for attempt in range(1, max(0, args.repair_attempts) + 1):
        if args.askcos_timeout_sec <= 0:
            repair_expansion_time = args.expansion_time * (attempt + 1)
            repair_timeout = 0
        else:
            repair_expansion_time = min(args.expansion_time * (attempt + 1), args.askcos_timeout_sec)
            repair_timeout = min(args.askcos_timeout_sec, repair_expansion_time + 600)
        search_passes.append(
            SearchPass(
                name=f"repair_{attempt}",
                askcos_backends=repair_backends,
                expansion_time=repair_expansion_time,
                max_paths=min(max(args.max_paths * (attempt + 1), 160), args.repair_max_paths),
                askcos_timeout_sec=repair_timeout,
            )
        )
    return search_passes


def _fit_search_pass_to_budget(
    search_pass: SearchPass,
    args: argparse.Namespace,
    budget: RuntimeBudget,
) -> tuple[SearchPass, argparse.Namespace] | None:
    requested_askcos_timeout = (
        search_pass.askcos_timeout_sec
        if search_pass.askcos_timeout_sec > 0
        else budget.remaining_seconds()
    )
    askcos_timeout = budget.phase_timeout(requested_askcos_timeout, reserve_sec=120)
    aizynth_timeout = budget.phase_timeout(args.aizynth_timeout_sec, reserve_sec=120)
    run_aizynthfinder = search_pass.run_aizynthfinder and aizynth_timeout >= 60
    askcos_backends = list(search_pass.askcos_backends) if askcos_timeout >= 60 else []
    if not run_aizynthfinder and not askcos_backends:
        return None

    # ASKCOS returns route trees only after path enumeration, ranking, clustering,
    # and persistence. Keeping the full timeout for graph expansion can therefore
    # discard pathways found near the search deadline before they are serialized.
    expansion_cap = (
        max(60, askcos_timeout - ASKCOS_TREE_POSTPROCESS_RESERVE_SEC)
        if askcos_backends
        else 60
    )
    effective_pass = replace(
        search_pass,
        askcos_backends=askcos_backends,
        expansion_time=min(search_pass.expansion_time, expansion_cap),
        askcos_timeout_sec=askcos_timeout,
        run_aizynthfinder=run_aizynthfinder,
    )
    effective_args = argparse.Namespace(**vars(args))
    effective_args.aizynth_timeout_sec = max(60, aizynth_timeout)
    effective_args.aizynth_time_limit = min(
        args.aizynth_time_limit,
        max(60, effective_args.aizynth_timeout_sec - 120),
    )
    effective_args.one_step_template_timeout_sec = min(
        float(args.one_step_template_timeout_sec),
        float(max(60, budget.phase_timeout(int(args.one_step_template_timeout_sec), reserve_sec=120))),
    )
    return effective_pass, effective_args


def _engine_key_for_search_pass(engine: str, search_pass: SearchPass) -> str:
    if search_pass.name == "primary":
        return engine
    return f"{engine}_{search_pass.name}"


def _run_dir_for_search_pass(run_dir: Path, search_pass: SearchPass) -> Path:
    if search_pass.name == "primary":
        return run_dir
    return run_dir / search_pass.name


def _remaining_search_pass(
    search_pass: SearchPass,
    engine_results: dict[str, dict[str, Any]],
) -> SearchPass:
    run_aizynthfinder = search_pass.run_aizynthfinder and (
        _engine_key_for_search_pass('aizynthfinder', search_pass) not in engine_results
    )
    askcos_backends = [
        backend
        for backend in search_pass.askcos_backends
        if _engine_key_for_search_pass(_askcos_engine_name(backend), search_pass)
        not in engine_results
    ]
    return SearchPass(
        name=search_pass.name,
        askcos_backends=askcos_backends,
        expansion_time=search_pass.expansion_time,
        max_paths=search_pass.max_paths,
        askcos_timeout_sec=search_pass.askcos_timeout_sec,
        run_aizynthfinder=run_aizynthfinder,
    )


def _askcos_stall_timeout_for_search_pass(args: argparse.Namespace, search_pass: SearchPass) -> int:
    if args.askcos_stall_timeout_sec is not None and args.askcos_stall_timeout_sec > 0:
        return args.askcos_stall_timeout_sec
    return search_pass.expansion_time + 300


def run_askcos_task(
    *,
    smiles: str,
    description: str,
    backend: str,
    base_url: str,
    username: str,
    password: str,
    auth_token: str | None,
    expansion_time: int,
    max_paths: int,
    timeout_sec: int,
    stall_timeout_sec: int | None,
    poll_sec: int,
    run_dir: Path,
    stock_registry: CommercialStockRegistry | None = None,
    custom_buyables_limit: int = 5000,
    buyables_source: list[str] | None = None,
    stop_event: Event | None = None,
) -> dict[str, Any]:
    custom_buyables = _custom_buyables_from_stock_registry(
        stock_registry,
        max_count=custom_buyables_limit,
    )
    payload = route_payload(
        smiles=smiles,
        description=description,
        expansion_time=expansion_time,
        max_paths=max_paths,
        backend=backend,
        custom_buyables=custom_buyables,
        buyables_source=buyables_source,
    )
    file_prefix = _askcos_file_prefix(backend)
    request_record = _askcos_request_record(
        payload,
        backend=backend,
        stock_registry=stock_registry,
        custom_buyables=custom_buyables,
        custom_buyables_limit=custom_buyables_limit,
    )
    _json_dump(run_dir / f"{file_prefix}_request.json", request_record)

    token = auth_token or get_token(base_url, username, password)
    task_id = str(
        post_json(
            _askcos_call_async_url(base_url, backend),
            _direct_backend_payload(payload, backend),
            token,
        )
    )
    (run_dir / f"{file_prefix}_task_id.txt").write_text(task_id, encoding="utf-8")

    started_at = time.monotonic()
    deadline = started_at + timeout_sec if timeout_sec > 0 else None
    no_progress_deadline = (
        started_at + stall_timeout_sec
        if stall_timeout_sec is not None and stall_timeout_sec > 0
        else None
    )
    latest: dict[str, Any] = {"found": False, "task_id": task_id}
    while deadline is None or time.monotonic() < deadline:
        if stop_event is not None and stop_event.is_set():
            _write_askcos_revoke_record(
                base_url=base_url,
                task_id=task_id,
                token=token,
                run_dir=run_dir,
                file_prefix=file_prefix,
                reason="early_result_available",
            )
            raise RuntimeError(f"ASKCOS task {ASKCOS_EARLY_STOP_TEXT}: {task_id}")
        now = time.monotonic()
        latest = mongo_result(task_id)
        _json_dump(run_dir / f"{file_prefix}_poll_summary.json", latest)
        state = latest.get("result_state")
        num_trees = _safe_int(latest.get("num_trees"))
        print(
            json.dumps(
                {
                    "engine": "askcos",
                    "backend": backend,
                    "task_id": task_id,
                    "state": state,
                    "num_trees": latest.get("num_trees"),
                    "stats": latest.get("stats"),
                    "elapsed_sec": round(now - started_at, 1),
                },
                ensure_ascii=False,
            ),
            flush=True,
        )
        if state not in ASKCOS_IN_PROGRESS_STATES:
            break
        if _should_raise_no_progress_stall(
            state=state,
            num_trees=num_trees,
            now=now,
            no_progress_deadline=no_progress_deadline,
        ):
            _write_askcos_revoke_record(
                base_url=base_url,
                task_id=task_id,
                token=token,
                run_dir=run_dir,
                file_prefix=file_prefix,
                reason="no_progress_stall",
            )
            raise TimeoutError(
                "ASKCOS task stalled without route-tree progress "
                f"after {stall_timeout_sec}s: {task_id} state={state} num_trees={latest.get('num_trees')}"
            )
        if _sleep_with_stop(stop_event, poll_sec):
            _write_askcos_revoke_record(
                base_url=base_url,
                task_id=task_id,
                token=token,
                run_dir=run_dir,
                file_prefix=file_prefix,
                reason="early_result_available",
            )
            raise RuntimeError(f"ASKCOS task {ASKCOS_EARLY_STOP_TEXT}: {task_id}")
    if deadline is not None and time.monotonic() >= deadline and latest.get("result_state") in ASKCOS_IN_PROGRESS_STATES:
        _json_dump(
            run_dir / f"{file_prefix}_timeout.json",
            {
                "task_id": task_id,
                "backend": backend,
                "timeout_sec": timeout_sec,
                "last_state": latest.get("result_state"),
                "last_num_trees": latest.get("num_trees"),
                "recoverable": True,
                "recovery": "task left running; rerun with the same run-dir to rehydrate if ASKCOS completes later",
            },
        )
        raise TimeoutError(f"ASKCOS task timed out after {timeout_sec}s and was left running for rehydrate: {task_id}")

    full_result = mongo_full_result(task_id)
    if not _askcos_task_has_usable_result(latest, full_result):
        raise RuntimeError(f"ASKCOS task did not complete: {task_id} state={latest.get('result_state')}")

    askcos_result_path = run_dir / f"{file_prefix}_result.json"
    _json_dump(askcos_result_path, full_result)
    return {
        "task_id": task_id,
        "payload": full_result,
        "result_path": str(askcos_result_path),
        "engine": _askcos_engine_name(backend),
    }


def _safe_int(value: Any) -> int | None:
    try:
        if value is None:
            return None
        return int(value)
    except (TypeError, ValueError):
        return None


def _sleep_with_stop(stop_event: Event | None, seconds: int | float) -> bool:
    if stop_event is None:
        time.sleep(seconds)
        return False
    deadline = time.monotonic() + max(0.0, float(seconds))
    while time.monotonic() < deadline:
        if stop_event.is_set():
            return True
        time.sleep(min(1.0, max(0.0, deadline - time.monotonic())))
    return stop_event.is_set()


def _askcos_result_route_count(result: dict[str, Any]) -> int:
    try:
        return len(normalize_askcos_tree_result(result["payload"], engine=result.get("engine", "askcos")))
    except Exception:
        return 0


def _engine_result_closed_route_count(result: dict[str, Any]) -> int:
    try:
        engine = str(result.get("engine") or "")
        payload = result["payload"]
        if engine.startswith("aizynthfinder"):
            routes = normalize_aizynthfinder_payload(payload)
        else:
            routes = normalize_askcos_tree_result(payload, engine=engine or "askcos")
        return sum(1 for route in routes if route.closed)
    except Exception:
        return 0


def _engine_result_meets_closed_min_routes(result: dict[str, Any], *, min_routes: int) -> bool:
    return _engine_result_closed_route_count(result) >= min_routes


def _revoke_other_askcos_tasks_after_useful_result(
    *,
    args: argparse.Namespace,
    run_dir: Path,
    token: str | None,
    current_task_id: str | None,
) -> None:
    if not current_task_id:
        return
    for file_prefix, task_id in _read_askcos_task_ids(run_dir).items():
        if task_id == current_task_id:
            continue
        _write_askcos_revoke_record(
            base_url=args.base_url,
            task_id=task_id,
            token=token,
            run_dir=run_dir,
            file_prefix=file_prefix,
            reason="early_result_available",
        )


def run_askcos_backend_tasks(
    *,
    search_pass: SearchPass,
    smiles: str,
    description: str,
    args: argparse.Namespace,
    auth_token: str | None,
    run_dir: Path,
    stock_registry: CommercialStockRegistry | None = None,
    on_progress: Any | None = None,
    external_stop_event: Event | None = None,
    max_backend_concurrency: int | None = None,
) -> tuple[dict[str, dict[str, Any]], dict[str, str]]:
    results: dict[str, dict[str, Any]] = {}
    errors: dict[str, str] = {}
    if not search_pass.askcos_backends:
        return results, errors

    askcos_stall_timeout_sec = _askcos_stall_timeout_for_search_pass(args, search_pass)
    stop_event = external_stop_event or Event()
    if stop_event.is_set():
        return results, errors
    shared_token = auth_token or get_token(args.base_url, args.username, args.password)
    backend_concurrency = len(search_pass.askcos_backends)
    if max_backend_concurrency is not None:
        backend_concurrency = min(
            backend_concurrency,
            max(1, int(max_backend_concurrency)),
        )
    with ThreadPoolExecutor(max_workers=backend_concurrency) as executor:
        futures = {}
        for askcos_backend in search_pass.askcos_backends:
            engine = _engine_key_for_search_pass(_askcos_engine_name(askcos_backend), search_pass)
            futures[
                executor.submit(
                    run_askcos_task,
                    smiles=smiles,
                    description=description,
                    backend=askcos_backend,
                    base_url=args.base_url,
                    username=args.username,
                    password=args.password,
                    auth_token=shared_token,
                    expansion_time=search_pass.expansion_time,
                    max_paths=search_pass.max_paths,
                    timeout_sec=search_pass.askcos_timeout_sec,
                    stall_timeout_sec=askcos_stall_timeout_sec,
                    poll_sec=args.poll_sec,
                    run_dir=run_dir,
                    stock_registry=stock_registry,
                    custom_buyables_limit=args.askcos_custom_buyables_limit,
                    buyables_source=_askcos_buyables_sources(args),
                    stop_event=stop_event,
                )
            ] = engine

        for future in as_completed(futures):
            engine = futures[future]
            try:
                result = future.result()
                result["engine"] = engine
                result["route_count"] = _askcos_result_route_count(result)
                results[engine] = result

            except Exception as exc:  # noqa: BLE001 - persisted for operator diagnosis.
                if ASKCOS_EARLY_STOP_TEXT in str(exc):
                    continue
                errors[engine] = str(exc)
                _json_dump(run_dir / f"{engine}_error.json", {"engine": engine, "error": str(exc)})
                print(json.dumps({"engine": engine, "error": str(exc)}, ensure_ascii=False), flush=True)
            if on_progress:
                on_progress(dict(results), dict(errors))

    return results, errors


def run_aizynthfinder_task(
    *,
    smiles: str,
    model_name: str,
    stock: str,
    timeout_sec: int,
    run_dir: Path,
    iteration_limit: int | None = None,
    max_transforms: int | None = None,
    time_limit: int | None = None,
) -> dict[str, Any]:
    output_path = run_dir / "aizynthfinder_result.json"
    adapter = AiZynthFinderAdapter(
        executable=os.environ.get("SYNON_AIZYNTH_PYTHON", sys.executable),
        config_path=ROOT / "engines" / "aizynthfinder" / "models" / "config.yml",
        cwd=ROOT,
    )
    result = adapter.run(
        smiles=smiles,
        output_path=output_path,
        model_name=model_name,
        timeout_sec=timeout_sec,
        stock=stock,
        iteration_limit=iteration_limit,
        max_transforms=max_transforms,
        time_limit=time_limit,
    )
    payload = json.loads(result.output_path.read_text(encoding="utf-8"))
    _json_dump(
        run_dir / "aizynthfinder_summary.json",
        {
            "model": model_name,
            "stock": stock,
            "solved": result.solved,
            "route_count": len(result.routes),
            "stats": result.stats,
            "output_path": str(result.output_path),
            "iteration_limit": iteration_limit,
            "max_transforms": max_transforms,
            "time_limit": time_limit,
        },
    )
    return {
        "payload": payload,
        "result_path": str(result.output_path),
        "model": model_name,
        "stock": stock,
        "solved": result.solved,
        "route_count": len(result.routes),
    }


def run_one_step_retro_tasks(
    *,
    smiles: str,
    args: argparse.Namespace,
    run_dir: Path,
    auth_token: str | None,
) -> tuple[list[RouteCandidate], dict[str, str]]:
    backends = _one_step_retro_backends(args)
    if not backends:
        return [], {}
    one_step_dir = run_dir / "one_step_retro"
    one_step_dir.mkdir(parents=True, exist_ok=True)
    token = auth_token
    routes: list[RouteCandidate] = []
    errors: dict[str, str] = {}
    for backend in sorted(backends):
        model_names = (
            _one_step_template_models(args)
            if backend == "template_relevance"
            else [args.one_step_retro_model]
        )
        for model_name in model_names:
            payload = {
                "backend": backend,
                "modelName": model_name,
                "smiles": [smiles],
                "topK": args.one_step_retro_top_k,
                "threshold": args.one_step_retro_threshold,
                "maxNumTemplates": int(
                    getattr(args, "one_step_template_max_num_templates", 1000)
                ),
                "maxCumProb": float(
                    getattr(args, "one_step_template_max_cum_prob", 0.995)
                ),
            }
            artifact_name = (
                f"{backend}_{model_name}" if backend == "template_relevance" else backend
            )
            response_path = one_step_dir / f"{artifact_name}_result.json"
            try:
                if response_path.is_file():
                    response = json.loads(response_path.read_text(encoding="utf-8"))
                else:
                    direct_url = str(
                        getattr(args, "one_step_template_direct_url", "") or ""
                    ).strip()
                    if backend == "template_relevance" and direct_url:
                        response = _post_template_relevance_direct(
                            direct_url,
                            payload,
                            float(getattr(args, "one_step_template_timeout_sec", 600.0)),
                        )
                    else:
                        if token is None:
                            token = get_token(args.base_url, args.username, args.password)
                        response = post_json(
                            f"{args.base_url.rstrip('/')}/api/retro/call-sync",
                            payload,
                            token,
                        )
                    _json_dump(response_path, response)
                routes.extend(
                    _routes_from_one_step_retro_response(
                        response,
                        target_smiles=smiles,
                        backend=backend,
                        model_name=model_name,
                    )
                )
            except Exception as exc:  # noqa: BLE001 - one-step retro is additive and isolated.
                error_key = f"askcos_{artifact_name}"
                errors[error_key] = str(exc)
                _json_dump(
                    one_step_dir / f"{artifact_name}_error.json",
                    {"backend": backend, "model_name": model_name, "error": str(exc)},
                )
    raw_route_count = len(routes)
    fast_filter_url = str(
        getattr(args, "one_step_fast_filter_url", "") or ""
    ).strip()
    if routes and fast_filter_url:
        reaction_smiles = [route.steps[0].reaction_smiles for route in routes]
        fast_filter_path = one_step_dir / "fast_filter_result.json"
        try:
            scores: list[float] | None = None
            if fast_filter_path.is_file():
                cached = json.loads(fast_filter_path.read_text(encoding="utf-8"))
                if cached.get("reaction_smiles") == reaction_smiles:
                    cached_scores = cached.get("scores")
                    if isinstance(cached_scores, list):
                        scores = [float(score) for score in cached_scores]
            if scores is None:
                scores = _post_fast_filter_batch(
                    fast_filter_url,
                    reaction_smiles,
                    float(
                        getattr(
                            args,
                            "one_step_fast_filter_timeout_sec",
                            60.0,
                        )
                    ),
                )
                _json_dump(
                    fast_filter_path,
                    {
                        "url": fast_filter_url,
                        "reaction_smiles": reaction_smiles,
                        "scores": scores,
                    },
                )
            routes = _apply_fast_filter_scores(
                routes,
                scores=scores,
                threshold=float(
                    getattr(args, "one_step_fast_filter_threshold", 0.75)
                ),
            )
        except Exception as exc:  # noqa: BLE001 - unvalidated seeds must not enter delivery.
            errors["askcos_fast_filter"] = str(exc)
            routes = []
            _json_dump(one_step_dir / "fast_filter_error.json", {"error": str(exc)})
    _json_dump(
        one_step_dir / "summary.json",
        {
            "backends": sorted(backends),
            "route_count": len(routes),
            "raw_route_count": raw_route_count,
            "forward_validated_route_count": len(routes),
            "errors": errors,
        },
    )
    return routes, errors


def _one_step_retro_backends(args: argparse.Namespace) -> set[str]:
    raw = str(getattr(args, "one_step_retro_backends", "") or "")
    backends = {item.strip().lower() for item in raw.split(",") if item.strip()}
    allowed = {"exact_match", "retrosim", "template_relevance"}
    unsupported = sorted(backends - allowed)
    if unsupported:
        raise ValueError(f"unsupported one-step retro backend(s): {', '.join(unsupported)}")
    return backends


def _one_step_template_models(args: argparse.Namespace) -> list[str]:
    raw = str(
        getattr(
            args,
            "one_step_template_models",
            "reaxys,pistachio,uspto_higher_level",
        )
        or ""
    )
    return sorted({item.strip() for item in raw.split(",") if item.strip()})


def _post_template_relevance_direct(
    base_url: str,
    payload: dict[str, Any],
    timeout_sec: float,
) -> dict[str, Any]:
    model_name = str(payload["modelName"])
    request_payload = {
        "model_name": model_name,
        "smiles": list(payload["smiles"]),
        "max_num_templates": int(payload.get("maxNumTemplates") or 1000),
        "max_cum_prob": float(payload.get("maxCumProb") or 0.995),
        "attribute_filter": [],
    }
    request = urllib.request.Request(
        f"{base_url.rstrip('/')}/{urllib.parse.quote(model_name, safe='')}",
        data=json.dumps(request_payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with _NO_PROXY_OPENER.open(request, timeout=timeout_sec) as response:
        raw_payload = json.loads(response.read().decode("utf-8"))
    if not isinstance(raw_payload, list):
        raise ValueError("template-relevance service returned a non-list response")

    result: list[list[dict[str, Any]]] = []
    for item in raw_payload:
        if not isinstance(item, dict):
            result.append([])
            continue
        reactants = item.get("reactants") if isinstance(item.get("reactants"), list) else []
        scores = item.get("scores") if isinstance(item.get("scores"), list) else []
        templates = item.get("templates") if isinstance(item.get("templates"), list) else []
        rows = []
        for outcome, score, template in zip(reactants, scores, templates):
            rows.append(
                {
                    "outcome": str(outcome),
                    "model_score": float(score),
                    "normalized_model_score": float(score),
                    "template": template,
                }
            )
        result.append(rows)
    return {"status_code": 200, "message": "", "result": result}


def _post_fast_filter_batch(
    url: str,
    reaction_smiles: list[str],
    timeout_sec: float,
) -> list[float]:
    request = urllib.request.Request(
        url,
        data=json.dumps({"rxn_smiles": reaction_smiles}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with _NO_PROXY_OPENER.open(request, timeout=timeout_sec) as response:
        payload = json.loads(response.read().decode("utf-8"))
    if payload.get("status") != "SUCCESS":
        raise ValueError(
            "fast-filter service failed: " + str(payload.get("error") or "unknown error")
        )
    results = payload.get("results")
    if not isinstance(results, list):
        raise ValueError("fast-filter service returned a non-list result")
    scores = [float(score) for score in results]
    if len(scores) != len(reaction_smiles):
        raise ValueError("fast-filter result count does not match request count")
    return scores


def _routes_from_one_step_retro_response(
    payload: dict[str, Any],
    *,
    target_smiles: str,
    backend: str,
    model_name: str,
) -> list[RouteCandidate]:
    if int(payload.get("status_code") or 0) != 200:
        return []
    result = payload.get("result")
    if not isinstance(result, list) or not result:
        return []
    rows = result[0]
    if not isinstance(rows, list):
        return []
    target_key = _canonicalize_one_step_smiles(target_smiles)
    if target_key is None:
        return []
    target_identity_key = structure_identity_key(target_key)
    routes: list[RouteCandidate] = []
    for index, item in enumerate(rows, start=1):
        if not isinstance(item, dict):
            continue
        outcome = str(item.get("outcome") or "").strip()
        if not outcome:
            continue
        raw_precursors = [part.strip() for part in outcome.split(".") if part.strip()]
        precursors = [_canonicalize_one_step_smiles(part) for part in raw_precursors]
        if not precursors or any(part is None for part in precursors):
            continue
        precursors = [str(part) for part in precursors]
        if any(
            structure_identity_key(precursor) == target_identity_key
            for precursor in precursors
        ):
            continue
        if _retro_step_increases_complexity(target_smiles, precursors):
            continue
        reaction_data = item.get("reaction_data") if isinstance(item.get("reaction_data"), dict) else {}
        normalized_outcome = ".".join(precursors)
        reaction_smiles = f"{normalized_outcome}>>{target_key}"
        digest = sha1(f"{backend}:{model_name}:{target_smiles}:{reaction_smiles}:{index}".encode("utf-8")).hexdigest()[:16]
        metadata = {
            "backend": backend,
            "model_name": model_name,
            "reaction_id": item.get("reaction_id"),
            "reaction_set": item.get("reaction_set"),
            "model_score": item.get("model_score"),
            "normalized_model_score": item.get("normalized_model_score"),
            "unclosed_precursors": precursors,
        }
        if reaction_data.get("reaction_smiles"):
            metadata["reported_reaction_smiles"] = reaction_data.get("reaction_smiles")
        if reaction_data.get("patent_number"):
            metadata["patent_number"] = reaction_data.get("patent_number")
        route_step = RouteStep(
            step_id="s1",
            reaction_smiles=reaction_smiles,
            precursors=precursors,
            product=target_key,
            source=f"askcos:{backend}:{model_name}",
            confidence=_optional_float(
                item.get("normalized_model_score") or item.get("model_score")
            ),
            metadata=metadata,
        )
        family_key = strategic_first_step_family(route_step) or (
            f"askcos:{backend}:{reaction_smiles.split('>>', 1)[0]}"
        )
        routes.append(
            RouteCandidate(
                route_id=f"askcos_{backend}:{digest}",
                engine=f"askcos_{backend}",
                target_smiles=target_smiles,
                steps=[route_step],
                starting_materials=precursors,
                closed=False,
                family_key=family_key,
                metadata=metadata,
            )
        )
    return routes


def _canonicalize_one_step_smiles(smiles: str) -> str | None:
    try:
        from rdkit import Chem

        mol = Chem.MolFromSmiles(smiles)
        if mol is None:
            return None
        for atom in mol.GetAtoms():
            atom.SetAtomMapNum(0)
            atom.SetIsotope(0)
        return Chem.MolToSmiles(mol, canonical=True, isomericSmiles=True)
    except Exception:
        return None


def _optional_float(value: object) -> float | None:
    try:
        if value is None:
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _apply_fast_filter_scores(
    routes: list[RouteCandidate],
    *,
    scores: list[float],
    threshold: float,
) -> list[RouteCandidate]:
    if len(scores) != len(routes):
        raise ValueError("fast-filter score count does not match one-step route count")
    if not 0.0 <= threshold <= 1.0:
        raise ValueError("fast-filter threshold must be between 0 and 1")

    validated: list[RouteCandidate] = []
    for route, score in zip(routes, scores):
        score = float(score)
        if not 0.0 <= score <= 1.0:
            raise ValueError("fast-filter score must be between 0 and 1")
        if not route.steps or score < threshold:
            continue

        first_step = route.steps[0]
        step_metadata = dict(first_step.metadata)
        step_metadata.update(
            {
                "retro_model_score": first_step.confidence,
                "fast_filter_score": score,
                "fast_filter_threshold": threshold,
                "fast_filter_passed": True,
            }
        )
        validated_step = replace(
            first_step,
            confidence=score,
            metadata=step_metadata,
        )
        route_metadata = dict(route.metadata)
        route_metadata.update(
            {
                "fast_filter_score": score,
                "fast_filter_threshold": threshold,
                "fast_filter_passed": True,
            }
        )
        validated.append(
            replace(
                route,
                steps=[validated_step, *route.steps[1:]],
                metadata=route_metadata,
                route_score=None,
            )
        )
    return validated


def _apply_route_fast_filter_scores(
    routes: list[RouteCandidate],
    *,
    scores_by_reaction: dict[str, float],
    threshold: float,
) -> list[RouteCandidate]:
    if not 0.0 <= threshold <= 1.0:
        raise ValueError("fast-filter threshold must be between 0 and 1")

    quality_policy = RouteQualityPolicy()
    validated: list[RouteCandidate] = []
    for route in routes:
        validated_steps: list[RouteStep] = []
        route_scores: list[float] = []
        for step in route.steps:
            if step.reaction_smiles not in scores_by_reaction:
                raise ValueError(
                    "missing fast-filter score for reaction: " + step.reaction_smiles
                )
            score = float(scores_by_reaction[step.reaction_smiles])
            if not 0.0 <= score <= 1.0:
                raise ValueError("fast-filter score must be between 0 and 1")
            route_scores.append(score)
            step_metadata = dict(step.metadata)
            step_metadata.update(
                {
                    "retro_model_score": step_metadata.get(
                        "retro_model_score",
                        step.confidence,
                    ),
                    "fast_filter_score": score,
                    "fast_filter_threshold": threshold,
                    "fast_filter_passed": score >= threshold,
                }
            )
            validated_steps.append(
                replace(
                    step,
                    confidence=score,
                    metadata=step_metadata,
                )
            )

        min_score = min(route_scores, default=0.0)
        mean_score = (
            sum(route_scores) / len(route_scores)
            if route_scores
            else 0.0
        )
        first_step_score = route_scores[0] if route_scores else 0.0
        ultra_low_count = sum(
            score < quality_policy.ultra_low_confidence_threshold
            for score in route_scores
        )
        ultra_low_fraction = (
            ultra_low_count / len(route_scores)
            if route_scores
            else 0.0
        )
        excessive_ultra_low_fraction = (
            len(route_scores) >= quality_policy.min_confidence_samples
            and ultra_low_fraction > quality_policy.max_ultra_low_fraction
        )
        route_validation_passed = (
            bool(route_scores)
            and first_step_score >= quality_policy.min_first_step_confidence
            and not excessive_ultra_low_fraction
        )
        route_metadata = dict(route.metadata)
        route_metadata.update(
            {
                "forward_validation_min_score": min_score,
                "forward_validation_mean_score": mean_score,
                "forward_validation_first_step_score": first_step_score,
                "forward_validation_threshold": threshold,
                "forward_validation_ultra_low_threshold": (
                    quality_policy.ultra_low_confidence_threshold
                ),
                "forward_validation_ultra_low_count": ultra_low_count,
                "forward_validation_ultra_low_fraction": ultra_low_fraction,
                "forward_validation_max_ultra_low_fraction": (
                    quality_policy.max_ultra_low_fraction
                ),
                "forward_validation_min_first_step_score": (
                    quality_policy.min_first_step_confidence
                ),
                "forward_validation_policy": "root_and_ultra_low_fraction_v1",
                "forward_validation_passed": route_validation_passed,
            }
        )
        validated.append(
            replace(
                route,
                steps=validated_steps,
                metadata=route_metadata,
                route_score=None,
            )
        )
    return validated


def _forward_validate_routes_with_cache(
    routes: list[RouteCandidate],
    *,
    url: str,
    threshold: float,
    timeout_sec: float,
    cache_path: Path,
) -> list[RouteCandidate]:
    if not routes:
        return []

    scores_by_reaction: dict[str, float] = {}
    if cache_path.is_file():
        cached = json.loads(cache_path.read_text(encoding="utf-8"))
        if cached.get("schema_version") == 1 and cached.get("url") == url:
            raw_scores = cached.get("scores")
            if isinstance(raw_scores, dict):
                scores_by_reaction = {
                    str(reaction): float(score)
                    for reaction, score in raw_scores.items()
                }

    reactions = list(
        dict.fromkeys(
            step.reaction_smiles
            for route in routes
            for step in route.steps
            if step.reaction_smiles
        )
    )
    missing = [
        reaction
        for reaction in reactions
        if reaction not in scores_by_reaction
    ]
    if missing:
        scores = _post_fast_filter_batch(url, missing, timeout_sec)
        scores_by_reaction.update(zip(missing, scores))
        _json_dump(
            cache_path,
            {
                "schema_version": 1,
                "url": url,
                "scores": scores_by_reaction,
            },
        )
    scores_by_reaction.setdefault("", 0.0)
    return _apply_route_fast_filter_scores(
        routes,
        scores_by_reaction=scores_by_reaction,
        threshold=threshold,
    )


def _forward_validate_recursive_leaf_routes(
    routes: list[RouteCandidate],
    *,
    args: argparse.Namespace,
    leaf_dir: Path,
) -> list[RouteCandidate]:
    url = str(getattr(args, "one_step_fast_filter_url", "") or "").strip()
    if not routes or not url:
        return routes
    return _forward_validate_routes_with_cache(
        routes,
        url=url,
        threshold=float(getattr(args, "one_step_fast_filter_threshold", 0.75)),
        timeout_sec=float(getattr(args, "one_step_fast_filter_timeout_sec", 60.0)),
        cache_path=leaf_dir / "forward_validation.json",
    )


def _retro_step_increases_complexity(target_smiles: str, precursors: list[str]) -> bool:
    target_atoms = _heavy_atom_count_for_smiles(target_smiles)
    precursor_atoms = [_heavy_atom_count_for_smiles(smiles) for smiles in precursors]
    valid_precursor_atoms = [count for count in precursor_atoms if count is not None]
    if target_atoms is None or not valid_precursor_atoms:
        return False
    return max(valid_precursor_atoms) > target_atoms + 2


def _heavy_atom_count_for_smiles(smiles: str) -> int | None:
    try:
        from rdkit import Chem

        mol = Chem.MolFromSmiles(smiles)
        if mol is None:
            return None
        return int(mol.GetNumHeavyAtoms())
    except Exception:
        return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _rehydrate_engine_results_from_run_dir(run_dir: Path) -> dict[str, dict[str, Any]]:
    """Load completed engine artifacts from a previous interrupted run.

    Resume must preserve real work already completed by independent engines.
    This avoids blocking usable AiZynthFinder output behind a slow or stalled
    ASKCOS tree-builder task.
    """

    results: dict[str, dict[str, Any]] = {}
    _rehydrate_aizynthfinder_result(run_dir, results)
    _rehydrate_askcos_results(run_dir, results)
    for repair_dir in sorted(run_dir.glob("repair_*")):
        if repair_dir.is_dir():
            _rehydrate_aizynthfinder_result(repair_dir, results, suffix=f"_{repair_dir.name}")
            _rehydrate_askcos_results(repair_dir, results, suffix=f"_{repair_dir.name}")
    return results


def _rehydrate_aizynthfinder_result(
    run_dir: Path,
    results: dict[str, dict[str, Any]],
    *,
    suffix: str = "",
) -> None:
    result_path = run_dir / "aizynthfinder_result.json"
    if not result_path.is_file():
        return
    payload = json.loads(result_path.read_text(encoding="utf-8"))
    routes = normalize_aizynthfinder_payload(payload)
    summary_path = run_dir / "aizynthfinder_summary.json"
    model = None
    stock = None
    if summary_path.is_file():
        try:
            summary = json.loads(summary_path.read_text(encoding="utf-8"))
            model = summary.get("model")
            stock = summary.get("stock")
        except json.JSONDecodeError:
            pass
    results[f"aizynthfinder{suffix}"] = {
        "payload": payload,
        "result_path": str(result_path),
        "model": model,
        "stock": stock,
        "route_count": len(routes),
    }


def _rehydrate_askcos_results(
    run_dir: Path,
    results: dict[str, dict[str, Any]],
    *,
    suffix: str = "",
) -> None:
    for result_path in sorted(run_dir.glob("askcos_*_result.json")):
        file_prefix = result_path.name.removesuffix("_result.json")
        payload = json.loads(result_path.read_text(encoding="utf-8"))
        task_id_path = run_dir / f"{file_prefix}_task_id.txt"
        task_id = task_id_path.read_text(encoding="utf-8").strip() if task_id_path.is_file() else None
        engine = f"{file_prefix}{suffix}"
        results[engine] = {
            "task_id": task_id,
            "payload": payload,
            "result_path": str(result_path),
            "engine": engine,
            "route_count": len(normalize_askcos_tree_result(payload, engine=engine)),
        }
    for task_id_path in sorted(run_dir.glob("askcos_*_task_id.txt")):
        file_prefix = task_id_path.name.removesuffix("_task_id.txt")
        result_path = run_dir / f"{file_prefix}_result.json"
        if result_path.is_file():
            continue
        task_id = task_id_path.read_text(encoding="utf-8").strip()
        if not task_id:
            continue
        try:
            summary = mongo_result(task_id)
        except Exception as exc:  # noqa: BLE001 - rehydrate is best-effort resume support.
            _json_dump(
                run_dir / f"{file_prefix}_rehydrate_error.json",
                {"task_id": task_id, "error": str(exc)},
            )
            continue
        _json_dump(run_dir / f"{file_prefix}_poll_summary.json", summary)
        try:
            payload = mongo_full_result(task_id)
        except Exception as exc:  # noqa: BLE001 - keep resumable task metadata for diagnosis.
            _json_dump(
                run_dir / f"{file_prefix}_rehydrate_error.json",
                {"task_id": task_id, "state": summary.get("result_state"), "error": str(exc)},
            )
            continue
        if not _askcos_task_has_usable_result(summary, payload):
            continue
        _json_dump(result_path, payload)
        engine = f"{file_prefix}{suffix}"
        results[engine] = {
            "task_id": task_id,
            "payload": payload,
            "result_path": str(result_path),
            "engine": engine,
            "route_count": len(normalize_askcos_tree_result(payload, engine=engine)),
        }


def run_search_pass(
    *,
    search_pass: SearchPass,
    smiles: str,
    description: str,
    args: argparse.Namespace,
    auth_token: str | None,
    run_dir: Path,
    stock_registry: CommercialStockRegistry | None = None,
    on_first_result: Any | None = None,
) -> tuple[dict[str, dict[str, Any]], dict[str, str]]:
    pass_run_dir = _run_dir_for_search_pass(run_dir, search_pass)
    pass_run_dir.mkdir(parents=True, exist_ok=True)
    pass_results: dict[str, dict[str, Any]] = {}
    pass_errors: dict[str, str] = {}
    first_result_reported = False
    askcos_stop_event = Event()

    def report_first_result_once() -> None:
        nonlocal first_result_reported
        if first_result_reported or not pass_results or not on_first_result:
            return
        on_first_result(search_pass, pass_results, pass_errors)
        first_result_reported = True

    futures = {}
    max_workers = max(
        1,
        (1 if search_pass.run_aizynthfinder else 0)
        + (1 if search_pass.askcos_backends else 0),
    )
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        if search_pass.run_aizynthfinder:
            futures[
                executor.submit(
                    run_aizynthfinder_task,
                    smiles=smiles,
                    model_name=args.aizynth_model,
                    stock=args.aizynth_stock,
                    timeout_sec=args.aizynth_timeout_sec,
                    run_dir=pass_run_dir,
                    iteration_limit=args.aizynth_iteration_limit,
                    max_transforms=args.aizynth_max_transforms,
                    time_limit=args.aizynth_time_limit,
                )
            ] = _engine_key_for_search_pass("aizynthfinder", search_pass)

        def report_askcos_progress(
            askcos_results: dict[str, dict[str, Any]],
            askcos_errors: dict[str, str],
        ) -> None:
            pass_results.update(askcos_results)
            pass_errors.update(askcos_errors)
            report_first_result_once()

        if search_pass.askcos_backends:
            futures[
                executor.submit(
                    run_askcos_backend_tasks,
                    search_pass=search_pass,
                    smiles=smiles,
                    description=description,
                    args=args,
                    auth_token=auth_token,
                    run_dir=pass_run_dir,
                    stock_registry=stock_registry,
                    on_progress=report_askcos_progress,
                    external_stop_event=askcos_stop_event,
                )
            ] = "askcos_group"

        for future in as_completed(futures):
            engine = futures[future]
            if engine == "askcos_group":
                try:
                    askcos_results, askcos_errors = future.result()
                    pass_results.update(askcos_results)
                    pass_errors.update(askcos_errors)
                except Exception as exc:  # noqa: BLE001 - other engines still remain usable.
                    pass_errors[engine] = str(exc)
                    _json_dump(pass_run_dir / "askcos_group_error.json", {"engine": engine, "error": str(exc)})
                    print(json.dumps({"engine": engine, "error": str(exc)}, ensure_ascii=False), flush=True)
                report_first_result_once()
                continue
            try:
                result = future.result()
                result["engine"] = engine
                pass_results[engine] = result
                report_first_result_once()

            except Exception as exc:  # noqa: BLE001 - persisted for operator diagnosis.
                pass_errors[engine] = str(exc)
                _json_dump(pass_run_dir / f"{engine}_error.json", {"engine": engine, "error": str(exc)})
                print(json.dumps({"engine": engine, "error": str(exc)}, ensure_ascii=False), flush=True)

    return pass_results, pass_errors


def _read_askcos_task_id(run_dir: Path) -> str | None:
    task_ids = _read_askcos_task_ids(run_dir)
    if not task_ids:
        return None
    return next(iter(task_ids.values()))


def _read_askcos_task_ids(run_dir: Path) -> dict[str, str]:
    task_ids: dict[str, str] = {}
    legacy_path = run_dir / "askcos_task_id.txt"
    if legacy_path.is_file():
        value = legacy_path.read_text(encoding="utf-8").strip()
        if value:
            task_ids["askcos"] = value
    for path in sorted(run_dir.glob("askcos_*_task_id.txt")):
        value = path.read_text(encoding="utf-8").strip()
        if value:
            task_ids[path.stem.removesuffix("_task_id")] = value
    return task_ids


def _first_askcos_task_id_from_results(engine_results: dict[str, dict[str, Any]], run_dir: Path) -> str | None:
    for key in sorted(engine_results):
        if key.startswith("askcos"):
            task_id = engine_results[key].get("task_id")
            if task_id:
                return str(task_id)
    return _read_askcos_task_id(run_dir)


def _askcos_task_ids_from_results(engine_results: dict[str, dict[str, Any]], run_dir: Path) -> dict[str, str]:
    task_ids = _read_askcos_task_ids(run_dir)
    for key in sorted(engine_results):
        if key.startswith("askcos"):
            task_id = engine_results[key].get("task_id")
            if task_id:
                task_ids[key] = str(task_id)
    return task_ids


def _read_legacy_askcos_task_id(run_dir: Path) -> str | None:
    path = run_dir / "askcos_task_id.txt"
    if not path.is_file():
        return None
    value = path.read_text(encoding="utf-8").strip()
    return value or None


def _route_sources_from_engine_results(
    engine_results: dict[str, dict[str, Any]],
) -> tuple[list[AskcosRouteSource], list[AizynthFinderRouteSource]]:
    askcos_sources: list[AskcosRouteSource] = []
    for key in sorted(engine_results):
        if not key.startswith("askcos"):
            continue
        askcos = engine_results[key]
        askcos_sources.append(
            AskcosRouteSource(
                source=key,
                payload=askcos["payload"],
                engine=askcos["engine"],
                task_id=askcos["task_id"],
                path=askcos["result_path"],
            )
        )

    aizynthfinder_sources: list[AizynthFinderRouteSource] = []
    for key in sorted(engine_results):
        if not key.startswith("aizynthfinder"):
            continue
        aizynth = engine_results[key]
        aizynthfinder_sources.append(
            AizynthFinderRouteSource(
                source=key,
                payload=aizynth["payload"],
                path=aizynth["result_path"],
            )
        )
    return askcos_sources, aizynthfinder_sources


def _candidate_routes_from_engine_results(
    engine_results: dict[str, dict[str, Any]],
    *,
    stock_registry: CommercialStockRegistry | None,
) -> list[RouteCandidate]:
    askcos_sources, aizynthfinder_sources = _route_sources_from_engine_results(engine_results)
    routes: list[RouteCandidate] = []
    for source in askcos_sources:
        routes.extend(normalize_askcos_tree_result(source.payload, engine=source.engine))
    for source in aizynthfinder_sources:
        routes.extend(normalize_aizynthfinder_payload(source.payload))
    if stock_registry is not None:
        routes = [stock_registry.close_route_if_buyable(route) for route in routes]
    return routes


def _close_routes_with_stock(
    routes: list[RouteCandidate],
    stock_registry: CommercialStockRegistry | None,
) -> list[RouteCandidate]:
    """Re-evaluate route leaves against the current commercial-stock snapshot."""
    if stock_registry is None:
        return routes
    return [stock_registry.close_route_if_buyable(route) for route in routes]


def _select_candidate_routes(
    routes: list[RouteCandidate],
    *,
    min_routes: int,
    max_routes: int,
) -> list[RouteCandidate]:
    pool = UnifiedRoutePool(min_routes=min_routes, max_routes=max_routes)
    pool.add_routes(routes)
    return pool.final_candidates()


def _select_recursive_subroutes(
    routes: list[RouteCandidate],
    *,
    max_routes: int,
) -> list[RouteCandidate]:
    if max_routes < 1:
        raise ValueError("max_routes must be at least 1")

    quality_policy = RouteQualityPolicy()
    closed_routes = []
    for route in routes:
        if not route.closed or route.metadata.get("unclosed_precursors"):
            continue
        reasons = set(quality_policy.evaluate_route(route).reasons)
        if reasons.issubset({"empty_route"}):
            closed_routes.append(route)
    if closed_routes:
        return _select_candidate_routes(
            closed_routes,
            min_routes=1,
            max_routes=max_routes,
        )

    viable_unclosed = _most_progressed_unclosed_routes(
        [
            route
            for route in routes
            if not route.closed and _is_recursive_route_viable(route)
        ]
    )
    return sorted(
        viable_unclosed,
        key=_recursive_frontier_priority_key,
        reverse=True,
    )[:max_routes]


def _viable_recursive_grafts(
    parent: RouteCandidate,
    *,
    leaf: str,
    subroutes: list[RouteCandidate],
) -> list[RouteCandidate]:
    grafts: list[RouteCandidate] = []
    for subroute in subroutes:
        try:
            grafted = graft_subroute(
                parent,
                leaf_smiles=leaf,
                subroute=subroute,
            )
        except ValueError:
            continue
        if _is_recursive_route_viable(grafted):
            grafts.append(grafted)
    return grafts


def _select_recursive_frontier_routes(
    routes: list[RouteCandidate],
    *,
    min_routes: int,
    max_routes: int,
    already_searched: set[str] | None = None,
    completed_expansions: set[str] | None = None,
    search_signature: str | None = None,
) -> list[RouteCandidate]:
    quality_policy = RouteQualityPolicy()
    closed_routes = [
        route
        for route in routes
        if quality_policy.evaluate_route(route).accepted
    ]
    closed_family_keys: set[str] = set()
    if closed_routes:
        selected_closed = _select_candidate_routes(
            closed_routes,
            min_routes=min_routes,
            max_routes=max_routes,
        )
        closed_family_keys = {
            route.family_key
            for route in selected_closed
            if route.family_key
        }
        if len(selected_closed) >= min_routes:
            return []

    unclosed_routes = _most_progressed_unclosed_routes(
        [
            route
            for route in routes
            if (
                not route.closed
                and _is_recursive_route_viable(route)
                and _route_has_pending_recursive_target(
                    route,
                    already_searched=already_searched or set(),
                    completed_expansions=completed_expansions or set(),
                    search_signature=search_signature,
                )
            )
        ]
    )
    if not unclosed_routes:
        return []
    return sorted(
        unclosed_routes,
        key=lambda route: (
            route.family_key not in closed_family_keys,
            _recursive_frontier_priority_key(route),
        ),
        reverse=True,
    )[:max_routes]


def _route_has_pending_recursive_target(
    route: RouteCandidate,
    *,
    already_searched: set[str],
    completed_expansions: set[str],
    search_signature: str | None,
) -> bool:
    for raw_leaf in route.metadata.get("unclosed_precursors") or []:
        leaf = str(raw_leaf).strip()
        if not leaf or leaf in already_searched:
            continue
        if search_signature is None:
            return True
        expansion_key = _recursive_expansion_key(
            route,
            leaf=leaf,
            search_signature=search_signature,
        )
        if expansion_key not in completed_expansions:
            return True
    return False


def _is_recursive_route_viable(route: RouteCandidate) -> bool:
    reasons = set(RouteQualityPolicy().evaluate_route(route).reasons)
    return reasons.issubset(
        {
            "route_not_closed",
            "empty_route",
            "ultra_low_confidence_fraction",
        }
    )


def _most_progressed_unclosed_routes(
    routes: list[RouteCandidate],
) -> list[RouteCandidate]:
    best_by_family: dict[str, RouteCandidate] = {}
    for route in routes:
        family = route.family_key or route.route_id
        current = best_by_family.get(family)
        if current is None or _recursive_progress_key(route) > _recursive_progress_key(current):
            best_by_family[family] = route
    return list(best_by_family.values())


def _recursive_progress_key(
    route: RouteCandidate,
) -> tuple[int, int, int, int, int, float]:
    unclosed = list(route.metadata.get("unclosed_precursors") or [])
    atom_counts = [smiles_atom_count(str(precursor)) for precursor in unclosed]
    return (
        -max(atom_counts, default=0),
        -sum(atom_counts),
        -len(unclosed),
        _recursive_graft_depth(route),
        -len(route.steps),
        float(route.route_score or 0.0),
    )


def _recursive_frontier_priority_key(
    route: RouteCandidate,
) -> tuple[int, int, int, int, int, int, float]:
    unclosed = list(route.metadata.get("unclosed_precursors") or [])
    atom_counts = [smiles_atom_count(str(precursor)) for precursor in unclosed]
    estimated_remaining_steps = sum(
        max(1, (atom_count + 5) // 6)
        for atom_count in atom_counts
    )
    estimated_total_steps = len(route.steps) + estimated_remaining_steps
    return (
        -estimated_total_steps,
        -len(route.steps),
        -len(unclosed),
        -max(atom_counts, default=0),
        -sum(atom_counts),
        _recursive_graft_depth(route),
        float(route.route_score or 0.0),
    )


def _recursive_graft_depth(route: RouteCandidate) -> int:
    raw_depth = route.metadata.get("recursive_graft_depth")
    if (
        isinstance(raw_depth, int)
        and not isinstance(raw_depth, bool)
        and raw_depth >= 0
    ):
        return raw_depth
    return int(bool(route.metadata.get("recursive_graft")))


def _load_recursive_grafted_routes(path: Path) -> list[RouteCandidate]:
    if not path.is_file():
        return []
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, list):
        raise ValueError(f"recursive graft checkpoint must contain a list: {path}")

    routes: list[RouteCandidate] = []
    for item in payload:
        if not isinstance(item, dict):
            raise ValueError(f"recursive graft checkpoint contains an invalid route: {path}")
        step_payloads = item.get("steps") or []
        if not isinstance(step_payloads, list):
            raise ValueError(f"recursive graft checkpoint contains invalid steps: {path}")
        steps = [
            RouteStep(**step_payload)
            for step_payload in step_payloads
            if isinstance(step_payload, dict)
        ]
        routes.append(RouteCandidate(**{**item, "steps": steps}))
    routes_by_id = {route.route_id: route for route in routes}
    depth_by_id: dict[str, int] = {}

    def graft_depth(route: RouteCandidate, active: set[str]) -> int:
        cached = depth_by_id.get(route.route_id)
        if cached is not None:
            return cached
        raw_depth = route.metadata.get("recursive_graft_depth")
        if (
            isinstance(raw_depth, int)
            and not isinstance(raw_depth, bool)
            and raw_depth >= 0
        ):
            depth_by_id[route.route_id] = raw_depth
            return raw_depth
        if route.route_id in active:
            return 1
        graft = route.metadata.get("recursive_graft")
        if not isinstance(graft, dict):
            depth_by_id[route.route_id] = 0
            return 0
        parent_id = str(graft.get("parent_route_id") or "")
        parent = routes_by_id.get(parent_id)
        depth = graft_depth(parent, {*active, route.route_id}) + 1 if parent else 1
        depth_by_id[route.route_id] = depth
        return depth

    upgraded: list[RouteCandidate] = []
    for route in routes:
        if (
            "recursive_graft_depth" not in route.metadata
            and not isinstance(route.metadata.get("recursive_graft"), dict)
        ):
            upgraded.append(route)
            continue
        metadata = dict(route.metadata)
        metadata["recursive_graft_depth"] = graft_depth(route, set())
        graft = metadata.get("recursive_graft")
        if isinstance(graft, dict) and "subroute_unclosed_precursors" not in graft:
            parent = routes_by_id.get(str(graft.get("parent_route_id") or ""))
            if parent is not None:
                replaced_leaf = str(graft.get("leaf_smiles") or "")
                parent_remaining = {
                    precursor
                    for precursor in (parent.metadata.get("unclosed_precursors") or [])
                    if precursor != replaced_leaf
                }
                graft = dict(graft)
                graft["subroute_unclosed_precursors"] = [
                    precursor
                    for precursor in (metadata.get("unclosed_precursors") or [])
                    if precursor not in parent_remaining
                ]
                metadata["recursive_graft"] = graft
        upgraded.append(replace(route, metadata=metadata))
    return [route for route in upgraded if _is_recursive_route_viable(route)]


def _recursive_expansion_signature(args: argparse.Namespace) -> str:
    settings = {
        "structure_identity_policy_version": 2,
        "recursive_subroute_policy_version": 4,
        "tree_search_profile_version": TREE_SEARCH_PROFILE_VERSION,
        **{
            name: getattr(args, name, None)
            for name in (
                "backend",
                "recursive_leaf_engines",
                "recursive_leaf_one_step_backends",
                "aizynth_model",
                "aizynth_stock",
                "aizynth_iteration_limit",
                "aizynth_max_transforms",
                "one_step_fast_filter_url",
                "one_step_fast_filter_threshold",
            )
        },
    }
    encoded = json.dumps(settings, sort_keys=True, separators=(",", ":"))
    return sha1(encoded.encode("utf-8")).hexdigest()


def _recursive_askcos_run_dir(
    leaf_dir: Path,
    *,
    search_signature: str,
) -> Path:
    """Scope ASKCOS leaf artifacts to the complete recursive search policy."""

    signature = search_signature.strip()
    if not signature:
        raise ValueError("search_signature must not be empty")
    return leaf_dir / "askcos" / f"profile_{signature[:12]}"


def _recursive_expansion_key(
    route: RouteCandidate,
    *,
    leaf: str,
    search_signature: str,
) -> str:
    encoded = "\0".join((search_signature, route.route_id, leaf))
    return sha1(encoded.encode("utf-8")).hexdigest()


def _load_recursive_expansion_records(path: Path) -> dict[str, dict[str, Any]]:
    if not path.is_file():
        return {}
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict) or payload.get("schema_version") != 1:
        raise ValueError(f"unsupported recursive expansion checkpoint: {path}")
    raw_records = payload.get("records") or []
    if not isinstance(raw_records, list):
        raise ValueError(f"recursive expansion records must be a list: {path}")
    records: dict[str, dict[str, Any]] = {}
    for record in raw_records:
        if not isinstance(record, dict):
            raise ValueError(f"recursive expansion record must be an object: {path}")
        key = str(record.get("expansion_key") or "").strip()
        selected_subroute_count = record.get("selected_subroute_count")
        if (
            isinstance(selected_subroute_count, int)
            and selected_subroute_count <= 0
            and record.get("terminal_no_progress") is not True
        ):
            continue
        if key:
            records[key] = record
    return records


def _write_recursive_expansion_records(
    path: Path,
    records: dict[str, dict[str, Any]],
) -> None:
    _json_dump(
        path,
        {
            "schema_version": 1,
            "records": sorted(
                records.values(),
                key=lambda record: (
                    str(record.get("completed_at") or ""),
                    str(record.get("expansion_key") or ""),
                ),
            ),
        },
    )


def _recursive_leaf_result_path(
    recursive_dir: Path,
    *,
    leaf: str,
    preferred_path: Path,
    expected_stock: str | None = None,
) -> Path:
    if _recursive_result_matches_stock(preferred_path, expected_stock):
        return preferred_path
    candidates = [
        path
        for path in recursive_dir.glob(
            f"depth_*_{_safe_leaf_key(leaf)}/aizynthfinder_result.json"
        )
        if _recursive_result_matches_stock(path, expected_stock)
    ]
    if not candidates:
        return preferred_path
    return max(candidates, key=lambda path: path.stat().st_mtime_ns)


def _recursive_result_matches_stock(path: Path, expected_stock: str | None) -> bool:
    if not path.is_file():
        return False
    if not expected_stock:
        return True
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return False
    stock = str(payload.get("stock") or "").strip()
    return not stock or stock == expected_stock


@dataclass(frozen=True)
class RecursiveLeafSearchResult:
    leaf: str
    leaf_dir: Path
    routes: list[RouteCandidate]
    errors: dict[str, str]
    deferred: bool = False


def _search_recursive_leaf(
    *,
    leaf: str,
    depth: int,
    leaf_engines: set[str],
    leaf_one_step_backends: set[str],
    args: argparse.Namespace,
    recursive_dir: Path,
    stock_registry: CommercialStockRegistry | None,
    leaf_timeout_sec: int,
    search_signature: str,
) -> RecursiveLeafSearchResult:
    """Run independent engines for one recursive leaf.

    The caller may execute this function concurrently for different leaves.
    Every engine writes beneath a leaf-specific directory, so no mutable route
    artifacts are shared between workers.
    """

    leaf_dir = recursive_dir / f"depth_{depth}_{_safe_leaf_key(leaf)}"
    routes: list[RouteCandidate] = []
    errors: dict[str, str] = {}
    deferred = False

    leaf_args = argparse.Namespace(**vars(args))
    leaf_args.one_step_retro_backends = ",".join(sorted(leaf_one_step_backends))
    leaf_args.one_step_template_timeout_sec = min(
        float(getattr(args, "one_step_template_timeout_sec", leaf_timeout_sec)),
        float(leaf_timeout_sec),
    )
    leaf_askcos_args = argparse.Namespace(**vars(args))
    leaf_askcos_args.recursive_leaf_timeout_sec = leaf_timeout_sec

    askcos_executor: ThreadPoolExecutor | None = None
    askcos_future: Any | None = None
    if "askcos" in leaf_engines:
        askcos_executor = ThreadPoolExecutor(max_workers=1)
        askcos_future = askcos_executor.submit(
            _run_recursive_leaf_askcos,
            leaf=leaf,
            depth=depth,
            args=leaf_askcos_args,
            run_dir=_recursive_askcos_run_dir(
                leaf_dir,
                search_signature=search_signature,
            ),
            stock_registry=stock_registry,
        )

    try:
        if "one_step" in leaf_engines and leaf_one_step_backends:
            try:
                one_step_routes, one_step_errors = run_one_step_retro_tasks(
                    smiles=leaf,
                    args=leaf_args,
                    run_dir=leaf_dir,
                    auth_token=os.environ.get(args.auth_token_env),
                )
                routes.extend(one_step_routes)
                if one_step_errors:
                    errors.update(one_step_errors)
                    _json_dump(leaf_dir / "one_step_retro_errors.json", one_step_errors)
            except Exception as exc:  # noqa: BLE001 - isolate one recursive engine.
                errors["one_step_retro"] = str(exc)
                _json_dump(
                    leaf_dir / "one_step_retro_error.json",
                    {"leaf": leaf, "depth": depth, "error": str(exc)},
                )

        result_path = _recursive_leaf_result_path(
            recursive_dir,
            leaf=leaf,
            preferred_path=leaf_dir / "aizynthfinder_result.json",
            expected_stock=args.aizynth_stock,
        )
        if "aizynthfinder" in leaf_engines:
            try:
                if _recursive_result_matches_stock(result_path, args.aizynth_stock):
                    payload = json.loads(result_path.read_text(encoding="utf-8"))
                else:
                    result = run_aizynthfinder_task(
                        smiles=leaf,
                        model_name=args.aizynth_model,
                        stock=args.aizynth_stock,
                        timeout_sec=leaf_timeout_sec,
                        run_dir=leaf_dir,
                        iteration_limit=args.aizynth_iteration_limit,
                        max_transforms=args.aizynth_max_transforms,
                        time_limit=min(
                            int(getattr(args, "aizynth_time_limit", leaf_timeout_sec)),
                            max(60, leaf_timeout_sec - 120),
                        ),
                    )
                    payload = result["payload"]
                routes.extend(normalize_aizynthfinder_payload(payload))
            except Exception as exc:  # noqa: BLE001 - isolate one recursive engine.
                error_text = str(exc)
                errors["aizynthfinder"] = error_text
                _json_dump(
                    leaf_dir / "aizynthfinder_error.json",
                    {"leaf": leaf, "depth": depth, "error": error_text},
                )
                late_result_path = _recursive_leaf_result_path(
                    recursive_dir,
                    leaf=leaf,
                    preferred_path=leaf_dir / "aizynthfinder_result.json",
                    expected_stock=args.aizynth_stock,
                )
                if _recursive_result_matches_stock(late_result_path, args.aizynth_stock):
                    try:
                        late_payload = json.loads(
                            late_result_path.read_text(encoding="utf-8")
                        )
                        routes.extend(normalize_aizynthfinder_payload(late_payload))
                    except (OSError, json.JSONDecodeError, ValueError):
                        pass
                elif "timed out" in error_text.lower():
                    deferred = True

        if askcos_future is not None:
            try:
                askcos_routes, askcos_errors = askcos_future.result()
                routes.extend(askcos_routes)
                if askcos_errors:
                    errors.update(askcos_errors)
                    _json_dump(leaf_dir / "askcos_recursive_errors.json", askcos_errors)
            except Exception as exc:  # noqa: BLE001 - isolate one recursive engine.
                errors["askcos"] = str(exc)
                _json_dump(
                    leaf_dir / "askcos_recursive_error.json",
                    {"leaf": leaf, "depth": depth, "error": str(exc)},
                )
    finally:
        if askcos_executor is not None:
            askcos_executor.shutdown(wait=True)

    try:
        routes = _forward_validate_recursive_leaf_routes(
            routes,
            args=args,
            leaf_dir=leaf_dir,
        )
    except Exception as exc:  # noqa: BLE001 - preserve candidates for the final validation gate.
        errors["forward_validation"] = str(exc)
        _json_dump(
            leaf_dir / "forward_validation_error.json",
            {"leaf": leaf, "depth": depth, "error": str(exc)},
        )
    if stock_registry is not None:
        routes = [stock_registry.close_route_if_buyable(route) for route in routes]
    return RecursiveLeafSearchResult(
        leaf=leaf,
        leaf_dir=leaf_dir,
        routes=routes,
        errors=errors,
        deferred=deferred,
    )


def run_recursive_leaf_aizynthfinder(
    *,
    engine_results: dict[str, dict[str, Any]],
    run_dir: Path,
    args: argparse.Namespace,
    stock_registry: CommercialStockRegistry | None,
    seed_routes: list[RouteCandidate] | None = None,
    runtime_budget: RuntimeBudget | None = None,
    on_progress: Any | None = None,
) -> list[RouteCandidate]:
    recursive_dir = run_dir / "recursive_leaf_search"
    if args.recursive_leaf_depth <= 0:
        return _close_routes_with_stock(
            _load_recursive_grafted_routes(
                recursive_dir / "recursive_grafted_routes.json"
            ),
            stock_registry,
        )
    leaf_engines = _recursive_leaf_engines(args)
    if not leaf_engines:
        return []
    leaf_one_step_backends = _recursive_leaf_one_step_backends(args)
    current_routes = _close_routes_with_stock(
        [
            *_candidate_routes_from_engine_results(engine_results, stock_registry=stock_registry),
            *(seed_routes or []),
        ],
        stock_registry,
    )
    recursive_dir.mkdir(parents=True, exist_ok=True)
    deferred_leaves = _deferred_recursive_leaf_targets(recursive_dir)
    if deferred_leaves:
        _json_dump(
            recursive_dir / "deferred_leaf_targets.json",
            {
                "reason": "prior_aizynthfinder_timeout_without_result",
                "targets": sorted(deferred_leaves),
            },
        )
    grafted_routes = _close_routes_with_stock(
        _load_recursive_grafted_routes(
            recursive_dir / "recursive_grafted_routes.json"
        ),
        stock_registry,
    )
    expansion_path = recursive_dir / "recursive_expansions.json"
    expansion_records = _load_recursive_expansion_records(expansion_path)
    search_signature = _recursive_expansion_signature(args)
    if not current_routes and not grafted_routes:
        return []

    searched: dict[str, list[RouteCandidate]] = {}
    attempted_leaves: set[str] = set()
    leaf_errors: dict[str, dict[str, str]] = {}
    budget_exhausted = False

    for depth in range(1, args.recursive_leaf_depth + 1):
        selected = _select_recursive_frontier_routes(
            [*current_routes, *grafted_routes],
            min_routes=args.min_routes,
            max_routes=args.max_routes,
            already_searched={*attempted_leaves, *deferred_leaves},
            completed_expansions=set(expansion_records),
            search_signature=search_signature,
        )
        if not selected:
            break
        leaves = _recursive_leaf_targets(
            selected,
            max_count=args.recursive_leaf_limit,
            already_searched={*attempted_leaves, *deferred_leaves},
            completed_expansions=set(expansion_records),
            search_signature=search_signature,
        )
        if not leaves:
            break
        _json_dump(
            recursive_dir / f"depth_{depth}_targets.json",
            {"depth": depth, "targets": leaves},
        )

        leaf_timeout_sec = args.recursive_leaf_timeout_sec
        if runtime_budget is not None:
            leaf_timeout_sec = runtime_budget.phase_timeout(
                args.recursive_leaf_timeout_sec,
                reserve_sec=60,
            )
        if leaf_timeout_sec < 60:
            budget_exhausted = True
            _json_dump(
                recursive_dir / "runtime_budget_exhausted.json",
                {
                    "depth": depth,
                    "leaves": leaves,
                    "remaining_seconds": (
                        runtime_budget.remaining_seconds()
                        if runtime_budget is not None
                        else 0
                    ),
                },
            )
            break

        attempted_leaves.update(leaves)
        leaf_concurrency = min(
            len(leaves),
            max(1, int(getattr(args, "recursive_leaf_concurrency", 2))),
        )
        deferred_interrupt: BaseException | None = None
        with ThreadPoolExecutor(max_workers=leaf_concurrency) as leaf_executor:
            future_to_leaf = {
                leaf_executor.submit(
                    _search_recursive_leaf,
                    leaf=leaf,
                    depth=depth,
                    leaf_engines=leaf_engines,
                    leaf_one_step_backends=leaf_one_step_backends,
                    args=args,
                    recursive_dir=recursive_dir,
                    stock_registry=stock_registry,
                    leaf_timeout_sec=leaf_timeout_sec,
                    search_signature=search_signature,
                ): leaf
                for leaf in leaves
            }
            for future in as_completed(future_to_leaf):
                leaf = future_to_leaf[future]
                try:
                    leaf_result = future.result()
                    leaf_dir = leaf_result.leaf_dir
                    routes = leaf_result.routes
                    errors_for_leaf = leaf_result.errors
                    if leaf_result.deferred:
                        deferred_leaves.add(leaf)
                except (KeyboardInterrupt, SystemExit) as exc:
                    # Finish checkpointing sibling results before propagating a
                    # process-level interruption to the caller.
                    deferred_interrupt = exc
                    continue
                except Exception as exc:  # noqa: BLE001 - preserve sibling leaf results.
                    leaf_dir = recursive_dir / f"depth_{depth}_{_safe_leaf_key(leaf)}"
                    routes = []
                    errors_for_leaf = {"leaf_worker": str(exc)}
                    _json_dump(
                        leaf_dir / "recursive_leaf_worker_error.json",
                        {"leaf": leaf, "depth": depth, "error": str(exc)},
                    )
                selected_subroutes = _select_recursive_subroutes(
                    routes,
                    max_routes=max(1, min(3, args.max_routes)),
                )
                if selected_subroutes:
                    searched[leaf] = selected_subroutes
                else:
                    searched.pop(leaf, None)
                _json_dump(
                    leaf_dir / "recursive_subroutes_summary.json",
                    {
                        "leaf": leaf,
                        "leaf_source": _recursive_leaf_source(selected, leaf, engine_results),
                        "route_count": len(routes),
                        "selected_route_count": len(selected_subroutes),
                        "closed_route_count": sum(
                            1 for route in selected_subroutes if route.closed
                        ),
                        "errors": errors_for_leaf,
                    },
                )
                if errors_for_leaf:
                    leaf_errors[f"depth_{depth}:{leaf}"] = errors_for_leaf
                    _json_dump(
                        recursive_dir / "recursive_leaf_errors.json",
                        leaf_errors,
                    )
                new_grafts: list[RouteCandidate] = []
                completed_records: list[dict[str, Any]] = []
                for parent in selected:
                    if leaf not in (parent.metadata.get("unclosed_precursors") or []):
                        continue
                    expansion_key = _recursive_expansion_key(
                        parent,
                        leaf=leaf,
                        search_signature=search_signature,
                    )
                    if expansion_key in expansion_records:
                        continue
                    parent_grafts = _viable_recursive_grafts(
                        parent,
                        leaf=leaf,
                        subroutes=selected_subroutes,
                    )
                    new_grafts.extend(
                        _close_routes_with_stock(parent_grafts, stock_registry)
                    )
                    if not errors_for_leaf:
                        completed_records.append(
                            {
                                "expansion_key": expansion_key,
                                "search_signature": search_signature,
                                "parent_route_id": parent.route_id,
                                "parent_family_key": parent.family_key,
                                "leaf_smiles": leaf,
                                "selected_subroute_count": len(selected_subroutes),
                                "graft_count": len(parent_grafts),
                                "viable_graft_count": sum(
                                    _is_recursive_route_viable(route)
                                    for route in parent_grafts
                                ),
                                "terminal_no_progress": not parent_grafts,
                                "completed_at": dt.datetime.now(dt.UTC).isoformat(),
                            }
                        )
                existing_ids = {route.route_id for route in grafted_routes}
                grafted_routes.extend(
                    route
                    for route in new_grafts
                    if route.route_id not in existing_ids
                )
                if grafted_routes:
                    _json_dump(
                        recursive_dir / "recursive_grafted_routes.json",
                        [asdict(route) for route in grafted_routes],
                    )
                if completed_records:
                    expansion_records.update(
                        {
                            str(record["expansion_key"]): record
                            for record in completed_records
                        }
                    )
                    _write_recursive_expansion_records(expansion_path, expansion_records)
                if on_progress is not None:
                    try:
                        on_progress(
                            list(grafted_routes),
                            {
                                "depth": depth,
                                "leaf": leaf,
                                "selected_subroute_count": len(selected_subroutes),
                                "closed_graft_count": sum(
                                    route.closed for route in grafted_routes
                                ),
                                "remaining_seconds": (
                                    runtime_budget.remaining_seconds()
                                    if runtime_budget is not None
                                    else None
                                ),
                            },
                        )
                    except Exception as exc:  # noqa: BLE001 - progress reporting must not stop chemistry search.
                        _json_dump(
                            recursive_dir / "progress_callback_error.json",
                            {"depth": depth, "leaf": leaf, "error": str(exc)},
                        )
        if deferred_interrupt is not None:
            raise deferred_interrupt
        if budget_exhausted:
            break

    if grafted_routes:
        _json_dump(
            recursive_dir / "recursive_grafted_routes.json",
            [asdict(route) for route in grafted_routes],
        )
    return grafted_routes


def _recursive_leaf_engines(args: argparse.Namespace) -> set[str]:
    raw = str(getattr(args, "recursive_leaf_engines", "aizynthfinder") or "")
    engines = {item.strip().lower() for item in raw.split(",") if item.strip()}
    allowed = {"one_step", "aizynthfinder", "askcos"}
    unsupported = sorted(engines - allowed)
    if unsupported:
        raise ValueError(f"unsupported recursive leaf engine(s): {', '.join(unsupported)}")
    return engines


def _recursive_leaf_one_step_backends(args: argparse.Namespace) -> set[str]:
    raw = str(getattr(args, "recursive_leaf_one_step_backends", "") or "")
    return _one_step_retro_backends(
        argparse.Namespace(one_step_retro_backends=raw)
    )


def _deferred_recursive_leaf_targets(recursive_dir: Path) -> set[str]:
    deferred: set[str] = set()
    for error_path in recursive_dir.glob("depth_*_*/aizynthfinder_error.json"):
        try:
            payload = json.loads(error_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        leaf = str(payload.get("leaf") or "").strip()
        error = str(payload.get("error") or "").lower()
        if not leaf or "timed out" not in error:
            continue
        leaf_key = _safe_leaf_key(leaf)
        if any(
            path.is_file()
            for path in recursive_dir.glob(
                f"depth_*_{leaf_key}/aizynthfinder_result.json"
            )
        ):
            continue
        deferred.add(leaf)
    return deferred


def _run_recursive_leaf_askcos(
    *,
    leaf: str,
    depth: int,
    args: argparse.Namespace,
    run_dir: Path,
    stock_registry: CommercialStockRegistry | None,
) -> tuple[list[RouteCandidate], dict[str, str]]:
    completion_buffer_sec = min(
        120,
        max(0, args.recursive_leaf_timeout_sec - 60),
    )
    expansion_time = max(60, args.recursive_leaf_timeout_sec - completion_buffer_sec)
    askcos_backends = _selected_askcos_backends(args.backend)
    search_pass = SearchPass(
        name=f"recursive_leaf_d{depth}",
        askcos_backends=askcos_backends,
        expansion_time=min(args.expansion_time, expansion_time),
        max_paths=min(args.max_paths, max(20, args.max_routes * 5)),
        askcos_timeout_sec=args.recursive_leaf_timeout_sec,
        run_aizynthfinder=False,
    )
    run_dir.mkdir(parents=True, exist_ok=True)
    rehydrated: dict[str, dict[str, Any]] = {}
    _rehydrate_askcos_results(
        run_dir,
        rehydrated,
        suffix=f"_recursive_leaf_d{depth}",
    )
    if rehydrated:
        routes: list[RouteCandidate] = []
        for result in rehydrated.values():
            routes.extend(normalize_askcos_tree_result(result["payload"], engine=result.get("engine") or "askcos_recursive"))
        if routes:
            _json_dump(
                run_dir / "askcos_recursive_summary.json",
                {
                    "leaf": leaf,
                    "depth": depth,
                    "engines": sorted(rehydrated),
                    "route_count": len(routes),
                    "rehydrated": True,
                    "errors": {},
                },
            )
            return routes, {}
    try:
        results, errors = run_askcos_backend_tasks(
            search_pass=search_pass,
            smiles=leaf,
            description=f"recursive leaf depth {depth}: {leaf}",
            args=args,
            auth_token=os.environ.get(args.auth_token_env),
            run_dir=run_dir,
            stock_registry=stock_registry,
            max_backend_concurrency=max(1, len(askcos_backends)),
        )
    except Exception as exc:  # noqa: BLE001 - recursive ASKCOS must not abort other engines.
        errors = {"askcos_recursive": str(exc)}
        _json_dump(
            run_dir / "askcos_recursive_error.json",
            {"leaf": leaf, "depth": depth, "error": str(exc)},
        )
        return [], errors
    routes: list[RouteCandidate] = []
    for result in results.values():
        routes.extend(normalize_askcos_tree_result(result["payload"], engine=result.get("engine") or "askcos_recursive"))
    _json_dump(
        run_dir / "askcos_recursive_summary.json",
        {
            "leaf": leaf,
            "depth": depth,
            "engines": sorted(results),
            "route_count": len(routes),
            "errors": errors,
        },
    )
    return routes, errors


def _recursive_leaf_targets(
    routes: list[RouteCandidate],
    *,
    max_count: int,
    already_searched: set[str],
    completed_expansions: set[str],
    search_signature: str,
) -> list[str]:
    targets: list[str] = []
    leaves_by_route = [
        (route, list(route.metadata.get("unclosed_precursors") or []))
        for route in routes
    ]
    max_leaf_count = max(
        (len(leaves) for _route, leaves in leaves_by_route),
        default=0,
    )
    for leaf_index in range(max_leaf_count):
        for route, leaves in leaves_by_route:
            if leaf_index >= len(leaves):
                continue
            leaf = leaves[leaf_index]
            if leaf in already_searched or leaf in targets:
                continue
            expansion_key = _recursive_expansion_key(
                route,
                leaf=leaf,
                search_signature=search_signature,
            )
            if expansion_key in completed_expansions:
                continue
            targets.append(leaf)
            if len(targets) >= max_count:
                return targets
    return targets


def _askcos_frontier_leaf_targets(
    engine_results: dict[str, dict[str, Any]],
    *,
    max_count: int,
    already_searched: set[str],
) -> list[str]:
    targets: list[str] = []
    for key in sorted(engine_results):
        if not key.startswith("askcos"):
            continue
        payload = engine_results[key].get("payload") or {}
        for item in _askcos_frontier_examples(payload):
            smiles = str(item.get("smiles") or "").strip()
            if not smiles or smiles in already_searched or smiles in targets:
                continue
            if _is_low_value_frontier_leaf(smiles, item):
                continue
            targets.append(smiles)
            if len(targets) >= max_count:
                return targets
    return targets


def _askcos_frontier_examples(payload: dict[str, Any]) -> list[dict[str, Any]]:
    result = payload.get("result") if isinstance(payload, dict) else None
    storage = result.get("storage") if isinstance(result, dict) else None
    frontier = storage.get("frontier_summary") if isinstance(storage, dict) else None
    examples = frontier.get("top_frontier_leaves") if isinstance(frontier, dict) else None
    if not isinstance(examples, list):
        return []
    return [item for item in examples if isinstance(item, dict)]


def _is_low_value_frontier_leaf(smiles: str, item: dict[str, Any]) -> bool:
    if ">>" in smiles or "." in smiles:
        return True
    if any(token in smiles for token in ("[Sn", "Sn]", "[Si", "Si]")):
        return True
    heavy_atom_count = item.get("heavy_atom_count")
    if isinstance(heavy_atom_count, int | float):
        return int(heavy_atom_count) < 8
    return len(smiles) < 10


def _recursive_leaf_source(
    selected_routes: list[RouteCandidate],
    leaf: str,
    engine_results: dict[str, dict[str, Any]],
) -> str:
    for route in selected_routes:
        if leaf in (route.metadata.get("unclosed_precursors") or []):
            return "selected_route_unclosed_precursor"
    for key in sorted(engine_results):
        if not key.startswith("askcos"):
            continue
        if any(str(item.get("smiles") or "").strip() == leaf for item in _askcos_frontier_examples(engine_results[key].get("payload") or {})):
            return f"{key}_frontier"
    return "unknown"


def _safe_leaf_key(smiles: str) -> str:
    return sha1(smiles.encode("utf-8")).hexdigest()[:12]


def write_route_pool_snapshot(
    *,
    id: str,
    smiles: str,
    description: str,
    run_dir: Path,
    engine_results: dict[str, dict[str, Any]],
    engine_errors: dict[str, str],
    min_routes: int,
    max_routes: int,
    stage: str,
    askcos_task_id: str | None,
    write_back: bool,
    public: bool,
    share_with: list[str],
    stock_registry: CommercialStockRegistry | None = None,
    online_suppliers: list[str] | None = None,
    online_supplier_timeout_sec: float = 20.0,
    online_supplier_max_sources: int = 5,
    online_supplier_verify_tls: bool = True,
    extra_routes: list[RouteCandidate] | None = None,
    forward_validation_url: str | None = None,
    forward_validation_threshold: float = 0.75,
    forward_validation_timeout_sec: float = 60.0,
) -> dict[str, Any]:
    askcos_sources, aizynthfinder_sources = _route_sources_from_engine_results(engine_results)
    online_stock_registry: CommercialStockRegistry | None = None
    online_supplier_summary: dict[str, Any] = {"enabled": online_suppliers or []}
    if online_suppliers:
        try:
            online_stock_registry = _build_online_supplier_registry(
                online_suppliers=online_suppliers,
                askcos_sources=askcos_sources,
                aizynthfinder_sources=aizynthfinder_sources,
                extra_routes=extra_routes,
                cache_path=run_dir / "online_supplier_evidence.json",
                timeout_sec=online_supplier_timeout_sec,
                max_sources_per_compound=online_supplier_max_sources,
                verify_tls=online_supplier_verify_tls,
                base_registry=stock_registry,
            )
            online_supplier_summary["decision_count"] = len(online_stock_registry.decisions)
            online_supplier_summary["accepted_count"] = sum(
                1 for decision in online_stock_registry.decisions if decision.decision == "accepted"
            )
        except Exception as exc:  # noqa: BLE001 - supplier evidence is additive and recorded.
            online_supplier_summary["error"] = str(exc)

    effective_stock_registry = merge_commercial_stock_registries([stock_registry, online_stock_registry])
    output_dir = run_dir if stage == "final" else run_dir / f".{stage}"
    route_transform = None
    if forward_validation_url:
        route_transform = lambda routes: _forward_validate_routes_with_cache(
            routes,
            url=forward_validation_url,
            threshold=forward_validation_threshold,
            timeout_sec=forward_validation_timeout_sec,
            cache_path=run_dir / "forward_validation.json",
        )
    build_result = build_unified_route_pool_artifacts(
        id=id,
        output_dir=output_dir,
        askcos_sources=askcos_sources,
        aizynthfinder_sources=aizynthfinder_sources,
        extra_routes=extra_routes,
        min_routes=min_routes,
        max_routes=max_routes,
        stock_registry=effective_stock_registry,
        route_transform=route_transform,
    )
    summary = {
        **build_result.summary,
        "stage": stage,
        "smiles": smiles,
        "description": description,
        "run_dir": str(run_dir),
        "engine_errors": engine_errors,
        "askcos_task_id": askcos_task_id,
        "askcos_task_ids": _askcos_task_ids_from_results(engine_results, run_dir),
        "online_supplier_evidence": online_supplier_summary,
    }
    if write_back and askcos_task_id and (summary["meets_min_routes"] or stage == "final"):
        try:
            summary["write_back"] = write_back_unified_route_pool(
                askcos_task_id,
                summary,
                build_result.selected_routes,
                public=public,
                share_with=share_with,
            )
        except Exception as exc:  # noqa: BLE001 - persisted for operator diagnosis.
            summary["write_back_error"] = str(exc)
            if stage == "final":
                raise

    snapshot_path = run_dir / ("summary.json" if stage == "final" else f"{stage}_summary.json")
    _json_dump(snapshot_path, summary)
    return summary


def _load_stock_registry(paths: list[Path]) -> CommercialStockRegistry | None:
    return UnifiedStockService(repo_root=ROOT, external_stock_paths=paths).load_registry()


def _search_stock_registry_with_cached_online_evidence(
    base_registry: CommercialStockRegistry | None,
    run_dir: Path,
) -> CommercialStockRegistry | None:
    cached_decisions = _load_cached_evidence_decisions(run_dir / "online_supplier_evidence.json")
    cached_registry = CommercialStockRegistry(cached_decisions) if cached_decisions else None
    return merge_commercial_stock_registries([base_registry, cached_registry])


def _build_online_supplier_registry(
    *,
    online_suppliers: list[str],
    askcos_sources: list[AskcosRouteSource],
    aizynthfinder_sources: list[AizynthFinderRouteSource],
    extra_routes: list[RouteCandidate] | None = None,
    cache_path: Path,
    timeout_sec: float,
    max_sources_per_compound: int,
    verify_tls: bool,
    base_registry: CommercialStockRegistry | None = None,
) -> CommercialStockRegistry:
    smiles_values = _collect_starting_material_smiles(
        askcos_sources,
        aizynthfinder_sources,
        extra_routes=extra_routes,
    )
    cached_decisions = _load_cached_evidence_decisions(cache_path)
    terminal_cached_decisions = [
        decision
        for decision in cached_decisions
        if not _is_retryable_online_evidence(decision)
    ]
    cached_smiles = {decision.smiles for decision in terminal_cached_decisions}
    missing_smiles = [
        smiles
        for smiles in smiles_values
        if smiles not in cached_smiles
        and (base_registry is None or not base_registry.is_buyable(smiles))
    ]

    new_registries: list[CommercialStockRegistry] = []
    if "pubchem" in set(online_suppliers) and missing_smiles:
        new_registries.append(
            build_pubchem_supplier_registry(
                missing_smiles,
                timeout_sec=timeout_sec,
                max_sources_per_compound=max_sources_per_compound,
                verify_tls=verify_tls,
            )
        )
    registry = merge_commercial_stock_registries(
        [CommercialStockRegistry(terminal_cached_decisions), *new_registries]
    ) or CommercialStockRegistry([])
    _write_cached_evidence_decisions(cache_path, registry.decisions)
    return registry


def _collect_starting_material_smiles(
    askcos_sources: list[AskcosRouteSource],
    aizynthfinder_sources: list[AizynthFinderRouteSource],
    *,
    extra_routes: list[RouteCandidate] | None = None,
) -> list[str]:
    values: list[str] = []

    def append_route_values(route: RouteCandidate) -> None:
        values.extend(route.starting_materials)
        values.extend(route.metadata.get("unclosed_precursors") or [])
        if route.closed:
            target_key = canonicalize_smiles(route.target_smiles)
            values.extend(
                step.product
                for step in route.steps
                if canonicalize_smiles(step.product) != target_key
            )

    for source in askcos_sources:
        try:
            askcos_routes = normalize_askcos_tree_result(source.payload, engine=source.engine)
        except ValueError:
            askcos_routes = []
        for route in askcos_routes:
            append_route_values(route)
    for source in aizynthfinder_sources:
        for route in normalize_aizynthfinder_payload(source.payload):
            append_route_values(route)
    for route in extra_routes or []:
        append_route_values(route)
    seen: set[str] = set()
    unique_values: list[str] = []
    for value in values:
        normalized = value.strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        unique_values.append(normalized)
    return unique_values


def _load_cached_evidence_decisions(path: Path) -> list[EvidenceDecision]:
    if not path.is_file():
        return []
    payload = json.loads(path.read_text(encoding="utf-8"))
    return [EvidenceDecision(**item) for item in payload.get("decisions", [])]


def _is_retryable_online_evidence(decision: EvidenceDecision) -> bool:
    if decision.decision != "ambiguous" or not decision.source.startswith("pubchem"):
        return False
    reason = decision.reason.lower()
    transient_markers = (
        "http 429",
        "http 500",
        "http 502",
        "http 503",
        "http 504",
        "timed out",
        "timeout",
        "temporarily unavailable",
        "connection reset",
        "connection refused",
        "remote end closed",
        "name or service not known",
        "temporary failure in name resolution",
    )
    return any(marker in reason for marker in transient_markers)

def _write_cached_evidence_decisions(path: Path, decisions: list[EvidenceDecision]) -> None:
    _json_dump(path, {"decisions": [asdict(decision) for decision in decisions]})


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run a real unified ASKCOS + AiZynthFinder route-search case.")
    parser.add_argument("--smiles")
    parser.add_argument("--smiles-file", type=Path)
    parser.add_argument("--id", required=True)
    parser.add_argument("--description")
    parser.add_argument("--backend", choices=["mcts", "retro_star", "all"], default="all")
    parser.add_argument("--base-url", default="http://127.0.0.1:9100")
    parser.add_argument("--username", default="askcos_admin")
    parser.add_argument("--password", default="reallybadpassword")
    parser.add_argument("--expansion-time", type=int, default=1200)
    parser.add_argument("--max-paths", type=int, default=200)
    parser.add_argument(
        "--askcos-timeout-sec",
        type=int,
        default=1500,
        help=(
            "Strategy wait window for each ASKCOS backend task. Timed-out tasks are checkpointed "
            "and left running for later rehydrate. Use 0 to wait until ASKCOS completes."
        ),
    )
    parser.add_argument(
        "--askcos-stall-timeout-sec",
        type=int,
        default=None,
        help="Fail ASKCOS if it stays submitted/started with zero route trees for this many seconds. Defaults to expansion_time + 300.",
    )
    parser.add_argument("--poll-sec", type=int, default=30)
    parser.add_argument("--aizynth-model", default="USPTO")
    parser.add_argument("--aizynth-stock", default="unified")
    parser.add_argument("--aizynth-timeout-sec", type=int, default=1080)
    parser.add_argument("--aizynth-iteration-limit", type=int, default=2000)
    parser.add_argument("--aizynth-max-transforms", type=int, default=14)
    parser.add_argument("--aizynth-time-limit", type=int, default=900)
    parser.add_argument(
        "--total-timeout-sec",
        type=int,
        default=3600,
        help="Hard wall-clock budget for one route-search job, including repair and recursion.",
    )
    parser.add_argument("--run-dir", type=Path)
    parser.add_argument("--auth-token-env", default="SYNON_ASKCOS_TOKEN")
    parser.add_argument("--min-routes", type=int, default=3)
    parser.add_argument("--max-routes", type=int, default=10)
    parser.add_argument(
        "--repair-attempts",
        type=int,
        default=0,
        help="Run this many expanded search passes when the primary pass produces fewer than min-routes.",
    )
    parser.add_argument(
        "--repair-max-paths",
        type=int,
        default=500,
        help="Upper bound for candidate paths in expanded repair passes.",
    )
    parser.add_argument("--public", action="store_true")
    parser.add_argument("--share-with", action="append", default=[])
    parser.add_argument(
        "--external-stock",
        action="append",
        type=Path,
        default=[],
        help="Operator-supplied stock evidence file; CSV/TSV/SMI/JSONL/JSON with exact SMILES.",
    )
    parser.add_argument(
        "--askcos-custom-buyables-limit",
        type=int,
        default=5000,
        help=(
            "Only send stock entries to ASKCOS as custom buyables when accepted stock "
            "count is at or below this limit. Large unified stock remains available "
            "for local closure checks and is not embedded into ASKCOS requests."
        ),
    )
    parser.add_argument(
        "--askcos-buyables-source",
        default="unified_commercial",
        help=(
            "Comma-separated native ASKCOS Mongo buyables sources. The default "
            "alias covers the imported domestic and commercial supplier stock."
        ),
    )
    parser.add_argument(
        "--online-supplier",
        action="append",
        choices=["pubchem"],
        default=[],
        help="Online exact-structure supplier evidence source. PubChem covers Chemical Vendors such as Sigma/Merck.",
    )
    parser.add_argument("--online-supplier-timeout-sec", type=float, default=20.0)
    parser.add_argument("--online-supplier-max-sources", type=int, default=5)
    parser.add_argument(
        "--online-supplier-insecure-tls",
        action="store_true",
        help="Disable TLS certificate verification for supplier lookup only; useful on machines with broken CA trust.",
    )
    parser.add_argument(
        "--one-step-retro-backends",
        default="template_relevance,exact_match,retrosim",
        help=(
            "Comma-separated ASKCOS one-step retro backends to add to the route pool: "
            "template_relevance, exact_match, retrosim."
        ),
    )
    parser.add_argument("--one-step-retro-model", default="USPTO_FULL")
    parser.add_argument(
        "--one-step-template-models",
        default="reaxys,pistachio,uspto_higher_level",
        help="Comma-separated template-relevance models queried independently.",
    )
    parser.add_argument(
        "--one-step-template-direct-url",
        default="http://127.0.0.1:19410/predictions",
        help=(
            "Direct ASKCOS template-relevance TorchServe URL. This avoids loading "
            "the full API process while the template models are resident."
        ),
    )
    parser.add_argument("--one-step-template-timeout-sec", type=float, default=600.0)
    parser.add_argument("--one-step-template-max-num-templates", type=int, default=1000)
    parser.add_argument("--one-step-template-max-cum-prob", type=float, default=0.995)
    parser.add_argument("--one-step-retro-top-k", type=int, default=20)
    parser.add_argument("--one-step-retro-threshold", type=float, default=0.2)
    parser.add_argument(
        "--one-step-fast-filter-url",
        default="http://127.0.0.1:9611/fast_filter_evaluate_batch",
        help="ASKCOS fast-filter batch endpoint used to forward-validate supplemental one-step routes.",
    )
    parser.add_argument(
        "--one-step-fast-filter-threshold",
        type=float,
        default=0.75,
        help="Minimum ASKCOS fast-filter score for a supplemental one-step route.",
    )
    parser.add_argument("--one-step-fast-filter-timeout-sec", type=float, default=60.0)
    parser.add_argument(
        "--allow-partial",
        action="store_true",
        help="Write available routes even if one engine fails; the summary still records the engine error.",
    )
    parser.add_argument(
        "--defer-write-back",
        action="store_true",
        help=(
            "Persist route artifacts and checkpoints without updating ASKCOS history. "
            "A later resume without this flag performs the final write-back."
        ),
    )
    parser.add_argument(
        "--defer-commercial-evidence",
        action="store_true",
        help=(
            "Do not load the unified commercial stock registry during search. "
            "Use this for low-memory recursive stages, then resume without the flag "
            "for final commercial-evidence validation."
        ),
    )
    parser.add_argument(
        "--recursive-leaf-depth",
        type=int,
        default=64,
        help=(
            "Safety cap for recursive search rounds. Normal termination is controlled "
            "by commercial closure, frontier exhaustion, or the total runtime budget."
        ),
    )
    parser.add_argument(
        "--recursive-leaf-engines",
        default="one_step,aizynthfinder,askcos",
        help=(
            "Comma-separated recursive leaf engines: one_step, aizynthfinder, "
            "askcos, or an explicit combination."
        ),
    )
    parser.add_argument(
        "--recursive-leaf-one-step-backends",
        default="exact_match,retrosim",
        help=(
            "Optional comma-separated one-step backends for recursive leaves. "
            "Root one-step backends are intentionally not inherited."
        ),
    )
    parser.add_argument(
        "--recursive-leaf-limit",
        type=int,
        default=2,
        help="Maximum unique unclosed leaves to search per recursive depth.",
    )
    parser.add_argument(
        "--recursive-leaf-concurrency",
        type=int,
        choices=(1, 2),
        default=2,
        help="Maximum sibling recursive leaves searched concurrently.",
    )
    parser.add_argument(
        "--recursive-leaf-timeout-sec",
        type=int,
        default=600,
        help="Timeout for each recursive leaf AiZynthFinder search.",
    )
    return parser


def main() -> int:
    args = build_parser().parse_args()
    runtime_budget = RuntimeBudget.start(args.total_timeout_sec)
    write_back_enabled = not args.defer_write_back
    job_lock = _acquire_exclusive_job_lock(args.id)
    smiles = _resolve_smiles(args.smiles, args.smiles_file)
    timestamp = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
    description = args.description or f"synon_unified_{args.id}_{timestamp}"
    run_dir = args.run_dir or RUNS_DIR / f"{timestamp}_unified_route_case_{args.id}"
    run_dir.mkdir(parents=True, exist_ok=True)
    askcos_stall_timeout_sec = (
        args.askcos_stall_timeout_sec
        if args.askcos_stall_timeout_sec is not None
        else args.expansion_time + 300
    )
    search_passes = build_search_passes(args)
    _json_dump(
        run_dir / "request.json",
        {
            "smiles": smiles,
            "id": args.id,
            "description": description,
            "backend": args.backend,
            "aizynth_model": args.aizynth_model,
            "aizynth_stock": args.aizynth_stock,
            "aizynth_iteration_limit": args.aizynth_iteration_limit,
            "aizynth_max_transforms": args.aizynth_max_transforms,
            "aizynth_time_limit": args.aizynth_time_limit,
            "total_timeout_sec": args.total_timeout_sec,
            "min_routes": args.min_routes,
            "max_routes": args.max_routes,
            "external_stock": [str(path) for path in args.external_stock],
            "online_supplier": args.online_supplier,
            "one_step_retro_backends": sorted(_one_step_retro_backends(args)),
            "one_step_retro_model": args.one_step_retro_model,
            "one_step_retro_top_k": args.one_step_retro_top_k,
            "one_step_retro_threshold": args.one_step_retro_threshold,
            "askcos_stall_timeout_sec": askcos_stall_timeout_sec,
            "repair_attempts": args.repair_attempts,
            "defer_write_back": args.defer_write_back,
            "defer_commercial_evidence": args.defer_commercial_evidence,
            "recursive_leaf_depth": args.recursive_leaf_depth,
            "recursive_leaf_engines": sorted(_recursive_leaf_engines(args)),
            "recursive_leaf_one_step_backends": sorted(
                _recursive_leaf_one_step_backends(args)
            ),
            "recursive_leaf_limit": args.recursive_leaf_limit,
            "recursive_leaf_concurrency": args.recursive_leaf_concurrency,
            "recursive_leaf_timeout_sec": args.recursive_leaf_timeout_sec,
            "search_passes": [asdict(search_pass) for search_pass in search_passes],
        },
    )

    engine_results: dict[str, dict[str, Any]] = {}
    engine_errors: dict[str, str] = {}
    stock_registry = (
        None
        if args.defer_commercial_evidence
        else _load_stock_registry(args.external_stock)
    )
    search_stock_registry = stock_registry
    auth_token = os.environ.get(args.auth_token_env)
    forward_validation_options = {
        "forward_validation_url": args.one_step_fast_filter_url,
        "forward_validation_threshold": args.one_step_fast_filter_threshold,
        "forward_validation_timeout_sec": args.one_step_fast_filter_timeout_sec,
    }

    def write_interim_progress(
        search_pass: SearchPass,
        pass_results: dict[str, dict[str, Any]],
        pass_errors: dict[str, str],
    ) -> None:
        combined_results = {**engine_results, **pass_results}
        combined_errors = {**engine_errors, **pass_errors}
        if not combined_results:
            return
        write_route_pool_snapshot(
            id=args.id,
            smiles=smiles,
            description=description,
            run_dir=run_dir,
            engine_results=combined_results,
            engine_errors=combined_errors,
            min_routes=args.min_routes,
            max_routes=args.max_routes,
            stage="interim",
            askcos_task_id=_first_askcos_task_id_from_results(combined_results, run_dir),
            write_back=write_back_enabled,
            public=args.public,
            share_with=args.share_with,
            stock_registry=stock_registry,
            online_suppliers=None,
            online_supplier_timeout_sec=args.online_supplier_timeout_sec,
            online_supplier_max_sources=args.online_supplier_max_sources,
            online_supplier_verify_tls=not args.online_supplier_insecure_tls,
            **forward_validation_options,
        )

    engine_results.update(_rehydrate_engine_results_from_run_dir(run_dir))
    if engine_results:
        resumed_summary = write_route_pool_snapshot(
            id=args.id,
            smiles=smiles,
            description=description,
            run_dir=run_dir,
            engine_results=engine_results,
            engine_errors=engine_errors,
            min_routes=args.min_routes,
            max_routes=args.max_routes,
            stage="resume_probe",
            askcos_task_id=_first_askcos_task_id_from_results(engine_results, run_dir),
            write_back=False,
            public=args.public,
            share_with=args.share_with,
            stock_registry=stock_registry,
            online_suppliers=args.online_supplier,
            online_supplier_timeout_sec=args.online_supplier_timeout_sec,
            online_supplier_max_sources=args.online_supplier_max_sources,
            online_supplier_verify_tls=not args.online_supplier_insecure_tls,
            **forward_validation_options,
        )
        print(json.dumps({"event": "rehydrated_existing_results", **resumed_summary}, ensure_ascii=False), flush=True)
        search_stock_registry = _search_stock_registry_with_cached_online_evidence(stock_registry, run_dir)

    for search_pass in search_passes:
        budgeted_inputs = _fit_search_pass_to_budget(search_pass, args, runtime_budget)
        if budgeted_inputs is None:
            engine_errors["runtime_budget"] = "search budget exhausted before another engine pass"
            _json_dump(
                run_dir / "runtime_budget_exhausted.json",
                {
                    "stage": search_pass.name,
                    "remaining_seconds": runtime_budget.remaining_seconds(),
                },
            )
            break
        search_pass, search_args = budgeted_inputs
        if search_pass.name != "primary" and should_skip_search_pass(search_pass, engine_errors):
            _json_dump(
                run_dir / f"{search_pass.name}_skipped.json",
                {
                    "search_pass": asdict(search_pass),
                    "reason": "askcos_no_progress_stall",
                    "engine_errors": engine_errors,
                },
            )
            break
        _json_dump(run_dir / f"{search_pass.name}_search_pass.json", asdict(search_pass))
        remaining_search_pass = _remaining_search_pass(search_pass, engine_results)
        if not remaining_search_pass.run_aizynthfinder and not remaining_search_pass.askcos_backends:
            _json_dump(
                run_dir / f'{search_pass.name}_resume_skipped.json',
                {
                    'search_pass': asdict(search_pass),
                    'reason': 'all_search_pass_engines_rehydrated',
                    'rehydrated_engines': sorted(engine_results),
                },
            )
            continue
        pass_results, pass_errors = run_search_pass(
            search_pass=remaining_search_pass,
            smiles=smiles,
            description=description,
            args=search_args,
            auth_token=auth_token,
            run_dir=run_dir,
            stock_registry=search_stock_registry,
            on_first_result=write_interim_progress,
        )
        engine_results.update(pass_results)
        engine_errors.update(pass_errors)
        if pass_results:
            write_interim_progress(search_pass, pass_results, pass_errors)
        if not engine_results:
            continue
        pass_summary = write_route_pool_snapshot(
            id=args.id,
            smiles=smiles,
            description=description,
            run_dir=run_dir,
            engine_results=engine_results,
            engine_errors=engine_errors,
            min_routes=args.min_routes,
            max_routes=args.max_routes,
            stage=search_pass.name,
            askcos_task_id=_first_askcos_task_id_from_results(engine_results, run_dir),
            write_back=write_back_enabled,
            public=args.public,
            share_with=args.share_with,
            stock_registry=stock_registry,
            online_suppliers=args.online_supplier,
            online_supplier_timeout_sec=args.online_supplier_timeout_sec,
            online_supplier_max_sources=args.online_supplier_max_sources,
            online_supplier_verify_tls=not args.online_supplier_insecure_tls,
            **forward_validation_options,
        )
        if pass_summary["meets_min_routes"]:
            break
        search_stock_registry = _search_stock_registry_with_cached_online_evidence(stock_registry, run_dir)

    if not engine_results:
        summary = {
            "id": args.id,
            "smiles": smiles,
            "description": description,
            "selected_route_count": 0,
            "meets_min_routes": False,
            "engine_errors": engine_errors,
            "run_dir": str(run_dir),
        }
        _json_dump(run_dir / "summary.json", summary)
        print(json.dumps(summary, ensure_ascii=False))
        return 1

    one_step_routes: list[RouteCandidate] = []
    one_step_errors: dict[str, str] = {}
    if runtime_budget.remaining_seconds() > 120:
        one_step_args = argparse.Namespace(**vars(args))
        one_step_args.one_step_template_timeout_sec = float(
            max(
                60,
                runtime_budget.phase_timeout(
                    int(args.one_step_template_timeout_sec),
                    reserve_sec=120,
                ),
            )
        )
        try:
            one_step_routes, one_step_errors = run_one_step_retro_tasks(
                smiles=smiles,
                args=one_step_args,
                run_dir=run_dir,
                auth_token=auth_token,
            )
            engine_errors.update(one_step_errors)
            one_step_routes = _select_candidate_routes(
                one_step_routes,
                min_routes=min(args.min_routes, args.max_routes),
                max_routes=args.max_routes,
            )
        except Exception as exc:  # noqa: BLE001 - one-step retro must not block tree-search output.
            engine_errors["askcos_one_step_retro"] = str(exc)
            _json_dump(run_dir / "one_step_retro_error.json", {"error": str(exc)})
    else:
        engine_errors["runtime_budget_one_step"] = "search budget exhausted before one-step expansion"

    preliminary_summary = write_route_pool_snapshot(
        id=args.id,
        smiles=smiles,
        description=description,
        run_dir=run_dir,
        engine_results=engine_results,
        engine_errors=engine_errors,
        min_routes=args.min_routes,
        max_routes=args.max_routes,
        stage="pre_recursive",
        askcos_task_id=_first_askcos_task_id_from_results(engine_results, run_dir),
        write_back=False,
        public=args.public,
        share_with=args.share_with,
        stock_registry=stock_registry,
        online_suppliers=args.online_supplier,
        online_supplier_timeout_sec=args.online_supplier_timeout_sec,
        online_supplier_max_sources=args.online_supplier_max_sources,
        online_supplier_verify_tls=not args.online_supplier_insecure_tls,
        extra_routes=one_step_routes,
        **forward_validation_options,
    )
    search_stock_registry = _search_stock_registry_with_cached_online_evidence(
        stock_registry,
        run_dir,
    )
    recursive_routes: list[RouteCandidate] = []

    def write_recursive_progress(
        routes: list[RouteCandidate],
        event: dict[str, Any],
    ) -> None:
        progress_summary = write_route_pool_snapshot(
            id=args.id,
            smiles=smiles,
            description=description,
            run_dir=run_dir,
            engine_results=engine_results,
            engine_errors=engine_errors,
            min_routes=args.min_routes,
            max_routes=args.max_routes,
            stage="interim",
            askcos_task_id=_first_askcos_task_id_from_results(engine_results, run_dir),
            write_back=write_back_enabled,
            public=args.public,
            share_with=args.share_with,
            stock_registry=search_stock_registry,
            online_suppliers=None,
            extra_routes=[*one_step_routes, *routes],
            **forward_validation_options,
        )
        progress_summary["progress"] = {"phase": "recursive_closure", **event}
        _json_dump(run_dir / "interim_summary.json", progress_summary)

    if (
        not preliminary_summary["meets_min_routes"]
        and runtime_budget.remaining_seconds() > 120
    ):
        recursive_routes = run_recursive_leaf_aizynthfinder(
            engine_results=engine_results,
            run_dir=run_dir,
            args=args,
            stock_registry=search_stock_registry,
            seed_routes=one_step_routes,
            runtime_budget=runtime_budget,
            on_progress=write_recursive_progress,
        )
    elif not preliminary_summary["meets_min_routes"]:
        engine_errors["runtime_budget"] = "search budget exhausted before recursive closure"

    summary = write_route_pool_snapshot(
        id=args.id,
        smiles=smiles,
        description=description,
        run_dir=run_dir,
        engine_results=engine_results,
        engine_errors=engine_errors,
        min_routes=args.min_routes,
        max_routes=args.max_routes,
        stage="final",
        askcos_task_id=_first_askcos_task_id_from_results(engine_results, run_dir),
        write_back=write_back_enabled,
        public=args.public,
        share_with=args.share_with,
        stock_registry=stock_registry,
        online_suppliers=args.online_supplier,
        online_supplier_timeout_sec=args.online_supplier_timeout_sec,
        online_supplier_max_sources=args.online_supplier_max_sources,
        online_supplier_verify_tls=not args.online_supplier_insecure_tls,
        extra_routes=[*one_step_routes, *recursive_routes],
        **forward_validation_options,
    )
    summary["runtime"] = {
        "total_timeout_sec": args.total_timeout_sec,
        "elapsed_seconds": args.total_timeout_sec - runtime_budget.remaining_seconds(),
        "remaining_seconds": runtime_budget.remaining_seconds(),
        "budget_exhausted": runtime_budget.remaining_seconds() <= 120,
    }
    _json_dump(run_dir / "summary.json", summary)
    print(json.dumps(summary, ensure_ascii=False))

    has_required_route_count = bool(summary["meets_min_routes"])
    if has_required_route_count:
        return 0
    return 1


def _resolve_smiles(smiles: str | None, smiles_file: Path | None) -> str:
    if smiles_file:
        value = smiles_file.read_text(encoding="utf-8-sig").strip().lstrip("\ufeff")
        if value.startswith("{"):
            try:
                payload = json.loads(value)
            except json.JSONDecodeError:
                payload = {}
            if isinstance(payload, dict) and isinstance(payload.get("smiles"), str):
                value = payload["smiles"].strip()
        if value:
            return value
    if smiles:
        return smiles.strip()
    raise SystemExit("--smiles or --smiles-file is required")


if __name__ == "__main__":
    raise SystemExit(main())
