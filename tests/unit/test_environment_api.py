"""Safe environment projection and real product-route security contracts."""

import json

import pytest
from fastapi.testclient import TestClient

from apps.api.app import create_app
from packages.platform.environments import ENGINE_SERVICES, environment_snapshot


def snapshot(health, runtime=None, models="pistachio,pistachio_ringbreaker"):
    return environment_snapshot(
        health=health, runtime=runtime or {}, configured_models=models
    )


@pytest.mark.parametrize(
    ("health", "expected"),
    [
        ({"backends": {"askcos_v2": True}}, "ready"),
        ({"service_checks": {"gateway": True}}, "degraded"),
        ({"service_checks": {"commercial_stock": True}}, "unavailable"),
        ({}, "unavailable"),
    ],
)
def test_engine_status_requires_actual_backend_probes(health, expected):
    assert snapshot(health)["engines"][0]["status"] == expected


def test_running_processes_do_not_claim_model_or_worker_readiness():
    health = {"backends": {"askcos_v2": False}, "worker_ready": False}
    runtime = {"resources": {"services": {"mcts": {"status": "running"}}}}
    result = snapshot(health, runtime)
    assert result["engines"][0]["runtime_mode"] == "supervised_native"
    assert result["engines"][0]["status"] == "unavailable"
    assert result["engines"][0]["models_verified"] is False
    assert result["health"]["worker_ready"] is False


def test_config_projection_lists_only_known_models_without_leaking_unknown_values():
    secret = "invalid-private-configuration-value"
    result = snapshot(
        {"version": "0.1.0", "auth_mode": "local"},
        models=f" pistachio, {secret}, pistachio, ",
    )
    engine = result["engines"][0]
    assert engine["configured_models"] == ["pistachio"]
    assert engine["unrecognized_model_count"] == 1
    assert secret not in json.dumps(result)
    assert result["platform"]["access_mode"] == "local"
    assert result["platform"]["name"] == "X-Synth"
    assert result["platform"]["entrypoint"] == "scripts.operations.serve_platform"


def test_projection_reuses_authoritative_health_and_runtime_without_mutation():
    health = {
        "backends": {"askcos_v2": True},
        "worker_ready": False,
        "service_checks": {"configured_models_loaded": True},
        "available_strategies": ["retro_star"],
        "stock_snapshot": {"catalog_sha256": "a" * 64},
    }
    runtime = {"budget": {"active_jobs": 1}, "resources": {"rss_bytes": 123}}
    before = json.dumps([health, runtime])
    result = snapshot(health, runtime)
    assert result["schema_version"] == 1
    assert result["health"] is health
    assert result["runtime"] is runtime
    assert result["engines"][0]["models_verified"] is True
    assert result["engines"][0]["available_strategies"] == ["retro_star"]
    assert result["engines"][0]["service_ids"] == list(ENGINE_SERVICES)
    assert json.dumps([health, runtime]) == before


def test_real_environment_api_is_authenticated_read_only_and_shares_runtime(tmp_path):
    application = create_app(jobs_root=tmp_path)
    browser = TestClient(
        application, base_url="http://127.0.0.1", client=("127.0.0.1", 1234)
    )
    response = browser.get("/api/v1/environments")
    assert response.status_code == 200
    result = response.json()
    assert result["schema_version"] == 1
    assert result["platform"]["name"] == "X-Synth"
    assert result["platform"]["version"] == "0.1.0"
    assert len(result["engines"]) == 1
    assert result["engines"][0]["id"] == "askcos_v2"
    assert result["health"]["service"] == "x-synth"
    assert result["runtime"] == browser.get("/api/v1/runtime").json()
    assert application.state.repository.count("local_workspace") == 0
    assert (
        browser.post("/api/v1/environments", json={"command": "restart"}).status_code
        == 404
    )
    for headers in (
        {"Origin": "https://attacker.example"},
        {"Host": "attacker.example"},
        {"Sec-Fetch-Site": "cross-site"},
    ):
        assert browser.get("/api/v1/environments", headers=headers).status_code == 403
    remote = TestClient(
        application, base_url="http://127.0.0.1", client=("192.0.2.1", 1234)
    )
    assert remote.get("/api/v1/environments").status_code == 403
