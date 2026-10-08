"""Prediction/replay binding with real validation, auth and immutable records.

The adapter is isolated here; trained-model acceptance is a separate live check.
"""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from apps.api.condition_routes import condition_router
from packages.adapters.askcos.conditions import ConditionAdapter
from packages.platform.performance import PerformanceBudget
from packages.workspace.analysis_execution import analysis_runner
from packages.workspace.analysis_repository import AnalysisRepository


@pytest.fixture
def setup_client(tmp_path, monkeypatch):
    monkeypatch.setenv("X_SYNTH_AUTH_MODE", "local")
    calls = []

    def predict(_self, **body):
        calls.append(body)
        return {**body, "conditions": []}

    monkeypatch.setattr(ConditionAdapter, "predict", predict)
    repository = AnalysisRepository(tmp_path / "analyses.sqlite")
    app = FastAPI()
    app.include_router(condition_router(
        transport=None,
        budget=PerformanceBudget.from_environment(),
        read_health=lambda: {"service_checks": {"condition_recommender": True}},
        run_analysis=analysis_runner(repository),
    ), prefix="/api/v1")
    with TestClient(app, base_url="http://127.0.0.1:8769", client=("127.0.0.1", 50000)) as client:
        yield client, repository, calls


def test_full_reaction_is_saved_separately_without_changing_model_payload(setup_client):
    client, repository, calls = setup_client
    response = client.post("/api/v1/conditions/predict", json={
        "reactants": "CCO", "product": "CC=O", "count": 2,
        "reaction_smiles": "CCO>O>CC=O.CO",
    })
    assert response.status_code == 200
    row = repository.get(response.json()["record_id"], "local_workspace")
    assert row["inputs"] == {
        "reactants": "CCO", "product": "CC=O", "count": 2,
        "reaction_context": {"reaction_smiles": "CCO>O>CC=O.CO", "selected_product": "CC=O"},
    }
    assert calls == [{"reactants": "CCO", "product": "CC=O", "count": 2}]


def test_legacy_clients_do_not_acquire_invented_reaction_context(setup_client):
    client, repository, calls = setup_client
    response = client.post("/api/v1/conditions/predict", json={"reactants": "CCO", "product": "CC=O"})
    assert response.status_code == 200
    assert repository.get(response.json()["record_id"], "local_workspace")["inputs"] == {
        "reactants": "CCO", "product": "CC=O", "count": 5,
    }
    assert calls == [{"reactants": "CCO", "product": "CC=O", "count": 5}]


@pytest.mark.parametrize("context", ["CCN>O>CC=O", "CCO>O>CO", "CCO", "", "CCO>>[13CH3]C=O"])
def test_mismatched_context_is_refused_before_execution_or_record_creation(setup_client, context):
    client, repository, calls = setup_client
    response = client.post("/api/v1/conditions/predict", json={
        "reactants": "CCO", "product": "CC=O", "reaction_smiles": context,
    })
    assert response.status_code == 422
    assert calls == []
    assert repository.list("local_workspace")["total"] == 0


@pytest.mark.parametrize("headers", [{"Origin": "https://evil.example"}, {"Sec-Fetch-Site": "cross-site"}, {"Host": "evil.example"}])
def test_full_context_obeys_existing_local_security_boundary(setup_client, headers):
    client, repository, calls = setup_client
    assert client.post("/api/v1/conditions/predict", headers=headers, json={
        "reactants": "CCO", "product": "CC=O", "reaction_smiles": "CCO>>CC=O",
    }).status_code == 403
    assert calls == [] and repository.list("local_workspace")["total"] == 0
