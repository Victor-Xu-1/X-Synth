"""Open reaction evidence; native model scores and procurement remain separate."""

from __future__ import annotations

from typing import Literal

from pydantic import Field, model_validator

from packages.adapters.askcos.reference_models import (
    ReactionReference,
    ReferenceModel,
    ReferenceProvenance,
    ReferenceSearchResponse,
    ReferenceStatus,
    ReportedYield,
    Smiles,
)

EvidenceSource = Literal["USPTO_FULL", "ORD"]
LibrarySource = Literal["USPTO_FULL", "ORD", "OPEN_REACTIONS"]
EvidenceReason = Literal[
    "reaction_library_not_configured",
    "reaction_library_unavailable",
    "reaction_library_invalid",
    "reaction_library_query_failed",
]


class RecordedParameter(ReferenceModel):
    value: float = Field(allow_inf_nan=False)
    precision: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    unit: str = Field(min_length=1, max_length=80)
    source_field: str = Field(min_length=1, max_length=256)
    details: str | None = Field(default=None, max_length=4096)


class RecordedInput(ReferenceModel):
    role: str = Field(min_length=1, max_length=80)
    name: str | None = Field(default=None, max_length=4096)
    smiles: Smiles | None = None
    amounts: list[RecordedParameter] = Field(default_factory=list, max_length=16)
    source_field: str = Field(min_length=1, max_length=256)


class RecordedConditions(ReferenceModel):
    temperature: list[RecordedParameter] = Field(default_factory=list, max_length=256)
    time: list[RecordedParameter] = Field(default_factory=list, max_length=256)
    pressure: list[RecordedParameter] = Field(default_factory=list, max_length=256)
    inputs: list[RecordedInput] = Field(default_factory=list, max_length=256)


class EvidenceYield(ReportedYield):
    value: float | None = Field(default=None, allow_inf_nan=False)
    method: Literal["text_mined_yield", "calculated_yield", "ord_product_measurement"]
    product_smiles: Smiles | None = None
    analysis: str | None = Field(default=None, max_length=4096)
    measurement_type: str | None = Field(default=None, max_length=80)
    source_field: str | None = Field(default=None, max_length=256)


class EvidenceProvenance(ReferenceProvenance):
    source: EvidenceSource
    evidence_type: Literal["patent_reaction_extraction", "structured_reaction_record"]
    yield_extraction_fields: list[
        Literal["text_mined_yield", "calculated_yield", "ord_product_measurement"]
    ] = Field(default_factory=list, max_length=3)
    dataset_id: str | None = Field(default=None, max_length=160)
    dataset_name: str | None = Field(default=None, max_length=4096)
    source_sha256: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")
    source_path: str | None = Field(default=None, max_length=1024)
    original_reaction_id: str | None = Field(default=None, max_length=160)
    outcome_indices: list[int] = Field(default_factory=list, max_length=256)
    license: Literal["CC-BY-SA-4.0"] | None = None


class ReactionEvidence(ReactionReference):
    reported_yields: list[EvidenceYield] = Field(default_factory=list, max_length=256)
    conditions: RecordedConditions | None = None
    provenance: EvidenceProvenance
    doi: str | None = Field(default=None, max_length=512)
    source_url: str | None = Field(default=None, max_length=2048)
    publication_url: str | None = Field(default=None, max_length=2048)
    procedure: str | None = Field(default=None, max_length=32768)

    @model_validator(mode="after")
    def source_identity(self):
        provenance = self.provenance
        if any(index < 0 for index in provenance.outcome_indices):
            raise ValueError("Recorded outcome indices cannot be negative")
        if provenance.record_id != self.id:
            raise ValueError("Reaction evidence ID does not match provenance")
        if provenance.source == "ORD":
            if (
                provenance.evidence_type != "structured_reaction_record"
                or not provenance.dataset_id
                or not provenance.source_sha256
                or not provenance.source_path
                or provenance.license != "CC-BY-SA-4.0"
            ):
                raise ValueError("ORD evidence requires its original dataset identity")
        elif (
            provenance.evidence_type != "patent_reaction_extraction"
            or self.conditions is not None
            or any(
                item.method == "ord_product_measurement"
                for item in self.reported_yields
            )
        ):
            raise ValueError("Native USPTO evidence must remain source-only")
        return self


class EvidenceSourceStatus(ReferenceModel):
    source: EvidenceSource
    ready: bool
    record_count: int | None = Field(default=None, ge=0)
    product_index_available: bool
    reason: str | None = Field(default=None, max_length=100)
    conditions_count: int | None = Field(default=None, ge=0)
    yields_count: int | None = Field(default=None, ge=0)
    snapshot: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")
    license: Literal["CC-BY-SA-4.0"] | None = None

    @model_validator(mode="after")
    def consistent_status(self):
        if self.ready and (
            not self.product_index_available or self.record_count == 0 or self.reason
        ):
            raise ValueError("Evidence readiness requires an indexed, nonempty source")
        if not self.ready and not self.reason:
            raise ValueError("Unavailable evidence requires an explicit reason")
        return self


class ReactionLibraryStatus(ReferenceStatus):
    source: LibrarySource
    reason: str | None = Field(default=None, max_length=100)
    sources: list[EvidenceSourceStatus] = Field(default_factory=list, max_length=2)


class ReactionLibraryResponse(ReferenceSearchResponse):
    source: LibrarySource
    results: list[ReactionEvidence] = Field(max_length=30)
    sources: list[EvidenceSourceStatus] = Field(default_factory=list, max_length=2)

    @model_validator(mode="after")
    def unique_sources(self):
        if len({item.source for item in self.sources}) != len(self.sources):
            raise ValueError("Reaction evidence source statuses must be unique")
        return self
