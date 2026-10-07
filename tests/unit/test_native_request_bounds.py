"""Exercise actual HTTP transports and native client schemas with controlled responses."""

import inspect
import threading
import time
from dataclasses import replace

import pytest

from native_rpc_helpers import expansion_client, local_http
from packages.adapters.askcos.engine import AskcosEngine
from packages.adapters.askcos.native_http import NativeCallCancelled, NativeProtocolError, NativeSession, native_call_context, post_json
from packages.adapters.askcos.native_search_jobs import ChildSearchBody, NativeSearchJobs
from packages.adapters.askcos.native_search_protocol import NATIVE_SEARCH_HEADER
from packages.adapters.askcos.transport import AskcosTransport, EngineUnavailable
from packages.orchestrator.route_request import RouteJobRequest
from packages.platform.performance import PerformanceBudget
from test_native_search_protocol import eventually, protocol_output


@pytest.fixture(params=["mcts", "retro_star"])
def expander(request, monkeypatch):
    return expansion_client(request.param, monkeypatch)


@pytest.mark.parametrize("enabled", [True, False])
def test_evidence_setting_survives_native_transport_without_default_substitution(expander, enabled):
    received = []

    def inspect_request(_handler, payload):
        received.append(payload)
        return 200, {"status_code": 200, "message": "transport-only", "result": []}, {}

    with local_http(inspect_request) as (url, _server):
        client = expander.ExpandOneAPI(url, request_timeout=1)
        try:
            assert client("CCO", expander.ExpandOneOptions(include_evidence_candidates=enabled)) == []
            assert received[0]["include_evidence_candidates"] is enabled
        finally:
            client.session.close()


@pytest.mark.parametrize("status,envelope,recoverable", [
    (503, {"detail": "outage"}, True),
    (422, {"detail": "invalid"}, False),
    (200, {"status_code": 500, "message": "unavailable", "result": []}, True),
    (200, {"status_code": 422, "message": "invalid", "result": []}, False),
    (200, {"status_code": 200, "message": "bad schema", "result": [{}]}, False),
    (200, b"invalid JSON", False),
])
def test_real_expansion_client_preserves_failure_class_without_repeating_post(expander, status, envelope, recoverable):
    with local_http(lambda *_: (status, envelope, {})) as (url, server):
        client = expander.ExpandOneAPI(url, request_timeout=1)
        try:
            with pytest.raises(expander.ExpandOneBackendError) as failure:
                client("CCO", expander.ExpandOneOptions())
            assert failure.value.recoverable is recoverable
            assert len(server.calls) == 1
            assert not hasattr(client, "max_retries")
        finally:
            client.session.close()


@pytest.mark.parametrize("status,expected", [(503, "interrupted"), (422, "failed")])
def test_wrapped_real_rpc_error_reaches_correct_child_state(expander, tmp_path, monkeypatch, status, expected):
    monkeypatch.setenv("X_SYNTH_STATE_DIR", str(tmp_path))
    with local_http(lambda *_: (status, {"detail": "controlled failure"}, {})) as (url, server):
        client = expander.ExpandOneAPI(url, request_timeout=1)

        def runner(payload, event, *_):
            client(payload["smiles"], expander.ExpandOneOptions(), cancel_event=event)

        jobs = NativeSearchJobs("wrapped_rpc_unit", runner)
        try:
            jobs.submit(ChildSearchBody(id="a" * 32, input={"smiles": "CCO"}))
            eventually(lambda: jobs.get("a" * 32)["status"] == expected)
            assert jobs.get("a" * 32)["error_code"] == ("native_dependency_unavailable" if expected == "interrupted" else "native_search_failed")
            assert len(server.calls) == 1
        finally:
            jobs.close()
            client.session.close()


