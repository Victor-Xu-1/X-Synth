import os
import subprocess
import sys
from pathlib import Path

import pytest

from packages.orchestrator import runtime_health
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

    def probe(url, timeout, *, require_ready):
        calls.append(url)
        return True, {"status": "ready", "stock_snapshot": snapshot, "models": {"pistachio": {}, "pistachio_ringbreaker": {}}}

    monkeypatch.setattr(runtime_health, "_probe", probe)

    def child_probe(url, timeout, *, strategy, key):
        return probe(url + NATIVE_SEARCH_READY_PATH, timeout, require_ready=True)

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

    def child_probe(url, timeout, *, strategy, key):
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
