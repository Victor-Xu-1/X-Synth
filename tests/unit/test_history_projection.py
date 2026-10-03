"""Preserved native results remain viewable without new closure claims."""

import json
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from apps.api.job_views import route_result
from packages.workspace.history_projection import historical_routes


def native_payload():
    path = (
        Path(__file__).resolve().parents[1]
        / "fixtures/askcos/diphenhydramine_retrostar_result.json"
    )
    return json.loads(path.read_text(encoding="utf-8"))


def test_native_uds_projection_preserves_steps_but_does_not_recertify_closure():
    payload = native_payload()
    before = deepcopy(payload)
    routes = historical_routes(payload)
    assert routes
    assert all(route["steps"] for route in routes)
    assert all(route["engine"] == "askcos_history" for route in routes)
    assert all(route["closed"] is False for route in routes)
    assert all(route["closure_sources"] == [] for route in routes)
    assert all(route["route_score"] is None for route in routes)
    assert all(route["metadata"]["historical_unreviewed"] for route in routes)
    assert payload == before


def test_historical_result_uses_shared_viewer_and_retains_immutable_native_artifact(
    tmp_path,
):
    identifier = "a" * 32
    directory = tmp_path / identifier
    directory.mkdir()
    path = directory / "native-history.json"
    payload = native_payload()
    path.write_text(json.dumps(payload), encoding="utf-8")
    original = path.read_bytes()
    job = {
        "id": identifier,
        "status": "legacy_completed",
        "summary": {
            "origin": "askcos_history",
            "commercial_closure_revalidated": False,
        },
    }
    result = route_result(
        job, artifacts=tmp_path, budget=SimpleNamespace(response_bytes=32 * 1024**2)
    )
    assert result["result_state"] == "legacy_completed"
    assert result["result"]["unified_route_pool"]["selected_routes"]
    assert result["history_provenance"]["commercial_closure_revalidated"] is False
    assert path.read_bytes() == original
    with pytest.raises(HTTPException) as error:
        route_result(
            job,
            artifacts=tmp_path,
            budget=SimpleNamespace(response_bytes=len(original)),
        )
    assert error.value.status_code == 413
