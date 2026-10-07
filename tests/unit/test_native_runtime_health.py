import json
import os
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Event, Thread, current_thread
from types import SimpleNamespace

import pytest

from packages.orchestrator import runtime_health
from packages.orchestrator.runtime_health import _probe as http_probe
from packages.platform.atomic_file import write_json
from packages.platform.native_endpoints import resolve_native_endpoints
from packages.platform.native_search_contract import NATIVE_SEARCH_READY_PATH
from packages.platform.resource_metrics import process_identity


@pytest.fixture
def health(tmp_path, monkeypatch):
    for key in list(os.environ):
        if key in {"GATEWAY_URL", "X_SYNTH_STATE_DIR", "X_SYNTH_ASKCOS_MODELS", "X_SYNTH_STOCK_INDEX", "X_SYNTH_REACTION_LIBRARY_DB"} or key.endswith("_URL") and key.startswith("X_SYNTH_"):
            monkeypatch.delenv(key)
    monkeypatch.setenv("X_SYNTH_STATE_DIR", str(tmp_path))
    monkeypatch.setenv("X_SYNTH_STOCK_INDEX", "controlled-stock-fixture")
    monkeypatch.setenv("X_SYNTH_NATIVE_SEARCH_KEY", "synthetic-fixture-key-" + "x" * 32)
    snapshot = {"source_sha256": "source", "catalog_sha256": "catalog", "source_id": "fixture", "unique_structures": 1}
    monkeypatch.setattr(runtime_health, "StockIndex", lambda _path: type("FixtureStock", (), {"summary": snapshot})())
    calls = []

    def probe(url, timeout, *, require_ready, _cancel=None):
        calls.append(url)
        return True, {"status": "ready", "stock_snapshot": snapshot, "models": {"pistachio": {}, "pistachio_ringbreaker": {}}}

    monkeypatch.setattr(runtime_health, "_probe", probe)

    def child_probe(url, timeout, *, strategy, key, _cancel=None):
        return probe(url + NATIVE_SEARCH_READY_PATH, timeout, require_ready=True, _cancel=_cancel)

    monkeypatch.setattr(runtime_health, "_probe_search", child_probe)
    runtime_health._cache.clear()
    manifest = {
        "schema_version": 1, "generation": "generation-one", "revision": 1, "status": "running",
        "boot_id": Path("/proc/sys/kernel/random/boot_id").read_text().strip(),
        "supervisor": process_identity(os.getpid()), "services": {},
    }
    write_json(tmp_path / "native/runtime.json", manifest)
    yield tmp_path, calls, manifest
    runtime_health._cache.clear()


def test_cache_is_scoped_to_runtime_generation_and_lifecycle_revision(health):
    state, calls, manifest = health
    assert runtime_health.route_runtime_status(state)["route_search_ready"]
    count = len(calls)
    assert count == 13
    result = runtime_health.route_runtime_status(state)
    result["service_checks"]["gateway"] = False
    assert runtime_health.route_runtime_status(state)["service_checks"]["gateway"]
    assert len(calls) == count
    manifest["generation"] = "generation-two"
    write_json(state / "native/runtime.json", manifest)
    assert runtime_health.route_runtime_status(state)["route_search_ready"]
    assert len(calls) == 2 * count
    manifest["revision"] += 1
    write_json(state / "native/runtime.json", manifest)
    runtime_health.route_runtime_status(state)
    assert len(calls) == 3 * count


@pytest.mark.parametrize("status", ["starting", "stopping", "stopped", "failed"])
def test_non_running_lifecycle_cannot_reuse_ready_cache(health, status):
    state, calls, manifest = health
    assert runtime_health.route_runtime_status(state)["route_search_ready"]
    manifest.update(status=status, revision=2)
    write_json(state / "native/runtime.json", manifest)
    result = runtime_health.route_runtime_status(state)
    assert not result["route_search_ready"]
    assert result["available_strategies"] == []
    assert result["dependency_errors"]["native_runtime"] == "native_runtime_not_running"
    assert len(calls) == 26


