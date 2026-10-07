import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from threading import Event, Thread, current_thread

import pytest
from fastapi.testclient import TestClient

from apps.api import app as product_api
from packages.orchestrator import runtime_health
from packages.orchestrator.health_refresh import RuntimeHealthRefresh
from packages.platform.performance import PerformanceBudget
from test_native_runtime_health import control_plane, health
from test_health_probe import PROTOCOL_SECRET, owned_probe_sockets, trickling_server


def refresher(probe, *, ttl=0.1, timeout=0.05):
    return RuntimeHealthRefresh(
        lambda _cancel: probe(),
        budget=PerformanceBudget(health_cache_seconds=ttl, health_timeout_seconds=timeout)
    )


def test_startup_finishes_initial_probe_before_thread_is_started():
    entered, release, finished = Event(), Event(), Event()

    def probe():
        entered.set()
        assert release.wait(1)

    refresh = refresher(probe)
    owner = Thread(target=lambda: (refresh.start(), finished.set()))
    owner.start()
    try:
        assert entered.wait(1)
        assert not finished.is_set()
        assert refresh.thread is None
    finally:
        release.set()
        owner.join(timeout=2)
        refresh.stop()
    assert finished.is_set()
    assert not owner.is_alive()
    assert not refresh.thread.is_alive()


def test_refresh_is_proactive_and_shutdown_interrupts_cadence_wait():
    calls, repeated = [], Event()

    def probe():
        calls.append(1)
        if len(calls) == 2:
            repeated.set()

    refresh = refresher(probe)
    try:
        refresh.start()
        assert repeated.wait(0.3)
        assert refresh.interval == pytest.approx(0.05)
        assert refresh.thread.is_alive()
        with pytest.raises(RuntimeError, match="already started"):
            refresh.start()
        assert len(calls) >= 2
    finally:
        refresh.stop()
    assert not refresh.thread.is_alive()
    assert len(calls) >= 2


def test_owned_refresh_can_stop_while_waiting_for_another_refresh_lock(health):
    state, _, _ = health
    entered = Event()
    calls = []

    def probe(cancel):
        calls.append(1)
        if len(calls) == 2:
            entered.set()
        return runtime_health.route_runtime_status(state, force=True, _cancel=cancel)

    refresh = RuntimeHealthRefresh(probe, budget=PerformanceBudget(health_cache_seconds=0.1))
    refresh.start()
    try:
        with runtime_health._refresh_lock:
            assert entered.wait(1)
            started = time.monotonic()
            refresh.stop()
            assert time.monotonic() - started < 0.5
            assert not refresh.thread.is_alive()
    finally:
        refresh.stop()


@pytest.fixture
def application(health, control_plane, monkeypatch):
    state, _, _ = health
    monkeypatch.setattr(product_api.OptimizationRuntime, "health", lambda optimizer: optimizer.health_snapshot())
    application = product_api.create_app(jobs_root=state)
    assert application.state.pipeline is None
    return application


def test_api_lifespan_uses_real_initial_probe_and_hot_reads_do_not_wait(
    health, control_plane, application
):
    state, _, _ = health
    assert runtime_health.route_runtime_status(state)["route_search_ready"]
    assert len(control_plane.requests) == 1
    with TestClient(application, base_url="http://127.0.0.1") as browser:
        owner = application.state.health_refresh
        assert owner.thread.is_alive()
        assert len(control_plane.requests) == 2
        control_plane.block.set()
        with ThreadPoolExecutor(max_workers=1) as executor:
            refresh = executor.submit(runtime_health.route_runtime_status, state, force=True)
            try:
                assert control_plane.entered.wait(1)
                timings = []
                for _ in range(30):
                    started = time.monotonic()
                    response = browser.get("/api/v1/health")
                    timings.append((time.monotonic() - started) * 1000)
                    assert response.status_code == 200
                    payload = response.json()
                    assert payload["service_checks"]["gateway"] is True
                    assert payload["route_search_ready"] is False
                    assert payload["worker_ready"] is False
                p95 = sorted(timings)[28]
                print(f"controlled_api_health_hot_read_p95_ms={p95:.3f} max_ms={max(timings):.3f}")
                assert p95 <= 250
                assert not refresh.done()
            finally:
                control_plane.release.set()
            assert refresh.result(timeout=2)["route_search_ready"]
    assert not owner.thread.is_alive()


def test_api_lifespan_exception_still_stops_its_owned_thread(application):
    with pytest.raises(ValueError, match="controlled lifespan body error"):
        with TestClient(application):
            raise ValueError("controlled lifespan body error")
    assert not application.state.health_refresh.thread.is_alive()


