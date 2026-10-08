export const PROCESS_RESULT_TABS = [
  { id: "overview", label: "核算总览", icon: "mdi-scale-balance" },
  { id: "materials", label: "物料明细", icon: "mdi-flask-outline" },
  { id: "basis", label: "核算口径", icon: "mdi-information-outline" },
];

const METRIC_GROUPS = [
  { id: "product", title: "产物与收率", fields: [
    ["isolated_mass_g", "分离产物总质量 / g"],
    ["purity_mass_percent", "产物质量纯度 / %", "录入值"],
    ["pure_mass_g", "纯产物质量 / g"],
    ["reported_yield_percent", "录入实验收率 / %", "录入值"],
    ["theoretical_mass_g", "指定计量依据的理论产物 / g", "计算值"],
    ["calculated_yield_percent", "质量纯度校正摩尔收率 / %", "计算值"],
  ] },
  { id: "inputs", title: "投料与 PMI", fields: [
    ["known_input_mass_g", "已录入投料质量 / g"],
    ["total_input_mass_g", "完整边界总投料 / g"],
    ["pmi", "PMI（投料 / 分离总质量）"],
    ["pmi_lower_bound", "PMI 下限（不完整投料）"],
    ["purity_corrected_pmi", "纯度校正 PMI（投料 / 纯产物）"],
  ] },
  { id: "outputs", title: "出料与质量差额", fields: [
    ["known_other_output_mass_g", "已记录其他出料 / g"],
    ["non_product_mass_difference_g", "投料减分离产物差额 / g（非实测废物）"],
    ["unaccounted_mass_g", "未记录去向的质量 / g"],
    ["recorded_mass_recovery_percent", "已记录出料 / 总投料 / %"],
  ] },
];

export function processMetricValue(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "未定义";
  // Keep small nonzero masses distinct from actual zero without padding precision.
  const notation = value !== 0 && Math.abs(value) < 0.001 ? "scientific" : "standard";
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 3, notation }).format(value);
}

export function processMetricGroups(result) {
  return METRIC_GROUPS.map(({ id, title, fields }) => ({
    id, title,
    rows: fields.map(([key, label, source]) => ({
      key, label, source, value: (id === "product" ? result.product : result.metrics)[key],
    })),
  }));
}

export function processPrimaryMetrics(result) {
  const { product, metrics } = result;
  const pmi = metrics.pmi_status === "calculated"
    ? { key: "pmi", label: "PMI", value: metrics.pmi }
    : metrics.pmi_status === "lower_bound"
      ? { key: "pmi_lower_bound", label: "PMI 下限", value: metrics.pmi_lower_bound }
      : { key: "pmi", label: "PMI", value: null };
  return [
    { key: "isolated_mass_g", label: "分离总质量 / g", value: product.isolated_mass_g, note: "未作纯度校正" },
    { key: "pure_mass_g", label: "纯产物质量 / g", value: product.pure_mass_g, note: "按质量纯度校正" },
    { ...pmi, note: "投料 / 分离总质量" },
    { key: "calculated_yield_percent", label: "计算摩尔收率 / %", value: product.calculated_yield_percent, note: "质量纯度校正 · 非录入收率" },
  ];
}

export function processBoundary(result) {
  const status = result.metrics.pmi_status;
  if (status === "calculated") return {
    status, label: "完整边界 PMI",
    detail: "完整边界 PMI 使用分离产物总质量；纯度校正 PMI 单列。",
  };
  if (status === "lower_bound") return {
    status, label: "PMI 仅为下限",
    detail: "投料不完整：仅报告已录入范围的 PMI 下限，不能作为完整工艺 PMI。",
  };
  return {
    status: "unavailable", label: "PMI 未定义",
    detail: result.product.isolated_mass_g === 0
      ? "分离产物质量为零：PMI 分母为零，当前未定义。"
      : "缺少分离产物总质量：PMI 当前未定义。",
  };
}

export function processMaterialGroups(result) {
  return [
    { id: "inputs", title: "投料", rows: result.materials },
    { id: "outputs", title: "其他出料", rows: result.other_outputs },
  ];
}

export function processYieldBasis(result) {
  if (!result.yield_basis) return null;
  const material = result.materials.find((row) => row.id === result.yield_basis.limiting_material_id);
  return {
    ...result.yield_basis, material,
    label: material?.name || material?.structure?.formula || "未提供化学身份",
  };
}
