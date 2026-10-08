import { CalculationInputError } from "../assessment/useCalculation";

export const IMPURITY_RANKING_STRATEGY = "best_origin_log_probability_plus_log_fast_filter_then_similarity";

export const GROUPS = [
  { key: "reactants", label: "原子贡献反应物", item: "反应物", minimum: 1, maximum: 4 },
  { key: "knownProduct", label: "已知主产物基准", item: "主产物", minimum: 1, maximum: 1 },
  { key: "reagents", label: "试剂", item: "试剂", minimum: 0, maximum: 2 },
  { key: "solvents", label: "溶剂", item: "溶剂", minimum: 0, maximum: 2 },
];
export const newStructure = (smiles = "") => ({ id: crypto.randomUUID(), smiles });
export const createForm = () => ({ reactants: [newStructure()], knownProduct: [newStructure()], reagents: [], solvents: [], count: 5 });

export function restoreImpurityForm(input) {
  if (!Number.isInteger(input?.count) || input.count < 1 || input.count > 10)
    throw new CalculationInputError("历史杂质分析的候选数量无效。");
  const fields = { reactants: "reactants", knownProduct: "known_product", reagents: "reagents", solvents: "solvents" };
  const restored = { count: input?.count };
  for (const group of GROUPS) {
    const values = group.key === "knownProduct" ? [input?.known_product] : input?.[fields[group.key]];
    if (!Array.isArray(values) || values.length < group.minimum || values.length > group.maximum
      || values.some((value) => typeof value !== "string" || !value.trim()))
      throw new CalculationInputError("历史杂质分析缺少完整物料结构。");
    restored[group.key] = values.map(newStructure);
  }
  impurityBody(restored);
  return restored;
}

export function impurityBody(form) {
  const values = (key) => form[key].map((row) => {
    if (!row.smiles.trim()) throw new CalculationInputError("请应用全部已添加物料的结构，或移除不参与本次分析的空记录。");
    return row.smiles.trim();
  });
  const count = Number(form.count);
  if (!Number.isInteger(count) || count < 1 || count > 10) throw new CalculationInputError("候选数必须为 1 至 10 的整数。");
  return { reactants: values("reactants"), known_product: values("knownProduct")[0], reagents: values("reagents"), solvents: values("solvents"), count };
}

export function acceptsImpurities(value) {
  const probability = (number) => typeof number === "number" && Number.isFinite(number) && number >= 0 && number <= 1;
  return value?.scope === "possible_impurity_model_predictions" &&
    value.known_major_product?.evidence_type === "user_supplied_reference" &&
    typeof value.known_major_product.smiles === "string" && value.inputs?.known_product === value.known_major_product.smiles &&
    Array.isArray(value.candidates) && value.candidates.length <= 10 && value.candidates.every((row) =>
      typeof row.product === "string" && row.product !== value.known_major_product.smiles &&
      probability(row.similarity_to_known_product) && probability(row.mapping?.confidence) &&
      row.mapping.mode_consistent === true && typeof row.mapping.mapped_reaction === "string" &&
      Array.isArray(row.origins) && row.origins.length > 0 && row.origins.every((origin) =>
        Number.isFinite(origin.log_probability) && origin.log_probability <= 0 && probability(origin.feasibility_score) &&
        probability(origin.mapping_confidence) && origin.mapping?.mode_consistent === true &&
        typeof origin.mapping.mapped_reaction === "string" && [1, 2, 3, 4, 5].includes(origin.mode))) &&
    value.provenance?.mapper_model === "rxnmapper_albert_uspto_all_1310k" && value.provenance.mapper_package_version === "0.4.3" &&
    value.provenance.ranking_strategy === IMPURITY_RANKING_STRATEGY &&
    JSON.stringify(value.execution?.modes_completed) === "[1,2,3,4,5]" && Array.isArray(value.notices);
}
