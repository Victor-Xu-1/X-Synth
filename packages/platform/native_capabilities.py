"""Configured native capability projections and the product proxy boundary."""

from __future__ import annotations

from copy import deepcopy

# Keep public imports bound to the sole implementation and cache owner.
from .environment_dependencies import (
    dependency_inventory,
    inactive_integrations,
    template_asset_status,
)
from .native_capability_catalog import REPO_ROOT, configured_model_names, source_catalog
from .native_runtime import SERVICES

SCIENTIFIC_ENTRYPOINTS = {
    "forward": "/api/v1/reactions/predict",
    "context-recommender": "/api/v1/conditions/predict",
    "condition-recommendation": "/api/v1/conditions/predict",
    "impurity-predictor": "/api/v1/impurities/predict",
}

__all__ = [
    "REPO_ROOT",
    "SCIENTIFIC_ENTRYPOINTS",
    "configured_model_names",
    "dependency_inventory",
    "inactive_integrations",
    "native_inventory",
    "native_operations",
    "native_runtime_payload",
    "optional_proxy_module",
    "source_catalog",
    "template_asset_status",
]


def native_inventory(*, health: dict, runtime: dict, configured_models: str) -> dict:
    catalog = source_catalog()
    checks = health.get("service_checks", {})
    processes = runtime.get("resources", {}).get("services", {})
    models, unknown_count = configured_model_names(configured_models)
    models_verified = (
        bool(models)
        and unknown_count == 0
        and checks.get("configured_models_loaded") is True
    )
    modules = []
    for source in catalog["modules"]:
        module = deepcopy(source)
        ready = module["configured"] and checks.get(module["service_id"]) is True
        if module["id"] == "retro_template_relevance":
            ready = ready and models_verified
        process = processes.get(module["service_id"], {}).get("status")
        module.update(
            ready=ready,
            status="ready"
            if ready
            else "unavailable"
            if module["configured"]
            else "preserved_disabled",
            reason=None
            if ready
            else "dependency_not_ready"
            if module["configured"]
            else "not_configured",
            process_status=process
            if process in {"running", "stopped"}
            else "not_observed",
        )
        modules.append(module)
    return {
        "catalog_status": catalog["status"],
        "catalog_authority": "apps/askcos-v2/askcos2_core/configs/module_config_full.py",
        "configuration_authority": "configs.module_config_x_synth / packages.platform.native_endpoints / native_search_contract",
        "module_count": len(modules),
        "configured_module_count": sum(module["configured"] for module in modules),
        "configured_models": models,
        "unrecognized_model_count": unknown_count,
        "models_verified": models_verified,
        "modules": modules,
    }


def optional_proxy_module(group: str) -> dict | None:
    return next(
        (
            module
            for module in source_catalog()["modules"]
            if group in module["api_prefixes"]
        ),
        None,
    )


def native_operations() -> dict:
    return {
        "call_async": {"supported": False, "reason": "unmanaged_native_queue"},
        "unified_route": {
            "managed": True,
            "endpoint": "/api/v1/unified-route/call-async",
        },
        "expand_one": {
            "endpoint": "/api/tree-search/expand-one/call-sync-without-token"
        },
        "scientific_tools": {"managed": True, "endpoints": dict(SCIENTIFIC_ENTRYPOINTS)},
    }


def native_runtime_payload(
    *, health: dict, configured_models: str, include_services=False
) -> dict:
    inventory = native_inventory(
        health=health, runtime={}, configured_models=configured_models
    )
    checks = health.get("service_checks", {})
    modules = {
        module["service_id"]: module
        for module in inventory["modules"]
        if module["configured"]
    }
    services = {}
    for service_id, service in SERVICES.items():
        module = modules.get(service_id)
        if module is None and service_id != "gateway":
            continue
        ready = module["ready"] if module else checks.get("gateway") is True
        key = (
            "retro_template_relevance"
            if service_id == "template_relevance"
            else "app"
            if service_id == "gateway"
            else service_id
        )
        metadata = source_catalog()["service_metadata"].get(service_id, {})
        services[key] = {
            "service_id": service_id,
            "label": metadata.get("label", key.replace("_", " ")),
            "kind": metadata.get("kind", "native-service"),
            "source": "apps/askcos-v2/" + service.directory,
            "profiles": ["configured"],
            "ports": [{"host": service.port}],
            "port_basis": "resolved_native_configuration",
            "health_endpoint": None,
            "health": {
                "status": "healthy" if ready else "unavailable",
                "ready": ready,
                "source": "cached_product_readiness",
            },
        }
    models = [
        {
            "id": name,
            "label": name.replace("_", " "),
            "service": "retro_template_relevance",
            "backend": "template_relevance",
            "profiles": ["configured"],
            "health": {
                "status": "healthy"
                if services.get("retro_template_relevance", {})
                .get("health", {})
                .get("ready")
                is True
                else "unavailable"
            },
        }
        for name in inventory["configured_models"]
    ]
    result = {
        "schema_version": 1,
        "scope": "configured_native",
        "entrypoints": {"local_ui": "/", "api": "/api/", "product_api": "/api/v1"},
        "profiles": {"configured": {"label": "Configured X-Synth native runtime"}},
        "service_count": len(services),
        "service_kinds": sorted({service["kind"] for service in services.values()}),
        "retrosynthesis_models": models,
        "configured": {
            **{key: value for key, value in inventory.items() if key != "modules"},
            "available_strategies": list(health.get("available_strategies", [])),
            "route_backend_ready": health.get("backends", {}).get("askcos_v2") is True,
        },
        "catalog": {
            "scope": "supported_source_only",
            "profiles": deepcopy(source_catalog()["profiles"]),
            "modules": inventory["modules"],
        },
        "operations": native_operations(),
        "probe_policy": "cached_configured_services_only",
    }
    if include_services:
        result["services"] = services
    return result
