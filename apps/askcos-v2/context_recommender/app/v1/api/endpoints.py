from fastapi import APIRouter, Depends

from app.common.schemas.condition import Agent, ConditionRecommendation, Role
from app.common.schemas.request import RecommendConditionRequest, RecommendConditionResponse
from app.v1.api.deps import get_model
from app.v1.services import NeuralNetContextRecommender

from pydantic import BaseModel

router = APIRouter()


@router.post(
    "/condition", response_model=RecommendConditionResponse, response_model_exclude_unset=True
)
def recommend(
    request: RecommendConditionRequest, model: NeuralNetContextRecommender = Depends(get_model)
):
    reactants = [Agent(smi_or_name=smi, role=Role.REACTANT) for smi in request.smiles.split(".")]
    conditions, scores = model.recommend(request.smiles, request.reagents, request.n_conditions)

    recommendations = []
    for condition, score in zip(conditions, scores):
        temp, reagents, solvents, catalyst, *_ = condition
        reagents = [Agent(smi_or_name=smi, role=Role.REAGENT) for smi in reagents.split(".")]
        solvents = [Agent(smi_or_name=smi, role=Role.SOLVENT) for smi in solvents.split(".")]
        catalyst = Agent(smi_or_name=catalyst, role=Role.CATALYST)
        agents = [*reactants, *reagents, *solvents, catalyst]

        rec = ConditionRecommendation(agents=agents, temperature=temp, score=score)
        recommendations.append(rec)

    return recommendations


class UncleanedRequest(BaseModel):
    smiles: str
    n_conditions: int = 10
    with_smiles: bool = False
    return_scores: bool = False


class UncleanedOutput(BaseModel):
    conditions: list
    scores: list = None


# Modified API endpoint for deployment
@router.post(
    "/condition_uncleaned"
)
def get_n_conditions(
    request: UncleanedRequest,
    model: NeuralNetContextRecommender = Depends(get_model)
) -> UncleanedOutput:
    # hardcoded to always return scores
    conditions, scores = model.recommend(
        smi=request.smiles,
        reagents=None,
        n_conditions=request.n_conditions,
        with_smiles=request.with_smiles,
        return_scores=True,
        return_separate=False
    )
    # return conditions
    output = {
        "conditions": conditions,
        "scores": scores if request.return_scores else None
    }
    output = UncleanedOutput(**output)

    return output


@router.post(
    "/condition_cleaned"
)
def postprocess(
    request: RecommendConditionRequest,
    model: NeuralNetContextRecommender = Depends(get_model)
):
    conditions, scores = model.recommend(
        smi=request.smiles,
        reagents=request.reagents,
        n_conditions=request.n_conditions,
        with_smiles=False,
        return_scores=True,
        return_separate=True
    )
    output = model.postprocess(conditions)

    return output
