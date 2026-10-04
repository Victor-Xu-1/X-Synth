"""Authenticated USPTO reference retrieval, never neural condition prediction."""

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from packages.adapters.askcos.references import (
    ReferenceAdapter,
    ReferenceError,
    ReferenceSearchInput,
    ReferenceSearchResponse,
    ReferenceStatus,
)
from packages.workspace.http_validation import WorkspaceRoute

from .security import authenticate


def reference_router(*, transport, budget):
    router = APIRouter(prefix="/references", route_class=WorkspaceRoute)
    adapter = ReferenceAdapter(transport)

    @router.get("/status", response_model=ReferenceStatus)
    def status(request: Request):
        authenticate(request, transport)
        snapshot = adapter.status()
        if not snapshot.ready:
            return JSONResponse(
                status_code=503, content=snapshot.model_dump(mode="json")
            )
        return snapshot

    @router.post("/search", response_model=ReferenceSearchResponse)
    def search(body: ReferenceSearchInput, request: Request):
        authenticate(request, transport)
        try:
            return adapter.search(body, max_atoms=budget.max_structure_atoms)
        except ReferenceError as exc:
            raise HTTPException(exc.status, {"code": exc.code}) from exc
        except ValueError as exc:
            raise HTTPException(
                422, {"code": "invalid_reference_structure", "message": str(exc)}
            ) from exc

    return router
