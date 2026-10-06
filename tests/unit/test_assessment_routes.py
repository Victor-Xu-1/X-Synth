"""The new routers mounted alone, with actual workspace auth and RDKit."""

import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from apps.api.assessment_routes import assessment_router, process_router
from apps.api.analysis_routes import analysis_router
from packages.workspace.analysis_execution import analysis_runner
from apps.api.request_limits import RequestLimitMiddleware
from packages.adapters.askcos.transport import EngineUnavailable
from packages.chemistry.assessment import AssessmentUnavailable, MolecularAssessment, assess_molecule
from packages.chemistry.process_metrics import ProcessResult, ProcessInput, calculate_process
from pydantic import ValidationError
from packages.platform.performance import PerformanceBudget
from packages.workspace.analysis_repository import AnalysisRepository
from test_process_metrics import batch


class IdentityTransport:
    def current_user(self, token):
        if token != "test-approved":
            raise EngineUnavailable("test identity rejected", recoverable=False)
        return {"username": "test-user", "is_superuser": False}


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("X_SYNTH_AUTH_MODE", "local")
    monkeypatch.setenv("X_SYNTH_ALLOWED_ORIGINS", "http://127.0.0.1:8769")
    app = FastAPI()
    budget = PerformanceBudget()
    app.add_middleware(RequestLimitMiddleware, limit=budget.request_bytes)
    def run_analysis(*, owner, kind, inputs, execute):
        return {**execute(), "record_id": "1" * 32}
    for factory in [assessment_router, process_router]:
        app.include_router(factory(transport=IdentityTransport(), budget=budget, run_analysis=run_analysis), prefix="/api/v1")
    with TestClient(app, base_url="http://127.0.0.1", client=("127.0.0.1", 50001)) as client:
        yield client


@pytest.mark.parametrize("endpoint,body", [
    ("/assessment/molecule", {"smiles": "C[C@H](F)Cl"}),
    ("/process/metrics", batch()),
])
def test_authenticated_real_calculations_and_csrf_boundary(client, endpoint, body, monkeypatch):
    path = "/api/v1" + endpoint
    result = client.post(path, json=body)
    assert result.status_code == 200, result.text
    assert result.json()["rdkit_version"]
    assert client.post(path, json=body, headers={"origin": "https://outside.example"}).status_code == 403
    assert client.post(path, json=body, headers={"sec-fetch-site": "cross-site"}).status_code == 403
    monkeypatch.setenv("X_SYNTH_AUTH_MODE", "askcos")
    assert client.post(path, json=body).status_code == 401
    assert client.post(path, json=body, headers={"authorization": "Bearer wrong"}).status_code == 401
    assert client.post(path, json=body, headers={"authorization": "Bearer test-approved"}).status_code == 200


@pytest.mark.parametrize("body", [{"smiles": "CCO", "route_verified": True}, {"smiles": "*"}, {"smiles": "C" * 257}, {"smiles": 123}, {"smiles": "C" * 8193}])
def test_structure_and_request_bounds(client, body):
    assert client.post("/api/v1/assessment/molecule", json=body).status_code == 422


@pytest.mark.parametrize("value", [float("nan"), float("inf"), -1, True, "1"])
def test_finite_typed_mass_validation_is_json_safe(client, value):
    body = batch()
    body["materials"][0]["mass"]["value"] = value
    response = client.post("/api/v1/process/metrics", content=json.dumps(body), headers={"content-type": "application/json"})
    assert response.status_code == 422
    assert isinstance(response.json()["detail"], list)


def test_missing_sa_assets_are_unavailable_not_a_fallback_score(client, monkeypatch):
    def unavailable(_):
        raise AssessmentUnavailable("SA fragment data unavailable")
    monkeypatch.setattr("packages.chemistry.assessment._sa_score", unavailable)
    response = client.post("/api/v1/assessment/molecule", json={"smiles": "CCO"})
    assert response.status_code == 503
    assert "components" not in response.json()


