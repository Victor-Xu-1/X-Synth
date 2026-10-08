import { isJobTerminal } from "./job-state";
import { i18n, uiText } from "@/i18n";

export const HISTORY_PAGE_SIZE = 24;

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
  return task?.description || task?.target_smiles || uiText("未命名任务");
}
export function taskSourceLabel(task) {
  const tags = (Array.isArray(task?.tags) ? task.tags : []).filter(
    (tag) => typeof tag === "string" && !/^askcos(?: v2)?$/i.test(tag),
  );
  return tags.join(" / ") || uiText("路线记录");
}

export function taskDetailLocation(task, context) {
  const path = `/results/${encodeURIComponent(task.result_id)}`;
  if (!context) return path;
  return {
    path,
    query: {
      history_query: context.query || "",
      history_status: context.status,
      history_group: context.group,
      history_page: String(context.page + 1),
      history_view: context.view,
      history_archived: String(context.archived),
    },
  };
}

export function preserveStructureControl(event) {
  if (event.target?.closest?.("button")) event.preventDefault();
}

export function taskRouteCount(task) {
  const value = task?.num_trees;
  if (
    !["number", "string"].includes(typeof value) ||
    String(value).trim() === ""
  )
    return null;
  const count = Number(value);
  return Number.isInteger(count) && count >= 0 ? count : null;
}

export function normalizeTaskInfo(task, response = {}) {
  task = task || {};
  const value = isRecord(response) ? response : {};
  const priorTime = Date.parse(task.modified),
    nextTime = Date.parse(value.modified);
  const hasRevision = (record, key) =>
    Number.isSafeInteger(record[key]) && record[key] >= 0;
  const hasJobVersions =
    hasRevision(task, "revision") && hasRevision(value, "revision");
  const stale = hasJobVersions
    ? value.revision < task.revision
    : Number.isFinite(priorTime) &&
      Number.isFinite(nextTime) &&
      nextTime < priorTime;
  const snapshot = stale ? task : value;
  // Execution and editable history metadata have independent version clocks.
  const metadata =
    hasRevision(task, "history_revision") &&
    (!hasRevision(value, "history_revision") ||
      value.history_revision < task.history_revision)
      ? task
      : value;
  const state = snapshot.result_state || snapshot.status || task.result_state;
  const modified = Object.hasOwn(snapshot, "modified")
    ? snapshot.modified
    : state === task.result_state
      ? task.modified
      : null;
  const summary =
    value.result?.unified_route_pool?.summary ||
    value.result?.stats ||
    value.summary ||
    {};
  const routes = value.result?.unified_route_pool?.selected_routes;
  return {
    ...task,
    result_id: value.result_id || value.job_id || task.result_id,
    description:
      metadata.description ?? task.description ?? value.settings?.description,
    group_id: Object.hasOwn(metadata, "group_id")
      ? metadata.group_id
      : task.group_id,
    history_revision: hasRevision(metadata, "history_revision")
      ? metadata.history_revision
      : task.history_revision,
    archived: metadata.archived ?? task.archived,
    revision: hasRevision(snapshot, "revision")
      ? snapshot.revision
      : task.revision,
    target_smiles:
      snapshot.target_smiles || value.settings?.smiles || task.target_smiles,
    result_state: state,
    created: value.created ?? value.created_at ?? task.created,
    modified,
    num_trees: stale
      ? task.num_trees
      : (snapshot.num_trees ??
        snapshot.selected_route_count ??
        summary.selected_route_count ??
        (Array.isArray(routes) ? routes.length : task.num_trees)),
    settings: isRecord(value.settings) ? value.settings : task.settings || null,
    error_code: value.error_code ?? task.error_code,
  };
}

export function taskEndedAt(task) {
  return isJobTerminal(task?.result_state) && task?.modified
    ? task.modified
    : null;
}

