"""Authenticated read-only environment inventory, with no shell-control API."""

import os

from fastapi import APIRouter, Request

from packages.platform.environment_dependencies import template_asset_status
from packages.platform.environments import environment_snapshot
from packages.platform.performance import PerformanceBudget

from .security import authenticate


def environment_router(*, transport, read_health, read_runtime):
    router = APIRouter()

    @router.get("/environments")
    def environments(request: Request):
        authenticate(request, transport)
        return environment_snapshot(
            health=read_health(),
            runtime=read_runtime(),
            configured_models=os.environ.get(
                "X_SYNTH_ASKCOS_MODELS", "pistachio,pistachio_ringbreaker"
            ),
            template_library=template_asset_status(
                os.environ.get("X_SYNTH_TEMPLATE_LIBRARY_DB"),
                cache_seconds=PerformanceBudget.from_environment().health_cache_seconds,
            ),
        )

    return router
