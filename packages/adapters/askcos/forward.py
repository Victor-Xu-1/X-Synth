"""Forward candidates with independent inventory and feasibility assessment."""

import math

from pydantic import BaseModel, ConfigDict, Field

from packages.chemistry.forward_evaluation import (
    product_uses_supplied_atoms,
    validate_forward_input,
)
from packages.workspace.structure_validation import canonical_structure

from .native_models import NativeModelClient, NativeModelError


class ForwardPrediction(BaseModel):
    model_config = ConfigDict(extra="forbid")
    product: str = Field(min_length=1, max_length=16384)
    log_probability: float = Field(le=0, allow_inf_nan=False)


class RankedPrediction(ForwardPrediction):
    feasibility_score: float = Field(ge=0, le=1, allow_inf_nan=False)


class ForwardResult(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reactants: str
    products: list[ForwardPrediction] = Field(max_length=30)
    model: str
    asset_identity: str = Field(pattern=r"^[a-f0-9]{64}$")
    evidence_type: str


class RankedResult(ForwardResult):
    products: list[RankedPrediction] = Field(max_length=10)


class FeasibilityBatch(BaseModel):
    status: str
    results: list[float] = Field(max_length=30)


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
            candidates = []
            seen = set()
            for row in output.products:
                canonical = canonical_structure(row.product, max_atoms=300)[0]
                if canonical != row.product:
                    raise ValueError("Noncanonical forward output")
                if (
                    canonical != reactants
                    and canonical not in seen
                    and product_uses_supplied_atoms(reactants, canonical)
                ):
                    candidates.append(row)
                    seen.add(canonical)
            ranked = []
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
                for row, score in zip(candidates, scores.results, strict=True):
                    ranked.append(
                        RankedPrediction(**row.model_dump(), feasibility_score=score)
                    )
                # A classifier score alone cannot override an implausible sequence.
                ranked.sort(
                    key=lambda row: (
                        row.log_probability
                        + math.log(max(row.feasibility_score, 1e-30))
                    ),
                    reverse=True,
                )
            return RankedResult(
                **output.model_dump(exclude={"products"}), products=ranked[:count]
            )
        except ValueError as exc:
            raise NativeModelError("正向模型返回的候选结构或评分无效。") from exc