@pytest.mark.parametrize("boundary", ["cancel", "deadline"])
def test_inflight_rpc_cancel_or_deadline_closes_wait_without_another_submission(expander, boundary):
    entered, release, cancellation = threading.Event(), threading.Event(), threading.Event()

    def delayed(*_):
        entered.set()
        release.wait(2)
        return 200, {"status_code": 200, "message": "ok", "result": []}, {}

    with local_http(delayed) as (url, server):
        client = expander.ExpandOneAPI(url, request_timeout=1)
        failures = []

        def run():
            try:
                client("CCO", expander.ExpandOneOptions(), cancel_event=cancellation,
                       deadline=time.monotonic() + (0.15 if boundary == "deadline" else 1))
            except Exception as error:
                failures.append(error)

        thread = threading.Thread(target=run)
        started = time.monotonic()
        try:
            thread.start()
            assert entered.wait(1)
            if boundary == "cancel":
                cancellation.set()
            thread.join(timeout=0.7)
            assert not thread.is_alive()
            assert time.monotonic() - started < 0.9
            assert len(server.calls) == 1
            if boundary == "cancel":
                assert isinstance(failures[0], NativeCallCancelled)
            else:
                assert isinstance(failures[0], expander.ExpandOneBackendError)
                assert failures[0].recoverable
        finally:
            release.set()
            thread.join(timeout=2)
            client.session.close()


def test_expired_deadline_does_not_submit(expander):
    with local_http(lambda *_: (200, {}, {})) as (url, server):
        client = expander.ExpandOneAPI(url)
        try:
            with pytest.raises(expander.ExpandOneBackendError):
                client("CCO", expander.ExpandOneOptions(), deadline=time.monotonic() - 1)
            assert server.calls == []
        finally:
            client.session.close()


@pytest.mark.parametrize("controlled", [False, True])
def test_native_http_enforces_request_and_response_bytes_and_rejects_redirects(controlled):
    budget = replace(PerformanceBudget(), request_bytes=64, response_bytes=64)
    session = NativeSession(budget=budget)
    control = {"deadline": time.monotonic() + 2} if controlled else {}
    try:
        with local_http(lambda *_: (200, b"x" * 65, {})) as (url, server):
            with pytest.raises(NativeProtocolError) as request:
                session.post(url, json={"input": "x" * 65}, **control)
            assert request.value.code == "native_request_too_large"
            assert server.calls == []
            with pytest.raises(NativeProtocolError) as response:
                session.get(url, **control)
            assert response.value.code == "native_response_too_large"
        with local_http(lambda *_: (302, {}, {"Location": "/elsewhere"})) as (url, server):
            with pytest.raises(NativeProtocolError):
                session.get(url, **({"deadline": time.monotonic() + 2} if controlled else {}))
            assert len(server.calls) == 1
    finally:
        session.close()


def test_native_session_ignores_proxy_environment(monkeypatch):
    monkeypatch.setenv("HTTP_PROXY", "http://127.0.0.1:1")
    monkeypatch.setenv("HTTPS_PROXY", "http://127.0.0.1:1")
    monkeypatch.setenv("NO_PROXY", "")
    with local_http(lambda *_: (200, {"status_code": 200, "result": []}, {})) as (url, _):
        with NativeSession() as session:
            assert post_json(session, url, payload={})["result"] == []


def test_native_json_rejects_nonfinite_protocol_numbers():
    with local_http(lambda *_: (200, b'{"status_code":200,"result":[NaN]}', {})) as (url, _):
        with NativeSession() as session, pytest.raises(NativeProtocolError) as failure:
            post_json(session, url, payload={})
        assert not failure.value.recoverable


@pytest.mark.parametrize("timeout", [None, 0, -1, float("inf"), float("nan")])
def test_native_timeout_is_always_bounded(timeout):
    with NativeSession() as session, pytest.raises(NativeProtocolError):
        session.get("http://127.0.0.1:1", timeout=timeout)


