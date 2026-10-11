import Papa from "papaparse";
import { acceptsForwardResult } from "./forward-provenance";
import { JOINT_DISPLAY_BASIS } from "./forward-rank";

export function forwardProvenance(prediction) {
  return prediction?.provenance && acceptsForwardResult(prediction) ? prediction.provenance : null;
}

export function forwardLedger(provenance) {
  const decisions = new Map(provenance.decisions.map((row) => [row.decoder_rank, row]));
  return provenance.decoder.hypotheses.map((row) => {
    const decision = decisions.get(row.decoder_rank);
    return {
      decoder_rank: row.decoder_rank, native_rank: row.native_rank, joint_rank: decision?.joint_rank ?? null,
      decoded_product: row.decoded_product, product: row.product,
      terminated_by_eos: row.terminated_by_eos, decoded_token_count: row.decoded_token_count,
      log_probability: row.log_probability, feasibility_score: decision?.feasibility_score ?? null,
      joint_score: decision?.joint_score ?? null, decoder_disposition: row.disposition,
      filter_disposition: decision?.disposition ?? null, duplicate_of: row.duplicate_of,
    };
  });
}

export function forwardCsv(prediction, displayed = prediction?.products || []) {
  const provenance = forwardProvenance(prediction);
  if (prediction?.provenance != null && !provenance) return "";
  const rows = provenance ? forwardLedger(provenance) : displayed.map((row, index) => ({
    ...row, decoder_rank: null, native_rank: null, joint_rank: null, saved_joint_ordinal: index + 1,
  }));
  return Papa.unparse(rows.map((row) => ({
    decoder_rank: row.decoder_rank, native_rank: row.native_rank, joint_rank: row.joint_rank,
    saved_joint_ordinal: row.saved_joint_ordinal ?? null,
    rank_basis: provenance?.rank_basis ?? JOINT_DISPLAY_BASIS,
    ranking_policy: provenance?.ranking_policy ?? null,
    model: prediction?.model ?? null, forward_asset_identity: prediction?.asset_identity ?? null,
    fast_filter_model: provenance?.fast_filter_model ?? null,
    fast_filter_asset_identity: provenance?.fast_filter_asset_identity ?? null,
    reactants: prediction?.reactants ?? null, product: row.product,
    decoded_product: row.decoded_product ?? null, log_probability: row.log_probability,
    terminated_by_eos: provenance ? row.terminated_by_eos : null,
    decoded_token_count: provenance ? row.decoded_token_count : null,
    feasibility_score: row.feasibility_score, joint_score: row.joint_score ?? null,
    decoder_disposition: row.decoder_disposition ?? null, filter_disposition: row.filter_disposition ?? null,
    duplicate_of: row.duplicate_of ?? null,
  })), { escapeFormulae: true });
}