def test_payload_budget_and_no_route_or_job_operations(client):
    assert client.post("/api/v1/process/metrics", content=b"{}", headers={"content-length": str(10 * 1024 * 1024 + 1)}).status_code == 413
    assert client.get("/api/v1/process/metrics").status_code == 405
    assert client.post("/api/v1/jobs", json={}).status_code == 404
    schema = client.get("/openapi.json").json()
    for path in ["/api/v1/assessment/molecule", "/api/v1/process/metrics"]:
        assert "$ref" in schema["paths"][path]["post"]["responses"]["200"]["content"]["application/json"]["schema"]


@pytest.mark.parametrize("factory,kind,path,body", [
    (assessment_router, "assessment", "/assessment/molecule", {"smiles": "C[C@H](F)Cl"}),
    (process_router, "process", "/process/metrics", batch()),
])
def test_parent_repository_callback_keeps_authenticated_owner_and_record_id(monkeypatch, factory, kind, path, body):
    monkeypatch.setenv("X_SYNTH_AUTH_MODE", "local")
    calls = []
    def run_analysis(*, owner, kind, inputs, execute):
        calls.append((owner, kind, inputs))
        return {**execute(), "record_id": "a" * 32}
    app = FastAPI()
    app.include_router(factory(transport=IdentityTransport(), budget=PerformanceBudget(), run_analysis=run_analysis), prefix="/api/v1")
    with TestClient(app, base_url="http://127.0.0.1", client=("127.0.0.1", 50001)) as client:
        response = client.post("/api/v1" + path, json=body)
        assert response.status_code == 200, response.text
        assert response.json()["record_id"] == "a" * 32
        assert calls[0][0:2] == ("local_workspace", kind)
        if kind == "assessment":
            assert calls[0][2]["smiles"] == body["smiles"]
        else:
            assert calls[0][2]["product"] == body["product"]
        assert client.post("/api/v1" + path, json=body, headers={"sec-fetch-site": "cross-site"}).status_code == 403
        assert len(calls) == 1


def test_record_id_is_output_only_and_uses_shared_repository_format(client):
    for model, result in [
        (MolecularAssessment, assess_molecule("CCO")),
        (ProcessResult, calculate_process(ProcessInput.model_validate(batch()))),
    ]:
        assert model.model_validate({**result.model_dump(), "record_id": "c" * 32}).record_id == "c" * 32
        for record_id in ["C" * 32, "a" * 31, "opaque/id"]:
            with pytest.raises(ValidationError):
                model.model_validate({**result.model_dump(), "record_id": record_id})
    assert client.post("/api/v1/assessment/molecule", json={"smiles": "CCO", "record_id": "c" * 32}).status_code == 422
    assert client.post("/api/v1/process/metrics", json={**batch(), "record_id": "c" * 32}).status_code == 422


@pytest.mark.parametrize("factory,kind,path,body", [
    (assessment_router, "assessment", "/assessment/molecule", {"smiles": "N[C@@H](C)C(=O)O"}),
    (process_router, "process", "/process/metrics", batch()),
])
def test_actual_parent_repository_round_trip_retains_typed_output(tmp_path, monkeypatch, factory, kind, path, body):
    monkeypatch.setenv("X_SYNTH_AUTH_MODE", "local")
    repository = AnalysisRepository(tmp_path / "analyses.sqlite")
    transport, budget = IdentityTransport(), PerformanceBudget()
    app = FastAPI()
    app.include_router(factory(transport=transport, budget=budget, run_analysis=analysis_runner(repository)), prefix="/api/v1")
    app.include_router(analysis_router(repository=repository, transport=transport), prefix="/api/v1")
    with TestClient(app, base_url="http://127.0.0.1", client=("127.0.0.1", 50001)) as client:
        response = client.post("/api/v1" + path, json=body)
        assert response.status_code == 200, response.text
        result = response.json()
        record = client.get("/api/v1/analyses/" + result["record_id"]).json()
        assert record["status"] == "completed"
        assert record["kind"] == kind
        assert record["result"] == {**result, "record_id": None}
        with pytest.raises(KeyError):
            repository.get(result["record_id"], "foreign_owner")
