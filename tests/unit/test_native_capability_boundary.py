"""Native boundary contracts; no inference providers, weights, or queues are started."""

import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from apps.api import native_routes
from packages.adapters.askcos.transport import AskcosTransport
from packages.platform.native_capabilities import native_runtime_payload
from packages.platform.performance import PerformanceBudget


@pytest.fixture
def boundary(monkeypatch):
    monkeypatch.setenv("X_SYNTH_AUTH_MODE", "local")
    requests = []
    reads = []
    checks = {
        "gateway": True,
        "configured_models_loaded": True,
        "template_relevance": True,
    }

    class TransportMetadata(BaseHTTPRequestHandler):
        def do_GET(self):
            requests.append((self.command, self.path))
            payload = json.dumps(
                {"transport_method": self.command, "transport_path": self.path}
            ).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        do_POST = do_GET

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), TransportMetadata)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    def read_health():
        reads.append(True)
        return {"service_checks": checks}

    application = FastAPI()
    application.state.native_checks = checks
    application.include_router(
        native_routes.native_router(
            transport=AskcosTransport(f"http://127.0.0.1:{server.server_port}"),
            budget=PerformanceBudget(),
            read_health=read_health,
        ),
        prefix="/api",
    )
    with TestClient(
        application, base_url="http://127.0.0.1", client=("127.0.0.1", 1234)
    ) as client:
        yield client, application, requests, reads
    server.shutdown()
    server.server_close()
    thread.join(timeout=2)


@pytest.mark.parametrize(
    "suffix", ["capabilities", "capabilities/", "services", "services/"]
)
def test_runtime_routes_project_configured_models_without_forwarding_legacy_manifest(
    boundary, suffix, monkeypatch
):
    monkeypatch.setenv(
        "X_SYNTH_ASKCOS_MODELS", "pistachio,pistachio_ringbreaker,private-secret-value"
    )
    client, _, forwarded, reads = boundary
    response = client.get("/api/runtime/" + suffix + "?probe=true")
    assert response.status_code == 200
    payload = response.json()
    assert payload["scope"] == "configured_native"
    assert payload["service_count"] == 13
    assert {model["id"] for model in payload["retrosynthesis_models"]} == {
        "pistachio",
        "pistachio_ringbreaker",
    }
    assert payload["configured"]["unrecognized_model_count"] == 1
    assert payload["catalog"]["scope"] == "supported_source_only"
    assert len(payload["catalog"]["modules"]) == 34
    assert "private-secret-value" not in response.text
    assert "keycloak" not in payload["entrypoints"]
    assert forwarded == []
    assert len(reads) == 1
    if suffix.startswith("services"):
        assert set(payload["services"]) == {
            "app",
            "expand_one",
            "mcts",
            "retro_star",
            "retro_template_relevance",
            "fast_filter",
            "scscore",
            "pathway_ranker",
            "value_network",
            "cluster",
            "condition_recommender",
            "forward_predictor",
            "impurity",
        }
        assert not {
            "mongo",
            "redis",
            "rabbitmq",
            "celery_workers",
            "keycloak",
        }.intersection(payload["services"])
        assert payload["services"]["scscore"]["kind"] == "scoring"
        assert payload["services"]["mcts"]["kind"] == "route-search"


@pytest.mark.parametrize(
    "path",
    [
        "retro/template-relevance/call-async",
        "fast-filter/call-async",
        "tree-search/expand-one/call-async",
        "fastsolv/call-async",
        "count-analogs/call_async",
    ],
)
def test_unmanaged_async_is_rejected_before_probing_or_forwarding(boundary, path):
    client, _, forwarded, reads = boundary
    response = client.post("/api/" + path, json={})
    assert response.status_code == 501
    assert response.json()["detail"] == {
        "code": "unmanaged_native_queue",
        "managed_endpoint": "/api/v1/unified-route/call-async",
    }
    assert forwarded == []
    assert reads == []


@pytest.mark.parametrize("prefix,endpoint", native_routes.SCIENTIFIC_ENTRYPOINTS.items())
@pytest.mark.parametrize("suffix", ["call-sync", "call-async", "get-config"])
def test_scientific_models_cannot_bypass_the_typed_recorded_product_path(boundary, prefix, endpoint, suffix):
    client, _, forwarded, reads = boundary
    response = client.post(f"/api/{prefix}/{suffix}", json={})
    assert response.status_code == 410
    assert response.json()["detail"] == {
        "code": "retired_native_scientific_entrypoint", "managed_endpoint": endpoint,
    }
    assert forwarded == [] and reads == []


@pytest.mark.parametrize("group", ["fastsolv", "count-analogs"])
def test_preserved_optional_wrapper_does_not_probe_disabled_module(boundary, group):
    client, _, forwarded, reads = boundary
    assert group in native_routes.NATIVE_GROUPS
    response = client.get(f"/api/{group}/get-config")
    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "native_service_not_configured"
    assert forwarded == []
    assert reads == []


