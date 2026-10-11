"""Immutable forward-model lineage; display order is not decoder order."""

import hashlib
import json
import math
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator
from rdkit import Chem

from packages.chemistry.forward_evaluation import product_uses_supplied_atoms
from packages.workspace.structure_validation import canonical_structure

RANKING_POLICY = "sequence_log_probability_plus_log_fast_filter_v1"
RANK_BASIS = "original_decoder_ordinal"


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


def decoded_structure(smiles):
    canonical = canonical_structure(smiles, max_atoms=300)[0]
    molecule = Chem.MolFromSmiles(canonical)
    for atom in molecule.GetAtoms():
        atom.SetAtomMapNum(0)
    return canonical_structure(Chem.MolToSmiles(molecule, isomericSmiles=True), max_atoms=300)[0]


class DecoderParameters(StrictModel):
    beam_size: int = Field(ge=1, le=30, strict=True)
    n_best: int = Field(ge=1, le=30, strict=True)
    temperature: float = Field(gt=0, allow_inf_nan=False)
    predict_min_len: int = Field(ge=1, strict=True)
    predict_max_len: int = Field(ge=1, le=512, strict=True)
    mask_rel_chirality: int = Field(ge=0, le=1, strict=True)

    @model_validator(mode="after")
    def bounds(self):
        if self.n_best > self.beam_size or self.predict_min_len > self.predict_max_len:
            raise ValueError("Invalid decoder parameter bounds")
        return self


class DecoderHypothesis(StrictModel):
    decoder_rank: int = Field(ge=1, le=30, strict=True)
    decoded_product: str = Field(max_length=16384)
    terminated_by_eos: bool
    decoded_token_count: int = Field(ge=0, le=512, strict=True)
    product: str | None = Field(default=None, min_length=1, max_length=8192)
    log_probability: float = Field(le=0, allow_inf_nan=False)
    disposition: Literal["returned", "invalid_decoding", "unsupported_structure", "duplicate", "incomplete_decoding"]
    native_rank: int | None = Field(default=None, ge=1, le=30, strict=True)
    duplicate_of: int | None = Field(default=None, ge=1, le=30, strict=True)


class DecoderProvenance(StrictModel):
    version: int = Field(default=1, ge=1, le=1, strict=True)
    parameters: DecoderParameters
    hypotheses: list[DecoderHypothesis] = Field(max_length=30)

    @model_validator(mode="after")
    def ordered_hypotheses(self):
        if len(self.hypotheses) > self.parameters.n_best:
            raise ValueError("Decoder output exceeds n_best")
        returned = {}
        for index, row in enumerate(self.hypotheses, 1):
            if row.decoder_rank != index:
                raise ValueError("Decoder provenance must preserve every original ordinal")
            if row.decoded_token_count > self.parameters.predict_max_len:
                raise ValueError("Decoder hypothesis exceeds its recorded token limit")
            if row.terminated_by_eos and row.decoded_token_count == 0:
                raise ValueError("EOS termination requires an actual token")
            if (row.disposition == "incomplete_decoding") == row.terminated_by_eos:
                raise ValueError("Decoder disposition contradicts its EOS termination")
            if row.disposition == "returned":
                if (row.native_rank != len(returned) + 1 or row.duplicate_of is not None
                        or row.product is None or row.product in returned):
                    raise ValueError("Invalid native candidate provenance")
                if canonical_structure(row.product, max_atoms=300)[0] != row.product:
                    raise ValueError("Noncanonical native candidate")
                if decoded_structure(row.decoded_product) != row.product:
                    raise ValueError("Native product is not the recorded decoding")
                returned[row.product] = index
            elif row.disposition == "duplicate":
                if row.native_rank is not None or row.product not in returned or row.duplicate_of != returned[row.product]:
                    raise ValueError("Duplicate provenance is not bound to an earlier candidate")
                if decoded_structure(row.decoded_product) != row.product:
                    raise ValueError("Duplicate product is not the recorded decoding")
            elif row.product is not None or row.native_rank is not None or row.duplicate_of is not None:
                raise ValueError("Invalid decoding must not invent a candidate")
        return self

    def returned(self):
        return [row for row in self.hypotheses if row.disposition == "returned"]


class ForwardPrediction(StrictModel):
    product: str = Field(min_length=1, max_length=16384)
    log_probability: float = Field(le=0, allow_inf_nan=False)


class RankedPrediction(ForwardPrediction):
    feasibility_score: float = Field(ge=0, le=1, allow_inf_nan=False)
    decoder_rank: int | None = Field(default=None, ge=1, le=30, strict=True)
    native_rank: int | None = Field(default=None, ge=1, le=30, strict=True)
    joint_rank: int | None = Field(default=None, ge=1, le=30, strict=True)


class ForwardIdentity(StrictModel):
    reactants: str
    model: str
    asset_identity: str = Field(pattern=r"^[a-f0-9]{64}$")
    evidence_type: str


