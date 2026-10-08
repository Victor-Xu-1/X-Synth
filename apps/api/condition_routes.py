"""Authenticated, bounded reaction-condition prediction using the native model."""

import os

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from packages.adapters.askcos.conditions import ConditionAdapter, ConditionModelError
from packages.workspace.http_validation import WorkspaceRoute
from packages.workspace.prediction_input import condition_input_context
from packages.workspace.structure_validation import (
    MAX_SMILES_LENGTH,
    canonical_structure,
)

from .security import authenticate


class ConditionBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reactants: str = Field(min_length=1, max_length=MAX_SMILES_LENGTH)
    product: str = Field(min_length=1, max_length=MAX_SMILES_LENGTH)
    count: int = Field(default=5, ge=1, le=20)
    reaction_smiles: str | None = Field(default=None, min_length=1, max_length=MAX_SMILES_LENGTH)


def condition_router(*, transport, budget, read_health, run_analysis):
    router = APIRouter(prefix="/conditions", route_class=WorkspaceRoute)
    adapter = ConditionAdapter(
        os.environ.get("X_SYNTH_CONDITION_URL", "http://127.0.0.1:9901")
    )

    @router.post("/predict")
    def predict(body: ConditionBody, request: Request):
        principal = authenticate(request, transport)
        if (
            read_health().get("service_checks", {}).get("condition_recommender")
            is not True
        ):
            raise HTTPException(503, "条件模型未就绪，请查看环境部署。")
        try:
            reactants = canonical_structure(
                body.reactants, max_atoms=budget.max_structure_atoms
            )[0]
            product = canonical_structure(
                body.product, max_atoms=budget.max_structure_atoms
            )[0]
            context = condition_input_context(body.reaction_smiles, reactants, product, max_atoms=budget.max_structure_atoms)
        except ValueError as exc:
            raise HTTPException(422, "无法解析反应物或产物结构。") from exc
        try:
            inputs = {"reactants": reactants, "product": product, "count": body.count}
            if context is not None:
                inputs["reaction_context"] = context
            return run_analysis(
                owner=principal.owner,
                kind="conditions",
                inputs=inputs,
                execute=lambda: adapter.predict(
                    reactants=reactants, product=product, count=body.count
                ),
            )
        except ConditionModelError as exc:
            raise HTTPException(exc.status, str(exc)) from exc

    return router
