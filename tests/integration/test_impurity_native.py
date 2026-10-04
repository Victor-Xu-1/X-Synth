"""Real model execution acceptance, not a benchmark of impurity chemistry.

Requires the native 9941 service with actual forward/FF dependencies. No
expected impurity structures are manufactured or calibrated into assertions.
"""

import json
import os
from urllib.request import urlopen

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from apps.api.impurity_routes import impurity_router
from apps.api.analysis_routes import analysis_router, analysis_runner
from packages.adapters.askcos.impurities import ImpurityAdapter, ImpurityInput, canonical_input
from packages.platform.performance import PerformanceBudget
from packages.workspace.analysis_repository import AnalysisRepository


def native_ready():
    url = os.environ.get("X_SYNTH_IMPURITY_URL", "http://127.0.0.1:9941")
    with urlopen(url + "/health/ready", timeout=10) as response:
        return json.load(response)


@pytest.fixture(scope="module")
def native_result():
    url = os.environ.get("X_SYNTH_IMPURITY_URL", "http://127.0.0.1:9941")
    ready = native_ready()
    assert ready["check_mapping"] is True
    assert ready["cpu_threads"] == PerformanceBudget.from_environment().model_threads
    body = canonical_input(ImpurityInput(
        reactants=["CC(=O)Cl", "CN"], known_product="CNC(C)=O", solvents=["CO"], count=10,
    ))
    result = ImpurityAdapter(url).predict(body)
    assert result.provenance.model_dump() == ready["provenance"]
    return body, result


def test_actual_five_modes_neural_mapping_and_nonexperimental_scores(native_result):
    body, result = native_result
    assert result.inputs == body
    assert result.execution.modes_completed == [1, 2, 3, 4, 5]
    assert result.execution.forward_calls > 1
    assert result.execution.mapping_calls > 0
    assert result.candidates
    assert result.known_major_product.evidence_type == "user_supplied_reference"
    assert all(row.product != body.known_product for row in result.candidates)
    for row in result.candidates:
        assert row.mapping.mapped_reaction.count(">>") == 1
        assert row.mapping.mode_consistent
        for origin in row.origins:
            assert origin.log_probability <= 0
            assert 0 <= origin.feasibility_score <= 1
            assert 0 <= origin.mapping_confidence <= 1
            assert all(item.fraction > 0.3 for item in origin.required_fragments)


def test_product_router_auth_actual_native_and_shared_history(native_result, monkeypatch, tmp_path):
    body, _ = native_result
    monkeypatch.setenv("X_SYNTH_AUTH_MODE", "local")
    repository = AnalysisRepository(tmp_path / "analyses.sqlite")
    def read_health():
        ready = native_ready()
        return {"service_checks": {"impurity": ready["status"] == "ready" and ready["check_mapping"] is True}}
    app = FastAPI()
    app.include_router(impurity_router(transport=None, budget=PerformanceBudget(), read_health=read_health,
                                      run_analysis=analysis_runner(repository)), prefix="/api/v1")
    app.include_router(analysis_router(repository=repository, transport=None), prefix="/api/v1")
    with TestClient(app, base_url="http://127.0.0.1", client=("127.0.0.1", 50001)) as client:
        response = client.post("/api/v1/impurities/predict", json=body.model_dump())
        assert response.status_code == 200, response.text
        result = response.json()
        record = client.get("/api/v1/analyses/" + result["record_id"]).json()
        assert record["kind"] == "impurity" and record["status"] == "completed"
        assert record["inputs"] == body.model_dump(mode="json")
        assert record["result"] == {**result, "record_id": None}
        with pytest.raises(KeyError):
            repository.get(result["record_id"], "foreign_owner")
        assert client.post("/api/v1/impurities/predict", json=body.model_dump(), headers={"sec-fetch-site": "cross-site"}).status_code == 403
        assert repository.list("local_workspace")["total"] == 1
