/** @jest-environment node */
import { readRouteReviewSummary } from "./route-review-summary";

// API-contract fixtures only, not a provider or experimental route evidence.
function candidate() {
  return {
    steps: ["s1", "s2", "s3", "s4"].map((step_id) => ({ step_id })),
    metadata: {
      automated_review: {
        version: 1,
        forward: {
          matched_steps: 4,
          total_steps: 4,
          records: [{
            step_id: "s1",
            record_id: "a".repeat(32),
            expected_rank: 1,
            model: "graph2smiles_uspto_stereo",
            feasibility_score: 0.9,
          }],
        },
        references: {
          reaction_matched_steps: 1,
          product_matched_steps: 2,
          unmatched_steps: 1,
          records: [{
            step_id: "s1",
            reaction_count: 2,
            product_count: 0,
            refs: [{
              id: "ord-contract",
              url: "https://example.org/reaction",
              match_scope: "reaction_identity",
              source: "ORD",
            }],
          }],
        },
      },
    },
  };
}

test("the v1 summary preserves aggregate coverage even when records are abbreviated", () => {
  const value = candidate();
  const before = JSON.stringify(value);
  expect(readRouteReviewSummary(value)).toEqual({
    forward: { status: "ready", matched: 4, total: 4 },
    references: {
      status: "ready", reaction: 1, product: 2, unmatched: 1, total: 4,
    },
  });
  expect(JSON.stringify(value)).toBe(before);
});

function supportedCandidate() {
  const value = candidate();
  const review = value.metadata.automated_review;
  review.version = 2;
  review.forward = {
    matched_steps: 4, total_steps: 4, model_top1_matched_steps: 3, record_supported_steps: 1,
    records: value.steps.map((step, index) => ({
      step_id: step.step_id, record_id: "a".repeat(32), model: "graph2smiles_uspto_stereo",
      expected_rank: index === 0 ? 2 : 1, matched: true, model_top1_matched: index !== 0,
      support_kind: index === 0 ? "record_supported_model_candidate" : "model_top1",
      record_support: index === 0 ? [{
        id: "ord-contract", source: "ORD", snapshot: "b".repeat(64), source_sha256: "c".repeat(64),
        basis: "exact_recorded_reaction_with_positive_yield",
      }] : [],
    })),
  };
  return value;
}

test("v2 counts keep model-first and record-supported candidates separate", () => {
  const value = supportedCandidate();
  expect(readRouteReviewSummary(value).forward).toEqual({
    status: "ready", matched: 4, total: 4, top1: 3, recorded: 1,
  });
});

test.each([
  { expected_rank: null }, { expected_rank: 1 }, { model_top1_matched: true },
  { record_support: [] }, { matched: undefined }, { support_kind: "unknown" },
])("v2 does not accept inconsistent record support: %j", (change) => {
  const value = supportedCandidate();
  Object.assign(value.metadata.automated_review.forward.records[0], change);
  expect(readRouteReviewSummary(value).forward.status).toBe("invalid");
});

test("v2 source proof and aggregate counts cannot be missing or inconsistent", () => {
  const value = supportedCandidate();
  value.metadata.automated_review.forward.records[0].record_support[0].snapshot = "missing";
  expect(readRouteReviewSummary(value).forward.status).toBe("invalid");
  const other = supportedCandidate();
  other.metadata.automated_review.forward.model_top1_matched_steps = 4;
  expect(readRouteReviewSummary(other).forward.status).toBe("invalid");
});

test("partial searches and unchecked steps remain distinct from returned no-matches", () => {
  const value = candidate();
  Object.assign(value.metadata.automated_review.references, {
    reaction_matched_steps: 1, product_matched_steps: 0, unmatched_steps: 0,
    unchecked_steps: 3, truncated_steps: 1, unavailable_source_steps: 1,
    unknown_coverage_steps: 0,
  });
  expect(readRouteReviewSummary(value).references).toEqual({
    status: "ready", reaction: 1, product: 0, unmatched: 0, total: 4,
    coverage: { unchecked: 3, truncated: 1, unavailable: 1, unknown: 0 },
  });
  value.metadata.automated_review.references.unchecked_steps = 2;
  expect(readRouteReviewSummary(value).references).toEqual({ status: "invalid" });
});

