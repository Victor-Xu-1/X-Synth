from __future__ import annotations

import ssl
import urllib.error
import urllib.request
from typing import Any

from runtime.manifest_loader import load_runtime_manifest


def probe_endpoint(url: str, timeout: float = 1.5) -> dict[str, Any]:
    context = ssl.create_default_context() if url.startswith("https://") else None
    try:
        with urllib.request.urlopen(url, timeout=timeout, context=context) as response:
            return {
                "status": "healthy",
                "http_status": response.status,
            }
    except urllib.error.HTTPError as exc:
        return {
            "status": "responding",
            "http_status": exc.code,
        }
    except Exception as exc:  # noqa: BLE001 - this is a status probe boundary.
        return {
            "status": "unavailable",
            "error": exc.__class__.__name__,
        }


def build_services_payload(*, probe: bool = False) -> dict[str, Any]:
    manifest = load_runtime_manifest()
    services = {}

    for service_name, service in manifest["services"].items():
        health_endpoint = service.get("health_endpoint")
        health = {"status": "not_probed"}
        if probe and health_endpoint:
            health = probe_endpoint(health_endpoint)

        services[service_name] = {
            "label": service["label"],
            "kind": service["kind"],
            "source": service["source"],
            "profiles": service["profiles"],
            "ports": service.get("ports", []),
            "health_endpoint": health_endpoint,
            "health": health,
        }

    return {
        "entrypoints": manifest.get("entrypoints", {}),
        "profiles": manifest["profiles"],
        "service_count": len(services),
        "services": services,
    }


def build_capabilities_payload(*, probe: bool = False) -> dict[str, Any]:
    services_payload = build_services_payload(probe=probe)
    services = services_payload["services"]
    retrosynthesis_models = []

    for service_name, service in load_runtime_manifest()["services"].items():
        for model_id in service.get("models", []):
            retrosynthesis_models.append({
                "id": model_id,
                "label": model_id.replace("_", " "),
                "service": service_name,
                "profiles": service["profiles"],
                "health": services[service_name]["health"],
            })

    return {
        "entrypoints": services_payload["entrypoints"],
        "profiles": services_payload["profiles"],
        "service_count": services_payload["service_count"],
        "retrosynthesis_models": retrosynthesis_models,
        "service_kinds": sorted({service["kind"] for service in services.values()}),
    }


def get_runtime_capabilities(probe: bool = False) -> dict[str, Any]:
    return build_capabilities_payload(probe=probe)


def get_runtime_services(probe: bool = False) -> dict[str, Any]:
    return build_services_payload(probe=probe)
