"""Pure native projections and joint ranking, with no fabricated legacy ranks."""

from packages.workspace.structure_validation import canonical_structure
from packages.chemistry.forward_evaluation import validate_forward_input

from .forward_models import (
    DecoderHypothesis, DecoderProvenance, FilterDecision, ForwardPrediction,
    ForwardResult, RankedResult, RankingProvenance, decoded_structure, eligibility, joint_score,
)


def decoded_tokens(indices, vocabulary):
    """Only remove a real EOS; an unfinished SMILES is not a complete molecule."""
    if len(indices) > 512:
        raise ValueError("Decoder hypothesis exceeds the token budget")
    if any(type(index) is not int or not 0 <= index < len(vocabulary) for index in indices):
        raise ValueError("Invalid decoder vocabulary index")
    tokens = [vocabulary[index] for index in indices]
    terminated = bool(tokens) and tokens[-1] == "_EOS"
    return {"decoded_product": "".join(tokens[:-1] if terminated else tokens),
            "terminated_by_eos": terminated, "decoded_token_count": len(tokens)}


def build_native_result(*, reactants, asset_identity, parameters, hypotheses):
    reactants = validate_forward_input(reactants)
    rows, seen = [], {}
    for item in hypotheses:
        row = {"decoder_rank": item["decoder_rank"], "decoded_product": item["decoded_product"],
               "terminated_by_eos": item["terminated_by_eos"], "decoded_token_count": item["decoded_token_count"],
               "log_probability": item["log_probability"],
               "disposition": "invalid_decoding" if item["terminated_by_eos"] else "incomplete_decoding"}
        normalized = item["normalized_product"]
        if normalized and not item["terminated_by_eos"]:
            raise ValueError("Unfinished decoding must not become a native candidate")
        if normalized:
            try:
                product = canonical_structure(normalized, max_atoms=300)[0]
                decoded = decoded_structure(item["decoded_product"])
            except ValueError:
                row["disposition"] = "unsupported_structure"
            else:
                if decoded != product:
                    raise ValueError("Native normalization disagrees with recorded decoding")
                row["product"] = product
                if product in seen:
                    row.update(disposition="duplicate", duplicate_of=seen[product])
                else:
                    seen[product] = item["decoder_rank"]
                    row.update(disposition="returned", native_rank=len(seen))
        rows.append(DecoderHypothesis.model_validate(row))
    provenance = DecoderProvenance(parameters=parameters, hypotheses=rows)
    return ForwardResult(
        reactants=reactants, model="graph2smiles_uspto_stereo", asset_identity=asset_identity,
        evidence_type="model_prediction", provenance=provenance,
        products=[ForwardPrediction(product=row.product, log_probability=row.log_probability)
                  for row in provenance.returned()],
    )


def eligible_forward_predictions(output):
    if output.provenance is None:
        raise ValueError("Native forward provenance is missing")
    return [row for row in output.provenance.returned() if eligibility(output.reactants, row.product) == "ranked"]


def rank_forward_result(output, *, scores, count, fast_filter_asset):
    if type(count) is not int or not 1 <= count <= 10:
        raise ValueError("Invalid display candidate count")
    candidates = eligible_forward_predictions(output)
    if len(scores) != len(candidates):
        raise ValueError("Fast-filter scores disagree with eligible candidates")
    by_decoder = dict(zip((row.decoder_rank for row in candidates), scores, strict=True))
    decisions = []
    for row in output.provenance.returned():
        disposition = eligibility(output.reactants, row.product)
        score = by_decoder.get(row.decoder_rank)
        decisions.append(FilterDecision(
            decoder_rank=row.decoder_rank, native_rank=row.native_rank, disposition=disposition,
            feasibility_score=score,
            joint_score=joint_score(row.log_probability, score) if disposition == "ranked" else None,
            joint_rank=1 if disposition == "ranked" else None,
        ))
    ranked = sorted((row for row in decisions if row.disposition == "ranked"),
                    key=lambda row: row.joint_score, reverse=True)
    for index, row in enumerate(ranked, 1):
        row.joint_rank = index
    provenance = RankingProvenance(
        decoder=output.provenance, decisions=decisions,
        fast_filter_asset_identity=fast_filter_asset if ranked else None,
    )
    return RankedResult(**output.model_dump(exclude={"products", "provenance"}),
                        provenance=provenance, products=provenance.ranked_products()[:count])
