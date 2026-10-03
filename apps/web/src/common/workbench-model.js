import { buildUnifiedRouteRequestBody } from "./unified-route";

export const workbenchModes = [
  { value: "auto", title: "完整路线搜索", icon: "mdi-source-branch" },
  { value: "manual", title: "单步逆合成", icon: "mdi-molecule" },
  { value: "import", title: "打开路线文档", icon: "mdi-file-import-outline" },
];
export const searchSettings = [
  {
    key: "max_depth",
    label: "逆合成层数上限",
    description:
      "单条分支逐级追溯前体的搜索深度（max_depth），不是路线总反应数。",
    min: 3,
    max: 50,
  },
  {
    key: "max_branching",
    label: "每步候选反应数上限",
    description: "每个中间体允许继续扩展的候选反应分支数（max_branching）。",
    min: 1,
    max: 200,
  },
  {
    key: "template_count",
    label: "每步模板数上限",
    description:
      "每次预测参与匹配的反应模板数上限（template_count），不等于返回路线数。",
    min: 10,
    max: 5000,
  },
  {
    key: "cumulative_probability",
    label: "模板概率覆盖阈值",
    description:
      "按模型排序累计的模板选择概率（cumulative_probability），不是实验成功率。",
    min: Number.MIN_VALUE,
    max: 1,
    step: "any",
  },
  {
    key: "minimum_plausibility",
    label: "反应筛选分数下限",
    description:
      "Fast Filter 模型的反应评分阈值（minimum_plausibility），不是实测收率或实验成功率。",
    min: 0,
    max: 1,
    step: "any",
  },
];
export function normalizeMode(value) {
  return workbenchModes.some((mode) => mode.value === value) ? value : "auto";
}
function searchDraft(body) {
  return {
    strategies: [...body.strategies],
    maxPaths: body.max_paths,
    minRoutes: body.min_routes,
    repairAttempts: body.repair_attempts,
    maxRoutes: body.max_routes,
    minutes: body.expansion_time / 60,
    tuning: body.tuning,
  };
}
export function defaultSearchSettings() {
  return searchDraft(buildUnifiedRouteRequestBody({}));
}
export function buildWorkbenchRequest({ smiles, name, settings }) {
  if (
    typeof settings.minutes !== "number" ||
    !Number.isFinite(settings.minutes)
  )
    throw new Error("每轮搜索时长必须为有效数字。");
  return buildUnifiedRouteRequestBody(
    {
      smiles,
      description: name,
      strategies: settings.strategies,
      max_paths: settings.maxPaths,
      min_routes: settings.minRoutes,
      max_routes: settings.maxRoutes,
      repair_attempts: settings.repairAttempts,
      expansion_time: Math.round(settings.minutes * 60),
      tuning: settings.tuning,
    },
    { strict: true },
  );
}
export function querySeed(query) {
  if (
    ["smiles", "q", "task_name", "search_settings"].some(
      (key) => query[key] !== undefined && typeof query[key] !== "string",
    )
  )
    throw new Error("任务链接参数格式无效。");
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
  const body = settings
    ? buildUnifiedRouteRequestBody(settings, { strict: true })
    : null;
  return {
    key: JSON.stringify([
      query.smiles || query.q || "",
      query.task_name || "",
      text,
    ]),
    smiles: String(query.smiles || query.q || settings?.smiles || ""),
    name: String(query.task_name || settings?.description || "").slice(0, 160),
    settings: body ? searchDraft(body) : defaultSearchSettings(),
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
        metadata: item,
      },
    ],
    closed: false,
  };
}