def test_api_startup_probe_failure_cannot_reuse_old_ready_or_start_thread(
    health, application, monkeypatch
):
    state, _, _ = health
    assert runtime_health.route_runtime_status(state)["route_search_ready"]

    def fail(*_args, **_kwargs):
        raise RuntimeError("controlled startup probe failure")

    monkeypatch.setattr(runtime_health, "_probe", fail)
    with pytest.raises(RuntimeError, match="controlled startup probe failure"):
        with TestClient(application):
            pytest.fail("A failed initial probe reached the serving lifespan")
    assert application.state.health_refresh.thread is None
    assert not runtime_health._cache


def test_api_background_failure_is_an_error_not_a_successful_health_response(
    health, control_plane, monkeypatch
):
    state, _, _ = health
    monkeypatch.setenv("X_SYNTH_HEALTH_CACHE_SECONDS", "0.2")
    monkeypatch.setattr(product_api.OptimizationRuntime, "health", lambda optimizer: optimizer.health_snapshot())
    application = product_api.create_app(jobs_root=state)
    previous = runtime_health._probe
    failing, failed = Event(), Event()

    def probe(*args, **kwargs):
        if failing.is_set():
            failed.set()
            raise RuntimeError("controlled periodic probe failure")
        return previous(*args, **kwargs)

    monkeypatch.setattr(runtime_health, "_probe", probe)
    with pytest.raises(RuntimeError, match="readiness refresh failed"):
        with TestClient(application, raise_server_exceptions=False) as browser:
            failing.set()
            assert failed.wait(1)
            application.state.health_refresh.thread.join(timeout=1)
            assert browser.get("/api/v1/health").status_code == 500
            assert not runtime_health._cache
    assert not application.state.health_refresh.thread.is_alive()


def test_initial_probe_failure_propagates_without_creating_worker():
    def probe():
        raise ValueError("controlled initial probe failure")

    refresh = refresher(probe)
    with pytest.raises(ValueError, match="controlled initial probe failure"):
        refresh.start()
    assert refresh.thread is None
    refresh.stop()


def test_background_probe_failure_is_not_swallowed_or_retried():
    calls, failed = [], Event()

    def probe():
        calls.append(1)
        if len(calls) == 2:
            failed.set()
            raise ValueError("controlled periodic probe failure")

    refresh = refresher(probe)
    refresh.start()
    assert failed.wait(0.3)
    refresh.thread.join(timeout=1)
    assert not refresh.thread.is_alive()
    with pytest.raises(RuntimeError, match="readiness refresh failed"):
        refresh.check()
    with pytest.raises(RuntimeError, match="readiness refresh failed"):
        refresh.stop()
    assert len(calls) == 2


def test_shutdown_waits_for_owned_inflight_probe_and_never_leaves_thread():
    calls, entered, release, stopped = [], Event(), Event(), Event()

    def probe():
        calls.append(1)
        if len(calls) == 2:
            entered.set()
            assert release.wait(1)

    refresh = refresher(probe, timeout=1)
    refresh.start()
    assert entered.wait(0.3)
    shutdown = Thread(target=lambda: (refresh.stop(), stopped.set()))
    shutdown.start()
    try:
        assert not stopped.wait(0.03)
    finally:
        release.set()
        shutdown.join(timeout=2)
    assert stopped.is_set()
    assert not shutdown.is_alive()
    assert not refresh.thread.is_alive()
    assert len(calls) == 2


def test_clean_lifespan_reentry_performs_a_new_initial_probe():
    calls = []
    refresh = refresher(lambda: calls.append(1), ttl=10)
    for _ in range(2):
        refresh.start()
        refresh.stop()
        assert not refresh.thread.is_alive()
    assert len(calls) == 2


def test_concurrent_starts_create_only_one_owned_refresh_thread():
    entered, release = Event(), Event()
    calls = []

    def probe():
        calls.append(1)
        entered.set()
        assert release.wait(1)

    refresh = refresher(probe, ttl=10)
    with ThreadPoolExecutor(max_workers=2) as executor:
        first = executor.submit(refresh.start)
        try:
            assert entered.wait(1)
            second = executor.submit(refresh.start)
        finally:
            release.set()
        try:
            first.result(timeout=2)
            with pytest.raises(RuntimeError, match="already started"):
                second.result(timeout=2)
            assert len(calls) == 1
        finally:
            refresh.stop()
    assert not refresh.thread.is_alive()


