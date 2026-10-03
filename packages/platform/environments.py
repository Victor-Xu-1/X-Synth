"""Safe deployment inventory; model execution and lifecycle remain in adapters."""

from __future__ import annotations

import platform
from datetime import UTC, datetime

MODEL_NAMES = frozenset({"pistachio", "pistachio_ringbreaker"})
ENGINE_SERVICES = (
    "gateway",
    "expand_one",
    "mcts",
    "retro_star",
    "template_relevance",
    "fast_filter",
    "scscore",
    "pathway_ranker",
    "value_network",
    "cluster",
)


def environment_snapshot(
    *, health: dict, runtime: dict, configured_models: str
) -> dict:
    checks = health.get("service_checks", {})
    resources = runtime.get("resources", {})
    configured = set(configured_models.split(","))
    configured = {name.strip() for name in configured if name.strip()}
    # Configuration mistakes must not expose secrets placed in a model field.
    known_models = sorted(configured & MODEL_NAMES)
    ready = health.get("backends", {}).get("askcos_v2") is True
    status = (
        "ready"
        if ready
        else "degraded"
        if any(checks.get(name) is True for name in ENGINE_SERVICES)
        else "unavailable"
    )
    services = resources.get("services", {})
    return {
        "schema_version": 1,
        "observed_at": datetime.now(UTC).isoformat(),
        "platform": {
            "name": "X-Synth",
            "version": health.get("version"),
            "build": health.get("build", {}),
            "python_version": platform.python_version(),
            "system": "WSL"
            if "microsoft" in platform.release().lower()
            else platform.system(),
            "access_mode": "local"
            if health.get("auth_mode") == "local"
            else "authenticated",
            "entrypoint": "scripts.operations.serve_platform",
        },
        "engines": [
            {
                "id": "askcos_v2",
                "name": "ASKCOS V2",
                "backend": "askcos",
                "role": "retrosynthesis",
                "active": True,
                "status": status,
                "runtime_mode": "supervised_native"
                if services
                else "external_services",
                "configured_models": known_models,
                "unrecognized_model_count": len(configured - MODEL_NAMES),
                "models_verified": checks.get("configured_models_loaded") is True,
                "available_strategies": health.get("available_strategies", []),
                "service_ids": list(ENGINE_SERVICES),
            }
        ],
        "health": health,
        "runtime": runtime,
    }