class ForwardResult(ForwardIdentity):
    products: list[ForwardPrediction] = Field(max_length=30)
    provenance: DecoderProvenance | None = None

    @model_validator(mode="after")
    def candidate_binding(self):
        if self.provenance is not None:
            expected = [ForwardPrediction(product=row.product, log_probability=row.log_probability)
                        for row in self.provenance.returned()]
            if self.products != expected:
                raise ValueError("Native products disagree with decoder provenance")
        return self


class FilterDecision(StrictModel):
    decoder_rank: int = Field(ge=1, le=30, strict=True)
    native_rank: int = Field(ge=1, le=30, strict=True)
    disposition: Literal["ranked", "no_op", "unsupplied_atoms"]
    feasibility_score: float | None = Field(default=None, ge=0, le=1, allow_inf_nan=False)
    joint_score: float | None = Field(default=None, allow_inf_nan=False)
    joint_rank: int | None = Field(default=None, ge=1, le=30, strict=True)


def joint_score(log_probability, feasibility_score):
    return log_probability + math.log(max(feasibility_score, 1e-30))


def eligibility(reactants, product):
    if product == reactants:
        return "no_op"
    return "ranked" if product_uses_supplied_atoms(reactants, product) else "unsupplied_atoms"


class RankingProvenance(StrictModel):
    version: int = Field(default=1, ge=1, le=1, strict=True)
    rank_basis: Literal["original_decoder_ordinal"] = RANK_BASIS
    ranking_policy: Literal["sequence_log_probability_plus_log_fast_filter_v1"] = RANKING_POLICY
    decoder: DecoderProvenance
    decisions: list[FilterDecision] = Field(max_length=30)
    fast_filter_model: Literal["askcos_fast_filter"] = "askcos_fast_filter"
    fast_filter_asset_identity: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")

    @model_validator(mode="after")
    def decision_binding(self):
        native = self.decoder.returned()
        if len(native) != len(self.decisions):
            raise ValueError("Every native candidate needs a filter decision")
        ranked = []
        for source, row in zip(native, self.decisions, strict=True):
            if row.decoder_rank != source.decoder_rank or row.native_rank != source.native_rank:
                raise ValueError("Filter decision lost its original rank")
            if row.disposition == "ranked":
                if row.feasibility_score is None or row.joint_rank is None or row.joint_score is None:
                    raise ValueError("Ranked candidate is missing scorer provenance")
                if row.joint_score != joint_score(source.log_probability, row.feasibility_score):
                    raise ValueError("Joint score disagrees with recorded model scores")
                ranked.append(row)
            elif any(value is not None for value in (row.feasibility_score, row.joint_score, row.joint_rank)):
                raise ValueError("Filtered candidate must not acquire a score or rank")
        ranked.sort(key=lambda row: row.joint_score, reverse=True)
        if [row.joint_rank for row in ranked] != list(range(1, len(ranked) + 1)):
            raise ValueError("Joint rank disagrees with stable joint ordering")
        if bool(ranked) != bool(self.fast_filter_asset_identity):
            raise ValueError("Fast-filter identity must bind every scored candidate")
        return self

    def ranked_products(self):
        native = {row.decoder_rank: row for row in self.decoder.returned()}
        return [RankedPrediction(
            product=native[row.decoder_rank].product,
            log_probability=native[row.decoder_rank].log_probability,
            feasibility_score=row.feasibility_score, decoder_rank=row.decoder_rank,
            native_rank=row.native_rank, joint_rank=row.joint_rank,
        ) for row in sorted((row for row in self.decisions if row.disposition == "ranked"),
                            key=lambda row: row.joint_rank)]


class RankedResult(ForwardIdentity):
    products: list[RankedPrediction] = Field(max_length=10)
    provenance: RankingProvenance | None = None

    @model_validator(mode="after")
    def ranking_binding(self):
        if self.provenance is None:
            if any(any(rank is not None for rank in (row.decoder_rank, row.native_rank, row.joint_rank))
                   for row in self.products):
                raise ValueError("Candidate ranks require complete provenance")
            return self
        native = self.provenance.decoder.returned()
        for source, row in zip(native, self.provenance.decisions, strict=True):
            if row.disposition != eligibility(self.reactants, source.product):
                raise ValueError("Filter decision disagrees with reactant atom inventory")
        complete = self.provenance.ranked_products()
        if self.products != complete[:len(self.products)] or (complete and not self.products):
            raise ValueError("Displayed candidates are not the joint-ranked prefix")
        return self

    def all_ranked_products(self):
        return self.provenance.ranked_products() if self.provenance is not None else self.products

    def provenance_digest(self):
        if self.provenance is None:
            raise ValueError("Original forward provenance was not recorded")
        payload = self.model_dump(mode="json", exclude={"products"})
        return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