def test_supervisor_start_identity_change_invalidates_cache_without_manifest_write(health):
    state, calls, manifest = health
    child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"], start_new_session=True)
    try:
        manifest["supervisor"] = process_identity(child.pid)
        write_json(state / "native/runtime.json", manifest)
        assert runtime_health.route_runtime_status(state)["route_search_ready"]
        child.kill()
        child.wait(timeout=2)
        assert not runtime_health.route_runtime_status(state)["route_search_ready"]
        assert len(calls) == 26
    finally:
        if child.poll() is None:
            child.kill()
        child.wait(timeout=2)


def test_readiness_consumes_registry_overrides_and_matching_gateway_alias(health, monkeypatch):
    state, calls, _ = health
    monkeypatch.setenv("X_SYNTH_MCTS_URL", "http://localhost:18311/")
    monkeypatch.setenv("GATEWAY_URL", "http://127.0.0.1:18100")
    runtime_health.route_runtime_status(state)
    expected = {endpoint.url + NATIVE_SEARCH_READY_PATH if name in {"mcts", "retro_star"} else endpoint.readiness_url
                for name, endpoint in resolve_native_endpoints().items()}
    assert set(calls) == expected
    assert "http://127.0.0.1:18311/api/search-jobs/ready" in calls
    assert "http://127.0.0.1:18100/health/ready" in calls


def test_generation_change_during_probe_never_publishes_or_caches_old_ready_result(health, monkeypatch):
    state, calls, manifest = health
    probe = runtime_health._probe

    def replacing_probe(*args, **kwargs):
        if args[0].endswith(":9100/health/ready"):
            manifest.update(generation="new-generation", revision=2)
            write_json(state / "native/runtime.json", manifest)
        return probe(*args, **kwargs)

    monkeypatch.setattr(runtime_health, "_probe", replacing_probe)
    result = runtime_health.route_runtime_status(state)
    assert not result["route_search_ready"]
    assert result["dependency_errors"]["native_runtime"] == "native_runtime_generation_changed"
    assert not runtime_health._cache
    monkeypatch.setattr(runtime_health, "_probe", probe)
    assert runtime_health.route_runtime_status(state)["route_search_ready"]
    assert len(calls) == 26


def test_missing_or_wrong_key_cannot_reuse_cached_authenticated_readiness(health, monkeypatch):
    state, calls, _ = health
    expected = os.environ["X_SYNTH_NATIVE_SEARCH_KEY"]

    def child_probe(url, timeout, *, strategy, key, _cancel=None):
        calls.append(url + NATIVE_SEARCH_READY_PATH)
        return bool(key == expected), {"status": "ready"}

    monkeypatch.setattr(runtime_health, "_probe_search", child_probe)
    assert runtime_health.route_runtime_status(state)["route_search_ready"]
    monkeypatch.setenv("X_SYNTH_NATIVE_SEARCH_KEY", "wrong-synthetic-fixture-key-" + "y" * 32)
    wrong = runtime_health.route_runtime_status(state)
    assert not wrong["route_search_ready"] and not wrong["available_strategies"]
    assert len(calls) == 26
    monkeypatch.delenv("X_SYNTH_NATIVE_SEARCH_KEY")
    assert not runtime_health.route_runtime_status(state)["route_search_ready"]
    assert len(calls) == 39
    monkeypatch.setenv("X_SYNTH_NATIVE_SEARCH_KEY", expected)
    assert runtime_health.route_runtime_status(state)["route_search_ready"]
    assert len(calls) == 52
    if expected in repr(runtime_health._cache):
        pytest.fail("Readiness cache retained the plaintext internal key")


@pytest.mark.parametrize("invalid", [{"generation": []}, {"revision": "1"}, {"status": {}}, {"boot_id": None}])
def test_malformed_lifecycle_cannot_poison_cache_or_claim_ready(health, invalid):
    state, _, manifest = health
    manifest.update(invalid)
    write_json(state / "native/runtime.json", manifest)
    assert not runtime_health.route_runtime_status(state)["route_search_ready"]


def route_dependencies():
    return dict.fromkeys((
        "gateway", "expand_one", "template_relevance", "fast_filter",
        "commercial_stock", "scscore", "pathway_ranker", "cluster",
        "inventory_consistent", "configured_models_loaded", "forward_predictor",
    ), True)


@pytest.mark.parametrize("missing", ["forward_predictor", "fast_filter", "commercial_stock", "inventory_consistent"])
def test_route_admission_requires_every_search_and_qualification_dependency(missing):
    checks = route_dependencies()
    assert runtime_health._route_dependencies_ready(checks)
    checks[missing] = False
    assert not runtime_health._route_dependencies_ready(checks)
    checks.pop(missing)
    assert not runtime_health._route_dependencies_ready(checks)


