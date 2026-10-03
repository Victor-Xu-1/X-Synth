const FINAL_ROUTE_OUTPUT_MIN = 3;
const FINAL_ROUTE_OUTPUT_MAX = 10;
const HIGH_QUALITY_CANDIDATE_POOL = 200;
const HIGH_QUALITY_FILTER_THRESHOLD = 0.75;
const HIGH_QUALITY_TEMPLATE_COUNT = 1000;
const HIGH_QUALITY_TEMPLATE_CUM_PROB = 0.999;

function ensureObject(target, key) {
  if (!target[key] || typeof target[key] !== "object") {
    target[key] = {};
  }
  return target[key];
}

function applyHighQualityRoutePolicy(body) {
  const buildTreeOptions = ensureObject(body, "build_tree_options");
  const enumeratePathsOptions = ensureObject(body, "enumerate_paths_options");
  const expandOneOptions = ensureObject(body, "expand_one_options");

  buildTreeOptions.return_first = false;
  buildTreeOptions.max_trees = Math.max(
    HIGH_QUALITY_CANDIDATE_POOL,
    Number(buildTreeOptions.max_trees) || 0
  );

  enumeratePathsOptions.path_format = enumeratePathsOptions.path_format || "json";
  enumeratePathsOptions.json_format = enumeratePathsOptions.json_format || "nodelink";
  enumeratePathsOptions.validate_paths = true;
  enumeratePathsOptions.sorting_metric = "score";
  enumeratePathsOptions.score_trees = true;
  enumeratePathsOptions.cluster_trees = true;
  enumeratePathsOptions.cluster_method = enumeratePathsOptions.cluster_method || "hdbscan";
  enumeratePathsOptions.min_samples = Number(enumeratePathsOptions.min_samples) || 5;
  enumeratePathsOptions.min_cluster_size = Number(enumeratePathsOptions.min_cluster_size) || 5;
  enumeratePathsOptions.max_paths = FINAL_ROUTE_OUTPUT_MAX;
  delete enumeratePathsOptions.final_route_output_min;
  delete enumeratePathsOptions.final_route_output_max;

  expandOneOptions.use_fast_filter = true;
  expandOneOptions.filter_threshold = Math.max(
    HIGH_QUALITY_FILTER_THRESHOLD,
    Number(expandOneOptions.filter_threshold) || 0
  );
  if ("fast_filter_threshold" in expandOneOptions) {
    expandOneOptions.fast_filter_threshold = Math.max(
      HIGH_QUALITY_FILTER_THRESHOLD,
      Number(expandOneOptions.fast_filter_threshold) || 0
    );
    expandOneOptions.filter_threshold = Math.max(
      expandOneOptions.filter_threshold,
      expandOneOptions.fast_filter_threshold
    );
  }
  expandOneOptions.template_max_count = Math.max(
    HIGH_QUALITY_TEMPLATE_COUNT,
    Number(expandOneOptions.template_max_count) || 0
  );
  expandOneOptions.template_max_cum_prob = Math.max(
    HIGH_QUALITY_TEMPLATE_CUM_PROB,
    Number(expandOneOptions.template_max_cum_prob) || 0
  );
  expandOneOptions.cluster_precursors = true;

  return body;
}

function buildHighQualityMctsPayload({ smiles, description }) {
  return applyHighQualityRoutePolicy({
    description: description || smiles,
    smiles,
    expand_one_options: {},
    build_tree_options: {},
    enumerate_paths_options: {},
  });
}

export {
  FINAL_ROUTE_OUTPUT_MAX,
  FINAL_ROUTE_OUTPUT_MIN,
  HIGH_QUALITY_CANDIDATE_POOL,
  HIGH_QUALITY_FILTER_THRESHOLD,
  HIGH_QUALITY_TEMPLATE_COUNT,
  HIGH_QUALITY_TEMPLATE_CUM_PROB,
  applyHighQualityRoutePolicy,
  buildHighQualityMctsPayload,
};
