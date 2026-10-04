"""Product-authenticated reaction optimization; mounted by the parent app owner."""

from fastapi import APIRouter, HTTPException, Request

from packages.adapters.optimization.contracts import (
    OptimizationRequest,
    OptimizationResult,
    RuntimeHealth,
    TableInput,
    TablePreview,
)
from packages.adapters.optimization.prepare import prepare_experiment
from packages.adapters.optimization.runtime import (
    OptimizationError,
    OptimizationRuntime,
)
from packages.adapters.optimization.tables import inspect_table
from packages.workspace.http_validation import WorkspaceRoute

from .security import authenticate


def optimization_router(
    *, transport, run_analysis, runtime: OptimizationRuntime | None = None
):
    if not callable(run_analysis):
        raise TypeError(
            "Optimization product routes require the shared persisted analysis runner."
        )
    router = APIRouter(prefix="/optimization", route_class=WorkspaceRoute)
    engine = runtime if runtime is not None else OptimizationRuntime()

    @router.get("/health", response_model=RuntimeHealth)
    def health(request: Request):
        authenticate(request, transport)
        return engine.health()

    @router.post("/inspect", response_model=TablePreview)
    def inspect(body: TableInput, request: Request):
        authenticate(request, transport)
        try:
            return inspect_table(body.content)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc

    @router.post(
        "/recommend",
        response_model=OptimizationResult,
        response_model_exclude_none=True,
    )
    def recommend(body: OptimizationRequest, request: Request):
        principal = authenticate(request, transport)
        try:
            prepare_experiment(body)
            inputs = body.model_dump(mode="json")
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        try:
            return run_analysis(
                owner=principal.owner,
                kind="optimization",
                inputs=inputs,
                execute=lambda: engine.recommend(body).model_dump(mode="json"),
            )
        except OptimizationError as exc:
            raise HTTPException(exc.status, str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(
                422, "实测输入无效或超过研究记录存储上限，请核对并缩小记录。"
            ) from exc

    return router
