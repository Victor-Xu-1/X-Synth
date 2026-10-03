const UNIFIED_ROUTE_ENDPOINT = "/api/v1/unified-route/call-async";
const UNIFIED_ROUTE_JOBS_ENDPOINT = "/api/v1/unified-route/jobs";

function unifiedRouteStatusEndpoint(jobId) {
  return `/api/v1/unified-route/jobs/${encodeURIComponent(jobId)}`;
}

function boundedNumber(
  value,
  fallback,
  min,
  max,
  { strict, integer, positive, name } = {},
) {
  if (value === undefined) return fallback;
  const numeric =
    typeof value === "number" ||
    (!strict && typeof value === "string" && value.trim() !== "");
  const number = numeric ? Number(value) : NaN;
  if (
    strict &&
    (!Number.isFinite(number) ||
      number < min ||
      number > max ||
      (integer && !Number.isInteger(number)) ||
      (positive && number <= 0))
  ) {
    throw new Error("搜索参数 " + name + " 不符合后端约束。");
  }
  if (!Number.isFinite(number) || (positive && number <= 0)) return fallback;
  const bounded = Math.min(Math.max(number, min), max);
  return integer ? Math.round(bounded) : bounded;
}

function record(value, strict) {
  if (value === undefined) return {};
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (strict) throw new Error("搜索参数格式无效。");
  return {};
}
function strategies(value) {
  if (value === undefined) return ["mcts", "retro_star"];
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.length > 2 ||
    value.some((item) => !["mcts", "retro_star"].includes(item))
  )
    throw new Error("搜索策略不符合后端约束。");
  return [...new Set(value)];
}
const supplied = (value, legacy) => (value === undefined ? legacy : value);

function buildUnifiedRouteRequestBody(treeBody, { strict = false } = {}) {
  treeBody = record(treeBody, strict);
  const buildTreeOptions = record(treeBody.build_tree_options, strict);
  const enumeratePathsOptions = record(
    treeBody.enumerate_paths_options,
    strict,
  );
  const expandOneOptions = record(treeBody.expand_one_options, strict);
  const tuning = record(treeBody.tuning, strict);
  const smiles = String(treeBody?.smiles || "").trim();
  const description = String(treeBody?.description || smiles).trim() || smiles;
  const number = (
    name,
    value,
    fallback,
    min,
    max,
    integer = false,
    positive = false,
  ) =>
    boundedNumber(value, fallback, min, max, {
      strict,
      integer,
      positive,
      name,
    });
  const minRoutes = number("min_routes", treeBody.min_routes, 3, 3, 10, true);
  const maxRoutes = number(
    "max_routes",
    supplied(treeBody.max_routes, enumeratePathsOptions.max_paths),
    10,
    3,
    10,
    true,
  );
  if (minRoutes > maxRoutes) throw new Error("路线数量下限不能高于上限。");
  const legacyPaths =
    Number(enumeratePathsOptions.max_paths) <= 10
      ? undefined
      : enumeratePathsOptions.max_paths;

  return {
    smiles,
    description,
    backend: "askcos",
    strategies: strategies(treeBody.strategies),
    expansion_time: number(
      "expansion_time",
      supplied(treeBody.expansion_time, buildTreeOptions.expansion_time),
      1800,
      60,
      7200,
      true,
    ),
    max_paths: number(
      "max_paths",
      supplied(treeBody.max_paths, legacyPaths),
      200,
      treeBody.max_paths === undefined ? 50 : 10,
      500,
      true,
    ),
    min_routes: minRoutes,
    max_routes: maxRoutes,
    repair_attempts: number(
      "repair_attempts",
      treeBody.repair_attempts,
      1,
      0,
      1,
      true,
    ),
    tuning: {
      max_depth: number(
        "max_depth",
        supplied(tuning.max_depth, buildTreeOptions.max_depth),
        12,
        3,
        50,
        true,
      ),
      max_branching: number(
        "max_branching",
        supplied(tuning.max_branching, buildTreeOptions.max_branching),
        50,
        1,
        200,
        true,
      ),
      template_count: number(
        "template_count",
        supplied(tuning.template_count, expandOneOptions.template_max_count),
        1000,
        10,
        5000,
        true,
      ),
      cumulative_probability: number(
        "cumulative_probability",
        supplied(
          tuning.cumulative_probability,
          expandOneOptions.template_max_cum_prob,
        ),
        0.999,
        0,
        1,
        false,
        true,
      ),
      minimum_plausibility: number(
        "minimum_plausibility",
        supplied(
          tuning.minimum_plausibility,
          expandOneOptions.filter_threshold,
        ),
        0.75,
        0,
        1,
      ),
    },
    public: false,
  };
}

function mergeAskcosResultsWithUnifiedJobs(askcosResults, unifiedJobs) {
  const results = Array.isArray(askcosResults) ? [...askcosResults] : [];
  const representedJobIds = new Set(
    results
      .map(
        (item) =>
          item?.unified_route_pool_summary?.id ||
          item?.result?.unified_route_pool?.id,
      )
      .filter(Boolean),
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
    job?.selected_route_count ?? summary?.selected_route_count ?? 0,
  );
  return {
    result_id: String(job?.job_id || ""),
    description:
      job?.description || summary?.description || job?.job_id || "统一路线任务",
    created: job?.created_at || job?.modified || "",
    modified: job?.modified || job?.created_at || "",
    tags: ["统一路线"],
    result_state: job?.status || "running",
    result_type: "unified_route_job",
    target_smiles: job?.target_smiles || summary?.smiles || "",
    num_trees: Number.isFinite(selectedRouteCount) ? selectedRouteCount : 0,
    public: false,
    unified_route_pool_summary: {
      ...summary,
      id: summary?.id || job?.job_id,
      selected_route_count: Number.isFinite(selectedRouteCount)
        ? selectedRouteCount
        : 0,
      closed_route_count:
        job?.closed_route_count ?? summary?.closed_route_count ?? 0,
      meets_min_routes:
        job?.meets_min_routes ?? summary?.meets_min_routes ?? false,
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
