import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from packages.orchestrator import runtime_health
from packages.platform.native_search_contract import (
    NATIVE_SEARCH_HEADER, NATIVE_SEARCH_PROTOCOL, NATIVE_SEARCH_PROTOCOL_VERSION,
    NATIVE_SEARCH_READY_PATH,
)


FIXTURE_KEY = "synthetic-fixture-key-" + "x" * 32


@pytest.fixture
def child_channel():
    settings = {"enforce_auth": True, "redirect": False,
                "payload": {"status": "ready", "protocol": NATIVE_SEARCH_PROTOCOL,
                            "protocol_version": NATIVE_SEARCH_PROTOCOL_VERSION, "strategy": "mcts"}}
    requests = []

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            authenticated = self.headers.get(NATIVE_SEARCH_HEADER) == FIXTURE_KEY
            requests.append((self.path, authenticated))
            if self.path != NATIVE_SEARCH_READY_PATH:
                status, body = 200, {"status": "ready"}
            elif settings["enforce_auth"] and not authenticated:
                status, body = 403, {"detail": "Private native search authentication failed"}
            else:
                status, body = 200, settings["payload"]
            if authenticated and settings["redirect"]:
                self.send_response(302)
                self.send_header("Location", "/public-ready")
                self.end_headers()
                return
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(body).encode())

        def log_message(self, *_args):
            pass

    server = HTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.01})
    thread.start()
    yield f"http://127.0.0.1:{server.server_port}", settings, requests
    server.shutdown()
    server.server_close()
    thread.join(timeout=2)
    assert not thread.is_alive()


def test_authenticated_child_protocol_probe_proves_rejection_and_matches_version_strategy(child_channel):
    url, _, requests = child_channel
    ready, payload = runtime_health._probe_search(url, 0.5, strategy="mcts", key=FIXTURE_KEY)
    assert ready
    assert payload == {"status": "ready", "protocol": "x_synth_native_search", "protocol_version": 1, "strategy": "mcts"}
    assert requests == [(NATIVE_SEARCH_READY_PATH, False), (NATIVE_SEARCH_READY_PATH, True)]


@pytest.mark.parametrize("key", ["", "wrong-synthetic-fixture-key-" + "y" * 32])
def test_missing_or_wrong_key_never_reports_child_ready(child_channel, key):
    url, _, requests = child_channel
    ready, payload = runtime_health._probe_search(url, 0.5, strategy="mcts", key=key)
    assert not ready
    if not key:
        assert requests == []
    if FIXTURE_KEY in repr(payload) or key and key in repr(payload):
        pytest.fail("Readiness exposed an internal key")


def test_public_ready_response_without_enforced_auth_is_not_child_readiness(child_channel):
    url, settings, requests = child_channel
    settings["enforce_auth"] = False
    ready, payload = runtime_health._probe_search(url, 0.5, strategy="mcts", key=FIXTURE_KEY)
    assert not ready
    assert payload["error"] == "native_search_auth_not_enforced"
    assert requests == [(NATIVE_SEARCH_READY_PATH, False)]


@pytest.mark.parametrize("replacement", [
    {"status": "starting"}, {"protocol": "unmanaged"}, {"protocol_version": 2},
    {"protocol_version": True}, {"strategy": "retro_star"}, {"padding": "x" * 5000},
])
def test_authenticated_response_must_match_bounded_private_protocol(child_channel, replacement):
    url, settings, _ = child_channel
    settings["payload"].update(replacement)
    assert not runtime_health._probe_search(url, 0.5, strategy="mcts", key=FIXTURE_KEY)[0]


def test_private_probe_never_follows_redirect_or_returns_unexpected_fields(child_channel):
    url, settings, requests = child_channel
    settings["redirect"] = True
    assert not runtime_health._probe_search(url, 0.5, strategy="mcts", key=FIXTURE_KEY)[0]
    assert not any(path == "/public-ready" for path, _ in requests)
    settings["redirect"] = False
    settings["payload"]["unexpected"] = FIXTURE_KEY
    ready, payload = runtime_health._probe_search(url, 0.5, strategy="mcts", key=FIXTURE_KEY)
    assert ready and "unexpected" not in payload
    if FIXTURE_KEY in repr(payload):
        pytest.fail("Private probe returned the internal key")


@pytest.mark.parametrize("url", ["http://remote.invalid:9000", "https://127.0.0.1:9000", "http://127.0.0.1:9000/private"])
def test_internal_key_is_never_sent_to_an_unmanaged_endpoint(url, monkeypatch):
    monkeypatch.setattr(runtime_health.request, "build_opener", lambda *_: pytest.fail("Internal key left its loopback endpoint"))
    assert not runtime_health._probe_search(url, 0.5, strategy="mcts", key=FIXTURE_KEY)[0]
