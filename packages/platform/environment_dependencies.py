"""Read-only dependencies and inactive integrations, not an engine registry."""

from __future__ import annotations

import sqlite3
from collections import OrderedDict
from copy import deepcopy
from pathlib import Path
from threading import Lock
from time import monotonic

from packages.knowledge_base.template_library import TemplateLibraryService
from packages.platform.immutable_sqlite import ImmutableSQLiteError, file_identity

from .native_capability_catalog import REPO_ROOT

_template_cache = None
_template_lock = Lock()
_template_services = OrderedDict()


def inactive_integrations() -> list[dict]:
    return [
        {
            "id": "aizynthfinder",
            "active": False,
            "status": "adapter_unwired",
            "source_path": "packages/adapters/aizynthfinder",
            "source_present": (
                REPO_ROOT / "packages/adapters/aizynthfinder/client.py"
            ).is_file(),
            "runtime_verified": False,
        },
        {
            "id": "llm",
            "active": False,
            "status": "deferred",
            "source_path": "packages/adapters/llm",
            "source_present": (REPO_ROOT / "packages/adapters/llm/review.py").is_file(),
            "runtime_verified": False,
        },
        {
            "id": "codex",
            "active": False,
            "status": "not_integrated",
            "runtime_verified": False,
        },
        {
            "id": "deepretro",
            "active": False,
            "status": "not_integrated",
            "runtime_verified": False,
            "reason": "legacy_conda_environment_name_only",
        },
    ]


def template_asset_status(path: str | None, *, cache_seconds: float) -> dict:
    global _template_cache
    if not path:
        return {"status": "unavailable", "reason": "not_configured"}
    if Path(path).suffix.lower() not in {".sqlite", ".sqlite3", ".db"}:
        return {"status": "unavailable", "reason": "invalid_index_path"}
    with _template_lock:
        now = monotonic()
        try:
            resolved = Path(path).absolute()
            identity = file_identity(resolved)
            key = (str(resolved), identity)
            service = _template_services.get(key)
            if service is None:
                service = TemplateLibraryService(resolved)
                _template_services[key] = service
                while len(_template_services) > 4:
                    _template_services.popitem(last=False)
            _template_services.move_to_end(key)
            service.check_snapshot()
            if (
                _template_cache and _template_cache[0] == key
                and now - _template_cache[1] < cache_seconds
            ):
                if file_identity(resolved) != identity:
                    raise ImmutableSQLiteError("Template snapshot changed during polling")
                return deepcopy(_template_cache[2])
            summary = service.summary()
            if file_identity(resolved) != identity:
                raise ImmutableSQLiteError("Template snapshot changed during polling")
            result = {
                "status": "ready",
                "authority": "/api/v1/template-library/health",
                **{
                    key: summary[key]
                    for key in (
                        "template_count",
                        "source_count",
                        "sources",
                        "domains",
                        "directions",
                    )
                },
            }
            if "strategy_availability" in summary:
                result["strategy_availability"] = summary["strategy_availability"]
        except (OSError, ValueError, sqlite3.Error, KeyError):
            result = {"status": "unavailable", "reason": "template_index_unavailable"}
            return result
        _template_cache = (key, monotonic(), result)
        return deepcopy(result)


def dependency_inventory(*, health: dict, template_library: dict | None = None) -> dict:
    checks = health.get("service_checks", {})
    return {
        "mongo": {
            "status": "ready" if checks.get("gateway") is True else "unavailable",
            "evidence": "native_gateway_database_readiness",
            "direct_probe": False,
        },
        "sqlite_workspace": {
            "status": "not_probed",
            "role": "product_jobs_and_route_documents",
        },
        "commercial_stock": {
            "status": "ready"
            if checks.get("commercial_stock") is True
            else "unavailable",
            "inventory_consistent": checks.get("inventory_consistent") is True,
            "snapshot": deepcopy(health.get("stock_snapshot")),
        },
        "native_models": {
            "status": "ready"
            if checks.get("configured_models_loaded") is True
            and checks.get("template_relevance") is True
            else "unavailable",
            "evidence": "configured_models_loaded",
        },
        "template_library": template_library
        or {"status": "not_observed", "authority": "/api/v1/template-library/health"},
    }