def test_optional_wrapper_requires_configured_and_observed_ready_service(
    boundary, monkeypatch
):
    client, _, forwarded, reads = boundary
    monkeypatch.setattr(
        native_routes,
        "optional_proxy_module",
        lambda group: {"configured": True, "service_id": "fastsolv"},
    )
    response = client.post("/api/fastsolv/call-sync", json={})
    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "native_service_not_ready"
    assert forwarded == []
    assert len(reads) == 1


def test_optional_wrapper_forwards_only_after_authoritative_ready_check(
    boundary, monkeypatch
):
    client, application, forwarded, reads = boundary
    monkeypatch.setattr(
        native_routes,
        "optional_proxy_module",
        lambda group: {"configured": True, "service_id": "fastsolv"},
    )
    application.state.native_checks["fastsolv"] = True
    response = client.post("/api/fastsolv/call-sync", json={})
    assert response.status_code == 200
    assert response.json()["transport_path"] == "/api/fastsolv/call-sync"
    assert len(forwarded) == 1
    assert len(reads) == 1


def test_expand_one_sync_preserves_real_http_forwarding(boundary):
    client, _, forwarded, reads = boundary
    response = client.post(
        "/api/tree-search/expand-one/call-sync-without-token", json={"smiles": "CCO"}
    )
    assert response.status_code == 200
    assert response.json() == {
        "transport_method": "POST",
        "transport_path": "/api/tree-search/expand-one/call-sync-without-token",
    }
    assert len(forwarded) == 1
    assert reads == []


@pytest.mark.parametrize("strategy", ["mcts", "retro-star"])
@pytest.mark.parametrize("operation", ["call-sync", "call-async"])
def test_native_route_jobs_remain_blocked_at_product_boundary(
    boundary, strategy, operation
):
    client, _, forwarded, reads = boundary
    response = client.post(f"/api/tree-search/{strategy}/{operation}", json={})
    assert response.status_code == 409
    assert forwarded == []
    assert reads == []


@pytest.mark.parametrize("endpoint", ["capabilities", "services"])
def test_native_runtime_projection_preserves_auth_and_local_host_boundary(
    boundary, endpoint, monkeypatch
):
    client, application, forwarded, reads = boundary
    path = "/api/runtime/" + endpoint
    assert (
        client.get(path, headers={"Origin": "https://untrusted.example"}).status_code
        == 403
    )
    with TestClient(
        application, base_url="http://127.0.0.1", client=("192.0.2.1", 1234)
    ) as remote:
        assert remote.get(path).status_code == 403
    monkeypatch.setenv("X_SYNTH_AUTH_MODE", "askcos")
    assert client.get(path).status_code == 401
    assert forwarded == []
    assert reads == []


def test_models_are_not_verified_from_process_or_service_presence_alone():
    payload = native_runtime_payload(
        health={"service_checks": {"template_relevance": True}},
        configured_models="pistachio",
    )
    assert payload["configured"]["models_verified"] is False
    assert payload["retrosynthesis_models"][0]["health"]["status"] == "unavailable"


def test_loaded_models_are_not_healthy_when_template_service_is_unavailable():
    payload = native_runtime_payload(
        health={
            "service_checks": {
                "configured_models_loaded": True,
                "template_relevance": False,
            }
        },
        configured_models="pistachio",
    )
    assert payload["configured"]["models_verified"] is True
    assert payload["retrosynthesis_models"][0]["health"]["status"] == "unavailable"


def test_warm_product_environment_and_native_capability_reads(tmp_path, monkeypatch):
    from apps.api.app import create_app
    from packages.orchestrator import runtime_health

    monkeypatch.setenv("X_SYNTH_STOCK_INDEX", str(tmp_path / "missing-stock.sqlite"))
    original_probe = runtime_health._probe
    probes = []

    def observed_probe(*args, **kwargs):
        probes.append(args[0])
        return original_probe(*args, **kwargs)

    monkeypatch.setattr(runtime_health, "_probe", observed_probe)
    with TestClient(
        create_app(jobs_root=tmp_path),
        base_url="http://127.0.0.1",
        client=("127.0.0.1", 1234),
    ) as client:
        paths = (
            "/api/v1/environments",
            "/api/runtime/capabilities",
            "/api/runtime/services",
        )
        for path in paths:
            assert client.get(path).status_code == 200
        before = len(probes)
        for path in paths:
            durations = []
            for _ in range(40):
                start = time.perf_counter()
                assert client.get(path).status_code == 200
                durations.append(time.perf_counter() - start)
            p95 = sorted(durations)[37]
            print(f"warm {path}: n=40 p95={p95 * 1000:.2f}ms")
            assert p95 <= 0.250
        assert len(probes) == before


def test_managed_unified_task_route_is_not_caught_by_native_async_guard(
    tmp_path, monkeypatch
):
    from apps.api.app import create_app

    monkeypatch.setenv("X_SYNTH_STOCK_INDEX", str(tmp_path / "missing-stock.sqlite"))
    client = TestClient(
        create_app(jobs_root=tmp_path),
        base_url="http://127.0.0.1",
        client=("127.0.0.1", 1234),
    )
    response = client.post("/api/v1/unified-route/call-async", json={"smiles": "CCO"})
    assert response.status_code == 503
    assert not isinstance(response.json()["detail"], dict)
    assert client.get("/api/v1/unified-route/jobs").json()["total"] == 0
