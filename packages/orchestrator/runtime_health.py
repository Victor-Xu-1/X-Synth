from __future__ import annotations

import hashlib
import json
import os
import stat
import time
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from pathlib import Path
from threading import Lock
from urllib import request
from urllib.error import HTTPError

from packages.adapters.askcos.transport import NoRedirect
from packages.adapters.stock.stock_index import StockIndex, StockIndexError
from packages.platform.performance import PerformanceBudget
from packages.platform.native_endpoints import (
    ENDPOINTS, require_search_key, resolve_native_endpoints,
)
from packages.platform.native_search_contract import (
    NATIVE_SEARCH_HEADER, SEARCH_KEY_VARIABLE, NATIVE_SEARCH_READY_PATH,
    NATIVE_SEARCH_PROTOCOL, NATIVE_SEARCH_PROTOCOL_VERSION,
)
from packages.platform.resource_metrics import matching_process
from packages.knowledge_base.reaction_library import ReactionLibrary
from packages.knowledge_base.reaction_models import EvidenceSourceStatus

_cache = {}
_cache_lock = Lock()
_refresh_lock = Lock()


def _route_dependencies_ready(checks: dict) -> bool:
    required = (
        "gateway", "expand_one", "template_relevance", "fast_filter",
        "commercial_stock", "scscore", "pathway_ranker", "cluster",
        "inventory_consistent", "configured_models_loaded", "forward_predictor",
    )
    return all(checks.get(name) is True for name in required) and checks.get("reaction_evidence_consistent", True) is True


def _evidence_dependency_ready(path: str, native: dict | None) -> bool:
    if not path:
        return native is None
    try:
        local = ReactionLibrary(path).status()
        return local.ready and EvidenceSourceStatus.model_validate(native) == local
    except (OSError, ValueError, TypeError):
        return False


def _native_lifecycle() -> tuple[tuple | None, bool]:
    state = os.environ.get("X_SYNTH_STATE_DIR")
    if not state:
        return None, True
    path = Path(state) / "native/runtime.json"
    try:
        metadata = path.lstat()
        if (not stat.S_ISREG(metadata.st_mode) or metadata.st_size > 1_048_576
                or metadata.st_uid != os.geteuid() or metadata.st_mode & 0o077):
            return ("invalid",), False
        document = json.loads(path.read_text())
        if (not isinstance(document, dict) or not isinstance(document.get("generation"), str)
                or type(document.get("revision")) is not int
                or not isinstance(document.get("boot_id"), str)
                or not isinstance(document.get("status"), str)):
            return ("invalid",), False
        owner = matching_process(document.get("supervisor", {}))
        alive = bool(owner and owner["state"] not in {"Z", "X"})
        token = (metadata.st_ino, document.get("boot_id"), document.get("generation"),
                 document.get("revision"), document.get("status"), alive)
        boot_id = Path("/proc/sys/kernel/random/boot_id").read_text().strip()
        return token, bool(document.get("boot_id") == boot_id and document.get("generation")
                           and document.get("status") == "running" and alive)
    except FileNotFoundError:
        return ("absent",), True
    except (OSError, ValueError, TypeError, AttributeError):
        return ("invalid",), False


def _probe(url: str | request.Request, timeout: float, *, require_ready: bool, max_bytes=1_000_000) -> tuple[bool, dict]:
    opener = request.build_opener(request.ProxyHandler({}), NoRedirect())
    try:
        with opener.open(url, timeout=timeout) as response:
            raw = response.read(max_bytes + 1)
            if len(raw) > max_bytes:
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