def test_shutdown_budget_failure_is_observable_and_cannot_allow_duplicate_owner():
    entered, release = Event(), Event()
    calls = []

    def probe():
        calls.append(1)
        if len(calls) == 2:
            entered.set()
            assert release.wait(2)

    refresh = refresher(probe)
    refresh.start()
    try:
        assert entered.wait(1)
        with pytest.raises(RuntimeError, match="did not stop within its budget"):
            refresh.stop()
        with pytest.raises(RuntimeError, match="readiness refresh failed"):
            refresh.check()
        with pytest.raises(RuntimeError, match="already started"):
            refresh.start()
    finally:
        release.set()
        refresh.thread.join(timeout=1)
        with pytest.raises(RuntimeError, match="readiness refresh failed"):
            refresh.stop()
    assert not refresh.thread.is_alive()


def test_cancelled_owned_http_refresh_cannot_publish_after_shutdown(health, control_plane):
    state, _, _ = health
    owner = RuntimeHealthRefresh(
        lambda cancel: runtime_health.route_runtime_status(state, force=True, _cancel=cancel),
        budget=PerformanceBudget(health_cache_seconds=0.1),
    )
    owner.start()
    control_plane.block.set()
    shutdown = Thread(target=owner.stop)
    try:
        assert control_plane.entered.wait(1)
        shutdown.start()
        assert owner._stopping.wait(1)
    finally:
        control_plane.release.set()
        if shutdown.ident is not None:
            shutdown.join(timeout=2)
        else:
            owner.stop()
    assert not shutdown.is_alive()
    assert not owner.thread.is_alive()
    assert not runtime_health._cache


def test_cancel_during_final_validation_cannot_commit_ready_cache(health, monkeypatch):
    state, _, _ = health
    entered, release = Event(), Event()
    validation_calls, shutdown_errors = [], []
    previous = runtime_health._health_context

    def context():
        value = previous()
        if current_thread().name == "runtime-health-refresh":
            validation_calls.append(1)
            if len(validation_calls) == 2:
                entered.set()
                assert release.wait(2)
        return value

    monkeypatch.setattr(runtime_health, "_health_context", context)
    owner = RuntimeHealthRefresh(
        lambda cancel: runtime_health.route_runtime_status(state, force=True, _cancel=cancel),
        budget=PerformanceBudget(health_cache_seconds=0.1),
    )

    def stop():
        try:
            owner.stop()
        except Exception as error:
            shutdown_errors.append(error)

    shutdown = Thread(target=stop)
    try:
        owner.start()
        assert entered.wait(1)
        shutdown.start()
        assert owner._stopping.wait(1)
        release.set()
        shutdown.join(timeout=2)
        assert not shutdown.is_alive()
        assert not owner.thread.is_alive()
        assert not shutdown_errors
        assert not runtime_health._cache
    finally:
        release.set()
        if shutdown.ident is not None:
            shutdown.join(timeout=2)
        owner.stop()


@pytest.mark.parametrize("fault", [
    "bad_status", "incomplete_length", "incomplete_chunk", "malformed_json", "recursive_json",
    "stock_shape", "model_shape",
])
def test_owned_worker_survives_real_protocol_failure_and_next_round_recovers(
    health, trickling_server, monkeypatch, caplog, fault
):
    state, _, _ = health
    endpoint = trickling_server.url.removesuffix("/health/ready")
    monkeypatch.setenv("X_SYNTH_ASKCOS_URL", endpoint)
    monkeypatch.setenv("X_SYNTH_TEMPLATE_URL", endpoint)
    trickling_server.stock_snapshot = runtime_health.StockIndex("controlled-stock-fixture").summary
    trickling_server.models = {"pistachio": {}, "pistachio_ringbreaker": {}}
    previous = runtime_health._probe
    from test_native_runtime_health import http_probe

    def probe(url, timeout, *, require_ready, _cancel=None):
        if url == trickling_server.url:
            return http_probe(url, timeout, require_ready=require_ready, _cancel=_cancel)
        return previous(url, timeout, require_ready=require_ready, _cancel=_cancel)

    monkeypatch.setattr(runtime_health, "_probe", probe)
    old_limit = sys.getrecursionlimit()
    if fault == "recursive_json":
        sys.setrecursionlimit(500)
        decoder = json.JSONDecoder()
        decoder.scan_once = json.scanner.py_make_scanner(decoder)
        monkeypatch.setattr(runtime_health.json, "loads", lambda raw: decoder.decode(
            raw.decode() if isinstance(raw, bytes) else raw,
        ))
    owner = RuntimeHealthRefresh(
        lambda cancel: runtime_health.route_runtime_status(state, force=True, _cancel=cancel),
        budget=PerformanceBudget(health_cache_seconds=0.1),
    )

    def wait_for_ready(expected):
        until = time.monotonic() + 1
        while time.monotonic() < until:
            owner.check()
            with runtime_health._cache_lock:
                entry = next(iter(runtime_health._cache.values()), None)
                if entry is not None and entry[1]["route_search_ready"] is expected:
                    return entry[1]
            time.sleep(0.005)
        pytest.fail("Owned health worker did not publish the expected readiness")

    try:
        owner.start()
        wait_for_ready(True)
        trickling_server.fault = fault
        unavailable = wait_for_ready(False)
        assert unavailable["backends"]["askcos_v2"] is False
        assert PROTOCOL_SECRET not in repr(unavailable)
        assert owner.thread.is_alive()
        trickling_server.fault = None
        wait_for_ready(True)
        assert owner.thread.is_alive()
        owner.check()
        assert PROTOCOL_SECRET not in caplog.text
    finally:
        try:
            owner.stop()
        finally:
            sys.setrecursionlimit(old_limit)
    assert not owner.thread.is_alive()


