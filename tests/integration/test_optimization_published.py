"""Opt-in scientific acceptance using the exact published Shields direct-arylation data.

Download outside Git from Zenodo 15204165, baybe-paper.zip, verified archive MD5
ec8c50f4918a2d7bc48c5fc5269a62b6. The CSV member is
baybe-paper-main/data/direct_arylation.csv (CC-BY-4.0, Fitzner/Merck deposit).
Paper: doi:10.1039/D5DD00050E; data provenance: Shields et al.,
doi:10.1038/s41586-021-03213-y. This is a retrospective software acceptance,
not newly performed chemistry or reproduction of the paper's full benchmarks.
"""

import csv
import hashlib
import json
import os
import random
import time
from io import StringIO
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from apps.api.analysis_routes import analysis_runner
from apps.api.optimization_routes import optimization_router
from packages.adapters.optimization.contracts import OptimizationResult
from packages.adapters.optimization.runtime import OptimizationRuntime
from packages.workspace.analysis_repository import AnalysisRepository

DATASET_SHA256 = "3255e74e3542addfc69afbf61cee9c4962b6fc85c95abf94d1ef3386a95ced9c"


def published_request(path):
    content = Path(path).read_text(encoding="utf-8")
    assert hashlib.sha256(content.encode()).hexdigest() == DATASET_SHA256
    rows = list(csv.DictReader(StringIO(content)))
    names = [name for name in rows[0] if name != "yield"]
    factors = []
    for name in names:
        values = list(dict.fromkeys(row[name] for row in rows))
        kind = "numerical" if name in ("Concentration", "Temp_C") else "categorical"
        factors.append(
            {
                "name": name,
                "kind": kind,
                "values": [float(value) for value in values]
                if kind == "numerical"
                else values,
            }
        )
    selected = sorted(random.Random(2026).sample(range(1, len(rows) + 1), 48))
    return {
        "content": content,
        "table_sha256": DATASET_SHA256,
        "selected_rows": selected,
        "factors": factors,
        "target": {
            "name": "yield",
            "kind": "yield_percent",
            "direction": "maximize",
            "unit": "%",
        },
        "batch_size": 3,
        "seed": 42,
        "confirmed_measurements": True,
        "confirmed_candidates": True,
    }, rows


@pytest.mark.parametrize("direction", ["maximize", "minimize"])
def test_official_baybe_recommend_via_authenticated_api_with_published_measurements(
    monkeypatch, tmp_path, direction
):
    path = os.environ.get("X_SYNTH_OPTIMIZATION_DATASET")
    python = os.environ.get("X_SYNTH_OPTIMIZATION_PYTHON")
    if not path or not python:
        pytest.skip(
            "Explicit published dataset cache and isolated BayBE Python are required."
        )
    body, lookup = published_request(path)
    if direction == "minimize":
        body["target"].update(kind="response", direction="minimize")
    monkeypatch.setenv("X_SYNTH_AUTH_MODE", "local")
    app = FastAPI()
    repository = AnalysisRepository(tmp_path / "analyses.sqlite")
    app.include_router(
        optimization_router(
            transport=None,
            runtime=OptimizationRuntime(python=Path(python)),
            run_analysis=analysis_runner(repository),
        ),
        prefix="/api/v1",
    )
    with TestClient(
        app, base_url="http://127.0.0.1:8769", client=("127.0.0.1", 50000)
    ) as client:
        assert client.get("/api/v1/optimization/health").json()["ready"] is True
        started = time.monotonic()
        response = client.post("/api/v1/optimization/recommend", json=body)
        elapsed = time.monotonic() - started
    assert response.status_code == 200, response.text
    result = OptimizationResult.model_validate(response.json())
    assert result.measurement_count == 48 and len(result.recommendations) == 3
    assert result.versions["baybe"] == "0.15.0"
    assert (
        result.surrogate == "GaussianProcessSurrogate"
        and result.acquisition == "qLogExpectedImprovement"
    )
    assert result.empirically_confirmed is False
    stored = repository.get(result.record_id, "local_workspace")
    assert stored["kind"] == "optimization" and stored["status"] == "completed"
    assert len(stored["inputs"]["selected_rows"]) == 48
    assert (
        hashlib.sha256(stored["inputs"]["content"].encode()).hexdigest()
        == stored["inputs"]["table_sha256"]
        == DATASET_SHA256
    )
    names = [factor["name"] for factor in body["factors"]]
    condition_key = lambda row: tuple(
        str(row[name]) if name not in ("Concentration", "Temp_C") else float(row[name])
        for name in names
    )
    measured = {condition_key(lookup[index - 1]) for index in body["selected_rows"]}
    held_out = {
        condition_key(row): float(row["yield"])
        for row in lookup
        if condition_key(row) not in measured
    }
    retrospective = []
    for row in result.recommendations:
        key = condition_key(row.conditions)
        assert key in held_out and key not in measured
        retrospective.append(
            {
                "conditions": row.conditions,
                "published_held_out_yield_percent": held_out[key],
            }
        )
    best = min if direction == "minimize" else max
    assert result.best_observed == best(
        float(lookup[index - 1]["yield"]) for index in body["selected_rows"]
    )
    exported = list(csv.DictReader(StringIO(result.csv_content)))
    assert all(
        row["yield"] == "" and row["empirically_confirmed"] == "false"
        for row in exported
    )
    evidence = os.environ.get("X_SYNTH_OPTIMIZATION_EVIDENCE_DIR")
    report = {
        "elapsed_seconds": elapsed,
        "direction": direction,
        "result": result.model_dump(mode="json"),
        "retrospective_lookup_not_new_experiments": retrospective,
        "dataset_sha256": DATASET_SHA256,
        "dataset_version_doi": "10.5281/zenodo.15204165",
        "dataset_license": "CC-BY-4.0",
    }
    if evidence:
        directory = Path(evidence).absolute()
        assert Path(__file__).resolve().parents[2] not in directory.parents
        directory.mkdir(parents=True, exist_ok=True)
        filename = (
            "published-acceptance.json"
            if direction == "maximize"
            else "published-minimize-acceptance.json"
        )
        (directory / filename).write_text(
            json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8"
        )
    print(
        json.dumps(
            {
                "elapsed_seconds": elapsed,
                "direction": direction,
                "measurements": 48,
                "candidate_count": result.candidate_count,
                "recommendations": retrospective,
                "best_observed_percent": result.best_observed,
            },
            ensure_ascii=False,
        )
    )
