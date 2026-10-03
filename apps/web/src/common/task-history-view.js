import { isJobTerminal } from "./job-state";

export const historyStatusOptions = [
  { title: "全部状态", value: "all" },
  { title: "进行中 / 等待恢复", value: "active" },
  { title: "已完成", value: "completed" },
  { title: "路线不足", value: "completed_not_enough_routes" },
  { title: "未闭合", value: "failed_unclosed" },
  { title: "已取消", value: "cancelled" },
  { title: "执行失败", value: "failed" },
  { title: "历史结果", value: "legacy_completed" },
  { title: "历史未完成", value: "legacy_incomplete" },
];

const parameterLabels = {
  backend: "搜索引擎",
  strategies: "搜索策略",
  expansion_time: "搜索预算（秒）",
  max_paths: "候选路径上限",
  min_routes: "路线数量下限",
  max_routes: "路线数量上限",
  repair_attempts: "扩大搜索次数上限",
  public: "公开任务",
  max_depth: "最大深度",
  max_branching: "扩展分支上限",
  template_count: "候选模板上限",
  cumulative_probability: "累计模板概率",
  minimum_plausibility: "FF 筛选阈值",
};

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function taskTitle(task) {
  return task?.description || task?.target_smiles || "未命名任务";
}

export function taskDetailLocation(task) {
  return `/results/${encodeURIComponent(task.result_id)}`;
}

export function preserveStructureControl(event) {
  if (event.target?.closest?.("button")) event.preventDefault();
}

export function taskRouteCount(task) {
  const value = task?.num_trees;
  if (!["number", "string"].includes(typeof value) || String(value).trim() === "") return null;
  const count = Number(value);
  return Number.isInteger(count) && count >= 0 ? count : null;
}

export function normalizeTaskInfo(task, response = {}) {
  const value = isRecord(response) ? response : {};
  const priorTime = Date.parse(task.modified), nextTime = Date.parse(value.modified);
  const snapshot = Number.isFinite(priorTime) && Number.isFinite(nextTime) && nextTime < priorTime ? task : value;
  const state = snapshot.result_state || snapshot.status || task.result_state;
  const modified = Object.hasOwn(snapshot, "modified") ? snapshot.modified
    : (state === task.result_state ? task.modified : null);
  const summary = value.result?.unified_route_pool?.summary || value.result?.stats || value.summary || {};
  const routes = value.result?.unified_route_pool?.selected_routes;
  return {
    ...task,
    result_id: value.result_id || value.job_id || task.result_id,
    description: snapshot.description ?? value.settings?.description ?? task.description,
    target_smiles: snapshot.target_smiles || value.settings?.smiles || task.target_smiles,
    result_state: state,
    created: value.created ?? value.created_at ?? task.created,
    modified,
    num_trees: snapshot.num_trees ?? snapshot.selected_route_count ?? summary.selected_route_count
      ?? (Array.isArray(routes) ? routes.length : task.num_trees),
    settings: isRecord(value.settings) ? value.settings : (task.settings || null),
    error_code: value.error_code ?? task.error_code,
  };
}

export function taskEndedAt(task) {
  return isJobTerminal(task?.result_state) && task?.modified ? task.modified : null;
}

export function taskTimestampLabel(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "未记录";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).format(date);
}

function parameterValue(key, value) {
  if (key === "backend" && value === "askcos") return "ASKCOS V2";
  if (key === "public" && typeof value === "boolean") return value ? "是" : "否";
  if (key === "strategies" && Array.isArray(value) && value.every((item) => typeof item === "string")) {
    const labels = { mcts: "MCTS", retro_star: "RetroStar" };
    return value.map((item) => labels[item] || item).join(" / ");
  }
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

export function taskParameterGroups(settings) {
  if (!isRecord(settings)) return [];
  const field = (key, value, prefix = "") => ({
    key: `${prefix}${key}`,
    label: parameterLabels[key] || key,
    value: parameterValue(key, value),
  });
  const primary = Object.entries(settings)
    .filter(([key]) => !["smiles", "description"].includes(key) && (key !== "tuning" || !isRecord(settings.tuning)))
    .map(([key, value]) => field(key, value));
  const tuning = isRecord(settings.tuning)
    ? Object.entries(settings.tuning).map(([key, value]) => field(key, value, "tuning."))
    : [];
  return [
    { title: "搜索参数", fields: primary },
    { title: "搜索调优", fields: tuning },
  ].filter((group) => group.fields.length);
}

export function buildTaskSearchLocation(task) {
  if (!isRecord(task.settings) || !Object.keys(task.settings).length)
    throw new Error(JSON.stringify({ detail: "原始搜索参数不可用，未预填任务。" }));
  const smiles = task.settings.smiles || task.target_smiles;
  if (!smiles) throw new Error(JSON.stringify({ detail: "原始目标结构不可用，未预填任务。" }));
  return {
    path: "/",
    query: {
      smiles,
      task_name: task.settings.description ?? task.description ?? "",
      search_settings: JSON.stringify(task.settings),
    },
  };
}

export function historyCountLabel({ loaded, loading, count, matched, filtering, page = 0, loadedPage = page }) {
  if (!loaded) return loading ? "正在读取任务" : "任务尚未加载";
  if (loadedPage !== page) {
    const prefix = loading ? `正在读取第 ${page + 1} 页，` : "";
    return `${prefix}当前显示第 ${loadedPage + 1} 页，${count} 个任务`;
  }
  return `本页 ${count} 个任务${filtering ? `，匹配 ${matched} 个` : ""}`;
}