def _probe_search(url: str, timeout: float, *, strategy: str, key: str) -> tuple[bool, dict]:
    try:
        require_search_key({SEARCH_KEY_VARIABLE: key}, [strategy])
        # Internal credentials never leave the managed loopback channel.
        endpoint = resolve_native_endpoints({ENDPOINTS[strategy].variable: url}, managed=True)[strategy]
    except ValueError:
        return False, {"error": "native_search_auth_unavailable"}
    target = endpoint.url + NATIVE_SEARCH_READY_PATH
    deadline = time.monotonic() + timeout
    opener = request.build_opener(request.ProxyHandler({}), NoRedirect())
    invalid = "invalid-internal-readiness-probe"
    if invalid == key:
        invalid += "-different"
    try:
        with opener.open(request.Request(target, headers={NATIVE_SEARCH_HEADER: invalid}), timeout=timeout):
            return False, {"error": "native_search_auth_not_enforced"}
    except HTTPError as error:
        rejected = error.code == 403
        error.close()
        if not rejected:
            return False, {"error": "native_search_auth_unavailable"}
    except (OSError, ValueError):
        return False, {"error": "native_search_auth_unavailable"}
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        return False, {"error": "native_search_auth_unavailable"}
    ready, payload = _probe(request.Request(target, headers={NATIVE_SEARCH_HEADER: key}),
                            remaining, require_ready=True, max_bytes=4096)
    valid_protocol = (
        payload.get("protocol") == NATIVE_SEARCH_PROTOCOL
        and type(payload.get("protocol_version")) is int
        and payload["protocol_version"] == NATIVE_SEARCH_PROTOCOL_VERSION
        and payload.get("strategy") == strategy
    )
    if not ready or not valid_protocol:
        return False, {"error": "native_search_protocol_unavailable"}
    return True, {field: payload[field] for field in ("status", "protocol", "protocol_version", "strategy")}


def route_runtime_status(repo_root: Path, *, force: bool = False) -> dict:
    """ASKCOS is the sole engine. Documentation pages are not model readiness."""
    budget = PerformanceBudget.from_environment()
    resolved = resolve_native_endpoints()
    endpoints = {name: endpoint.url + NATIVE_SEARCH_READY_PATH if name in {"mcts", "retro_star"}
                 else endpoint.readiness_url for name, endpoint in resolved.items()}
    stock_path = os.environ.get("X_SYNTH_STOCK_INDEX", "")
    evidence_path = os.environ.get("X_SYNTH_REACTION_LIBRARY_DB", "")
    with _refresh_lock:
        lifecycle, runtime_running = _native_lifecycle()
        search_key = os.environ.get(SEARCH_KEY_VARIABLE, "")
        auth_identity = hashlib.sha256(search_key.encode()).digest()
        cache_key = (
            tuple(endpoints.items()), stock_path, evidence_path, lifecycle, auth_identity,
            budget.health_timeout_seconds,
            os.environ.get("X_SYNTH_ASKCOS_MODELS", "pistachio,pistachio_ringbreaker"),
        )
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
            futures = {}
            for name, url in endpoints.items():
                if name in {"mcts", "retro_star"}:
                    futures[name] = executor.submit(
                        _probe_search, resolved[name].url, budget.health_timeout_seconds,
                        strategy=name, key=search_key,
                    )
                else:
                    futures[name] = executor.submit(_probe, url, budget.health_timeout_seconds, require_ready=True)
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
        checks["reaction_evidence_consistent"] = _evidence_dependency_ready(
            evidence_path, replies["expand_one"][1].get("evidence_source"),
        )
        if not checks["reaction_evidence_consistent"]:
            errors["reaction_evidence_consistent"] = "search_and_review_reaction_evidence_mismatch"
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
        if not runtime_running:
            errors["native_runtime"] = "native_runtime_not_running"
            available = []
        askcos_ready = runtime_running and _route_dependencies_ready(checks) and bool(available)
        result = {
            "route_search_ready": askcos_ready,
            "backends": {"askcos_v2": askcos_ready},
            "service_checks": checks,
            "dependency_errors": errors,
            "stock_snapshot": snapshot,
            "performance_budget": budget.summary(),
            "available_strategies": available,
        }
        latest, _ = _native_lifecycle()
        if latest != lifecycle or hashlib.sha256(os.environ.get(SEARCH_KEY_VARIABLE, "").encode()).digest() != auth_identity:
            result.update(route_search_ready=False, backends={"askcos_v2": False}, available_strategies=[])
            result["dependency_errors"]["native_runtime"] = "native_runtime_generation_changed"
            return deepcopy(result)
        with _cache_lock:
            _cache.clear()
            _cache[cache_key] = (time.monotonic(), result)
        return deepcopy(result)
