"""Actual local HTTP reconnection; no chemical model/provider is simulated."""

from threading import Event

import pytest

from native_rpc_helpers import local_http
from packages.adapters.askcos.engine import AskcosEngine
from packages.adapters.askcos.transport import AskcosTransport, EngineUnavailable
from packages.orchestrator.route_request import RouteJobRequest


class ImmediateEvent(Event):
    def wait(self, timeout=None):
        return self.is_set()


def test_interrupted_child_reconnects_same_id_and_input_not_a_new_search(monkeypatch):
    posted = []
    identifier = "a" * 32
    def callback(handler, body):
        if handler.command == "POST":
            posted.append(body)
            return 200, {"id": identifier, "status": "interrupted" if len(posted) == 1 else "completed",
                         "progress": {"iterations": 17}}, {}
        assert handler.path.endswith("/result")
        return 200, {"uds": {}, "stats": {}}, {}
    with local_http(callback) as (url, _):
        monkeypatch.setenv("X_SYNTH_MCTS_URL", url)
        monkeypatch.setenv("X_SYNTH_NATIVE_SEARCH_KEY", "controlled-unit-key")
        observed = []
        result = AskcosEngine(AskcosTransport(url)).search(RouteJobRequest(smiles="CCO"),
            strategy="mcts", models=["pistachio"], child_id=identifier,
            interrupted=ImmediateEvent(), progress=observed.append)
    assert result.payload["target_smiles"] == "CCO"
    assert len(posted) == 2 and posted[0] == posted[1]
    assert any(row.get("reconnect_attempt") == 1 for row in observed)


def test_persistent_interruption_stops_reconnects_and_preserves_recoverable_state(monkeypatch):
    count = []
    identifier = "a" * 32
    def callback(handler, body):
        count.append(body)
        return 200, {"id": identifier, "status": "interrupted", "error_code": "native_dependency_unavailable"}, {}
    with local_http(callback) as (url, _):
        monkeypatch.setenv("X_SYNTH_MCTS_URL", url)
        monkeypatch.setenv("X_SYNTH_NATIVE_SEARCH_KEY", "controlled-unit-key")
        with pytest.raises(EngineUnavailable) as raised:
            AskcosEngine(AskcosTransport(url)).search(RouteJobRequest(smiles="CCO"),
                strategy="mcts", models=["pistachio"], child_id=identifier, interrupted=ImmediateEvent())
    assert len(count) == 3 and all(body == count[0] for body in count)
    assert raised.value.recoverable


@pytest.mark.parametrize("failure_stage", ["submit", "poll", "result"])
def test_transient_http_failure_retries_only_same_child_operation(monkeypatch, failure_stage):
    identifier = "b" * 32
    posted, failures = [], []

    def callback(handler, body):
        stage = "submit" if handler.command == "POST" else (
            "result" if handler.path.endswith("/result") else "poll"
        )
        if body is not None:
            posted.append(body)
        if stage == failure_stage and not failures:
            failures.append(stage)
            return 503, {"error": "temporarily unavailable"}, {}
        if stage == "result":
            return 200, {"uds": {}, "stats": {}}, {}
        return 200, {"id": identifier, "status": "running" if stage == "submit" else "completed"}, {}

    with local_http(callback) as (url, server):
        monkeypatch.setenv("X_SYNTH_MCTS_URL", url)
        monkeypatch.setenv("X_SYNTH_NATIVE_SEARCH_KEY", "controlled-unit-key")
        result = AskcosEngine(AskcosTransport(url)).search(RouteJobRequest(smiles="CCO"),
            strategy="mcts", models=["pistachio"], child_id=identifier, interrupted=ImmediateEvent())
    assert result.payload["target_smiles"] == "CCO"
    assert failures == [failure_stage]
    assert all(body == posted[0] for body in posted)
    assert len(posted) == (2 if failure_stage == "submit" else 1)
    assert all(identifier in path or path == "/api/search-jobs" for _, path in server.calls)


