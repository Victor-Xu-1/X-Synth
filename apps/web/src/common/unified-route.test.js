const {
  UNIFIED_ROUTE_ENDPOINT,
  UNIFIED_ROUTE_JOBS_ENDPOINT,
  unifiedRouteStatusEndpoint,
  buildUnifiedRouteRequestBody,
  mergeAskcosResultsWithUnifiedJobs,
} = require("@/common/unified-route");

test("uses Synon unified route endpoint for route tree submissions", () => {
  expect(UNIFIED_ROUTE_ENDPOINT).toBe("/api/v1/unified-route/call-async");
  expect(UNIFIED_ROUTE_JOBS_ENDPOINT).toBe("/api/v1/unified-route/jobs");
  expect(unifiedRouteStatusEndpoint("job 1/2")).toBe(
    "/api/v1/unified-route/jobs/job%201%2F2",
  );
});

test("maps ASKCOS tree builder settings into unified route request body", () => {
  const body = buildUnifiedRouteRequestBody({
    smiles: "OC(C(F)=CC=C1)=C1C2=CC3=C(NCC34CCNCC4)N=N2",
    description: "complex target",
    build_tree_options: {
      expansion_time: 2400,
      max_depth: 14,
    },
    enumerate_paths_options: {
      max_paths: 9,
    },
  });

  expect(body).toStrictEqual({
    smiles: "OC(C(F)=CC=C1)=C1C2=CC3=C(NCC34CCNCC4)N=N2",
    description: "complex target",
    backend: "askcos",
    strategies: ["mcts", "retro_star"],
    expansion_time: 2400,
    max_paths: 200,
    min_routes: 3,
    max_routes: 9,
    repair_attempts: 1,
    tuning: {
      max_depth: 14,
      max_branching: 50,
      template_count: 1000,
      cumulative_probability: 0.999,
      minimum_plausibility: 0.75,
    },
    public: false,
  });
});

test("normalizes unsafe route request limits without lowering quality defaults", () => {
  const body = buildUnifiedRouteRequestBody({
    smiles: "CCO",
    build_tree_options: {
      expansion_time: 1,
    },
    enumerate_paths_options: {
      max_paths: 99,
    },
  });

  expect(body.description).toBe("CCO");
  expect(body.expansion_time).toBe(60);
  expect(body.max_paths).toBe(99);
  expect(body.min_routes).toBe(3);
  expect(body.max_routes).toBe(10);
});

