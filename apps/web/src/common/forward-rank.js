export const ORIGINAL_RANK_BASIS = "original_decoder_ordinal";
export const JOINT_DISPLAY_BASIS = "joint_display_ordinal";
export const FORWARD_RANKING_POLICY = "sequence_log_probability_plus_log_fast_filter_v1";
export const FORWARD_REVIEW_POLICY = "exact_stock_graph2smiles_rank_provenance_v7";

export const rankRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
export const rankText = (value) => typeof value === "string" && !!value.trim();
export const assetHash = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export const candidateCount = (value) => Number.isSafeInteger(value) && value >= 0 && value <= 30;
export const rankOrdinal = (value) => candidateCount(value) && value > 0;
export const logProbability = (value) => Number.isFinite(value) && value <= 0;
export const filterScore = (value) => Number.isFinite(value) && value >= 0 && value <= 1;
export const jointScore = (log, score) => log + Math.log(Math.max(score, 1e-30));
export const sameScore = (left, right) => Number.isFinite(left) && Number.isFinite(right) &&
  Math.abs(left - right) <= 8 * Number.EPSILON * Math.max(1, Math.abs(left), Math.abs(right));

export function reviewRankBasis(version, basis) {
  if (version === 4) return basis === ORIGINAL_RANK_BASIS ? ORIGINAL_RANK_BASIS : null;
  return [1, 2, 3].includes(version) && (basis === undefined || basis === JOINT_DISPLAY_BASIS)
    ? JOINT_DISPLAY_BASIS : null;
}

// Validate the recorded receipt, not chemistry or the server's content-addressed digest.
export function validForwardRankReceipt(row) {
  const p = row?.rank_provenance;
  if (!rankRecord(p) || p.version !== 1 || p.rank_basis !== ORIGINAL_RANK_BASIS ||
      p.ranking_policy !== FORWARD_RANKING_POLICY ||
      ![p.provenance_sha256, p.reaction_sha256, p.forward_asset_identity].every(assetHash) ||
      ![p.decoder_count, p.native_count, p.ranked_count].every(candidateCount) ||
      p.ranked_count > p.native_count || p.native_count > p.decoder_count ||
      !filterScore(p.minimum_plausibility) ||
      (p.ranked_count > 0 ? !assetHash(p.fast_filter_asset_identity) : p.fast_filter_asset_identity !== null) ||
      row.model !== "graph2smiles_uspto_stereo" || row.expected_rank !== p.decoder_rank)
    return false;
  const values = [p.decoder_rank, p.native_rank, p.joint_rank, p.log_probability, p.joint_score];
  if (p.decoder_rank === null)
    return values.every((value) => value === null) && row.feasibility_score === null && row.matched === false;
  return [p.decoder_rank, p.native_rank, p.joint_rank].every(rankOrdinal) &&
    p.decoder_rank <= p.decoder_count && p.native_rank <= p.native_count &&
    p.joint_rank <= p.ranked_count && p.native_rank <= p.decoder_rank &&
    logProbability(p.log_probability) && filterScore(row.feasibility_score) &&
    sameScore(p.joint_score, jointScore(p.log_probability, row.feasibility_score));
}
