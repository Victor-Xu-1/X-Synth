"""Safe attribution through real local HTTP and nested native exception boundaries."""

import hashlib
import json
import logging

import pytest

from native_rpc_helpers import expansion_client, load_source, local_http
from packages.adapters.askcos.native_failure_diagnostics import native_failure_context, native_operation
from packages.adapters.askcos.native_http import NativeProtocolError


def test_operation_logging_preserves_exception_identity_and_excludes_private_text(caplog):
    original = NativeProtocolError("private-token http://secret.invalid?password=secret", code="native_call_timeout",
                                   recoverable=True, service="value_network")
    request = {"smiles": ["private-structure"]}
    with caplog.at_level(logging.ERROR), pytest.raises(NativeProtocolError) as raised:
        with native_operation("value_network_call", request=request):
            raise original
    assert raised.value is original
    expected = hashlib.sha256(json.dumps(request, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    assert native_failure_context(original) == {
        "operation": "value_network_call", "input_sha256": expected, "service": "value_network",
    }
    for private in ("private-token", "secret.invalid", "password", "private-structure"):
        assert private not in caplog.text


def test_nested_operations_log_once_and_recover_the_original_service(caplog):
    original = NativeProtocolError("secret", recoverable=True, service="template_relevance")
    with caplog.at_level(logging.ERROR), pytest.raises(NativeProtocolError):
        with native_operation("retro_backend_call", request={"smiles": ["CCO"]}):
            with native_operation("cache_lookup", request={"smiles": ["CCO"]}):
                raise original
    observed = [record for record in caplog.records if record.message.startswith("Native operation failed: ")]
    assert len(observed) == 1
    outer = NativeProtocolError("wrapped secret")
    outer.__cause__ = original
    assert native_failure_context(outer)["operation"] == "cache_lookup"
    assert native_failure_context(outer)["service"] == "template_relevance"


def test_cause_walk_is_bounded_and_cycle_safe():
    errors = [RuntimeError("secret") for _ in range(12)]
    for index in range(11):
        errors[index].__cause__ = errors[index + 1]
    errors[-1].service = "value_network"
    assert native_failure_context(errors[0]) == {}
    errors[1].__cause__ = errors[0]
    assert native_failure_context(errors[0]) == {}


@pytest.mark.parametrize("context,service", [
    ({"operation": "private-token", "input_sha256": "a" * 64}, {"password": "private-token"}),
    ({"operation": ["cache_lookup"], "input_sha256": "a" * 64}, "private-token"),
    ({"operation": "cache_lookup", "input_sha256": "private-token"}, []),
])
def test_untrusted_fields_are_not_copied(context, service):
    error = RuntimeError("private-token")
    error.native_operation_context, error.service = context, service
    result = native_failure_context(error)
    assert "private-token" not in json.dumps(result)
    assert set(result) <= {"operation"}


def test_diagnostic_hash_failure_does_not_replace_the_real_error():
    original = RuntimeError("real failure")
    with pytest.raises(RuntimeError) as raised:
        with native_operation("cache_lookup", request={"invalid": object()}):
            raise original
    assert raised.value is original
    assert native_failure_context(original) == {"operation": "cache_lookup"}


def test_cache_misses_are_not_logged(caplog):
    with pytest.raises(KeyError):
        with native_operation("retro_cache_lookup", ignore=(KeyError,)):
            raise KeyError("Cache miss")
    assert not caplog.records


@pytest.mark.parametrize("operation", ["private-token", [], None])
def test_unknown_operation_cannot_be_logged(operation, caplog):
    with pytest.raises(ValueError, match="Unknown native diagnostic operation"):
        with native_operation(operation):
            pytest.fail("Invalid diagnostic operation executed")
    assert not caplog.records


@pytest.mark.parametrize("strategy", ["retro_star", "mcts"])
def test_actual_expansion_client_preserves_service_and_cause_context(monkeypatch, strategy):
    module = expansion_client(strategy, monkeypatch)
    failure = {"code": "native_call_timeout", "recoverable": True, "service": "template_relevance"}
    with local_http(lambda *_: (503, {"native_failure": failure}, {})) as (url, server):
        client = module.ExpandOneAPI(url, request_timeout=1)
        try:
            with pytest.raises(module.ExpandOneBackendError) as raised:
                client("CCO", module.ExpandOneOptions())
        finally:
            client.session.close()
        assert len(server.calls) == 1
    assert raised.value.service == "template_relevance"
    assert native_failure_context(raised.value) == {
        "operation": "expand_one_call", "service": "template_relevance",
    }


@pytest.mark.parametrize("result,operation", [([[2.104]], None), (None, "value_network_decode"),
                                                ([], "value_network_decode")])
def test_value_client_response_boundary_over_real_local_http(monkeypatch, result, operation, caplog):
    module = load_source("apps/askcos-v2/tree_search/retro_star/api/value_fn_api.py",
                         "unit_value_operation_diagnostics", monkeypatch)
    reply = {"status_code": 200, "message": "", "result": result}
    with local_http(lambda *_: (200, reply, {})) as (url, server):
        client = module.ValueFnAPI(url)
        try:
            if operation is None:
                assert client("CCO") == 2.104
                assert not caplog.records
            else:
                with caplog.at_level(logging.ERROR), pytest.raises(NativeProtocolError) as raised:
                    client("CCO")
                assert raised.value.recoverable is False
                assert native_failure_context(raised.value)["operation"] == operation
        finally:
            client.session.close()
        assert len(server.calls) == 1


def test_value_client_transport_failure_is_not_a_chemical_score(monkeypatch):
    module = load_source("apps/askcos-v2/tree_search/retro_star/api/value_fn_api.py",
                         "unit_value_operation_transport", monkeypatch)
    failure = {"code": "native_call_timeout", "recoverable": True, "service": "value_network"}
    with local_http(lambda *_: (503, {"native_failure": failure}, {})) as (url, server):
        client = module.ValueFnAPI(url)
        try:
            with pytest.raises(NativeProtocolError) as raised:
                client("CCO")
        finally:
            client.session.close()
        assert len(server.calls) == 1
    assert raised.value.code == "native_call_timeout" and raised.value.recoverable is True
    assert native_failure_context(raised.value)["operation"] == "value_network_call"
    assert native_failure_context(raised.value)["service"] == "value_network"
