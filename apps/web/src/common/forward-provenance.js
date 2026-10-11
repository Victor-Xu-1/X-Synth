import {
  ORIGINAL_RANK_BASIS, FORWARD_RANKING_POLICY, assetHash, rankRecord, rankText,
  rankOrdinal, logProbability, filterScore, jointScore, sameScore,
} from "./forward-rank";

function validParameters(p) {
  return rankRecord(p) && rankOrdinal(p.beam_size) && rankOrdinal(p.n_best) &&
    p.n_best <= p.beam_size && Number.isFinite(p.temperature) && p.temperature > 0 &&
    Number.isSafeInteger(p.predict_min_len) && p.predict_min_len >= 1 &&
    Number.isSafeInteger(p.predict_max_len) && p.predict_max_len <= 512 &&
    p.predict_max_len >= p.predict_min_len && [0, 1].includes(p.mask_rel_chirality);
}

export function validRankingProvenance(p) {
  if (!rankRecord(p) || p.version !== 1 || p.rank_basis !== ORIGINAL_RANK_BASIS ||
      p.ranking_policy !== FORWARD_RANKING_POLICY || p.fast_filter_model !== "askcos_fast_filter" ||
      !rankRecord(p.decoder) || p.decoder.version !== 1 || !validParameters(p.decoder.parameters) ||
      !Array.isArray(p.decoder.hypotheses) || p.decoder.hypotheses.length > p.decoder.parameters.n_best ||
      !Array.isArray(p.decisions) || p.decisions.length > 30) return false;
  const returned = [], seen = new Map();
  for (const [index, row] of p.decoder.hypotheses.entries()) {
    if (!rankRecord(row) || row.decoder_rank !== index + 1 ||
        typeof row.decoded_product !== "string" || !logProbability(row.log_probability) ||
        typeof row.terminated_by_eos !== "boolean" ||
        (row.terminated_by_eos && row.decoded_token_count === 0) ||
        !Number.isSafeInteger(row.decoded_token_count) || row.decoded_token_count < 0 ||
        row.decoded_token_count > p.decoder.parameters.predict_max_len ||
        (row.disposition === "incomplete_decoding") === row.terminated_by_eos) return false;
    if (row.disposition === "returned") {
      if (!rankText(row.product) || seen.has(row.product) ||
          row.native_rank !== returned.length + 1 || row.duplicate_of !== null) return false;
      seen.set(row.product, row.decoder_rank);
      returned.push(row);
    } else if (row.disposition === "duplicate") {
      if (!seen.has(row.product) || row.duplicate_of !== seen.get(row.product) || row.native_rank !== null) return false;
    } else if (!["invalid_decoding", "unsupported_structure", "incomplete_decoding"].includes(row.disposition) ||
        row.product !== null || row.native_rank !== null || row.duplicate_of !== null) return false;
  }
  if (returned.length !== p.decisions.length) return false;
  const ranked = [];
  for (const [index, decision] of p.decisions.entries()) {
    const source = returned[index];
    if (!rankRecord(decision) || decision.decoder_rank !== source.decoder_rank ||
        decision.native_rank !== source.native_rank) return false;
    if (decision.disposition === "ranked") {
      if (!filterScore(decision.feasibility_score) || !rankOrdinal(decision.joint_rank) ||
          !sameScore(decision.joint_score, jointScore(source.log_probability, decision.feasibility_score))) return false;
      ranked.push(decision);
    } else if (!["no_op", "unsupplied_atoms"].includes(decision.disposition) ||
        [decision.feasibility_score, decision.joint_score, decision.joint_rank].some((value) => value !== null)) return false;
  }
  ranked.sort((a, b) => b.joint_score - a.joint_score);
  return ranked.every((row, index) => row.joint_rank === index + 1) &&
    (ranked.length > 0 ? assetHash(p.fast_filter_asset_identity) : p.fast_filter_asset_identity === null);
}

export function rankedLedgerProducts(p) {
  const source = new Map(p.decoder.hypotheses.map((row) => [row.decoder_rank, row]));
  return p.decisions.filter((row) => row.disposition === "ranked")
    .sort((a, b) => a.joint_rank - b.joint_rank).map((row) => ({
      product: source.get(row.decoder_rank).product,
      log_probability: source.get(row.decoder_rank).log_probability,
      feasibility_score: row.feasibility_score, decoder_rank: row.decoder_rank,
      native_rank: row.native_rank, joint_rank: row.joint_rank,
    }));
}

export function acceptsForwardResult(result, limit = 10, { requireIdentity = false } = {}) {
  if (!rankRecord(result) || typeof result.reactants !== "string" ||
      !Array.isArray(result.products) || result.products.length > Math.min(limit, 10) ||
      result.products.some((row) => !rankRecord(row) || !rankText(row.product) ||
        !logProbability(row.log_probability) || !filterScore(row.feasibility_score))) return false;
  const modern = result.provenance !== undefined && result.provenance !== null;
  if ((modern || requireIdentity) && (result.model !== "graph2smiles_uspto_stereo" ||
      result.evidence_type !== "model_prediction" || !assetHash(result.asset_identity) ||
      !rankText(result.reactants))) return false;
  if (!modern) return result.products.every((row) =>
    [row.decoder_rank, row.native_rank, row.joint_rank].every((rank) => rank == null));
  if (!validRankingProvenance(result.provenance)) return false;
  const native = result.provenance.decoder.hypotheses.filter((row) => row.disposition === "returned");
  if (result.provenance.decisions.some((row, index) =>
    (row.disposition === "no_op") !== (native[index].product === result.reactants))) return false;
  const complete = rankedLedgerProducts(result.provenance);
  if (complete.length && !result.products.length) return false;
  return result.products.every((row, index) => complete[index] &&
    Object.entries(complete[index]).every(([key, value]) => row[key] === value));
}
