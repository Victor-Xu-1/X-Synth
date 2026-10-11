import { assetHash, rankRecord, rankText } from "@/common/forward-rank";

function conditionScope(field, outcome) {
  if (field === "procedure" || field.startsWith("conditions.temperature.") || field.startsWith("conditions.pressure.")) return true;
  const time = /^outcomes\[(\d+)\]\.reaction_time$/.exec(field);
  return !!time && Number(time[1]) === outcome;
}

// Read-time evidence binding only; the producer owns canonical chemical identity checks.
export function recordedForwardSupportBound(proofs, step, reference) {
  if (!rankRecord(step) || !rankText(step.product) || !rankRecord(reference) ||
      reference.complete !== true || reference.has_more !== false ||
      !Array.isArray(reference.sources) || !reference.sources.length ||
      reference.sources.some((source) => !rankRecord(source) || source.ready !== true) ||
      !Array.isArray(reference.refs) || !Array.isArray(proofs) || !proofs.length) return false;
  return proofs.every((proof) => {
    if (!rankRecord(proof) || !rankText(proof.id) || proof.source !== "ORD" ||
        !assetHash(proof.snapshot) || !assetHash(proof.source_sha256) ||
        proof.basis !== "exact_recorded_reaction_with_positive_yield" ||
        !reference.sources.some((source) => source.source === "ORD" && source.snapshot === proof.snapshot)) return false;
    const source = reference.refs.find((row) => row?.id === proof.id && row.source === "ORD" &&
      row.match_scope === "reaction_identity" &&
      (row.reaction_conditions_recorded === true || row.reaction_procedure_recorded === true) &&
      row.reaction_yields_recorded === true && row.provenance?.source_sha256 === proof.source_sha256);
    if (!source || !Array.isArray(source.reaction_yield_measurements) ||
        !Array.isArray(source.reaction_condition_fields) ||
        !Array.isArray(proof.recorded_outcomes) || !proof.recorded_outcomes.length) return false;
    return proof.recorded_outcomes.every((item) => {
      if (!rankRecord(item) || !Number.isSafeInteger(item.outcome_index) || item.outcome_index < 0 ||
          item.product_smiles !== step.product || !Number.isFinite(item.yield_value) ||
          item.yield_value <= 0 || item.yield_value > 100 || item.yield_unit !== "%" ||
          typeof item.yield_source_field !== "string" ||
          !Array.isArray(item.condition_source_fields) || !item.condition_source_fields.length) return false;
      const yieldField = /^outcomes\[(\d+)\]\.products\[\d+\]\.measurements\[\d+\]$/.exec(item.yield_source_field);
      const indices = source.provenance?.outcome_indices;
      if (!yieldField || Number(yieldField[1]) !== item.outcome_index ||
          (indices !== undefined && (!Array.isArray(indices) || (indices.length && !indices.includes(item.outcome_index)))) ||
          item.condition_source_fields.some((field) => typeof field !== "string" ||
            !conditionScope(field, item.outcome_index) || !source.reaction_condition_fields.includes(field))) return false;
      return source.reaction_yield_measurements.some((measurement) => rankRecord(measurement) &&
        measurement.value === item.yield_value && measurement.unit === item.yield_unit &&
        measurement.method === "ord_product_measurement" && measurement.measurement_type === "YIELD" &&
        measurement.product_smiles === step.product && measurement.source_field === item.yield_source_field);
    });
  });
}
