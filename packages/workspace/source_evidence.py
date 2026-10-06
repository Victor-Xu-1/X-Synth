"""Bounded internal source data; these fields are never accepted from clients."""

from typing import Annotated, Any

from pydantic import BaseModel, ConfigDict, Field

from .structure_validation import MAX_SMILES_LENGTH

Smiles = Annotated[str, Field(min_length=1, max_length=MAX_SMILES_LENGTH)]
Score = Annotated[float, Field(strict=True, ge=0, le=1, allow_inf_nan=False)]


class SourceStep(BaseModel):
    product: Smiles
    precursors: list[Smiles] = Field(min_length=1, max_length=499)
    confidence: Any = None


class SourceCandidate(BaseModel):
    target_smiles: Smiles
    engine: str = Field(default="askcos", min_length=1, max_length=80)
    route_id: str | None = Field(default=None, max_length=128)
    steps: list[SourceStep] = Field(default_factory=list, max_length=499)
    closed: bool = Field(default=False, strict=True)


class SourceEvidence(BaseModel):
    model_config = ConfigDict(extra="forbid")

    signature: str = Field(pattern=r"^[a-f0-9]{64}$")
    prediction_scores: dict[str, Score] = Field(default_factory=dict, max_length=499)
    closed: bool = Field(default=False, strict=True)
    engine: str = Field(default="askcos", min_length=1, max_length=80)
    route_id: str | None = Field(default=None, max_length=128)
    job_id: str | None = Field(default=None, pattern=r"^[a-f0-9]{32}$")
    route_index: int = Field(default=0, strict=True, ge=0, le=9)
    result_snapshot: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")
