from __future__ import annotations

import subprocess
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "runtime" / "manifests" / "services.yaml"

VALID_PROFILES = {
    "core",
    "retro-basic",
    "route-tree",
    "context",
    "analysis",
    "auth",
    "full",
}


def load_manifest() -> dict:
    with MANIFEST.open("r", encoding="utf-8") as handle:
        return yaml.safe_load(handle)


def compose_services() -> set[str]:
    output = subprocess.check_output(
        ["docker", "compose", "--profile", "full", "config", "--services"],
        cwd=ROOT,
        text=True,
    )
    return {line.strip() for line in output.splitlines() if line.strip()}


def test_manifest_exists_and_matches_compose_services() -> None:
    manifest = load_manifest()
    services = manifest["services"]

    assert len(services) == 23
    assert set(services) == compose_services()


def test_profiles_are_known_and_each_service_has_one() -> None:
    services = load_manifest()["services"]

    for service_name, service in services.items():
        profiles = service.get("profiles")
        assert profiles, f"{service_name} must declare at least one profile"
        assert set(profiles).issubset(VALID_PROFILES), service_name


def test_ports_are_unique_except_template_relevance_port_range() -> None:
    services = load_manifest()["services"]
    seen: dict[int, str] = {}

    for service_name, service in services.items():
        for port in service.get("ports", []):
            host_port = int(port["host"])
            previous = seen.get(host_port)
            assert previous is None, f"port {host_port} used by {previous} and {service_name}"
            seen[host_port] = service_name


def test_required_manifest_fields_present() -> None:
    services = load_manifest()["services"]

    for service_name, service in services.items():
        assert service.get("label"), service_name
        assert service.get("kind"), service_name
        assert service.get("source"), service_name
        assert service.get("profiles"), service_name


def test_retro_basic_profile_includes_scscore_dependency() -> None:
    services = load_manifest()["services"]

    assert "retro-basic" in services["scscore"]["profiles"]
