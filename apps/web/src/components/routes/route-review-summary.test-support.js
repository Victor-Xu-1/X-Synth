import { forwardRankReceiptFixture, rankedForwardFixture } from "@/common/forward-result.test-support";
import { jointScore } from "@/common/forward-rank";

// Shape-level contract fixture; hashes do not claim scientific acceptance.
export function rankedReviewFixture(decoderRank = 2) {
  const output = rankedForwardFixture(), p = forwardRankReceiptFixture(decoderRank);
  const top1 = decoderRank === 1, step = {
    step_id: "s1", product: output.provenance.decoder.hypotheses[decoderRank - 1].product,
    precursors: output.reactants.split("."),
  };
  const score = decoderRank === 2 ? .9 : .95;
  p.joint_score = jointScore(p.log_probability, score);
  if (top1) p.joint_rank = 1;
  const jointFirst = p.joint_rank === 1;
  const observation = {
    outcome_index: 0, product_smiles: step.product, yield_value: 80, yield_unit: "%",
    yield_source_field: "outcomes[0].products[0].measurements[0]",
    condition_source_fields: ["conditions.temperature.setpoint"],
  };
  const proof = {
    id: "ord-contract", source: "ORD", snapshot: "e".repeat(64), source_sha256: "f".repeat(64),
    basis: "exact_recorded_reaction_with_positive_yield", recorded_outcomes: [observation],
  };
  return {
    steps: [step], metadata: { automated_review: {
      version: 4, forward: {
        matched_steps: 1, total_steps: 1, model_top1_matched_steps: top1 ? 1 : 0,
        joint_top1_matched_steps: jointFirst ? 1 : 0, record_supported_steps: jointFirst ? 0 : 1,
        records: [{
          step_id: step.step_id, model: output.model, record_id: "a".repeat(32), expected_rank: decoderRank,
          feasibility_score: score,
          matched: true, model_top1_matched: top1, joint_top1_matched: jointFirst,
          support_kind: jointFirst ? "joint_ranked_top1" : "record_supported_model_candidate",
          record_support: jointFirst ? [] : [proof], rank_provenance: p,
        }],
      }, references: {
        reaction_matched_steps: 1, product_matched_steps: 0, unmatched_steps: 0,
        records: [{
          step_id: step.step_id, reaction_count: 1, product_count: 0, complete: true, has_more: false,
          query: { product: step.product, reactants: step.precursors },
          sources: [{ source: "ORD", ready: true, snapshot: proof.snapshot }],
          refs: [{
            id: proof.id, source: "ORD", match_scope: "reaction_identity",
            reaction_conditions_recorded: true, reaction_yields_recorded: true,
            reaction_condition_fields: observation.condition_source_fields,
            provenance: { source_sha256: proof.source_sha256, outcome_indices: [0] },
            reaction_yield_measurements: [{
              value: observation.yield_value, unit: "%", method: "ord_product_measurement", measurement_type: "YIELD",
              product_smiles: step.product, source_field: observation.yield_source_field,
            }],
          }],
        }],
      },
    } },
  };
}