test.each(["unchecked_steps", "truncated_steps", "unavailable_source_steps", "unknown_coverage_steps"])(
  "new coverage counter %s cannot use coercion or negative values", (key) => {
    const value = candidate();
    value.metadata.automated_review.references[key] = "1";
    expect(readRouteReviewSummary(value).references.status).toBe("invalid");
  },
);

test.each([undefined, {}, { metadata: {} }, { metadata: { automated_review: null } }, {
  metadata: {
    forward_validation_passed: true,
    full_forward_prediction_validated: true,
    forward_validation_method: "native_template_reconstruction",
    evidence_refs: ["legacy-reference"],
  },
}])("legacy or absent metadata never implies automated review: %j", (value) => {
  expect(readRouteReviewSummary(value)).toEqual({
    forward: { status: "missing" }, references: { status: "missing" },
  });
});

test.each([true, [], "review", {}, { version: "1" }])(
  "malformed review envelopes stay invalid: %j", (automated_review) => {
    expect(readRouteReviewSummary({ metadata: { automated_review } })).toEqual({
      forward: { status: "invalid" }, references: { status: "invalid" },
    });
  },
);

test("unknown versions cannot be interpreted as a completed v1 review", () => {
  const value = candidate();
  value.metadata.automated_review.version = 3;
  expect(readRouteReviewSummary(value)).toEqual({
    forward: { status: "unsupported" }, references: { status: "unsupported" },
  });
});

