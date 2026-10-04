import {
  analysisRecordUrl,
  buildRequest,
  candidateCount,
  factorValues,
  validateResult,
} from "./model";

// UI protocol fixtures, not empirical experiments or scientific acceptance results.
const draft = () => ({
  content: "protocol fixture",
  table: { table_sha256: "a".repeat(64) },
  selectedRows: [3, 1, 2],
  factors: [
    { name: "temperature", kind: "numerical", levels: "10\n20" },
    { name: "solvent", kind: "categorical", levels: "a\nb\nc" },
  ],
  target: {
    name: "response",
    kind: "response",
    direction: "minimize",
    unit: "mM",
  },
  batchSize: 1,
  confirmedMeasurements: true,
  confirmedCandidates: true,
});

export function resultFixture(request) {
  return {
    engine: "BayBE",
    versions: { baybe: "0.15.0" },
    empirically_confirmed: false,
    table_sha256: request.table_sha256,
    measurement_count: 3,
    selected_rows: request.selected_rows,
    target: request.target,
    recommendations: [
      {
        conditions: { temperature: 20, solvent: "b" },
        posterior_mean: 0,
        posterior_std: 1,
      },
    ],
    csv_content: "protocol fixture",
    best_observed: 1,
    unique_measured_conditions: 3,
    warnings: ["Protocol fixture; not a scientific result."],
    record_id: "f".repeat(32),
    surrogate: "GaussianProcessSurrogate",
    acquisition: "qLogExpectedImprovement",
    seed: 42,
    categorical_encoding: "OHE",
    request_sha256: "a".repeat(64),
    other_server_metadata: "permitted envelope extension",
  };
}

test("request preserves explicit measured rows and target direction without implicit selection", () => {
  const request = buildRequest(draft());
  expect(request.selected_rows).toEqual([1, 2, 3]);
  expect(request.factors[0].values).toEqual([10, 20]);
  expect(request.target.direction).toBe("minimize");
  expect(request.confirmed_measurements).toBe(true);
});
test.each([
  { selectedRows: [] },
  { confirmedMeasurements: false },
  { confirmedCandidates: false },
  { batchSize: 9 },
  { target: { name: "temperature" } },
])("invalid or unconfirmed draft is not a request: %j", (update) => {
  expect(() => buildRequest({ ...draft(), ...update })).toThrow();
});
test.each([
  "1\nNaN",
  "10\n0x20",
  "10\n10",
  "true\n20",
  "10\nInfinity",
  "10",
  "1\n1000000000001",
])("invalid discrete numerical levels: %s", (levels) => {
  expect(() =>
    factorValues({ name: "t", kind: "numerical", levels }),
  ).toThrow();
});
test("Cartesian candidate count is bounded before a request", () => {
  const factors = Array.from({ length: 4 }, (_, i) => ({
    name: `f${i}`,
    kind: "categorical",
    levels: Array.from({ length: 10 }, (__, n) => String(n)).join("\n"),
  }));
  expect(candidateCount(factors)).toBe(10000);
  expect(() => buildRequest({ ...draft(), factors })).toThrow("4096");
});
test("server record id and additional envelope metadata do not invalidate a valid typed result", () => {
  const request = buildRequest(draft()),
    result = resultFixture(request);
  expect(validateResult(result, request).record_id).toBe("f".repeat(32));
  expect(analysisRecordUrl(result.record_id)).toBe(
    `/analyses/${"f".repeat(32)}`,
  );
  expect(analysisRecordUrl("../../elsewhere")).toBeNull();
});
test.each([
  { empirically_confirmed: true },
  { versions: { baybe: "0.12.2" } },
  { table_sha256: "b".repeat(64) },
  { measurement_count: 4 },
  { selected_rows: [1, 2, 4] },
  {
    recommendations: [
      {
        conditions: { temperature: 30, solvent: "b" },
        posterior_mean: 0,
        posterior_std: 1,
      },
    ],
  },
  {
    recommendations: [
      {
        conditions: { temperature: 20, solvent: "b" },
        posterior_mean: Infinity,
        posterior_std: 1,
      },
    ],
  },
])("stale, overstated or malformed response is hidden: %j", (update) => {
  const request = buildRequest(draft());
  expect(() =>
    validateResult({ ...resultFixture(request), ...update }, request),
  ).toThrow();
});
