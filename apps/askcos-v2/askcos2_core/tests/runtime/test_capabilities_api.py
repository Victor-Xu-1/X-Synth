from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from runtime.capabilities import build_capabilities_payload, build_services_payload


def test_capabilities_include_profiles_and_retrosynthesis_models() -> None:
    payload = build_capabilities_payload(probe=False)

    assert "profiles" in payload
    assert "retro-basic" in payload["profiles"]
    assert "route-tree" in payload["profiles"]
    model_ids = {model["id"] for model in payload["retrosynthesis_models"]}
    assert "reaxys" in model_ids
    assert "pistachio" in model_ids
    assert "uspto_higher_level" in model_ids


def test_services_payload_contains_manifest_services() -> None:
    payload = build_services_payload(probe=False)

    assert payload["service_count"] == 23
    assert "web" in payload["services"]
    assert "keycloak" in payload["services"]
    assert payload["services"]["keycloak"]["profiles"] == ["auth", "full"]


def test_runtime_routes_are_registered() -> None:
    source = (ROOT / "app.py").read_text(encoding="utf-8")

    assert 'runtime_router = APIRouter(prefix="/api/runtime")' in source
    assert 'path="/capabilities"' in source
    assert 'path="/services"' in source