def test_optional_scientific_tools_do_not_block_fully_verifiable_routes():
    checks = {**route_dependencies(), "condition_recommender": False, "impurity": False}
    assert runtime_health._route_dependencies_ready(checks)


@pytest.mark.parametrize("invalid", [None, "ready", 1])
def test_qualification_dependency_cannot_claim_readiness_with_truthy_nonboolean(invalid):
    checks = route_dependencies()
    checks["forward_predictor"] = invalid
    assert not runtime_health._route_dependencies_ready(checks)


@pytest.fixture
def control_plane(health, monkeypatch):
    source = SimpleNamespace(
        block=Event(), entered=Event(), release=Event(), ready=True, requests=[], handlers=[],
    )
    snapshot = runtime_health.StockIndex("controlled-stock-fixture").summary

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            source.handlers.append(current_thread())
            assert self.path == "/health/ready"
            source.requests.append(self.path)
            if source.block.is_set():
                source.entered.set()
                source.release.wait(2)
            payload = json.dumps({
                "status": "ready" if source.ready else "unavailable",
                "stock_snapshot": snapshot,
            }).encode()
            self.send_response(200 if source.ready else 503)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            try:
                self.wfile.write(payload)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def log_message(self, *_args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    server.daemon_threads = False
    serving = Thread(target=lambda: server.serve_forever(poll_interval=0.01))
    serving.start()
    endpoint = f"http://127.0.0.1:{server.server_port}"
    monkeypatch.setenv("X_SYNTH_ASKCOS_URL", endpoint)
    previous = runtime_health._probe

    def probe(url, timeout, *, require_ready, _cancel=None):
        if url == endpoint + "/health/ready":
            return http_probe(url, timeout, require_ready=require_ready, _cancel=_cancel)
        return previous(url, timeout, require_ready=require_ready, _cancel=_cancel)

    monkeypatch.setattr(runtime_health, "_probe", probe)
    try:
        yield source
    finally:
        source.release.set()
        server.shutdown()
        serving.join(timeout=2)
        server.server_close()
        assert not serving.is_alive()
        assert all(not handler.is_alive() for handler in source.handlers)


def test_healthy_cached_read_does_not_wait_for_real_http_refresh(health, control_plane):
    state, _, _ = health
    assert runtime_health.route_runtime_status(state)["route_search_ready"]
    control_plane.block.set()
    with ThreadPoolExecutor(max_workers=2) as executor:
        refresh = executor.submit(runtime_health.route_runtime_status, state, force=True)
        try:
            assert control_plane.entered.wait(1)
            started = time.monotonic()
            read = executor.submit(runtime_health.route_runtime_status, state)
            assert read.result(timeout=0.25)["route_search_ready"]
            assert time.monotonic() - started < 0.25
            assert not refresh.done()
        finally:
            control_plane.release.set()
        assert refresh.result(timeout=2)["route_search_ready"]


@pytest.mark.parametrize("cache_state", ["missing", "expired"])
def test_missing_or_expired_cache_never_returns_old_ready_during_refresh(
    health, control_plane, cache_state
):
    state, _, _ = health
    assert runtime_health.route_runtime_status(state)["route_search_ready"]
    with runtime_health._cache_lock:
        if cache_state == "missing":
            runtime_health._cache.clear()
        else:
            key, (_, snapshot) = next(iter(runtime_health._cache.items()))
            runtime_health._cache[key] = (time.monotonic() - 11, snapshot)
    control_plane.ready = False
    control_plane.block.set()
    with ThreadPoolExecutor(max_workers=2) as executor:
        refresh = executor.submit(runtime_health.route_runtime_status, state, force=True)
        try:
            assert control_plane.entered.wait(1)
            read = executor.submit(runtime_health.route_runtime_status, state)
            with pytest.raises(TimeoutError):
                read.result(timeout=0.1)
        finally:
            control_plane.release.set()
        assert not refresh.result(timeout=2)["route_search_ready"]
        result = read.result(timeout=2)
        assert not result["route_search_ready"]
        assert result["dependency_errors"]["gateway"] == "dependency_unavailable"


def test_forced_refresh_propagates_failure_and_invalidates_previous_ready(health, monkeypatch):
    state, _, _ = health
    assert runtime_health.route_runtime_status(state)["route_search_ready"]

    def failed_probe(*_args, **_kwargs):
        raise RuntimeError("controlled readiness failure")

    monkeypatch.setattr(runtime_health, "_probe", failed_probe)
    with pytest.raises(RuntimeError, match="controlled readiness failure"):
        runtime_health.route_runtime_status(state, force=True)
    assert not runtime_health._cache


def test_cached_result_checks_identity_again_before_return(health, monkeypatch):
    state, _, manifest = health
    assert runtime_health.route_runtime_status(state)["route_search_ready"]
    lifecycle = runtime_health._native_lifecycle
    reads = []

    def changing_lifecycle():
        token = lifecycle()
        reads.append(token)
        if len(reads) == 1:
            manifest.update(status="stopped", revision=2)
            write_json(state / "native/runtime.json", manifest)
        return token

    monkeypatch.setattr(runtime_health, "_native_lifecycle", changing_lifecycle)
    assert not runtime_health.route_runtime_status(state)["route_search_ready"]
    assert len(reads) >= 2


def test_cache_invalidation_during_fast_validation_cannot_return_detached_ready_copy(
    health, monkeypatch
):
    state, calls, _ = health
    assert runtime_health.route_runtime_status(state)["route_search_ready"]
    lifecycle = runtime_health._native_lifecycle
    reads = []

    def invalidating_lifecycle():
        reads.append(True)
        if len(reads) == 2:
            with runtime_health._cache_lock:
                runtime_health._cache.clear()
        return lifecycle()

    monkeypatch.setattr(runtime_health, "_native_lifecycle", invalidating_lifecycle)
    assert runtime_health.route_runtime_status(state)["route_search_ready"]
    assert len(calls) == 26


def test_entry_expiring_during_cache_copy_requires_new_probes(health, monkeypatch):
    state, calls, _ = health
    assert runtime_health.route_runtime_status(state)["route_search_ready"]
    with runtime_health._cache_lock:
        key, (_, snapshot) = next(iter(runtime_health._cache.items()))
        runtime_health._cache[key] = (time.monotonic() - 9.99, snapshot)
    previous = runtime_health.deepcopy
    delayed = []

    def copying(value):
        if not delayed and isinstance(value, dict) and "route_search_ready" in value:
            delayed.append(True)
            time.sleep(0.02)
        return previous(value)

    monkeypatch.setattr(runtime_health, "deepcopy", copying)
    assert runtime_health.route_runtime_status(state)["route_search_ready"]
    assert len(calls) == 26


def test_config_change_during_probe_never_caches_mixed_configuration(health, monkeypatch):
    state, _, _ = health
    previous = runtime_health._probe

    def changing_probe(*args, **kwargs):
        if args[0].endswith(":9100/health/ready"):
            monkeypatch.setenv("X_SYNTH_ASKCOS_MODELS", "unloaded-model")
        return previous(*args, **kwargs)

    monkeypatch.setattr(runtime_health, "_probe", changing_probe)
    result = runtime_health.route_runtime_status(state)
    assert not result["route_search_ready"]
    assert not runtime_health._cache


def test_concurrent_cold_reads_share_one_real_probe_round(health, control_plane):
    state, _, _ = health
    control_plane.block.set()
    with ThreadPoolExecutor(max_workers=8) as executor:
        reads = [executor.submit(runtime_health.route_runtime_status, state) for _ in range(8)]
        try:
            assert control_plane.entered.wait(1)
            assert len(control_plane.requests) == 1
        finally:
            control_plane.release.set()
        assert all(read.result(timeout=2)["route_search_ready"] for read in reads)
    assert len(control_plane.requests) == 1


def test_concurrent_forced_calls_each_perform_real_probes(health, control_plane):
    state, _, _ = health
    assert runtime_health.route_runtime_status(state)["route_search_ready"]
    with ThreadPoolExecutor(max_workers=4) as executor:
        reads = [executor.submit(runtime_health.route_runtime_status, state, force=True) for _ in range(4)]
        assert all(read.result(timeout=2)["route_search_ready"] for read in reads)
    assert len(control_plane.requests) == 5


@pytest.mark.parametrize("name,value", [
    ("X_SYNTH_HEALTH_CACHE_SECONDS", "1"),
    ("X_SYNTH_MODEL_THREADS", "2"),
])
def test_exact_budget_changes_do_not_return_previous_cached_budget(health, monkeypatch, name, value):
    state, calls, _ = health
    runtime_health.route_runtime_status(state)
    monkeypatch.setenv(name, value)
    result = runtime_health.route_runtime_status(state)
    assert result["performance_budget"][name.removeprefix("X_SYNTH_").lower()] == float(value)
    assert len(calls) == 26


def test_auth_change_while_copying_cache_never_returns_previous_authenticated_ready(health, monkeypatch):
    state, _, _ = health
    expected = os.environ["X_SYNTH_NATIVE_SEARCH_KEY"]
    monkeypatch.setattr(runtime_health, "_probe_search", lambda url, timeout, **kwargs: (
        kwargs["key"] == expected, {"status": "ready"}
    ))
    assert runtime_health.route_runtime_status(state)["route_search_ready"]
    previous = runtime_health.deepcopy
    changed = []

    def copying(value):
        result = previous(value)
        if not changed and isinstance(value, dict) and "route_search_ready" in value:
            changed.append(True)
            monkeypatch.setenv("X_SYNTH_NATIVE_SEARCH_KEY", "changed-control-plane-key-" + "z" * 32)
        return result

    monkeypatch.setattr(runtime_health, "deepcopy", copying)
    assert not runtime_health.route_runtime_status(state)["route_search_ready"]


@pytest.mark.parametrize("dependency", [
    "gateway", "forward_predictor", "configured_models_loaded",
    "commercial_stock", "inventory_consistent", "reaction_evidence_consistent",
])
def test_refresh_keeps_every_required_source_failure_not_ready(health, monkeypatch, dependency):
    state, _, _ = health
    previous = runtime_health._probe

    def probe(url, timeout, *, require_ready, _cancel=None):
        ready, payload = previous(url, timeout, require_ready=require_ready, _cancel=_cancel)
        if dependency == "gateway" and url.endswith(":9100/health/ready"):
            return False, {"status": "unavailable"}
        if dependency == "forward_predictor" and url.endswith(":9911/health/ready"):
            return False, {"status": "unavailable"}
        if dependency == "configured_models_loaded" and url.endswith(":19410/health/ready"):
            payload = {**payload, "models": {}}
        if dependency == "inventory_consistent" and url.endswith(":9100/health/ready"):
            payload = {**payload, "stock_snapshot": {**payload["stock_snapshot"], "catalog_sha256": "other"}}
        return ready, payload

    monkeypatch.setattr(runtime_health, "_probe", probe)
    if dependency == "commercial_stock":
        monkeypatch.delenv("X_SYNTH_STOCK_INDEX")
    if dependency == "reaction_evidence_consistent":
        monkeypatch.setenv("X_SYNTH_REACTION_LIBRARY_DB", str(state / "absent-evidence.sqlite"))
    result = runtime_health.route_runtime_status(state, force=True)
    assert result["service_checks"][dependency] is False
    assert not result["route_search_ready"]
    assert not result["backends"]["askcos_v2"]


@pytest.mark.parametrize("field,value,endpoint,check", [
    ("stock_snapshot", "synthetic-invalid-stock-metadata", ":9100", "inventory_consistent"),
    ("models", 7, ":19410", "configured_models_loaded"),
])
def test_invalid_dependency_metadata_is_not_ready_and_can_recover(
    health, monkeypatch, field, value, endpoint, check
):
    state, _, _ = health
    previous = runtime_health._probe

    def probe(url, timeout, *, require_ready, _cancel=None):
        ready, payload = previous(url, timeout, require_ready=require_ready, _cancel=_cancel)
        if url.endswith(endpoint + "/health/ready"):
            payload = {**payload, field: value}
        return ready, payload

    monkeypatch.setattr(runtime_health, "_probe", probe)
    result = runtime_health.route_runtime_status(state, force=True)
    assert result["service_checks"][check] is False
    assert result["route_search_ready"] is False
    monkeypatch.setattr(runtime_health, "_probe", previous)
    assert runtime_health.route_runtime_status(state, force=True)["route_search_ready"] is True