test.each([null, "4", true, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
  "invalid forward counts are not coerced or clamped: %s", (matched_steps) => {
    const value = candidate();
    value.metadata.automated_review.forward.matched_steps = matched_steps;
    const summary = readRouteReviewSummary(value);
    expect(summary.forward).toEqual({ status: "invalid" });
    expect(summary.references.status).toBe("ready");
  },
);

test.each(["reaction_matched_steps", "product_matched_steps", "unmatched_steps"])(
  "%s requires an explicit nonnegative integer", (key) => {
    const value = candidate();
    value.metadata.automated_review.references[key] = "1";
    expect(readRouteReviewSummary(value).references).toEqual({ status: "invalid" });
    expect(readRouteReviewSummary(value).forward.status).toBe("ready");
  },
);

test("forward totals and reference coverage must agree with route steps", () => {
  const value = candidate();
  value.metadata.automated_review.forward.total_steps = 3;
  value.metadata.automated_review.references.product_matched_steps = 4;
  expect(readRouteReviewSummary(value)).toEqual({
    forward: { status: "invalid" }, references: { status: "invalid" },
  });
});

test("summary counts cannot contradict an explicitly unmatched forward record", () => {
  const value = candidate();
  value.metadata.automated_review.forward.records[0].expected_rank = null;
  expect(readRouteReviewSummary(value).forward.status).toBe("invalid");
  value.metadata.automated_review.forward.matched_steps = 3;
  expect(readRouteReviewSummary(value).forward).toEqual({
    status: "ready", matched: 3, total: 4,
  });
});

test.each([0, -1, 0.5, "1", undefined])(
  "invalid expected ranks cannot support a forward match: %s", (expected_rank) => {
    const value = candidate();
    value.metadata.automated_review.forward.records[0].expected_rank = expected_rank;
    expect(readRouteReviewSummary(value).forward.status).toBe("invalid");
  },
);

test.each(["forward", "references"])(
  "%s rejects missing, duplicate and foreign step records", (section) => {
    for (const records of [null, [null]]) {
      const value = candidate();
      value.metadata.automated_review[section].records = records;
      expect(readRouteReviewSummary(value)[section].status).toBe("invalid");
    }
    const value = candidate();
    const rows = value.metadata.automated_review[section].records;
    rows.push({ ...rows[0] });
    expect(readRouteReviewSummary(value)[section].status).toBe("invalid");
    rows.pop();
    rows[0].step_id = "another-route-step";
    expect(readRouteReviewSummary(value)[section].status).toBe("invalid");
  },
);

test("product identity references do not become same-reaction evidence", () => {
  const value = candidate();
  const refs = value.metadata.automated_review.references;
  refs.reaction_matched_steps = 0;
  refs.product_matched_steps = 3;
  refs.records[0].reaction_count = 0;
  refs.records[0].product_count = 2;
  refs.records[0].refs[0].match_scope = "product_identity";
  expect(readRouteReviewSummary(value).references).toEqual({
    status: "ready", reaction: 0, product: 3, unmatched: 1, total: 4,
  });
  refs.reaction_matched_steps = 1;
  refs.product_matched_steps = 2;
  refs.records[0].reaction_count = 2;
  expect(readRouteReviewSummary(value).references.status).toBe("invalid");
});

test("a step can have both reference scopes without making product records reaction evidence", () => {
  const value = candidate();
  const row = value.metadata.automated_review.references.records[0];
  row.product_count = 1;
  row.refs.push({ ...row.refs[0], id: "product", match_scope: "product_identity" });
  value.metadata.automated_review.references.product_matched_steps = 3;
  expect(readRouteReviewSummary(value).references).toMatchObject({
    status: "ready", reaction: 1, product: 3,
  });
});

test("unknown reference scopes and unsupported reaction counts stay invalid", () => {
  const value = candidate();
  const row = value.metadata.automated_review.references.records[0];
  row.refs[0].match_scope = "similar_product";
  expect(readRouteReviewSummary(value).references.status).toBe("invalid");
  row.refs = [];
  expect(readRouteReviewSummary(value).references.status).toBe("invalid");
});

test("missing sections remain distinct from zero matches", () => {
  const value = candidate();
  delete value.metadata.automated_review.forward;
  expect(readRouteReviewSummary(value).forward).toEqual({ status: "missing" });
  expect(readRouteReviewSummary(value).references.status).toBe("ready");
  delete value.metadata.automated_review.references;
  expect(readRouteReviewSummary(value).references).toEqual({ status: "missing" });
});

test("empty routes preserve zero counts without inventing successful reactions", () => {
  const value = candidate();
  value.steps = [];
  value.metadata.automated_review.forward = {
    matched_steps: 0, total_steps: 0, records: [],
  };
  value.metadata.automated_review.references = {
    reaction_matched_steps: 0, product_matched_steps: 0, unmatched_steps: 0, records: [],
  };
  expect(readRouteReviewSummary(value)).toEqual({
    forward: { status: "ready", matched: 0, total: 0 },
    references: { status: "ready", reaction: 0, product: 0, unmatched: 0, total: 0 },
  });
});

test("a ranked product alone does not mean the producer accepted its feasibility", () => {
  const value = candidate();
  const forward = value.metadata.automated_review.forward;
  forward.matched_steps = 0;
  forward.records[0].expected_rank = 2;
  expect(readRouteReviewSummary(value).forward).toEqual({
    status: "ready", matched: 0, total: 4,
  });
  forward.records[0].matched = false;
  forward.records[0].expected_rank = 1;
  forward.records[0].feasibility_score = 0.1;
  expect(readRouteReviewSummary(value).forward.matched).toBe(0);
  forward.matched_steps = 4;
  expect(readRouteReviewSummary(value).forward.status).toBe("invalid");
});

test("full reference records must support both inclusive scope counters", () => {
  const value = candidate();
  const refs = value.metadata.automated_review.references;
  refs.records = value.steps.map((step) => ({
    step_id: step.step_id, reaction_count: 0, product_count: 1,
    refs: [{ id: step.step_id, match_scope: "product_identity" }],
  }));
  refs.reaction_matched_steps = 0;
  refs.product_matched_steps = 4;
  refs.unmatched_steps = 0;
  expect(readRouteReviewSummary(value).references.status).toBe("ready");
  refs.reaction_matched_steps = 1;
  expect(readRouteReviewSummary(value).references.status).toBe("invalid");
});
