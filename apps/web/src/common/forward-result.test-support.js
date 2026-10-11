import { FORWARD_RANKING_POLICY, ORIGINAL_RANK_BASIS, jointScore } from "./forward-rank";

// Protocol/rendering fixtures only, never provider or experimental evidence.
// Token counts are explicit protocol controls, not inferred from decoded strings.
export function rankedForwardFixture(displayCount = 10) {
  const reactants = `${"C".repeat(40)}.O`;
  const hypotheses = [], decisions = [];
  let nativeRank = 0;
  for (let rank = 1; rank <= 30; rank++) {
    const product = rank === 1 ? "CC=O" : rank === 2 ? "CO" : rank === 6 ? reactants
      : rank === 7 ? "F" : "C".repeat(rank);
    const skipped = { 3: "duplicate", 4: "invalid_decoding", 5: "unsupported_structure" }[rank];
    hypotheses.push({
      decoder_rank: rank, decoded_product: rank === 4 ? "invalid" : rank === 3 ? "CC=O" : product,
      terminated_by_eos: true, decoded_token_count: 16,
      product: rank === 3 ? "CC=O" : skipped ? null : product,
      log_probability: rank <= 2 ? -rank / 10 : -rank,
      disposition: skipped || "returned", native_rank: skipped ? null : ++nativeRank,
      duplicate_of: rank === 3 ? 1 : null,
    });
    if (skipped) continue;
    const disposition = rank === 6 ? "no_op" : rank === 7 ? "unsupplied_atoms" : "ranked";
    const score = disposition !== "ranked" ? null : rank === 1 ? 0.01 : rank === 2 ? 0.9 : 0.5;
    decisions.push({
      decoder_rank: rank, native_rank: nativeRank, disposition, feasibility_score: score,
      joint_score: score === null ? null : jointScore(hypotheses.at(-1).log_probability, score),
      joint_rank: null,
    });
  }
  const ranked = decisions.filter((row) => row.disposition === "ranked").sort((a, b) => b.joint_score - a.joint_score);
  ranked.forEach((row, index) => { row.joint_rank = index + 1; });
  const products = ranked.slice(0, displayCount).map((row) => ({
    product: hypotheses[row.decoder_rank - 1].product,
    log_probability: hypotheses[row.decoder_rank - 1].log_probability,
    feasibility_score: row.feasibility_score, decoder_rank: row.decoder_rank,
    native_rank: row.native_rank, joint_rank: row.joint_rank,
  }));
  return {
    reactants, model: "graph2smiles_uspto_stereo", evidence_type: "model_prediction",
    asset_identity: "a".repeat(64), products,
    provenance: {
      version: 1, rank_basis: ORIGINAL_RANK_BASIS, ranking_policy: FORWARD_RANKING_POLICY,
      decoder: { version: 1, parameters: {
        beam_size: 30, n_best: 30, temperature: 1, predict_min_len: 1, predict_max_len: 256, mask_rel_chirality: 0,
      }, hypotheses }, decisions, fast_filter_model: "askcos_fast_filter", fast_filter_asset_identity: "b".repeat(64),
    },
  };
}

export function incompleteForwardFixture(displayCount = 10) {
  const result = rankedForwardFixture(displayCount);
  result.provenance.decoder.parameters.predict_max_len = 512;
  Object.assign(result.provenance.decoder.hypotheses[3], {
    decoded_product: "[13CH3:1][C@H:2]([F:3])[Cl:4].[Na+]",
    terminated_by_eos: false, decoded_token_count: 512, disposition: "incomplete_decoding",
  });
  return result;
}

export function leadingIncompleteForwardFixture() {
  const result = incompleteForwardFixture(), p = result.provenance;
  p.decoder.hypotheses = [
    { ...p.decoder.hypotheses[3], decoder_rank: 1 },
    { ...p.decoder.hypotheses[1], native_rank: 1 },
  ];
  p.decisions = [{ ...p.decisions[1], native_rank: 1 }];
  result.products = [{ ...result.products[0], native_rank: 1 }];
  return result;
}

export function forwardRankReceiptFixture(decoderRank = 2) {
  const result = rankedForwardFixture(), p = result.provenance;
  const source = p.decoder.hypotheses.find((row) => row.decoder_rank === decoderRank);
  const decision = p.decisions.find((row) => row.decoder_rank === decoderRank);
  return {
    version: 1, rank_basis: p.rank_basis, ranking_policy: p.ranking_policy,
    provenance_sha256: "c".repeat(64), reaction_sha256: "d".repeat(64),
    forward_asset_identity: result.asset_identity, fast_filter_asset_identity: p.fast_filter_asset_identity,
    decoder_count: p.decoder.hypotheses.length, native_count: p.decisions.length,
    ranked_count: p.decisions.filter((row) => row.disposition === "ranked").length,
    minimum_plausibility: 0.75,
    decoder_rank: source.decoder_rank, native_rank: source.native_rank, joint_rank: decision.joint_rank,
    log_probability: source.log_probability, joint_score: decision.joint_score,
  };
}
