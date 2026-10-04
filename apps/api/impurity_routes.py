"""Authenticated impurity predictions through the shared analysis repository."""

import os

from fastapi import APIRouter, HTTPException, Request

from packages.adapters.askcos.impurities import (
    ImpurityAdapter,
    ImpurityInput,
    ImpurityResult,
    canonical_input,
)
from packages.adapters.askcos.native_models import NativeModelError
from packages.workspace.http_validation import WorkspaceRoute

from .security import authenticate


def impurity_router(*, transport, budget, read_health, run_analysis):
    router = APIRouter(prefix="/impurities", route_class=WorkspaceRoute)
    adapter = ImpurityAdapter(
        os.environ.get("X_SYNTH_IMPURITY_URL", "http://127.0.0.1:9941")
    )

    @router.post("/predict", response_model=ImpurityResult)
    def predict(body: ImpurityInput, request: Request):
        principal = authenticate(request, transport)
        checks = read_health().get("service_checks", {})
        if checks.get("impurity") is not True:
            raise HTTPException(503, "杂质模型或原子映射未就绪，请查看环境部署。")
        try:
            canonical = canonical_input(body, max_atoms=budget.max_structure_atoms)
        except ValueError as exc:
            raise HTTPException(
                422, "无法解析结构，或输入超过杂质分析的原子数限制。"
            ) from exc
        try:
            return run_analysis(
                owner=principal.owner,
                kind="impurity",
                inputs=canonical.model_dump(mode="json"),
                execute=lambda: adapter.predict(canonical),
            )
        except NativeModelError as exc:
            raise HTTPException(exc.status, str(exc)) from exc

    return router
