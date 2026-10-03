import {
  FINAL_ROUTE_OUTPUT_MAX,
  FINAL_ROUTE_OUTPUT_MIN,
  HIGH_QUALITY_CANDIDATE_POOL,
  HIGH_QUALITY_FILTER_THRESHOLD,
  HIGH_QUALITY_TEMPLATE_COUNT,
  HIGH_QUALITY_TEMPLATE_CUM_PROB,
} from "@/common/tree-quality-policy";

const HIGH_QUALITY_ROUTE_SETTINGS = {
  expansionTime: 1200,
  maxDepth: 12,
  maxBranching: 50,
  numTemplates: HIGH_QUALITY_TEMPLATE_COUNT,
  maxCumProb: HIGH_QUALITY_TEMPLATE_CUM_PROB,
  minPlausibility: HIGH_QUALITY_FILTER_THRESHOLD,
  returnFirst: false,
  maxTrees: HIGH_QUALITY_CANDIDATE_POOL,
  finalRouteOutputMin: FINAL_ROUTE_OUTPUT_MIN,
  finalRouteOutputMax: FINAL_ROUTE_OUTPUT_MAX,
  sortingMetric: "score",
  scoreTrees: true,
  clusterTrees: true,
};

const TB_PRESETS = {
  quality: {
    label: "最高质量路线",
    info: "使用 ASKCOS 路线打分、路线聚类和严格 fast filter；内部扩大候选池，最终只输出 3-10 条闭合路线。",
    settings: HIGH_QUALITY_ROUTE_SETTINGS,
  },
};

export { TB_PRESETS, HIGH_QUALITY_ROUTE_SETTINGS };
