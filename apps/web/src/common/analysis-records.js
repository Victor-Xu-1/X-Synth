export const analysisKinds = Object.freeze({
  conditions: { title: "反应条件", to: "/forward?tab=context" },
  forward: { title: "产物预测", to: "/forward?tab=forward" },
  impurity: { title: "杂质分析", to: "/impurity" },
  assessment: { title: "结构评估", to: "/assessment" },
  process: { title: "工艺核算", to: "/process" },
  optimization: { title: "实验优化", to: "/optimization" },
});

export const analysisStatuses = Object.freeze({
  running: "计算中", completed: "已完成", failed: "未完成", interrupted: "已中断",
});

export function recordDate(value) {
  if (typeof value !== "string" || !value.trim()) return "未提供";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "未提供" : date.toLocaleString("zh-CN", { hour12: false });
}

export const analysisPageSize = 25;
export const isRecordObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
export function recordPath(id) {
  return typeof id === "string" && id.trim() && id.length <= 256 ? `/analyses/${encodeURIComponent(id)}` : "";
}
export function analysisQuery(query = {}) {
  const kind = query.kind ?? "", page = query.page ?? "1";
  if (typeof kind !== "string" || (kind && !Object.hasOwn(analysisKinds, kind)))
    throw new Error("研究类型参数无效。");
  if (typeof page !== "string" || !/^\d+$/.test(page) || Number(page) < 1 ||
      !Number.isSafeInteger(Number(page) * analysisPageSize)) throw new Error("研究记录页码无效。");
  return { kind, page: Number(page) };
}
export function listQuery(kind, page) {
  return { kind: kind || undefined, page: page > 1 ? String(page) : undefined };
}
function validRecord(record) {
  return isRecordObject(record) && !!recordPath(record.id) &&
    typeof record.kind === "string" && typeof record.status === "string" &&
    Object.hasOwn(analysisKinds, record.kind) && Object.hasOwn(analysisStatuses, record.status) &&
    typeof record.created === "string";
}
export function readAnalysisList(response) {
  if (!isRecordObject(response) || !Number.isSafeInteger(response.total) || response.total < 0 ||
      !Array.isArray(response.items) || response.items.length > analysisPageSize || response.total < response.items.length ||
      response.items.some((row) => !validRecord(row) || typeof row.structure !== "string") ||
      new Set(response.items.map((row) => row.id)).size !== response.items.length)
    throw new Error("研究记录列表格式无效。");
  return response;
}
export function readAnalysisRecord(response, id) {
  if (!validRecord(response) || response.id !== id || !isRecordObject(response.inputs) ||
      (response.result !== null && !isRecordObject(response.result)) ||
      (response.status === "completed" && !isRecordObject(response.result)) ||
      (response.status !== "completed" && response.result !== null))
    throw new Error("研究记录内容格式无效或与当前记录不符。");
  return response;
}
export function analysisIngredient(row, role) {
  if (row.ingredients !== undefined && row.ingredients !== null) return row.ingredients[role];
  return { label: row[role], smiles: null, status: row[role] ? "label_only" : "not_predicted" };
}

export function analysisResultError(kind, result, accepts) {
  const invalid = "研究记录的结果格式无效，无法展示。";
  if (!isRecordObject(result)) return invalid;
  if (kind === "conditions") {
    if (typeof result.reactants !== "string" || typeof result.product !== "string" || !Array.isArray(result.conditions)) return invalid;
    if (result.conditions.some((row) => !isRecordObject(row) || !Number.isFinite(row.temperature) || !Number.isFinite(row.score) ||
      ["solvent", "reagent", "catalyst"].some((role) => {
        if (typeof row[role] !== "string") return true;
        const identity = analysisIngredient(row, role);
        if (!isRecordObject(identity) || identity.label !== row[role]) return true;
        if (identity.status === "structure") return typeof identity.smiles !== "string" || !identity.smiles.trim();
        if (identity.status === "label_only") return !identity.label || identity.smiles !== null;
        return identity.status !== "not_predicted" || identity.label !== "" || identity.smiles !== null;
      }))) return invalid;
  } else if (kind === "forward") {
    if (typeof result.reactants !== "string" || !Array.isArray(result.products) || result.products.some((row) =>
      !isRecordObject(row) || typeof row.product !== "string" || !Number.isFinite(row.log_probability) || !Number.isFinite(row.feasibility_score))) return invalid;
  } else if (kind === "optimization") {
    if (!Array.isArray(result.recommendations) || !isRecordObject(result.target) || !isRecordObject(result.versions) ||
      !Array.isArray(result.selected_rows) || result.recommendations.some((row) => !isRecordObject(row) || !isRecordObject(row.conditions))) return invalid;
  } else if (["assessment", "process", "impurity"].includes(kind)) {
    try {
      if (typeof accepts !== "function" || !accepts(result)) return invalid;
    } catch {
      return invalid;
    }
  } else {
    return invalid;
  }
  return "";
}

