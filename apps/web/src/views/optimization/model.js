export const LIMITS = Object.freeze({
  bytes: 2 * 1024 * 1024,
  measurements: 256,
  candidates: 4096,
  factors: 8,
  levels: 32,
  batch: 8,
});

export function factorValues(factor) {
  const values = factor.levels
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
  if (values.length < 2 || values.length > LIMITS.levels)
    throw new Error(`${factor.name} 需要 2-32 个互异离散水平。`);
  if (factor.kind === "numerical") {
    const numeric = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
    if (
      values.some(
        (value) =>
          !numeric.test(value) ||
          !Number.isFinite(Number(value)) ||
          Math.abs(Number(value)) > 1e12,
      )
    )
      throw new Error(`${factor.name} 的数值水平无效。`);
  }
  const converted = factor.kind === "numerical" ? values.map(Number) : values;
  if (new Set(converted).size !== converted.length)
    throw new Error(`${factor.name} 的水平重复。`);
  return converted;
}

export function candidateCount(factors) {
  if (!factors.length) return 0;
  try {
    return factors.reduce(
      (count, factor) => count * factorValues(factor).length,
      1,
    );
  } catch {
    return 0;
  }
}

export function buildRequest({
  content,
  table,
  selectedRows,
  factors,
  target,
  batchSize,
  confirmedMeasurements,
  confirmedCandidates,
}) {
  if (!table || !content) throw new Error("请选择当前实测 CSV。");
  if (selectedRows.length < 3 || selectedRows.length > LIMITS.measurements)
    throw new Error("请选择 3-256 条真实实测记录。");
  if (!confirmedMeasurements || !confirmedCandidates)
    throw new Error("请确认当前实测记录与候选组合。");
  if (!factors.length || factors.length > LIMITS.factors)
    throw new Error("请选择 1-8 个实验因子。");
  if (!target.name || factors.some((factor) => factor.name === target.name))
    throw new Error("请选择独立的数值响应列。");
  const number = Number(batchSize);
  if (!Number.isInteger(number) || number < 1 || number > LIMITS.batch)
    throw new Error("下一批实验数必须为 1-8 的整数。");
  const count = candidateCount(factors);
  if (count > LIMITS.candidates)
    throw new Error("候选组合超过 4096，请缩小离散水平。");
  return {
    content,
    table_sha256: table.table_sha256,
    selected_rows: [...selectedRows].sort((a, b) => a - b),
    factors: factors.map((factor) => ({
      name: factor.name,
      kind: factor.kind,
      values: factorValues(factor),
    })),
    target: {
      ...target,
      unit: target.kind === "yield_percent" ? "%" : target.unit,
      direction:
        target.kind === "yield_percent" ? "maximize" : target.direction,
    },
    batch_size: number,
    seed: 42,
    confirmed_measurements: true,
    confirmed_candidates: true,
  };
}

export function validateResult(result, request) {
  if (
    !result ||
    result.engine !== "BayBE" ||
    result.versions?.baybe !== "0.15.0" ||
    result.empirically_confirmed !== false ||
    result.table_sha256 !== request.table_sha256 ||
    result.measurement_count !== request.selected_rows.length ||
    result.recommendations?.length !== request.batch_size ||
    typeof result.csv_content !== "string" ||
    result.target?.name !== request.target.name ||
    result.target?.direction !== request.target.direction ||
    JSON.stringify(result.selected_rows) !==
      JSON.stringify(request.selected_rows)
  )
    throw new Error("优化结果与当前实测输入不一致，未显示该响应。");
  for (const row of result.recommendations) {
    if (
      !Number.isFinite(row.posterior_mean) ||
      !Number.isFinite(row.posterior_std) ||
      row.posterior_std < 0 ||
      Object.keys(row.conditions || {}).length !== request.factors.length ||
      request.factors.some(
        (factor) => !factor.values.includes(row.conditions?.[factor.name]),
      )
    )
      throw new Error("优化结果含无效预测或空间外条件，未显示该响应。");
  }
  return result;
}

export function formatResponse(value) {
  return Number.isFinite(value)
    ? value.toLocaleString("zh-CN", { maximumFractionDigits: 3 })
    : "未提供";
}

export function analysisRecordUrl(recordId) {
  return typeof recordId === "string" && /^[a-f0-9]{32}$/.test(recordId)
    ? `/analyses/${encodeURIComponent(recordId)}`
    : null;
}
