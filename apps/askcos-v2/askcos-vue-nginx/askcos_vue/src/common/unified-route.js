const UNIFIED_ROUTE_ENDPOINT = "/synon-api/unified-route/call-async";
const UNIFIED_ROUTE_JOBS_ENDPOINT = "/synon-api/unified-route/jobs";

function unifiedRouteStatusEndpoint(jobId) {
  return `/synon-api/unified-route/jobs/${encodeURIComponent(jobId)}`;
}

function boundedNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(number, min), max);
}

function buildUnifiedRouteRequestBody(treeBody) {
  const buildTreeOptions = treeBody?.build_tree_options || {};
  const enumeratePathsOptions = treeBody?.enumerate_paths_options || {};
  const smiles = String(treeBody?.smiles || "").trim();
  const description = String(treeBody?.description || smiles).trim() || smiles;

  return {
    smiles,
    description,
    backend: "all",
    expansion_time: boundedNumber(buildTreeOptions.expansion_time, 1800, 60, 7200),
    max_paths: boundedNumber(enumeratePathsOptions.max_paths, 200, 50, 500),
    askcos_timeout_sec: 3600,
    poll_sec: 60,
    aizynth_model: "USPTO",
    aizynth_timeout_sec: 3600,
    min_routes: 3,
    max_routes: 10,
    public: true,
  };
}

function mergeAskcosResultsWithUnifiedJobs(askcosResults, unifiedJobs) {
  const results = Array.isArray(askcosResults) ? [...askcosResults] : [];
  const representedJobIds = new Set(
    results
      .map((item) => item?.unified_route_pool_summary?.id || item?.result?.unified_route_pool?.id)
      .filter(Boolean)
  );

  for (const job of Array.isArray(unifiedJobs) ? unifiedJobs : []) {
    const jobId = String(job?.job_id || "").trim();
    if (!jobId || representedJobIds.has(jobId)) continue;
    results.push(unifiedJobToResult(job));
  }
  return results;
}

function unifiedJobToResult(job) {
  const summary = job?.summary || {};
  const selectedRouteCount = Number(
    job?.selected_route_count ?? summary?.selected_route_count ?? 0
  );
  return {
    result_id: String(job?.job_id || ""),
    description: job?.description || summary?.description || job?.job_id || "统一路线任务",
    created: job?.created_at || job?.modified || "",
    modified: job?.modified || job?.created_at || "",
    tags: ["统一路线"],
    result_state: job?.status || "running",
    result_type: "unified_route_job",
    target_smiles: job?.target_smiles || summary?.smiles || "",
    num_trees: Number.isFinite(selectedRouteCount) ? selectedRouteCount : 0,
    public: true,
    unified_route_pool_summary: {
      ...summary,
      id: summary?.id || job?.job_id,
      selected_route_count: Number.isFinite(selectedRouteCount) ? selectedRouteCount : 0,
      closed_route_count: job?.closed_route_count ?? summary?.closed_route_count ?? 0,
      meets_min_routes: job?.meets_min_routes ?? summary?.meets_min_routes ?? false,
      askcos_task_id: job?.askcos_task_id || summary?.askcos_task_id,
    },
  };
}

export {
  UNIFIED_ROUTE_ENDPOINT,
  UNIFIED_ROUTE_JOBS_ENDPOINT,
  unifiedRouteStatusEndpoint,
  buildUnifiedRouteRequestBody,
  mergeAskcosResultsWithUnifiedJobs,
};
