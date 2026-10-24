"""Public-option parsing and actual proxy HTTP contracts; no engines or stores."""

import json
from dataclasses import replace
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from apps.api.native_routes import native_router
from packages.adapters.askcos.transport import AskcosTransport
from packages.platform.performance import PerformanceBudget


PUBLIC_ROWS = [
    {"key": "VITE_EMAIL_REQUIRED", "value": "True"},
]
RETIRED_ROW = {"key": "VITE_GTAG", "value": " G-RETIRED-UNIT "}
PRIVATE_ROW = {"key": "UNRELATED_OPTION", "value": "unit-private-marker"}


def encoded(value):
    return json.dumps(value).encode("utf-8")


INVALID_PAYLOADS = [
    pytest.param(b"not JSON unit-private-marker", id="invalid-json"),
    pytest.param(b"null", id="null-envelope"),
    pytest.param(b"{}", id="object-envelope"),
    pytest.param(b'["unit-private-marker"]', id="non-object-row"),
    pytest.param(encoded([{"value": "unit-private-marker"}]), id="missing-key"),
    pytest.param(encoded([{"key": "VITE_GTAG"}]), id="missing-value"),
    pytest.param(encoded([{"key": 1, "value": "unit-private-marker"}]), id="non-string-key"),
    pytest.param(encoded([{"key": "VITE_GTAG", "value": None}]), id="null-value"),
    pytest.param(encoded([{"key": "VITE_GTAG", "value": True}]), id="boolean-value"),
    pytest.param(encoded([{"key": "VITE_GTAG", "value": 1}]), id="numeric-value"),
    pytest.param(encoded([{**PUBLIC_ROWS[0], "extra": "unit-private-marker"}]), id="extra-field"),
    pytest.param(encoded([{"key": "UNRELATED_OPTION", "value": {}}]), id="malformed-disallowed-row"),
    pytest.param(encoded([PUBLIC_ROWS[0], PUBLIC_ROWS[0]]), id="identical-public-duplicate"),
    pytest.param(encoded([PUBLIC_ROWS[0], {**PUBLIC_ROWS[0], "value": "False"}]), id="conflicting-public-duplicate"),
    pytest.param(b'[{"key":"VITE_GTAG","key":"UNRELATED_OPTION","value":"unit-private-marker"}]', id="duplicate-json-key"),
    pytest.param(b'[{"key":"VITE_GTAG","value":"public","value":"unit-private-marker"}]', id="duplicate-json-value"),
    pytest.param(b'[{"key":"VITE_EMAIL_REQUIRED","value":"a"},{"key":"VITE_EMAIL_\\u0052EQUIRED","value":"b"}]', id="escaped-public-duplicate"),
    pytest.param(b'[{"key":"UNRELATED_OPTION","value":NaN}]', id="non-finite-json"),
    pytest.param(b'[{"key":"VITE_GTAG","value":"\xff"}]', id="invalid-encoding"),
    pytest.param(b'[{"key":"VITE_GTAG","value":"\xed\xa0\x80"}]', id="raw-surrogate-encoding"),
    pytest.param(json.dumps(PUBLIC_ROWS).encode("utf-16"), id="utf16-response"),
    pytest.param(json.dumps(PUBLIC_ROWS).encode("utf-32"), id="utf32-response"),
    pytest.param(b'[{"key":"VITE_GTAG","value":"\\ud800"}]', id="escaped-high-surrogate"),
    pytest.param(b'[{"key":"VITE_GTAG","value":"\\udfff"}]', id="escaped-low-surrogate"),
    pytest.param(b'[{"key":"\\ud800","value":"unrelated"}]', id="escaped-surrogate-key"),
    pytest.param(b'[] {"value":"unit-private-marker"}', id="trailing-json"),
]


@pytest.fixture
def projection():
    # Import only for pure parser cases so baseline proxy tests exercise the old hook.
    from packages.platform.public_frontend_options import (
        PublicFrontendOptionsError,
        project_public_frontend_options,
    )

    return project_public_frontend_options, PublicFrontendOptionsError


@pytest.mark.parametrize("payload", INVALID_PAYLOADS)
def test_projection_rejects_malformed_or_ambiguous_payload(projection, payload):
    project, failure = projection
    with pytest.raises(failure):
        project(payload)


