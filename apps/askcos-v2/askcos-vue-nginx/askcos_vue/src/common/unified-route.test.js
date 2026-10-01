const {
  UNIFIED_ROUTE_ENDPOINT,
  UNIFIED_ROUTE_JOBS_ENDPOINT,
  unifiedRouteStatusEndpoint,
  buildUnifiedRouteRequestBody,
  mergeAskcosResultsWithUnifiedJobs,
} = require("@/common/unified-route");

test("uses Synon unified route endpoint for route tree submissions", () => {
  expect(UNIFIED_ROUTE_ENDPOINT).toBe("/synon-api/unified-route/call-async");
  expect(UNIFIED_ROUTE_JOBS_ENDPOINT).toBe("/synon-api/unified-route/jobs");
  expect(unifiedRouteStatusEndpoint("job 1/2")).toBe(
    "/synon-api/unified-route/jobs/job%201%2F2"
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
    backend: "all",
    expansion_time: 2400,
    max_paths: 50,
    askcos_timeout_sec: 3600,
    poll_sec: 60,
    aizynth_model: "USPTO",
    aizynth_timeout_sec: 3600,
    min_routes: 3,
    max_routes: 10,
    public: true,
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

test("merges unified jobs into results when ASKCOS list is empty or stale", () => {
  const merged = mergeAskcosResultsWithUnifiedJobs(
    [],
    [
      {
        job_id: "unified-job-1",
        status: "completed_not_enough_routes",
        target_smiles: "OC(C(F)=CC=C1)=C1C2=CC3=C(NCC4(C(F)F)CC5(CNC5)CN43)N=N2",
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
    ]
  );

  expect(merged).toHaveLength(1);
  expect(merged[0]).toMatchObject({
    result_id: "unified-job-1",
    result_type: "unified_route_job",
    result_state: "completed_not_enough_routes",
    target_smiles: "OC(C(F)=CC=C1)=C1C2=CC3=C(NCC4(C(F)F)CC5(CNC5)CN43)N=N2",
    num_trees: 0,
  });
  expect(merged[0].unified_route_pool_summary.engine_errors.askcos).toBe("stalled");
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
    ]
  );

  expect(merged).toStrictEqual([askcosResult]);
});
