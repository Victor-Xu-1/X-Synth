"""Safe deployment inventory; model execution and lifecycle remain in adapters."""

from __future__ import annotations

import platform
from datetime import UTC, datetime

from .environment_dependencies import (
    dependency_inventory,
    inactive_integrations,
)
from .native_capabilities import native_inventory, native_operations
from .native_capability_catalog import configured_model_names

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
    "condition_recommender",
    "forward_predictor",
    "impurity",
)


def environment_snapshot(
    *,
    health: dict,
    runtime: dict,
    configured_models: str,
    template_library: dict | None = None,
) -> dict:
    checks = health.get("service_checks", {})
    resources = runtime.get("resources", {})
    known_models, unknown_count = configured_model_names(configured_models)
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
                "unrecognized_model_count": unknown_count,
                "models_verified": bool(known_models)
                and unknown_count == 0
                and checks.get("configured_models_loaded") is True,
                "available_strategies": health.get("available_strategies", []),
                "service_ids": list(ENGINE_SERVICES),
            }
        ],
        "native": native_inventory(
            health=health, runtime=runtime, configured_models=configured_models
        ),
        "integrations": inactive_integrations(),
        "scientific_engines": [
            {"id": identifier, "name": name, "purpose": purpose,
             "ready": health.get("scientific_engines", {}).get(identifier, {}).get("ready") is True,
             "versions": health.get("scientific_engines", {}).get(identifier, {}).get("versions", {})}
            for identifier, name, purpose in (
                ("optimization", "BayBE / BoTorch", "实测实验优化"),
                ("assessment", "RDKit", "结构描述符与复杂度"),
                ("process", "RDKit / 物料核算", "录入批次质量与 PMI"),
            )
        ],
        "dependencies": dependency_inventory(
            health=health, template_library=template_library
        ),
        "operations": native_operations(),
        "health": health,
        "runtime": runtime,
    }
