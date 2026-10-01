from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import subprocess

from fastapi.testclient import TestClient

from apps.synon_orchestrator.app import UnifiedRouteRequestBody, create_app
from packages.orchestrator.unified_route_service import REPO_ROOT


def test_actual_frontend_default_is_accepted_by_backend_schema():
    node = os.environ.get("SYNON_TEST_NODE") or shutil.which("node")
    assert node, "Node.js is required to test the actual frontend/backend contract"
    source = REPO_ROOT / "apps/askcos-v2/askcos-vue-nginx/askcos_vue/src/common/unified-route.js"
    javascript = (
        "const mod = await import(process.argv[1]);"
        "console.log(JSON.stringify(mod.buildUnifiedRouteRequestBody({smiles:'CCO'})));"
    )
    result = subprocess.run(
        [node, "--input-type=module", "-e", javascript, source.as_uri()],
        check=True,
        capture_output=True,
        text=True,
        timeout=30,
    )
    parsed = UnifiedRouteRequestBody(**json.loads(result.stdout))
    assert parsed.backend == "all"
    assert parsed.askcos_timeout_sec <= 3600
    assert parsed.min_routes == 3
    assert parsed.max_routes == 10


def test_unavailable_model_does_not_create_a_job(tmp_path, monkeypatch):
    monkeypatch.delenv("SYNON_AIZYNTH_PYTHON", raising=False)
    monkeypatch.setenv("SYNON_ASKCOS_BASE_URL", "http://127.0.0.1:9")
    client = TestClient(create_app(jobs_root=tmp_path))
    assert client.get("/synon-api/health").json()["route_search_ready"] is False
    response = client.post("/synon-api/unified-route/call-async", json={"smiles": "CCO"})
    assert response.status_code == 503
    assert not list(tmp_path.iterdir())


def test_repo_path_follows_the_installed_checkout():
    assert REPO_ROOT == Path(__file__).resolve().parents[2]

