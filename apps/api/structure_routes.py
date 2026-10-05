from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from packages.workspace.chemical_files import (
    MAX_CHEMICAL_FILE_BYTES,
    ChemicalFormat,
    export_chemical_file,
    parse_chemical_file,
)
from packages.workspace.chemical_reactions import (
    export_reaction_file,
    parse_reaction_file,
)
from packages.workspace.http_validation import WorkspaceRoute
from packages.workspace.reaction_input import (
    ReactionDraftFormat,
    SingleRole,
    parse_reaction_draft,
)
from packages.workspace.structure_validation import (
    MAX_SMILES_LENGTH,
    canonical_structure,
)

from .security import authenticate


class StructureBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    smiles: str = Field(min_length=1, max_length=MAX_SMILES_LENGTH)


class ChemicalFileBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    format: ChemicalFormat
    content: str = Field(min_length=1, max_length=MAX_CHEMICAL_FILE_BYTES)


class ChemicalExportBody(StructureBody):
    format: ChemicalFormat
    name: str = Field(default="", max_length=160)


class ReactionFileBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    content: str = Field(min_length=1, max_length=MAX_CHEMICAL_FILE_BYTES)


class ReactionExportBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reactants: list[str] = Field(min_length=1, max_length=99)
    product: str = Field(min_length=1, max_length=MAX_SMILES_LENGTH)
    agents: list[str] = Field(default_factory=list, max_length=98)


class CompoundGroupsBody(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    reactants: list[str] = Field(max_length=100)
    products: list[str] = Field(max_length=100)
    agents: list[str] = Field(max_length=100)


class ReactionDraftBody(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    format: ReactionDraftFormat
    content: str = Field(min_length=1, max_length=MAX_CHEMICAL_FILE_BYTES)
    single_role: SingleRole = "product"
    compound_groups: CompoundGroupsBody | None = None


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

    @router.post("/import")
    def import_structure(body: ChemicalFileBody, request: Request):
        authenticate(request, transport)
        try:
            return parse_chemical_file(
                body.content, body.format, max_atoms=budget.max_structure_atoms
            )
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc

    @router.post("/export")
    def export_structure(body: ChemicalExportBody, request: Request):
        authenticate(request, transport)
        try:
            return export_chemical_file(
                body.smiles,
                body.format,
                name=body.name,
                max_atoms=budget.max_structure_atoms,
            )
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc

    @router.post("/reaction-import")
    def import_reaction(body: ReactionFileBody, request: Request):
        authenticate(request, transport)
        try:
            return parse_reaction_file(
                body.content, max_atoms=budget.max_structure_atoms
            )
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc

    @router.post("/reaction-export")
    def export_reaction(body: ReactionExportBody, request: Request):
        authenticate(request, transport)
        try:
            return export_reaction_file(
                body.reactants,
                body.product,
                body.agents,
                max_atoms=budget.max_structure_atoms,
            )
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc

    @router.post("/reaction-draft")
    def reaction_draft(body: ReactionDraftBody, request: Request):
        authenticate(request, transport)
        try:
            return parse_reaction_draft(
                body.content,
                body.format,
                single_role=body.single_role,
                compound_groups=body.compound_groups.model_dump()
                if body.compound_groups is not None
                else None,
                max_atoms=budget.max_structure_atoms,
            )
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc

    return router