def test_nested_model_rpc_inherits_cancellation_and_context_is_reset():
    entered, release, cancellation = threading.Event(), threading.Event(), threading.Event()

    def callback(request, _):
        if request.path == "/blocked":
            entered.set()
            release.wait(2)
        return 200, {"status_code": 200, "result": []}, {}

    with local_http(callback) as (url, server), NativeSession() as session:
        failures = []

        def run():
            try:
                with native_call_context(cancellation):
                    session.get(url + "/blocked", timeout=1)
            except Exception as error:
                failures.append(error)

        thread = threading.Thread(target=run)
        try:
            thread.start()
            assert entered.wait(1)
            cancellation.set()
            thread.join(timeout=0.5)
            assert not thread.is_alive()
            assert isinstance(failures[0], NativeCallCancelled)
            assert session.get(url + "/free", timeout=1).status_code == 200
            assert len(server.calls) == 2
        finally:
            release.set()
            thread.join(timeout=2)


@pytest.mark.parametrize("strategy", ["mcts", "retro_star"])
def test_engine_authenticates_custom_loopback_endpoint_without_signature_change(monkeypatch, strategy):
    key, identifier = "controlled-engine-key", "a" * 32
    monkeypatch.setenv("X_SYNTH_NATIVE_SEARCH_KEY", key)

    def callback(request, _):
        assert request.headers.get(NATIVE_SEARCH_HEADER) == key
        if request.path.endswith("/result"):
            return 200, protocol_output(), {}
        if request.command == "DELETE":
            return 200, {"id": identifier, "status": "cancelling"}, {}
        return 200, {"id": identifier, "status": "queued" if request.command == "POST" else "completed"}, {}

    with local_http(callback) as (url, server):
        monkeypatch.setenv(f"X_SYNTH_{strategy.upper()}_URL", url.replace("127.0.0.1", "localhost") + "/")
        engine = AskcosEngine(AskcosTransport("http://127.0.0.1:1"))
        result = engine.search(RouteJobRequest(smiles="CCO"), strategy=strategy, models=["pistachio"], child_id=identifier)
        assert result.payload["result"]["uds"]
        with pytest.raises(EngineUnavailable, match="search_cancelled"):
            engine.search(RouteJobRequest(smiles="CCO"), strategy=strategy, models=["pistachio"], child_id=identifier, cancelled=lambda: True)
        assert {method for method, _ in server.calls} == {"GET", "POST", "DELETE"}
        assert list(inspect.signature(AskcosEngine.search).parameters) == [
            "self", "request", "strategy", "models", "child_id", "pass_number", "cancelled", "interrupted", "progress", "rejected_reactions",
        ]
        monkeypatch.delenv("X_SYNTH_NATIVE_SEARCH_KEY")
        count = len(server.calls)
        with pytest.raises(EngineUnavailable, match="native_search_key_missing"):
            engine.search(RouteJobRequest(smiles="CCO"), strategy=strategy, models=["pistachio"], child_id=identifier)
        assert len(server.calls) == count


@pytest.mark.parametrize("strategy", ["mcts", "retro_star"])
@pytest.mark.parametrize("url", [
    "http://remote.invalid:9311",
    "http://0.0.0.0:9311",
    "http://[::1]:9311",
    "https://127.0.0.1:9311",
    "http://unit-username:unit-password@127.0.0.1:9311",
    "http://127.0.0.1:9311/not-root",
])
def test_engine_rejects_invalid_private_endpoint_before_constructing_transport(monkeypatch, strategy, url):
    key = "controlled-private-key-not-for-export"
    monkeypatch.setenv("X_SYNTH_NATIVE_SEARCH_KEY", key)
    monkeypatch.setenv(f"X_SYNTH_{strategy.upper()}_URL", url)
    engine = AskcosEngine(AskcosTransport("http://127.0.0.1:1"))

    def forbidden_transport(*_, **__):
        pytest.fail("Invalid endpoint reached private transport construction")

    monkeypatch.setattr("packages.adapters.askcos.engine.AskcosTransport", forbidden_transport)
    with pytest.raises(EngineUnavailable) as failure:
        engine.search(RouteJobRequest(smiles="CCO"), strategy=strategy, models=["pistachio"], child_id="a" * 32)
    assert failure.value.code == "native_search_endpoint_invalid"
    assert not failure.value.recoverable
    assert url not in str(failure.value)
    assert key not in str(failure.value)
    assert failure.value.__cause__ is None