def test_owned_startup_can_be_cancelled_while_waiting_for_refresh_lock(health):
    from concurrent.futures import CancelledError

    state, _, _ = health
    entered = Event()
    failures = []

    def probe(cancel):
        entered.set()
        return runtime_health.route_runtime_status(state, force=True, _cancel=cancel)

    owner = RuntimeHealthRefresh(probe, budget=PerformanceBudget(health_cache_seconds=0.1))

    def start():
        try:
            owner.start()
        except Exception as error:
            failures.append(error)

    startup, shutdown = Thread(target=start), Thread(target=owner.stop)
    try:
        with runtime_health._refresh_lock:
            startup.start()
            assert entered.wait(1)
            shutdown.start()
            startup.join(timeout=0.4)
            shutdown.join(timeout=0.4)
            assert not startup.is_alive()
            assert not shutdown.is_alive()
        assert len(failures) == 1 and isinstance(failures[0], CancelledError)
        assert owner.thread is None
        assert not runtime_health._cache
    finally:
        owner._stopping.set()
        startup.join(timeout=2)
        if shutdown.ident is not None:
            shutdown.join(timeout=2)
        owner.stop()


def test_cancel_after_initial_probe_cannot_create_an_owned_thread():
    from concurrent.futures import CancelledError

    owner = RuntimeHealthRefresh(
        lambda cancel: cancel.set(), budget=PerformanceBudget(health_cache_seconds=0.1),
    )
    with pytest.raises(CancelledError):
        owner.start()
    assert owner.thread is None
    owner.stop()


def test_cancel_is_not_blocked_by_the_cache_commit_lock(health, monkeypatch):
    state, _, _ = health
    validated = Event()
    contexts = []
    previous = runtime_health._health_context

    def context():
        value = previous()
        if current_thread().name == "runtime-health-refresh":
            contexts.append(1)
            if len(contexts) == 2:
                validated.set()
        return value

    monkeypatch.setattr(runtime_health, "_health_context", context)
    owner = RuntimeHealthRefresh(
        lambda cancel: runtime_health.route_runtime_status(state, force=True, _cancel=cancel),
        budget=PerformanceBudget(health_cache_seconds=0.1),
    )
    owner.start()
    try:
        with runtime_health._cache_lock:
            assert validated.wait(1)
            owner._stopping.set()
            assert owner._stopping.is_set()
    finally:
        owner.stop()
    assert not owner.thread.is_alive()
    assert not runtime_health._cache


@pytest.mark.parametrize("phase", ["header", "body"])
def test_owned_shutdown_closes_a_trickling_response_without_server_release(
    health, trickling_server, monkeypatch, phase
):
    from test_native_runtime_health import http_probe

    state, _, _ = health
    endpoint = trickling_server.url.removesuffix("/health/ready")
    monkeypatch.setenv("X_SYNTH_ASKCOS_URL", endpoint)
    trickling_server.stock_snapshot = runtime_health.StockIndex("controlled-stock-fixture").summary
    previous = runtime_health._probe

    def probe(url, timeout, *, require_ready, _cancel=None):
        if url == trickling_server.url:
            return http_probe(url, timeout, require_ready=require_ready, _cancel=_cancel)
        return previous(url, timeout, require_ready=require_ready, _cancel=_cancel)

    monkeypatch.setattr(runtime_health, "_probe", probe)
    owner = RuntimeHealthRefresh(
        lambda cancel: runtime_health.route_runtime_status(state, force=True, _cancel=cancel),
        budget=PerformanceBudget(health_cache_seconds=0.1),
    )
    try:
        owner.start()
        trickling_server.phase = phase
        trickling_server.slow.set()
        assert trickling_server.entered.wait(1)
        started = time.monotonic()
        owner.stop()
        assert time.monotonic() - started < 0.4
        assert not owner.thread.is_alive()
        assert trickling_server.disconnected.wait(1)
        assert not runtime_health._cache
    finally:
        trickling_server.release.set()
        owner.stop()
