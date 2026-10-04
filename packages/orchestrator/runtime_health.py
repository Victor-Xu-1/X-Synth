from __future__ import annotations

import json
import os
import time
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from pathlib import Path
from threading import Lock
from urllib import request

from packages.adapters.askcos.transport import NoRedirect
from packages.adapters.stock.stock_index import StockIndex, StockIndexError
from packages.platform.performance import PerformanceBudget

_cache = {}
_cache_lock = Lock()
_refresh_lock = Lock()


def _probe(url: str, timeout: float, *, require_ready: bool) -> tuple[bool, dict]:
    opener = request.build_opener(request.ProxyHandler({}), NoRedirect())
    try:
        with opener.open(url, timeout=timeout) as response:
            raw = response.read(1_000_001)
            if len(raw) > 1_000_000:
                return False, {"error": "health_response_too_large"}
            payload = json.loads(raw)
            if not isinstance(payload, dict):
                return False, {"error": "invalid_health_payload"}
            ready = response.status == 200
            if require_ready:
                ready = ready and payload.get("status") == "ready"
            return ready, payload
    except (OSError, ValueError, UnicodeError):
        return False, {"error": "dependency_unavailable"}


def route_runtime_status(repo_root: Path, *, force: bool = False) -> dict:
    """ASKCOS is the sole engine. Documentation pages are not model readiness."""
    budget = PerformanceBudget.from_environment()
    base_url = os.environ.get("X_SYNTH_ASKCOS_URL", "http://127.0.0.1:9100").rstrip("/")
    endpoints = {
        "gateway": f"{base_url}/health/ready",
        "mcts": os.environ.get("X_SYNTH_MCTS_URL", "http://127.0.0.1:9311")
        + "/health/ready",
        "retro_star": os.environ.get("X_SYNTH_RETRO_STAR_URL", "http://127.0.0.1:9321")
        + "/health/ready",
        "expand_one": os.environ.get("X_SYNTH_EXPAND_ONE_URL", "http://127.0.0.1:9301")
        + "/health/ready",
        "template_relevance": os.environ.get(
            "X_SYNTH_TEMPLATE_URL", "http://127.0.0.1:19410"
        )
        + "/health/ready",
        "fast_filter": os.environ.get(
            "X_SYNTH_FAST_FILTER_URL", "http://127.0.0.1:9611"
        )
        + "/health/ready",
        "scscore": os.environ.get("X_SYNTH_SCSCORE_URL", "http://127.0.0.1:9741")
        + "/health/ready",
        "pathway_ranker": os.environ.get(
            "X_SYNTH_PATHWAY_RANKER_URL", "http://127.0.0.1:9681"
        )
        + "/health/ready",
        "value_network": os.environ.get(
            "X_SYNTH_VALUE_NETWORK_URL", "http://127.0.0.1:9350"
        )
        + "/health/ready",
        "cluster": os.environ.get("X_SYNTH_CLUSTER_URL", "http://127.0.0.1:9801")
        + "/health/ready",
    }
    endpoints["condition_recommender"] = os.environ.get(
        "X_SYNTH_CONDITION_URL", "http://127.0.0.1:9901"
    ).rstrip("/") + "/health/ready"
    endpoints["forward_predictor"] = os.environ.get(
        "X_SYNTH_FORWARD_URL", "http://127.0.0.1:9911"
    ).rstrip("/") + "/health/ready"
    endpoints["impurity"] = os.environ.get(
        "X_SYNTH_IMPURITY_URL", "http://127.0.0.1:9941"
    ).rstrip("/") + "/health/ready"
    stock_path = os.environ.get("X_SYNTH_STOCK_INDEX", "")
    cache_key = (
        tuple(endpoints.items()),
        stock_path,
        budget.health_timeout_seconds,
        os.environ.get("X_SYNTH_ASKCOS_MODELS", "pistachio,pistachio_ringbreaker"),
    )
    with _refresh_lock:
        current = time.monotonic()
        with _cache_lock:
            cached = _cache.get(cache_key)
            if (
                not force
                and cached
                and current - cached[0] < budget.health_cache_seconds
            ):
                return deepcopy(cached[1])

        with ThreadPoolExecutor(max_workers=len(endpoints)) as executor:
            futures = {
                name: executor.submit(
                    _probe, url, budget.health_timeout_seconds, require_ready=True
                )
                for name, url in endpoints.items()
            }
            replies = {name: future.result() for name, future in futures.items()}
        checks = {name: reply[0] for name, reply in replies.items()}
        errors = {
            name: "dependency_unavailable"
            for name, ready in checks.items()
            if not ready
        }
        snapshot = None
        try:
            snapshot = StockIndex(stock_path).summary if stock_path else None
            checks["commercial_stock"] = snapshot is not None
        except StockIndexError:
            checks["commercial_stock"] = False
        if not checks["commercial_stock"]:
            errors["commercial_stock"] = "exact_catalog_index_unavailable"
        gateway_snapshot = replies["gateway"][1].get("stock_snapshot") or {}
        checks["inventory_consistent"] = bool(snapshot) and all(
            gateway_snapshot.get(key) == snapshot.get(key)
            for key in (
                "source_sha256",
                "catalog_sha256",
                "source_id",
                "unique_structures",
            )
        )
        if not checks["inventory_consistent"]:
            errors["inventory_consistent"] = "search_and_review_stock_mismatch"
        configured = {
            value.strip()
            for value in os.environ.get(
                "X_SYNTH_ASKCOS_MODELS", "pistachio,pistachio_ringbreaker"
            ).split(",")
            if value.strip()
        }
        loaded = replies["template_relevance"][1].get("models") or {}
        checks["configured_models_loaded"] = bool(configured) and configured.issubset(
            loaded
        )
        if not checks["configured_models_loaded"]:
            errors["configured_models_loaded"] = "configured_model_not_loaded"
        available = [
            name
            for name in ("mcts", "retro_star")
            if checks[name] and (name != "retro_star" or checks["value_network"])
        ]
        askcos_ready = all(
            checks[name]
            for name in (
                "gateway",
                "expand_one",
                "template_relevance",
                "fast_filter",
                "commercial_stock",
                "scscore",
                "pathway_ranker",
                "cluster",
                "inventory_consistent",
                "configured_models_loaded",
            )
        ) and bool(available)
        result = {
            "route_search_ready": askcos_ready,
            "backends": {"askcos_v2": askcos_ready},
            "service_checks": checks,
            "dependency_errors": errors,
            "stock_snapshot": snapshot,
            "performance_budget": budget.summary(),
            "available_strategies": available,
        }
        with _cache_lock:
            _cache.clear()
            _cache[cache_key] = (time.monotonic(), result)
        return deepcopy(result)
