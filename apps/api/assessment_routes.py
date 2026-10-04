"""Authenticated molecular assessment and batch metrics via the shared analysis runner."""

from fastapi import APIRouter, HTTPException, Request
from pydantic import Field

from packages.chemistry.assessment import (
    AssessmentUnavailable,
    ChemistryModel,
    MAX_ASSESSMENT_ATOMS,
    MolecularAssessment,
    assess_molecule,
)
from packages.chemistry.process_metrics import ProcessInput, ProcessResult, calculate_process
from packages.workspace.http_validation import WorkspaceRoute
from packages.workspace.structure_validation import MAX_SMILES_LENGTH

from .security import authenticate


class AssessmentBody(ChemistryModel):
    smiles: str = Field(strict=True, min_length=1, max_length=MAX_SMILES_LENGTH)


def assessment_router(*, transport, budget, run_analysis):
    router = APIRouter(prefix="/assessment", route_class=WorkspaceRoute)

    @router.post("/molecule", response_model=MolecularAssessment)
    def molecule(body: AssessmentBody, request: Request):
        principal = authenticate(request, transport)
        try:
            def execute():
                return assess_molecule(
                    body.smiles, max_atoms=min(budget.max_structure_atoms, MAX_ASSESSMENT_ATOMS)
                ).model_dump(mode="json")
            return run_analysis(owner=principal.owner, kind="assessment", inputs=body.model_dump(mode="json"), execute=execute)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        except AssessmentUnavailable as exc:
            raise HTTPException(503, str(exc)) from exc

    return router


def process_router(*, transport, budget, run_analysis):
    router = APIRouter(prefix="/process", route_class=WorkspaceRoute)

    @router.post("/metrics", response_model=ProcessResult)
    def metrics(body: ProcessInput, request: Request):
        principal = authenticate(request, transport)
        try:
            def execute():
                return calculate_process(body, max_atoms=budget.max_structure_atoms).model_dump(mode="json")
            return run_analysis(owner=principal.owner, kind="process", inputs=body.model_dump(mode="json"), execute=execute)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc

    return router
