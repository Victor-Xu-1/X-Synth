from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from packages.workspace.http_validation import WorkspaceRoute
from packages.workspace.structure_validation import (
    MAX_SMILES_LENGTH,
    canonical_structure,
)

from .security import authenticate


class StructureBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    smiles: str = Field(min_length=1, max_length=MAX_SMILES_LENGTH)


def structure_router(*, transport, budget):
    router = APIRouter(prefix="/structure", route_class=WorkspaceRoute)

    @router.post("/validate")
    def validate_structure(body: StructureBody, request: Request):
        authenticate(request, transport)
        try:
            smiles, atoms = canonical_structure(
                body.smiles, max_atoms=budget.max_structure_atoms
            )
        except ValueError as exc:
            raise HTTPException(422, "无法解析该分子结构或超过当前支持范围。") from exc
        return {"smiles": smiles, "atoms": atoms, "valid": True}

    return router
