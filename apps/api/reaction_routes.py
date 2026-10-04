"""Authenticated product-facing native forward prediction."""

import os

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from packages.adapters.askcos.forward import ForwardAdapter
from packages.adapters.askcos.native_models import NativeModelError
from packages.chemistry.forward_evaluation import validate_forward_input
from packages.workspace.http_validation import WorkspaceRoute
from packages.workspace.structure_validation import MAX_SMILES_LENGTH

from .security import authenticate


class ForwardBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reactants: str = Field(min_length=1, max_length=MAX_SMILES_LENGTH)
    count: int = Field(default=5, ge=1, le=10)


def reaction_router(*, transport, budget, read_health, run_analysis):
    router = APIRouter(prefix="/reactions", route_class=WorkspaceRoute)
    adapter = ForwardAdapter(
        os.environ.get("X_SYNTH_FORWARD_URL", "http://127.0.0.1:9911"),
        os.environ.get("X_SYNTH_FAST_FILTER_URL", "http://127.0.0.1:9611"),
    )

    @router.post("/predict")
    def predict(body: ForwardBody, request: Request):
        principal = authenticate(request, transport)
        checks = read_health().get("service_checks", {})
        if (
            checks.get("forward_predictor") is not True
            or checks.get("fast_filter") is not True
        ):
            raise HTTPException(503, "正向模型或可行性模型未就绪，请查看环境部署。")
        try:
            reactants = validate_forward_input(
                body.reactants, max_atoms=min(budget.max_structure_atoms, 300)
            )
        except ValueError as exc:
            raise HTTPException(422, "请输入确定的、含化学键的反应物结构。") from exc
        try:
            return run_analysis(
                owner=principal.owner,
                kind="forward",
                inputs={"reactants": reactants, "count": body.count},
                execute=lambda: adapter.predict(reactants=reactants, count=body.count),
            )
        except NativeModelError as exc:
            raise HTTPException(exc.status, str(exc)) from exc

    return router
