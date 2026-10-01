from __future__ import annotations

import json
import subprocess
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "runtime" / "manifests" / "services.yaml"


def compose_config(*args: str) -> dict:
    output = subprocess.check_output(
        ["docker", "compose", *args, "config", "--format", "json"],
        cwd=ROOT,
        text=True,
    )
    return json.loads(output)


def manifest_services_for_profile(profile: str) -> set[str]:
    with MANIFEST.open("r", encoding="utf-8") as handle:
        services = yaml.safe_load(handle)["services"]
    return {
        name
        for name, service in services.items()
        if profile in service.get("profiles", [])
    }


def service_names(config: dict) -> set[str]:
    return set(config["services"])


def test_default_config_is_core_runtime_only() -> None:
    config = compose_config()

    assert service_names(config) == manifest_services_for_profile("core")


def test_full_profile_contains_every_manifest_service() -> None:
    config = compose_config("--profile", "full")

    with MANIFEST.open("r", encoding="utf-8") as handle:
        manifest_services = set(yaml.safe_load(handle)["services"])
    assert service_names(config) == manifest_services


def test_auth_profile_adds_keycloak_without_full_stack() -> None:
    config = compose_config("--profile", "auth")

    names = service_names(config)
    assert {"keycloak", "keycloak-db"}.issubset(names)
    assert "retro_template_relevance" not in names
    assert "mcts" not in names


def test_route_tree_profile_contains_required_route_services() -> None:
    config = compose_config("--profile", "route-tree")
    names = service_names(config)

    assert manifest_services_for_profile("route-tree").issubset(names)
    assert "keycloak" not in names
    assert "keycloak-db" not in names


def test_retro_basic_profile_contains_scscore_dependency() -> None:
    config = compose_config("--profile", "retro-basic")
    names = service_names(config)

    assert "scscore" in names
