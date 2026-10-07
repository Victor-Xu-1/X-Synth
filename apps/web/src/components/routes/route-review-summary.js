const record = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value) => typeof value === "string" && value.trim().length > 0;
const count = (value) => Number.isSafeInteger(value) && value >= 0;
const state = (status) => ({ status });
const emptySummary = (status) => ({
  forward: state(status),
  references: state(status),
});

function stepRecords(records, total, stepIds) {
  if (!Array.isArray(records) || records.length > total) return false;
  const seen = new Set();
  return records.every((row) => {
    if (
      !record(row) ||
      !text(row.step_id) ||
      seen.has(row.step_id) ||
      (stepIds && !stepIds.has(row.step_id))
    )
      return false;
    seen.add(row.step_id);
    return true;
  });
}

function forwardSummary(value, stepCount, stepIds, version) {
  if (value == null) return state("missing");
  if (
    !record(value) ||
    !count(value.matched_steps) ||
    !count(value.total_steps) ||
    value.matched_steps > value.total_steps ||
    (stepCount !== null && value.total_steps !== stepCount) ||
    !stepRecords(value.records, value.total_steps, stepIds)
  )
    return state("invalid");
  let matched = 0,
    unmatched = 0;
  for (const row of value.records) {
    if (
      typeof row.record_id !== "string" ||
      !/^[a-f0-9]{32}$/i.test(row.record_id) ||
      !text(row.model) ||
      !(row.expected_rank === null ||
        (count(row.expected_rank) && row.expected_rank > 0)) ||
      (row.matched !== undefined && typeof row.matched !== "boolean") ||
      (row.matched === true && row.expected_rank === null)
    )
      return state("invalid");
    // Rank alone does not encode the producer's rank/feasibility acceptance gate.
    if (row.matched === true) matched++;
    else if (row.matched === false || row.expected_rank === null) unmatched++;
  }
  if (
    matched > value.matched_steps ||
    unmatched > value.total_steps - value.matched_steps
  )
    return state("invalid");
  if (version === 2) {
    if (!count(value.model_top1_matched_steps) || !count(value.record_supported_steps) ||
        value.model_top1_matched_steps + value.record_supported_steps !== value.matched_steps)
      return state("invalid");
    let top1 = 0, supported = 0;
    for (const row of value.records) {
      if (typeof row.matched !== "boolean" || typeof row.model_top1_matched !== "boolean" || !Array.isArray(row.record_support))
        return state("invalid");
      if (row.support_kind === "model_top1") {
        if (!row.matched || !row.model_top1_matched || row.expected_rank !== 1 || row.record_support.length)
          return state("invalid");
        top1++;
      } else if (row.support_kind === "record_supported_model_candidate") {
        if (!row.matched || row.model_top1_matched || row.expected_rank < 2 || !row.record_support.length ||
            row.record_support.some((proof) => !record(proof) || !text(proof.id) || proof.source !== "ORD" ||
              !/^[a-f0-9]{64}$/.test(proof.snapshot) || !/^[a-f0-9]{64}$/.test(proof.source_sha256) ||
              proof.basis !== "exact_recorded_reaction_with_positive_yield"))
          return state("invalid");
        supported++;
      } else if (row.support_kind !== "unsupported" || row.matched || row.model_top1_matched || row.record_support.length) {
        return state("invalid");
      }
    }
    if (top1 !== value.model_top1_matched_steps || supported !== value.record_supported_steps)
      return state("invalid");
  }
  return {
    status: "ready",
    matched: value.matched_steps,
    total: value.total_steps,
    ...(version === 2 ? { top1: value.model_top1_matched_steps, recorded: value.record_supported_steps } : {}),
  };
}

function referenceSummary(value, stepCount, stepIds) {
  if (value == null) return state("missing");
  if (
    !record(value) ||
    !count(value.reaction_matched_steps) ||
    !count(value.product_matched_steps) ||
    !count(value.unmatched_steps)
  )
    return state("invalid");
  const totals = [
    value.reaction_matched_steps,
    value.product_matched_steps,
    value.unmatched_steps,
  ];
  const total = stepCount;
  const coverageKeys = ["unchecked_steps", "truncated_steps", "unavailable_source_steps", "unknown_coverage_steps"];
  const hasCoverage = coverageKeys.some((key) => value[key] !== undefined);
  const coverageCounts = coverageKeys.map((key) => value[key] ?? 0);
  if (coverageKeys.some((key) => value[key] === null)) return state("invalid");
  if (hasCoverage && coverageCounts.some((item) => !count(item) || item > total))
    return state("invalid");
  const [unchecked, truncated, unavailable, unknown] = coverageCounts;
  const covered = total - value.unmatched_steps - unchecked;
  if (
    !count(total) ||
    covered < 0 ||
    value.reaction_matched_steps > covered ||
    value.product_matched_steps > covered ||
    value.reaction_matched_steps + value.product_matched_steps < covered ||
    !stepRecords(value.records, total, stepIds)
  )
    return state("invalid");
  if (hasCoverage && (unchecked !== total - value.records.length ||
      [truncated, unavailable, unknown].some((item) => item > value.records.length)))
    return state("invalid");
  const recorded = [0, 0, 0];
  let overlap = 0;
  for (const row of value.records) {
    if (
      !count(row.reaction_count) ||
      !count(row.product_count) ||
      !Array.isArray(row.refs) ||
      row.refs.some(
        (ref) =>
          !record(ref) ||
          !["reaction_identity", "product_identity"].includes(ref.match_scope),
      )
    )
      return state("invalid");
    for (const [scope, expected] of [
      ["reaction_identity", row.reaction_count],
      ["product_identity", row.product_count],
    ]) {
      const shown = row.refs.filter((ref) => ref.match_scope === scope).length;
      if (shown > expected || (expected > 0 && shown === 0))
        return state("invalid");
    }
    // The producer counts each scope independently; a step can have both kinds.
    if (row.reaction_count > 0) recorded[0]++;
    if (row.product_count > 0) recorded[1]++;
    if (!row.reaction_count && !row.product_count) recorded[2]++;
    if (row.reaction_count > 0 && row.product_count > 0) overlap++;
  }
  if (
    overlap > value.reaction_matched_steps + value.product_matched_steps - covered ||
    recorded.some((item, index) =>
      item > totals[index] || (value.records.length === total && item !== totals[index]),
    )
  )
    return state("invalid");
  return {
    status: "ready",
    reaction: totals[0],
    product: totals[1],
    unmatched: totals[2],
    total,
    ...(hasCoverage ? { coverage: { unchecked, truncated, unavailable, unknown } } : {}),
  };
}

export function readRouteReviewSummary(candidate) {
  const review = candidate?.metadata?.automated_review;
  if (review == null) return emptySummary("missing");
  if (!record(review) || !count(review.version)) return emptySummary("invalid");
  if (![1, 2].includes(review.version)) return emptySummary("unsupported");
  const steps = Array.isArray(candidate?.steps) ? candidate.steps : null;
  const stepCount = steps ? steps.length : null;
  const stepIds =
    steps?.every((step) => text(step?.step_id))
      ? new Set(steps.map((step) => step.step_id))
      : null;
  const forward = forwardSummary(review.forward, stepCount, stepIds, review.version);
  return {
    forward,
    references: referenceSummary(
      review.references,
      stepCount ?? (forward.status === "ready" ? forward.total : null),
      stepIds,
    ),
  };
}
