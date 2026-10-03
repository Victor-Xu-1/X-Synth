"""Authenticated read-only environment inventory, with no shell-control API."""

import os

from fastapi import APIRouter, Request

from packages.platform.environments import environment_snapshot

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
        )

    return router
