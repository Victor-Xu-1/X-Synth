"""Forward candidates with independent inventory and feasibility assessment."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from packages.chemistry.forward_evaluation import (
    validate_forward_input,
)
from packages.workspace.structure_validation import canonical_structure

from .native_models import NativeModelClient, NativeModelError
from .forward_models import ForwardPrediction, ForwardResult, RankedPrediction, RankedResult
from .forward_provenance import eligible_forward_predictions, rank_forward_result

__all__ = ["ForwardAdapter", "ForwardPrediction", "ForwardResult", "RankedPrediction", "RankedResult"]


class FeasibilityBatch(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    status: Literal["SUCCESS"]
    error: Literal[""] = ""
    results: list[Annotated[float, Field(ge=0, le=1, allow_inf_nan=False)]] = Field(max_length=30)
    model: Literal["askcos_fast_filter"]
    asset_identity: str = Field(pattern=r"^[a-f0-9]{64}$")


class ForwardAdapter:
    def __init__(self, base_url, fast_filter_url):
        self.model = NativeModelClient(base_url)
        self.filter = NativeModelClient(fast_filter_url)

    def predict(self, *, reactants, count):
        reactants = validate_forward_input(reactants)
        try:
            output = ForwardResult.model_validate(
                self.model.post("/predict", {"reactants": reactants})
            )
            if (
                canonical_structure(output.reactants, max_atoms=300)[0] != reactants
                or output.model != "graph2smiles_uspto_stereo"
                or output.evidence_type != "model_prediction"
            ):
                raise ValueError("Forward response is not bound to this request")
            output.reactants = reactants
            candidates = eligible_forward_predictions(output)
            values, asset = [], None
            if candidates:
                scores = FeasibilityBatch.model_validate(
                    self.filter.post(
                        "/fast_filter_evaluate_batch",
                        {
                            "rxn_smiles": [
                                reactants + ">>" + row.product for row in candidates
                            ]
                        },
                    )
                )
                if scores.status != "SUCCESS" or len(scores.results) != len(candidates):
                    raise ValueError("Invalid forward feasibility response")
                values, asset = scores.results, scores.asset_identity
            return rank_forward_result(output, scores=values, count=count, fast_filter_asset=asset)
        except ValueError as exc:
            raise NativeModelError("正向模型返回的候选结构或评分无效。", 502, recoverable=False) from exc
