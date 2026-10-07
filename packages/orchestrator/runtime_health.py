from __future__ import annotations

import hashlib
import json
import os
import stat
import time
from concurrent.futures import CancelledError, ThreadPoolExecutor
from contextlib import contextmanager, nullcontext
from copy import deepcopy
from dataclasses import dataclass, field
from http.client import HTTPException
from pathlib import Path
from threading import Event, Lock
from urllib import request

from packages.adapters.stock.stock_index import StockIndex, StockIndexError
from packages.orchestrator.health_probe import (
    CANCEL_POLL_SECONDS, HealthCancellation, read_http,
)
from packages.platform.performance import PerformanceBudget
from packages.platform.native_endpoints import (
    ENDPOINTS, NativeEndpoint, require_search_key, resolve_native_endpoints,
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


def _probe(
    url: str | request.Request, timeout: float, *, require_ready: bool,
    max_bytes=1_000_000, _cancel: Event | None = None,
) -> tuple[bool, dict]:
    deadline = time.monotonic() + timeout
    try:
        status, raw = read_http(
            url.full_url if isinstance(url, request.Request) else url,
            headers=dict(url.header_items()) if isinstance(url, request.Request) else None,
            deadline=deadline, cancel=_cancel, max_bytes=max_bytes,
        )
        if not 200 <= status < 300:
            return False, {"error": "dependency_unavailable"}
        if len(raw) > max_bytes:
            return False, {"error": "health_response_too_large"}
        payload = json.loads(raw)
        if _cancel is not None and _cancel.is_set():
            raise CancelledError("Runtime readiness refresh stopped")
        if time.monotonic() >= deadline:
            return False, {"error": "dependency_unavailable"}
        if not isinstance(payload, dict):
            return False, {"error": "invalid_health_payload"}
        ready = status == 200 and (not require_ready or payload.get("status") == "ready")
        return ready, payload
    except (OSError, ValueError, UnicodeError, HTTPException, RecursionError):
        return False, {"error": "dependency_unavailable"}


def _probe_search(
    url: str, timeout: float, *, strategy: str, key: str, _cancel: Event | None = None,
) -> tuple[bool, dict]:
    try:
        require_search_key({SEARCH_KEY_VARIABLE: key}, [strategy])
        # Internal credentials never leave the managed loopback channel.
        endpoint = resolve_native_endpoints({ENDPOINTS[strategy].variable: url}, managed=True)[strategy]
    except ValueError:
        return False, {"error": "native_search_auth_unavailable"}
    target = endpoint.url + NATIVE_SEARCH_READY_PATH
    deadline = time.monotonic() + timeout
    invalid = "invalid-internal-readiness-probe"
    if invalid == key:
        invalid += "-different"
    try:
        status, _ = read_http(
            target, deadline=deadline, cancel=_cancel,
            headers={NATIVE_SEARCH_HEADER: invalid}, read_body=False,
        )
        if 200 <= status < 300:
            return False, {"error": "native_search_auth_not_enforced"}
        if status != 403:
            return False, {"error": "native_search_auth_unavailable"}
    except (OSError, ValueError, HTTPException):
        return False, {"error": "native_search_auth_unavailable"}
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        return False, {"error": "native_search_auth_unavailable"}
    ready, payload = _probe(request.Request(target, headers={NATIVE_SEARCH_HEADER: key}),
                            remaining, require_ready=True, max_bytes=4096, _cancel=_cancel)
    valid_protocol = (
        payload.get("protocol") == NATIVE_SEARCH_PROTOCOL
        and type(payload.get("protocol_version")) is int
        and payload["protocol_version"] == NATIVE_SEARCH_PROTOCOL_VERSION
        and payload.get("strategy") == strategy
    )
    if not ready or not valid_protocol:
        return False, {"error": "native_search_protocol_unavailable"}
    return True, {field: payload[field] for field in ("status", "protocol", "protocol_version", "strategy")}


@dataclass(frozen=True)
class _HealthContext:
    budget: PerformanceBudget
    resolved: dict[str, NativeEndpoint]
    stock_path: str
    evidence_path: str
    state_path: str
    lifecycle: tuple | None
    runtime_running: bool
    search_key: str = field(repr=False)
    models: str

    @property
    def identity(self) -> tuple:
        return (
            tuple((name, endpoint.url) for name, endpoint in self.resolved.items()),
            self.stock_path, self.evidence_path, self.state_path, self.lifecycle,
            hashlib.sha256(self.search_key.encode()).digest(), self.budget, self.models,
        )


def _health_context() -> _HealthContext:
    budget = PerformanceBudget.from_environment()
    resolved = resolve_native_endpoints()
    stock_path = os.environ.get("X_SYNTH_STOCK_INDEX", "")
    evidence_path = os.environ.get("X_SYNTH_REACTION_LIBRARY_DB", "")
    state_path = os.environ.get("X_SYNTH_STATE_DIR", "")
    lifecycle, runtime_running = _native_lifecycle()
    return _HealthContext(
        budget, resolved, stock_path, evidence_path, state_path, lifecycle, runtime_running,
        os.environ.get(SEARCH_KEY_VARIABLE, ""),
        os.environ.get("X_SYNTH_ASKCOS_MODELS", "pistachio,pistachio_ringbreaker"),
    )


def _cached_status(context: _HealthContext) -> dict | None:
    with _cache_lock:
        cached = _cache.get(context.identity)
        if not cached or time.monotonic() - cached[0] >= context.budget.health_cache_seconds:
            return None
        result = deepcopy(cached[1])
    if _health_context().identity != context.identity:
        return None
    with _cache_lock:
        if (_cache.get(context.identity) is not cached
                or time.monotonic() - cached[0] >= context.budget.health_cache_seconds):
            return None
    return result


@contextmanager
def _refresh_slot(cancel: Event | None):
    if cancel is None:
        _refresh_lock.acquire()
    else:
        timeout = min(CANCEL_POLL_SECONDS, PerformanceBudget.from_environment().health_timeout_seconds)
        while not _refresh_lock.acquire(timeout=timeout):
            if cancel.is_set():
                raise CancelledError("Runtime readiness refresh stopped")
    try:
        if cancel is not None and cancel.is_set():
            raise CancelledError("Runtime readiness refresh stopped")
        yield
    finally:
        _refresh_lock.release()


def _probe_status(context: _HealthContext, cancel: Event | None) -> dict:
    budget = context.budget
    with ThreadPoolExecutor(max_workers=len(context.resolved)) as executor:
        futures = {}
        for name, endpoint in context.resolved.items():
            if name in {"mcts", "retro_star"}:
                futures[name] = executor.submit(
                    _probe_search, endpoint.url, budget.health_timeout_seconds,
                    strategy=name, key=context.search_key, _cancel=cancel,
                )
            else:
                futures[name] = executor.submit(
                    _probe, endpoint.readiness_url, budget.health_timeout_seconds,
                    require_ready=True, _cancel=cancel,
                )
        replies = {name: future.result() for name, future in futures.items()}
    checks = {name: reply[0] for name, reply in replies.items()}
    errors = {name: "dependency_unavailable" for name, ready in checks.items() if not ready}
    snapshot = None
    try:
        snapshot = StockIndex(context.stock_path).summary if context.stock_path else None
        checks["commercial_stock"] = snapshot is not None
    except StockIndexError:
        checks["commercial_stock"] = False
    if not checks["commercial_stock"]:
        errors["commercial_stock"] = "exact_catalog_index_unavailable"
    gateway_snapshot = replies["gateway"][1].get("stock_snapshot") or {}
    checks["inventory_consistent"] = (
        bool(snapshot) and isinstance(gateway_snapshot, dict) and all(
            gateway_snapshot.get(key) == snapshot.get(key)
            for key in ("source_sha256", "catalog_sha256", "source_id", "unique_structures")
        )
    )
    if not checks["inventory_consistent"]:
        errors["inventory_consistent"] = "search_and_review_stock_mismatch"
    checks["reaction_evidence_consistent"] = _evidence_dependency_ready(
        context.evidence_path, replies["expand_one"][1].get("evidence_source"),
    )
    if not checks["reaction_evidence_consistent"]:
        errors["reaction_evidence_consistent"] = "search_and_review_reaction_evidence_mismatch"
    configured = {value.strip() for value in context.models.split(",") if value.strip()}
    loaded = replies["template_relevance"][1].get("models") or {}
    checks["configured_models_loaded"] = (
        bool(configured) and isinstance(loaded, dict) and configured.issubset(loaded)
    )
    if not checks["configured_models_loaded"]:
        errors["configured_models_loaded"] = "configured_model_not_loaded"
    available = [
        name for name in ("mcts", "retro_star")
        if checks[name] and (name != "retro_star" or checks["value_network"])
    ]
    if not context.runtime_running:
        errors["native_runtime"] = "native_runtime_not_running"
        available = []
    ready = context.runtime_running and _route_dependencies_ready(checks) and bool(available)
    return {
        "route_search_ready": ready,
        "backends": {"askcos_v2": ready},
        "service_checks": checks,
        "dependency_errors": errors,
        "stock_snapshot": snapshot,
        "performance_budget": budget.summary(),
        "available_strategies": available,
    }


def route_runtime_status(
    repo_root: Path, *, force: bool = False, _cancel: HealthCancellation | None = None
) -> dict:
    """ASKCOS is the sole engine. Documentation pages are not model readiness."""
    if not force:
        cached = _cached_status(_health_context())
        if cached is not None:
            return cached
    with _refresh_slot(_cancel):
        try:
            context = _health_context()
            if not force:
                cached = _cached_status(context)
                if cached is not None:
                    return cached
            result = _probe_status(context, _cancel)
            if _cancel is not None and _cancel.is_set():
                raise CancelledError("Runtime readiness refresh stopped")
            if _health_context().identity != context.identity:
                result.update(route_search_ready=False, backends={"askcos_v2": False}, available_strategies=[])
                result["dependency_errors"]["native_runtime"] = "native_runtime_generation_changed"
                with _cache_lock:
                    _cache.clear()
                return deepcopy(result)
            with _cache_lock:
                with _cancel.commit() if _cancel is not None else nullcontext():
                    _cache.clear()
                    _cache[context.identity] = (time.monotonic(), result)
            return deepcopy(result)
        except Exception:
            with _cache_lock:
                _cache.clear()
            raise
