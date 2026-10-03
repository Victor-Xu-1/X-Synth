import { buildUnifiedRouteRequestBody } from "./unified-route";

export const workbenchModes = [
  { value: "auto", title: "路线搜索", icon: "mdi-source-branch" },
  { value: "manual", title: "一步分析", icon: "mdi-molecule" },
  { value: "import", title: "导入路线", icon: "mdi-file-import-outline" },
];
export const searchSettings = [
  { key: "max_depth", label: "最大深度", min: 3, max: 50 },
  { key: "max_branching", label: "扩展分支", min: 1, max: 200 },
  { key: "template_count", label: "候选模板", min: 10, max: 5000 },
  {
    key: "cumulative_probability",
    label: "累计模板概率",
    min: 0.01,
    max: 1,
    step: 0.001,
  },
  {
    key: "minimum_plausibility",
    label: "FF 筛选阈值",
    min: 0,
    max: 1,
    step: 0.01,
  },
];
export function normalizeMode(value) {
  return workbenchModes.some((mode) => mode.value === value) ? value : "auto";
}
export function defaultSearchSettings() {
  const body = buildUnifiedRouteRequestBody({});
  return {
    maxRoutes: body.max_routes,
    minutes: body.expansion_time / 60,
    tuning: body.tuning,
  };
}
export function querySeed(query) {
  if (!query.smiles && !query.q && !query.task_name && !query.search_settings)
    return null;
  const text = String(query.search_settings || "");
  if (text.length > 16000) throw new Error("任务参数过长。");
  const settings = text ? JSON.parse(text) : null;
  if (
    text &&
    (!settings || typeof settings !== "object" || Array.isArray(settings))
  )
    throw new Error("任务参数格式无效。");
  const body = settings ? buildUnifiedRouteRequestBody(settings) : null;
  return {
    key: JSON.stringify([
      query.smiles || query.q || "",
      query.task_name || "",
      text,
    ]),
    smiles: String(query.smiles || query.q || settings?.smiles || ""),
    name: String(query.task_name || settings?.description || "").slice(0, 160),
    settings: body
      ? {
          maxRoutes: body.max_routes,
          minutes: body.expansion_time / 60,
          tuning: body.tuning,
        }
      : null,
  };
}
export function oneStepCandidate(result, index) {
  const item = result.outcomes[index];
  if (!item) throw new Error("候选已失效，请重新选择。");
  return {
    target_smiles: result.canonical,
    engine: `ASKCOS / ${result.model}`,
    steps: [
      {
        product: result.canonical,
        precursors: String(item.outcome || "")
          .split(".")
          .filter(Boolean),
        confidence: item.plausibility,
      },
    ],
    closed: false,
  };
}
