"""Real product authentication/WorkspaceRoute contracts in a focused router assembly."""

import hashlib
import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from test_optimization_tables import CSV, request_body

from apps.api.analysis_routes import analysis_runner
from apps.api.optimization_routes import optimization_router
from packages.adapters.optimization.runtime import OptimizationRuntime
from packages.workspace.analysis_repository import AnalysisRepository


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setenv("X_SYNTH_AUTH_MODE", "local")
    monkeypatch.delenv("X_SYNTH_OPTIMIZATION_PYTHON", raising=False)
    app = FastAPI()
    app.state.analyses = AnalysisRepository(tmp_path / "analyses.sqlite")
    app.include_router(
        optimization_router(
            transport=None,
            runtime=OptimizationRuntime(),
            run_analysis=analysis_runner(app.state.analyses),
        ),
        prefix="/api/v1",
    )
    with TestClient(
        app, base_url="http://127.0.0.1:8769", client=("127.0.0.1", 50000)
    ) as value:
        yield value


def test_csv_inspection_is_available_without_fake_model_readiness(client):
    response = client.post("/api/v1/optimization/inspect", json={"content": CSV})
    assert response.status_code == 200
    assert response.json()["row_count"] == 4
    assert client.get("/api/v1/optimization/health").json()["ready"] is False
    assert (
        client.post("/api/v1/optimization/recommend", json=request_body()).status_code
        == 503
    )


@pytest.mark.parametrize(
    "headers",
    [
        {"Origin": "https://evil.example"},
        {"Sec-Fetch-Site": "cross-site"},
        {"Host": "evil.example"},
    ],
)
def test_all_optimization_endpoints_share_product_cross_site_boundary(client, headers):
    assert client.get("/api/v1/optimization/health", headers=headers).status_code == 403
    assert (
        client.post(
            "/api/v1/optimization/inspect", json={"content": CSV}, headers=headers
        ).status_code
        == 403
    )
    assert (
        client.post(
            "/api/v1/optimization/recommend", json=request_body(), headers=headers
        ).status_code
        == 403
    )


def test_shared_workspace_requires_verified_identity_not_client_owner(
    client, monkeypatch
):
    monkeypatch.setenv("X_SYNTH_AUTH_MODE", "askcos")
    assert client.get("/api/v1/optimization/health").status_code == 401
    assert (
        client.post("/api/v1/optimization/inspect", json={"content": CSV}).status_code
        == 401
    )
    assert (
        client.post("/api/v1/optimization/recommend", json=request_body()).status_code
        == 401
    )
    assert (
        client.post(
            "/api/v1/optimization/recommend", json=request_body(owner="admin")
        ).status_code
        == 422
    )


def test_workspace_validation_serializes_nonfinite_and_forbids_arbitrary_configuration(
    client,
):
    payload = request_body()
    payload["factors"][0]["values"] = [float("nan"), 20]
    response = client.post(
        "/api/v1/optimization/recommend",
        content=json.dumps(payload),
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 422
    assert response.json()["detail"]
    for field in ("path", "model", "python", "eval", "campaign_json"):
        assert (
            client.post(
                "/api/v1/optimization/recommend",
                json=request_body(**{field: "untrusted"}),
            ).status_code
            == 422
        )
    assert (
        client.post(
            "/api/v1/optimization/inspect", json={"content": "a,a\n1,2"}
        ).status_code
        == 422
    )


def test_stale_csv_is_rejected_before_invoking_runtime(client):
    response = client.post(
        "/api/v1/optimization/recommend", json=request_body(table_sha256="f" * 64)
    )
    assert response.status_code == 422
    assert client.app.state.analyses.list("local_workspace")["total"] == 0


def test_shared_analysis_runner_retains_validated_result_and_uuid32_record_id(
    client, monkeypatch
):
    from test_optimization_runtime import transport_fixture

    from packages.adapters.optimization.contracts import OptimizationRequest

    monkeypatch.setattr(
        OptimizationRuntime,
        "_invoke",
        lambda self, content: transport_fixture(
            OptimizationRequest.model_validate_json(content)
        ),
    )
    response = client.post("/api/v1/optimization/recommend", json=request_body())
    assert response.status_code == 200
    identifier = response.json()["record_id"]
    assert len(identifier) == 32
    record = client.app.state.analyses.get(identifier, "local_workspace")
    assert record["status"] == "completed" and record["kind"] == "optimization"
    assert record["inputs"]["selected_rows"] == [1, 2, 3]
    assert record["inputs"]["content"] == CSV
    assert (
        hashlib.sha256(record["inputs"]["content"].encode()).hexdigest()
        == record["inputs"]["table_sha256"]
    )
    assert record["result"]["empirically_confirmed"] is False
    with pytest.raises(KeyError):
        client.app.state.analyses.get(identifier, "other_user")


def test_real_runtime_failure_is_recorded_not_replaced_by_unpersisted_success(client):
    assert (
        client.post("/api/v1/optimization/recommend", json=request_body()).status_code
        == 503
    )
    listing = client.app.state.analyses.list("local_workspace")
    assert listing["total"] == 1 and listing["items"][0]["status"] == "failed"
