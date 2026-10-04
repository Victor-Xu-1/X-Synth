"""Typed USPTO reference contracts, limits and error codes."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from packages.workspace.structure_validation import MAX_SMILES_LENGTH

SOURCE = "USPTO_FULL"
MAX_REFERENCE_ATOMS = 1024
MAX_CANDIDATES = 300
MAX_RESULTS = 30
MAX_REACTION_LENGTH = 32768
STATUS_CACHE_SECONDS = 60
SEARCH_PATH = "/api/reactions/uspto-exact-references"
STATUS_PATH = "/api/reactions/uspto-reference-status"
Smiles = Annotated[str, Field(min_length=1, max_length=MAX_SMILES_LENGTH)]
YieldMethod = Literal["text_mined_yield", "calculated_yield"]
Reason = Literal[
    "reference_product_index_unavailable",
    "reference_record_index_unavailable",
    "reference_database_unavailable",
    "reference_query_timeout",
    "reference_records_unavailable",
    "reference_product_index_inconsistent",
    "reference_candidate_budget_exceeded",
    "reference_record_invalid",
    "reference_endpoint_unavailable",
    "reference_native_unavailable",
    "reference_native_protocol_error",
]


class ReferenceError(RuntimeError):
    def __init__(self, code: Reason, *, status: int = 503):
        super().__init__(code)
        self.code = code
        self.status = status


class ReferenceModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class ReferenceSearchInput(ReferenceModel):
    product: Smiles
    reactants: list[Smiles] = Field(default_factory=list, max_length=30)
    limit: int = Field(default=20, ge=1, le=MAX_RESULTS)


class ReferenceQuery(ReferenceModel):
    product: Smiles
    reactants: list[Smiles] = Field(default_factory=list, max_length=30)


class ReportedYield(ReferenceModel):
    value: float | None = None
    unit: Literal["%"] | None = None
    method: YieldMethod
    text: str = Field(min_length=1, max_length=4096)


class ReferenceProvenance(ReferenceModel):
    source: Literal["USPTO_FULL"] = SOURCE
    record_id: str = Field(min_length=1, max_length=160)
    evidence_type: Literal["patent_reaction_extraction"] = "patent_reaction_extraction"
    yield_extraction_fields: list[YieldMethod] = Field(max_length=2)
    patent_url_basis: Literal["record_patent_number"] | None = None


class ReactionReference(ReferenceModel):
    id: str = Field(min_length=1, max_length=160)
    reaction_smiles: str = Field(min_length=1, max_length=MAX_REACTION_LENGTH)
    reactants: list[Smiles] = Field(min_length=1, max_length=MAX_REFERENCE_ATOMS)
    products: list[Smiles] = Field(min_length=1, max_length=MAX_REFERENCE_ATOMS)
    agents: list[Smiles] = Field(default_factory=list, max_length=MAX_REFERENCE_ATOMS)
    match_scope: Literal["reaction_identity", "product_identity"]
    patent_number: str | None = Field(default=None, max_length=160)
    patent_url: str | None = Field(default=None, max_length=256)
    paragraph: str | None = Field(default=None, max_length=160)
    year: int | None = Field(default=None, ge=1700, le=2100)
    reported_yields: list[ReportedYield] = Field(max_length=2)
    conditions: None = None
    provenance: ReferenceProvenance


class ReferenceSearchResponse(ReferenceModel):
    query: ReferenceQuery
    requested: ReferenceQuery
    source: Literal["USPTO_FULL"] = SOURCE
    results: list[ReactionReference] = Field(max_length=MAX_RESULTS)
    count: int = Field(ge=0, le=MAX_RESULTS)
    has_more: bool
    match_basis: Literal["exact_product_structure"] = "exact_product_structure"
    retrieved_at: str = Field(min_length=1, max_length=64)

    @model_validator(mode="after")
    def consistent_count(self):
        if self.count != len(self.results):
            raise ValueError("Reference count does not match the returned records")
        if len({record.id for record in self.results}) != self.count:
            raise ValueError("Reference identifiers must be unique")
        if self.has_more and self.count == 0:
            raise ValueError("An empty exact result cannot claim more matches")
        timestamp = datetime.fromisoformat(self.retrieved_at)
        if timestamp.tzinfo is None:
            raise ValueError("Reference retrieval time requires a timezone")
        return self


class ReferenceStatus(ReferenceModel):
    ready: bool
    source: Literal["USPTO_FULL"] = SOURCE
    record_count: int | None = Field(default=None, ge=0)
    product_index_available: bool
    reason: Reason | None = None

    @model_validator(mode="after")
    def consistent_readiness(self):
        if self.ready and (
            not self.product_index_available or self.record_count == 0 or self.reason
        ):
            raise ValueError("Reference readiness requires an indexed, nonempty source")
        if not self.ready and self.reason is None:
            raise ValueError("Unavailable references require an explicit reason")
        return self
