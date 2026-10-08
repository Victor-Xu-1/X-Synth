export function metricValue(value, digits = 3) {
  return value === null || value === undefined ? "未定义" :
    new Intl.NumberFormat("zh-CN", { maximumFractionDigits: digits }).format(value);
}

export const finiteOrNull = (value) => value === null || (typeof value === "number" && Number.isFinite(value));
export const validIdentity = (value) => value && typeof value.smiles === "string" && value.smiles.length > 0 &&
  typeof value.formula === "string" && typeof value.molecular_weight_g_mol === "number" &&
  Number.isFinite(value.molecular_weight_g_mol);
const textList = (value) => Array.isArray(value) && value.every((item) => typeof item === "string");

export function acceptsAssessment(value) {
  return value?.scope === "molecular_descriptors_only" && typeof value.rdkit_version === "string" &&
    validIdentity(value.structure) && value.descriptors &&
    ["h_bond_donors", "h_bond_acceptors", "tpsa_angstrom2", "logp_crippen", "rotatable_bonds", "rings", "aromatic_rings", "fraction_csp3", "potential_stereocenters", "unassigned_stereocenters"].every((key) => typeof value.descriptors[key] === "number" && Number.isFinite(value.descriptors[key])) &&
    Array.isArray(value.components) && value.components.length > 0 && value.components.every((item) =>
      validIdentity(item.structure) && item.metrics && ["sa_score", "sps", "nsps", "bertz_ct"].every((key) => finiteOrNull(item.metrics[key])) && textList(item.notices)) &&
    textList(value.notices) && Array.isArray(value.methods);
}

export const ASSESSMENT_READING_TABS = [
  { value: "overview", title: "核心事实" },
  { value: "components", title: "组分复杂度" },
  { value: "descriptors", title: "完整描述符" },
  { value: "methods", title: "方法与来源" },
];

export const ASSESSMENT_COMPLEXITY_METRICS = [
  { key: "sa_score", label: "SA Score", note: "1 较易 / 10 较难" },
  { key: "sps", label: "SPS", note: "拓扑空间复杂度" },
  { key: "nsps", label: "nSPS", note: "按重原子数归一化" },
  { key: "bertz_ct", label: "Bertz CT", note: "连接与元素复杂度" },
];

const identityFields = [
  ["molecular_weight_g_mol", "分子量 / g·mol⁻¹"], ["exact_mass_da", "单同位素质量 / Da"],
  ["components", "组分数"], ["formal_charge", "形式电荷"], ["atoms", "结构图原子数"], ["heavy_atoms", "重原子数"],
];
const descriptorFields = [
  ["exact_mass_da", "单同位素质量 / Da", "structure"], ["heavy_atoms", "重原子数", "structure"],
  ["h_bond_donors", "氢键供体数"], ["h_bond_acceptors", "氢键受体数"],
  ["tpsa_angstrom2", "拓扑极性表面积 / Å²"], ["logp_crippen", "Crippen logP（计算值）"],
  ["rotatable_bonds", "可旋转键数（RDKit 严格定义）"], ["rings", "环数"],
  ["aromatic_rings", "芳香环数"], ["fraction_csp3", "sp³ 碳占比"],
  ["potential_stereocenters", "潜在四面体立体中心数"], ["unassigned_stereocenters", "未指定四面体立体中心数"],
];
const coreFields = new Set(["logp_crippen", "tpsa_angstrom2", "h_bond_donors", "h_bond_acceptors", "rotatable_bonds", "fraction_csp3"]);

export function assessmentIdentityRows(structure) {
  return identityFields.map(([key, label]) => ({ key, label, value: structure[key] }));
}

export function assessmentDescriptorRows(result) {
  return descriptorFields.map(([key, label, source = "descriptors"]) => ({ key, label, value: result[source][key] }));
}

export function assessmentCoreRows(result) {
  return assessmentDescriptorRows(result).filter((row) => coreFields.has(row.key));
}

export function assessmentSingleComponent(result) {
  return result.structure.components === 1 && result.components.length === 1 ? result.components[0] : null;
}

export function assessmentComplexityRows(component) {
  return ASSESSMENT_COMPLEXITY_METRICS.map((row) => ({ ...row, value: component.metrics[row.key] }));
}

export function assessmentComponentNotices(result) {
  return result.components.flatMap((component) => component.notices.map((text, index) => ({
    key: `${component.index}:${index}`, index: component.index, formula: component.structure.formula, text,
  })));
}