export function taskTimestampLabel(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return uiText("未记录");
  return new Intl.DateTimeFormat(i18n.global.locale.value, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function parameterValue(key, value) {
  if (key === "backend" && value === "askcos") return "ASKCOS V2";
  if (key === "public" && typeof value === "boolean")
    return uiText(value ? "是" : "否");
  if (
    key === "strategies" &&
    Array.isArray(value) &&
    value.every((item) => typeof item === "string")
  ) {
    const labels = { mcts: "MCTS", retro_star: "RetroStar" };
    return value.map((item) => labels[item] || item).join(" / ");
  }
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

export function taskParameterGroups(settings) {
  if (!isRecord(settings)) return [];
  const field = (key, value, prefix = "") => ({
    key: `${prefix}${key}`,
    label: uiText(parameterLabels[key] || key),
    value: parameterValue(key, value),
  });
  const primary = Object.entries(settings)
    .filter(
      ([key]) =>
        !["smiles", "description"].includes(key) &&
        (key !== "tuning" || !isRecord(settings.tuning)),
    )
    .map(([key, value]) => field(key, value));
  const tuning = isRecord(settings.tuning)
    ? Object.entries(settings.tuning).map(([key, value]) =>
        field(key, value, "tuning."),
      )
    : [];
  return [
    { title: "搜索参数", fields: primary },
    { title: "搜索调优", fields: tuning },
  ].filter((group) => group.fields.length);
}

export function buildTaskSearchLocation(task) {
  if (!isRecord(task.settings) || !Object.keys(task.settings).length)
    throw new Error(
      JSON.stringify({ detail: "原始搜索参数不可用，未预填任务。" }),
    );
  const smiles = task.settings.smiles || task.target_smiles;
  if (!smiles)
    throw new Error(
      JSON.stringify({ detail: "原始目标结构不可用，未预填任务。" }),
    );
  return {
    path: "/",
    query: {
      smiles,
      task_name: task.settings.description ?? task.description ?? "",
      search_settings: JSON.stringify(task.settings),
    },
  };
}

export function historyCountLabel({
  loaded,
  loading,
  total,
  page = 0,
  pageCount = 1,
}) {
  if (!loaded) return loading ? "正在读取任务" : "任务尚未加载";
  return `共 ${total} 个任务，第 ${page + 1} / ${pageCount} 页`;
}

export function readHistoryRouteQuery(params = {}) {
  const fail = (detail) => {
    throw new Error(JSON.stringify({ detail }));
  };
  const scalar = (key, fallback) => {
    const value = params[key];
    if (value === undefined) return fallback;
    if (typeof value !== "string") fail("任务历史查询参数无效。");
    return value;
  };
  const number = scalar("page", "1");
  if (
    !/^[1-9]\d*$/.test(number) ||
    !Number.isSafeInteger(Number(number)) ||
    !Number.isSafeInteger((Number(number) - 1) * HISTORY_PAGE_SIZE)
  )
    fail("任务历史页码无效。");
  const query = scalar("query", ""),
    status = scalar("status", "all"),
    group = scalar("group", "all");
  const view = scalar("view", "cards"),
    archive = scalar("archived", "false");
  if (
    query.length > 20000 ||
    !historyStatusOptions.some((item) => item.value === status) ||
    !group ||
    group.length > 128 ||
    !["cards", "list"].includes(view) ||
    !["true", "false"].includes(archive)
  )
    fail("任务历史筛选参数无效。");
  return {
    page: Number(number) - 1,
    query,
    status,
    group,
    view,
    archived: archive === "true",
  };
}

export function historyRouteQuery(state, existing = {}) {
  const query = { ...existing };
  for (const key of ["page", "query", "status", "group", "view", "archived"])
    delete query[key];
  if (state.page > 0) query.page = String(state.page + 1);
  if (state.query) query.query = state.query;
  if (state.status !== "all") query.status = state.status;
  if (state.group !== "all") query.group = state.group;
  if (state.view !== "cards") query.view = state.view;
  if (state.archived) query.archived = "true";
  return query;
}

export function readHistoryGroups(groups) {
  const count = (number) => Number.isSafeInteger(number) && number >= 0;
  const validGroup = (group) =>
    isRecord(group) &&
    typeof group.id === "string" &&
    group.id.length > 0 &&
    typeof group.name === "string" &&
    group.name.trim().length > 0 &&
    count(group.revision) &&
    count(group.count);
  if (
    !Array.isArray(groups) ||
    !groups.every(validGroup) ||
    new Set(groups.map((group) => group.id)).size !== groups.length
  )
    throw new Error(JSON.stringify({ detail: "任务分组响应格式无效。" }));
  return groups;
}

export function readHistoryPage(value) {
  const count = (number) => Number.isSafeInteger(number) && number >= 0;
  const validTask = (task) =>
    isRecord(task) &&
    typeof task.result_id === "string" &&
    task.result_id.length > 0 &&
    count(task.revision) &&
    count(task.history_revision) &&
    typeof task.result_state === "string" &&
    (task.group_id === null || typeof task.group_id === "string") &&
    (task.archived === undefined || typeof task.archived === "boolean");
  if (
    !isRecord(value) ||
    !Array.isArray(value.results) ||
    value.results.length > HISTORY_PAGE_SIZE ||
    !value.results.every(validTask) ||
    new Set(value.results.map((task) => task.result_id)).size !==
      value.results.length ||
    !count(value.total) ||
    value.total < value.results.length ||
    !count(value.all_total) ||
    !count(value.ungrouped_total)
  ) {
    throw new Error(JSON.stringify({ detail: "任务历史响应格式无效。" }));
  }
  readHistoryGroups(value.groups);
  return value;
}