test("fresh defaults remain explicit, private and bounded by the product contract", () => {
  expect(buildUnifiedRouteRequestBody({ smiles: "CCO" })).toMatchObject({
    backend: "askcos",
    public: false,
    strategies: ["mcts", "retro_star"],
    expansion_time: 1800,
    max_paths: 200,
    min_routes: 3,
    max_routes: 10,
    repair_attempts: 1,
  });
});
test.each([
  {
    strategies: ["retro_star"],
    expansion_time: 61,
    max_paths: 10,
    min_routes: 4,
    max_routes: 8,
    repair_attempts: 0,
  },
  {
    strategies: ["mcts"],
    expansion_time: 7200,
    max_paths: 500,
    min_routes: 10,
    max_routes: 10,
    repair_attempts: 1,
  },
])(
  "typed product replay fields are retained rather than mapped through legacy path limits",
  (settings) => {
    expect(
      buildUnifiedRouteRequestBody(
        { smiles: "CCO", ...settings },
        { strict: true },
      ),
    ).toMatchObject(settings);
  },
);
test("legal low cumulative probability and actual zero FF threshold remain unchanged", () => {
  expect(
    buildUnifiedRouteRequestBody(
      {
        tuning: { cumulative_probability: 0.001, minimum_plausibility: 0 },
      },
      { strict: true },
    ).tuning,
  ).toMatchObject({
    cumulative_probability: 0.001,
    minimum_plausibility: 0,
  });
});
test.each([
  { strategies: [] },
  { strategies: ["exact_match"] },
  { strategies: "mcts" },
  { strategies: ["mcts", "mcts", "retro_star"] },
  { max_paths: 9 },
  { max_paths: 501 },
  { max_paths: true },
  { max_paths: "80" },
  { min_routes: 2 },
  { min_routes: 4, max_routes: 3 },
  { repair_attempts: 2 },
  { repair_attempts: null },
  { expansion_time: 59 },
  { expansion_time: 7201 },
  { expansion_time: 60.5 },
  { tuning: [] },
  { tuning: { max_depth: 3.5 } },
  { tuning: { template_count: Infinity } },
  { tuning: { cumulative_probability: 0 } },
  { tuning: { minimum_plausibility: -0.01 } },
])("invalid typed replay cannot bypass backend constraints: %p", (settings) => {
  expect(() =>
    buildUnifiedRouteRequestBody(settings, { strict: true }),
  ).toThrow();
});
test("fresh normalization never emits booleans or fractions in integer request fields", () => {
  const body = buildUnifiedRouteRequestBody({
    expansion_time: 60.5,
    max_paths: true,
    max_routes: 6.4,
    tuning: { max_depth: [20], max_branching: 3.5 },
  });
  expect(body.expansion_time).toBe(61);
  expect(body.max_paths).toBe(200);
  expect(body.max_routes).toBe(6);
  expect(body.tuning.max_depth).toBe(12);
  expect(body.tuning.max_branching).toBe(4);
});
test("prefill cannot select another provider, public output or unrecognized request fields", () => {
  const body = buildUnifiedRouteRequestBody(
    {
      backend: "other",
      public: true,
      stock_provider: "untrusted",
      tuning: { future_option: true },
      strategies: ["mcts", "mcts"],
    },
    { strict: true },
  );
  expect(body.backend).toBe("askcos");
  expect(body.public).toBe(false);
  expect(body.strategies).toEqual(["mcts"]);
  expect(body).not.toHaveProperty("stock_provider");
  expect(body.tuning).not.toHaveProperty("future_option");
});

test("merges unified jobs into results when ASKCOS list is empty or stale", () => {
  const merged = mergeAskcosResultsWithUnifiedJobs(
    [],
    [
      {
        job_id: "unified-job-1",
        status: "completed_not_enough_routes",
        target_smiles:
          "OC(C(F)=CC=C1)=C1C2=CC3=C(NCC4(C(F)F)CC5(CNC5)CN43)N=N2",
        description: "complex zero route",
        selected_route_count: 0,
        closed_route_count: 0,
        modified: "2026-07-02T00:00:00",
        summary: {
          id: "unified-job-1",
          selected_route_count: 0,
          closed_route_count: 0,
          meets_min_routes: false,
          engine_errors: { askcos: "stalled" },
        },
      },
    ],
  );

  expect(merged).toHaveLength(1);
  expect(merged[0]).toMatchObject({
    result_id: "unified-job-1",
    result_type: "unified_route_job",
    result_state: "completed_not_enough_routes",
    target_smiles: "OC(C(F)=CC=C1)=C1C2=CC3=C(NCC4(C(F)F)CC5(CNC5)CN43)N=N2",
    num_trees: 0,
  });
  expect(merged[0].unified_route_pool_summary.engine_errors.askcos).toBe(
    "stalled",
  );
});

test("does not duplicate unified jobs already represented by ASKCOS result summaries", () => {
  const askcosResult = {
    result_id: "askcos-result-1",
    result_type: "tree_builder",
    unified_route_pool_summary: {
      id: "unified-job-1",
      selected_route_count: 3,
    },
  };

  const merged = mergeAskcosResultsWithUnifiedJobs(
    [askcosResult],
    [
      {
        job_id: "unified-job-1",
        status: "completed",
        selected_route_count: 3,
        summary: { id: "unified-job-1", selected_route_count: 3 },
      },
    ],
  );

  expect(merged).toStrictEqual([askcosResult]);
});
