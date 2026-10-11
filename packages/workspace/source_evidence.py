"""Bounded source contracts; provenance is assigned only by the server."""

from typing import Annotated, Any, Literal

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
    delivery_review: dict[str, Any] | None = None


class DocumentBinding(BaseModel):
    model_config = ConfigDict(extra="forbid")
    document_id: str = Field(pattern=r"^[a-f0-9]{32}$")
    document_revision: int = Field(strict=True, ge=0)
    chemical_signature: str = Field(pattern=r"^[a-f0-9]{64}$")


class DocumentSourceBinding(DocumentBinding):
    job_id: str = Field(pattern=r"^[a-f0-9]{32}$")
    route_id: str = Field(min_length=1, max_length=128)
    route_index: int = Field(strict=True, ge=0, le=9)
    result_snapshot: str | None = Field(pattern=r"^[a-f0-9]{64}$")


class PreservedSourceStep(SourceStep):
    model_config = ConfigDict(extra="forbid")
    step_id: str = Field(min_length=1, max_length=128)
    reaction_smiles: str | None = Field(default=None, max_length=1024 * 1024)
    source: Any = None
    metadata: dict[str, Any] | None = None


class DocumentSourceAvailable(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["available"]
    scope: Literal["pinned_publication", "current_matching_source"]
    binding: DocumentSourceBinding
    steps_by_node: dict[str, PreservedSourceStep] = Field(max_length=499)
    metadata: dict[str, Any]
    starting_materials: list[Smiles] = Field(max_length=499)
    closure_sources: list[str] = Field(max_length=499)
    source_closed: bool = Field(strict=True)


class DocumentSourceUnavailable(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["unavailable"]
    reason: str = Field(pattern=r"^[a-z_]{1,80}$")
    binding: DocumentBinding
