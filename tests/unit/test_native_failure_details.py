"""Transport diagnostics expose known codes and service names, never raw errors."""

import json

import pytest

from native_rpc_helpers import local_http
from packages.adapters.askcos.native_http import NativeProtocolError, NativeSession, native_failure_details


def test_diagnostics_do_not_copy_messages_tokens_urls_or_untrusted_codes():
    error = NativeProtocolError("password=private-test-token", code="native_private-test-token", service={"token": "private-test-token"})
    result = native_failure_details(error)
    assert result == {"code": "native_protocol_error", "recoverable": False, "service": None}
    assert "private-test-token" not in json.dumps(result)


def test_owned_gateway_relays_original_service_failure_without_misclassifying_retry():
    failure = {"code": "native_call_timeout", "recoverable": True, "service": "template_relevance"}
    with local_http(lambda *_: (503, {"native_failure": failure}, {})) as (url, _):
        with pytest.raises(NativeProtocolError) as raised:
            NativeSession().get(url, timeout=1)
    assert native_failure_details(raised.value) == failure
    failure["code"], failure["recoverable"] = "native_protocol_error", False
    with local_http(lambda *_: (502, {"native_failure": failure}, {})) as (url, _):
        with pytest.raises(NativeProtocolError) as raised:
            NativeSession().get(url, timeout=1)
    assert raised.value.recoverable is False


@pytest.mark.parametrize("failure", [
    {"code": "native_call_timeout", "recoverable": True, "service": []},
    {"code": "native_call_timeout", "recoverable": "yes", "service": None},
    {"code": "native_secret", "recoverable": True, "service": "template_relevance"},
])
def test_malformed_diagnostics_fall_back_to_the_real_http_status(failure):
    with local_http(lambda *_: (503, {"native_failure": failure}, {})) as (url, _):
        with pytest.raises(NativeProtocolError) as raised:
            NativeSession().get(url, timeout=1)
    assert raised.value.code == "native_http_503" and raised.value.recoverable is True