@pytest.mark.parametrize("rows", [
    [], [PRIVATE_ROW], [RETIRED_ROW], PUBLIC_ROWS,
    [RETIRED_ROW, PUBLIC_ROWS[0]], [PUBLIC_ROWS[0], RETIRED_ROW],
])
def test_projection_preserves_optional_keys_and_order(projection, rows):
    project, _ = projection
    before = encoded(rows)
    result = json.loads(project(before))
    assert result == [row for row in rows if row["key"] == "VITE_EMAIL_REQUIRED"]
    assert encoded(rows) == before


@pytest.mark.parametrize("value", ["", "False", "true", "0", " quoted ", "a\nb\t\\\"", "\u6d4b\u8bd5", "\U00010400"])
def test_projection_preserves_opaque_string_values(projection, value):
    project, _ = projection
    rows = [{"value": value, "key": "VITE_EMAIL_REQUIRED"}]
    assert json.loads(project(encoded(rows))) == rows


def test_projection_discards_repeated_disallowed_rows_without_reordering_public_rows(projection):
    project, _ = projection
    rows = [PRIVATE_ROW, RETIRED_ROW, PUBLIC_ROWS[0], PRIVATE_ROW]
    assert json.loads(project(encoded(rows))) == PUBLIC_ROWS


@pytest.mark.parametrize("last_value", [RETIRED_ROW["value"], "different-retired-value"])
def test_projection_discards_repeated_retired_telemetry_keys(projection, last_value):
    project, _ = projection
    rows = [RETIRED_ROW, PUBLIC_ROWS[0], {**RETIRED_ROW, "value": last_value}]
    assert json.loads(project(encoded(rows))) == PUBLIC_ROWS


def test_projection_rejects_excessive_json_nesting_as_a_protocol_error(projection):
    project, failure = projection
    with pytest.raises(failure):
        project(b"[" * 2000 + b"0" + b"]" * 2000)


@pytest.fixture
def proxy(monkeypatch):
    monkeypatch.setenv("X_SYNTH_AUTH_MODE", "local")
    upstream = SimpleNamespace(payload=b"[]", status=200, content_type="application/json", requests=[])

    class OptionsService(BaseHTTPRequestHandler):
        def do_GET(self):
            body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
            upstream.requests.append((self.command, self.path, body, self.headers.get("Authorization")))
            self.send_response(upstream.status)
            self.send_header("Content-Type", upstream.content_type)
            self.send_header("Content-Length", str(len(upstream.payload)))
            if upstream.status == 302:
                self.send_header("Location", "/must-not-follow")
            self.end_headers()
            self.wfile.write(upstream.payload)

        do_POST = do_GET

        def log_message(self, *args):
            pass

    def no_probe():
        raise AssertionError("Public option reads must not probe native engines")

    server = ThreadingHTTPServer(("127.0.0.1", 0), OptionsService)
    thread = Thread(target=lambda: server.serve_forever(poll_interval=0.01), daemon=True)
    thread.start()
    try:
        app = FastAPI()
        app.include_router(
            native_router(
                transport=AskcosTransport(f"http://127.0.0.1:{server.server_port}"),
                budget=replace(PerformanceBudget(), request_bytes=128, response_bytes=512),
                read_health=no_probe,
            ),
            prefix="/api",
        )
        with TestClient(app, base_url="http://127.0.0.1", client=("127.0.0.1", 1234)) as client:
            yield client, upstream
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
        assert not thread.is_alive()


@pytest.mark.parametrize("method", ["GET", "POST"])
@pytest.mark.parametrize("suffix", ["", "/", "?unit=1"])
def test_proxy_projects_public_rows_and_preserves_transport(proxy, method, suffix):
    client, upstream = proxy
    upstream.payload = encoded([PRIVATE_ROW, RETIRED_ROW, PUBLIC_ROWS[0], PRIVATE_ROW])
    path = "/api/frontend-config/get-all-config" + suffix
    response = client.request(method, path, headers={"Authorization": "Bearer synthetic-unit-value"})
    assert response.status_code == 200
    assert response.json() == PUBLIC_ROWS
    assert "unit-private-marker" not in response.text
    assert "G-RETIRED-UNIT" not in response.text
    assert upstream.requests == [(method, path, b"", "Bearer synthetic-unit-value")]


