"""Bound receipts for original decoder rank, independent of display truncation."""

import hashlib
from typing import Literal

from pydantic import Field, model_validator

from packages.adapters.askcos.forward_models import RANK_BASIS, RANKING_POLICY, StrictModel, joint_score
from packages.chemistry.forward_evaluation import validate_forward_input
from packages.workspace.structure_validation import canonical_structure
from .operation_review import forward_support_bound
from .reference_evidence import recorded_support_proofs_are_valid


def reaction_digest(reactants, product):
    return hashlib.sha256((reactants + ">>" + product).encode()).hexdigest()


class ForwardRankReceipt(StrictModel):
    version: int = Field(default=1, ge=1, le=1, strict=True)
    rank_basis: Literal["original_decoder_ordinal"] = RANK_BASIS
    ranking_policy: Literal["sequence_log_probability_plus_log_fast_filter_v1"] = RANKING_POLICY
    provenance_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    reaction_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    forward_asset_identity: str = Field(pattern=r"^[a-f0-9]{64}$")
    fast_filter_asset_identity: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")
    decoder_count: int = Field(ge=0, le=30, strict=True)
    native_count: int = Field(ge=0, le=30, strict=True)
    ranked_count: int = Field(ge=0, le=30, strict=True)
    minimum_plausibility: float = Field(ge=0, le=1, allow_inf_nan=False)
    decoder_rank: int | None = Field(default=None, ge=1, le=30, strict=True)
    native_rank: int | None = Field(default=None, ge=1, le=30, strict=True)
    joint_rank: int | None = Field(default=None, ge=1, le=30, strict=True)
    log_probability: float | None = Field(default=None, le=0, allow_inf_nan=False)
    joint_score: float | None = Field(default=None, allow_inf_nan=False)

    @model_validator(mode="after")
    def ranks_bound_to_counts(self):
        if not self.ranked_count <= self.native_count <= self.decoder_count:
            raise ValueError("Invalid forward candidate counts")
        if bool(self.ranked_count) != bool(self.fast_filter_asset_identity):
            raise ValueError("Unbound forward scorer asset")
        fields = (self.decoder_rank, self.native_rank, self.joint_rank, self.log_probability, self.joint_score)
        if self.decoder_rank is None:
            if any(value is not None for value in fields):
                raise ValueError("Unmatched product acquired a rank or score")
        elif (any(value is None for value in fields) or self.decoder_rank > self.decoder_count
              or self.native_rank > self.native_count or self.joint_rank > self.ranked_count
              or self.native_rank > self.decoder_rank):
            raise ValueError("Candidate rank exceeds its recorded source")
        return self


def forward_rank_receipt(output, product, *, plausibility=.75):
    if output.provenance is None:
        raise ValueError("Original forward provenance was not recorded")
    row = next((row for row in output.all_ranked_products() if row.product == product), None)
    provenance = output.provenance
    return ForwardRankReceipt(
        provenance_sha256=output.provenance_digest(), reaction_sha256=reaction_digest(output.reactants, product),
        forward_asset_identity=output.asset_identity,
        fast_filter_asset_identity=provenance.fast_filter_asset_identity,
        decoder_count=len(provenance.decoder.hypotheses), native_count=len(provenance.decoder.returned()),
        ranked_count=sum(row.disposition == "ranked" for row in provenance.decisions),
        minimum_plausibility=plausibility,
        decoder_rank=row.decoder_rank if row else None, native_rank=row.native_rank if row else None,
        joint_rank=row.joint_rank if row else None, log_probability=row.log_probability if row else None,
        joint_score=joint_score(row.log_probability, row.feasibility_score) if row else None,
    ).model_dump(mode="json")


def forward_rank_receipt_valid(row, step):
    try:
        value = row.get("rank_provenance")
        if not isinstance(value, dict) or type(value.get("version")) is not int:
            return False
        receipt = ForwardRankReceipt.model_validate(value)
        reactants = validate_forward_input(".".join(step["precursors"]))
        product = canonical_structure(step["product"], max_atoms=300)[0]
        if (receipt.reaction_sha256 != reaction_digest(reactants, product)
                or row.get("expected_rank") != receipt.decoder_rank):
            return False
        score = row.get("feasibility_score")
        if receipt.decoder_rank is None:
            return score is None and row.get("matched") is False
        return (type(score) in {int, float} and 0 <= score <= 1
                and receipt.joint_score == joint_score(receipt.log_probability, score))
    except (ValueError, TypeError, KeyError):
        return False


def forward_support_valid(row, step, review):
    if not forward_rank_receipt_valid(row, step):
        return False
    receipt = ForwardRankReceipt.model_validate(row["rank_provenance"])
    score = row.get("feasibility_score")
    eligible = score is not None and score >= receipt.minimum_plausibility
    model_first = receipt.decoder_rank == 1 and eligible
    joint_first = receipt.joint_rank == 1 and eligible
    if (type(row.get("model_top1_matched")) is not bool or row["model_top1_matched"] != model_first
            or type(row.get("joint_top1_matched")) is not bool or row["joint_top1_matched"] != joint_first
            or not isinstance(row.get("record_support"), list)):
        return False
    kind = row.get("support_kind")
    if kind == "joint_ranked_top1":
        return row["matched"] is True and joint_first and not row["record_support"]
    if kind == "record_supported_model_candidate":
        return (row["matched"] is True and eligible and not joint_first
                and recorded_support_proofs_are_valid(row["record_support"])
                and forward_support_bound(row["record_support"], step, review))
    return kind == "unsupported" and row["matched"] is False and not joint_first and not row["record_support"]