@pytest.mark.parametrize("status,response,expected,recoverable,count", [
    (503, {}, "native_http_503", True, 3),
    (401, {}, "native_http_401", False, 1),
    (200, b"not json", "native_invalid_json", False, 1),
    (200, {"id": "c" * 32, "status": "interrupted", "error_code": "native_protocol_error",
           "dependency_failure": {"recoverable": False}}, "native_protocol_error", False, 1),
])
def test_permanent_errors_and_exhausted_transport_retries_do_not_resubmit_forever(
    monkeypatch, status, response, expected, recoverable, count
):
    with local_http(lambda *_: (status, response, {})) as (url, server):
        monkeypatch.setenv("X_SYNTH_MCTS_URL", url)
        monkeypatch.setenv("X_SYNTH_NATIVE_SEARCH_KEY", "controlled-unit-key")
        with pytest.raises(EngineUnavailable) as raised:
            AskcosEngine(AskcosTransport(url)).search(RouteJobRequest(smiles="CCO"),
                strategy="mcts", models=["pistachio"], child_id="c" * 32, interrupted=ImmediateEvent())
    assert raised.value.code == expected and raised.value.recoverable is recoverable
    assert len(server.calls) == count


def test_worker_stop_during_backoff_preserves_native_child(monkeypatch):
    class StopOnWait(Event):
        def wait(self, timeout=None):
            self.set()
            return True

    with local_http(lambda *_: (503, {}, {})) as (url, server):
        monkeypatch.setenv("X_SYNTH_MCTS_URL", url)
        monkeypatch.setenv("X_SYNTH_NATIVE_SEARCH_KEY", "controlled-unit-key")
        with pytest.raises(EngineUnavailable) as raised:
            AskcosEngine(AskcosTransport(url)).search(RouteJobRequest(smiles="CCO"),
                strategy="mcts", models=["pistachio"], child_id="d" * 32, interrupted=StopOnWait())
    assert raised.value.code == "product_worker_stopped" and raised.value.recoverable
    assert server.calls == [("POST", "/api/search-jobs")]


def test_cancel_during_reconnect_deletes_child_without_another_submission(monkeypatch):
    cancelled = Event()

    def callback(handler, _):
        if handler.command == "POST":
            cancelled.set()
            return 503, {}, {}
        assert handler.command == "DELETE"
        return 200, {}, {}

    with local_http(callback) as (url, server):
        monkeypatch.setenv("X_SYNTH_MCTS_URL", url)
        monkeypatch.setenv("X_SYNTH_NATIVE_SEARCH_KEY", "controlled-unit-key")
        with pytest.raises(EngineUnavailable) as raised:
            AskcosEngine(AskcosTransport(url)).search(RouteJobRequest(smiles="CCO"),
                strategy="mcts", models=["pistachio"], child_id="e" * 32,
                cancelled=cancelled.is_set, interrupted=ImmediateEvent())
    assert raised.value.code == "search_cancelled" and not raised.value.recoverable
    assert server.calls == [("POST", "/api/search-jobs"), ("DELETE", "/api/search-jobs/" + "e" * 32)]


def test_record_interruption_and_transport_failure_share_one_retry_budget(monkeypatch):
    posted = []
    identifier = "f" * 32

    def callback(_, body):
        posted.append(body)
        if len(posted) == 2:
            return 503, {}, {}
        return 200, {"id": identifier, "status": "interrupted", "error_code": "native_worker_restarted"}, {}

    with local_http(callback) as (url, _):
        monkeypatch.setenv("X_SYNTH_MCTS_URL", url)
        monkeypatch.setenv("X_SYNTH_NATIVE_SEARCH_KEY", "controlled-unit-key")
        with pytest.raises(EngineUnavailable) as raised:
            AskcosEngine(AskcosTransport(url)).search(RouteJobRequest(smiles="CCO"),
                strategy="mcts", models=["pistachio"], child_id=identifier, interrupted=ImmediateEvent())
    assert raised.value.code == "native_worker_restarted" and raised.value.recoverable
    assert len(posted) == 3 and all(body == posted[0] for body in posted)


def test_truncated_http_response_recovers_without_allocating_a_new_child(monkeypatch):
    identifier = "1" * 32
    posted = []

    def callback(handler, body):
        if handler.command == "POST":
            posted.append(body)
            if len(posted) == 1:
                return 200, b'{"id":', {"Content-Length": "100"}
            return 200, {"id": identifier, "status": "completed"}, {}
        return 200, {"uds": {}}, {}

    with local_http(callback) as (url, _):
        monkeypatch.setenv("X_SYNTH_MCTS_URL", url)
        monkeypatch.setenv("X_SYNTH_NATIVE_SEARCH_KEY", "controlled-unit-key")
        result = AskcosEngine(AskcosTransport(url)).search(RouteJobRequest(smiles="CCO"),
            strategy="mcts", models=["pistachio"], child_id=identifier, interrupted=ImmediateEvent())
    assert result.payload["target_smiles"] == "CCO"
    assert len(posted) == 2 and posted[0] == posted[1]