@pytest.mark.parametrize("rows", [
    [RETIRED_ROW], [RETIRED_ROW, RETIRED_ROW],
    [RETIRED_ROW, PUBLIC_ROWS[0], {**RETIRED_ROW, "value": "other-retired-value"}],
])
def test_proxy_drops_retired_telemetry_including_duplicate_rows(proxy, rows):
    client, upstream = proxy
    upstream.payload = encoded(rows)
    response = client.get("/api/frontend-config/get-all-config")
    assert response.status_code == 200
    assert response.json() == [row for row in rows if row["key"] == "VITE_EMAIL_REQUIRED"]
    assert "G-RETIRED-UNIT" not in response.text
    assert len(upstream.requests) == 1


@pytest.mark.parametrize("payload", INVALID_PAYLOADS)
def test_proxy_rejects_malformed_success_without_reflecting_payload(proxy, payload):
    client, upstream = proxy
    upstream.payload = payload
    response = client.get("/api/frontend-config/get-all-config")
    assert response.status_code == 502
    assert response.json() == {"detail": "Invalid native frontend options response"}
    assert "unit-private-marker" not in response.text
    assert len(upstream.requests) == 1


def test_proxy_projects_with_json_media_type(proxy):
    client, upstream = proxy
    upstream.content_type = "text/plain"
    response = client.get("/api/frontend-config/get-all-config")
    assert response.status_code == 200
    assert response.json() == []
    assert response.headers["content-type"] == "application/json"


@pytest.mark.parametrize("status", [201, 203])
def test_proxy_preserves_success_status_while_projecting(proxy, status):
    client, upstream = proxy
    upstream.status = status
    upstream.payload = encoded([PRIVATE_ROW, RETIRED_ROW, PUBLIC_ROWS[0]])
    response = client.get("/api/frontend-config/get-all-config")
    assert response.status_code == status
    assert response.json() == [PUBLIC_ROWS[0]]


def test_proxy_other_native_response_remains_byte_exact(proxy):
    client, upstream = proxy
    upstream.payload = b'{"transport":"metadata-only", "count":0}'
    upstream.content_type = "text/plain"
    response = client.get("/api/templates/get-config")
    assert response.status_code == 200
    assert response.content == upstream.payload
    assert response.headers["content-type"].startswith("text/plain")


@pytest.mark.parametrize("direction", ["request", "response"])
def test_proxy_preserves_byte_budgets_before_projection(proxy, direction):
    client, upstream = proxy
    if direction == "request":
        response = client.request("GET", "/api/frontend-config/get-all-config", content=b"x" * 129)
        assert upstream.requests == []
    else:
        upstream.payload = b"x" * 513
        response = client.get("/api/frontend-config/get-all-config")
        assert len(upstream.requests) == 1
    assert response.status_code == 413


def test_proxy_preserves_response_budget_after_projection_encoding(proxy):
    client, upstream = proxy
    upstream.payload = json.dumps(
        [{"key": "VITE_EMAIL_REQUIRED", "value": "\u6d4b" * 100}], ensure_ascii=False
    ).encode("utf-8")
    assert len(upstream.payload) <= 512
    response = client.get("/api/frontend-config/get-all-config")
    assert response.status_code == 413
    assert len(upstream.requests) == 1


@pytest.mark.parametrize("mode,headers,status", [
    ("local", {"Origin": "https://untrusted.example"}, 403),
    ("local", {"Host": "untrusted.example"}, 403),
    ("askcos", {}, 401),
])
def test_proxy_preserves_auth_before_forwarding(proxy, monkeypatch, mode, headers, status):
    client, upstream = proxy
    monkeypatch.setenv("X_SYNTH_AUTH_MODE", mode)
    response = client.get("/api/frontend-config/get-all-config", headers=headers)
    assert response.status_code == status
    assert upstream.requests == []


@pytest.mark.parametrize("path", [
    "/api/frontend-config/get-all-config//",
    "/api/not-supported/get-all-config",
])
def test_proxy_preserves_path_rejection(proxy, path):
    client, upstream = proxy
    assert client.get(path).status_code == 404
    assert upstream.requests == []


@pytest.mark.parametrize("status", [302, 401, 422, 503])
def test_proxy_preserves_upstream_errors_without_reflecting_body(proxy, status):
    client, upstream = proxy
    upstream.status = status
    upstream.payload = b'{"detail":"unit-private-marker"}'
    response = client.get("/api/frontend-config/get-all-config", follow_redirects=False)
    assert response.status_code == status
    assert "unit-private-marker" not in response.text
    assert len(upstream.requests) == 1
