import { CalculationInputError } from "../assessment/useCalculation";
import { finiteOrNull, validIdentity } from "../assessment/result-model";

export const INPUT_ROLES = [
  { value: "reactant", label: "反应物" }, { value: "reagent", label: "试剂" },
  { value: "catalyst", label: "催化剂" }, { value: "solvent", label: "溶剂" },
  { value: "water", label: "水" }, { value: "auxiliary", label: "辅助物料" },
];
export const OUTPUT_ROLES = [
  { value: "waste", label: "实测废物" }, { value: "recovered", label: "回收物" }, { value: "coproduct", label: "副产物" },
];
export const newMaterial = (role) => ({ id: crypto.randomUUID(), name: "", smiles: "", role, mass: { value: "", unit: "g" } });

export function numericInput(value, label) {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) return null;
  if ((typeof value !== "string" && typeof value !== "number") || !Number.isFinite(Number(value)) || Number(value) < 0)
    throw new CalculationInputError(`${label}必须是有限的非负数。`);
  return Number(value);
}

export function processBody(form) {
  if (!form.product.smiles.trim()) throw new CalculationInputError("缺少产物结构。");
  const quantity = (mass) => ({ value: numericInput(mass.value, "质量"), unit: mass.unit });
  const material = (row) => ({ id: row.id, name: row.name, smiles: row.smiles.trim() || null, role: row.role, mass: quantity(row.mass) });
  let basis = null;
  if (form.useYieldBasis) {
    basis = {
      limiting_material_id: form.yieldBasis.limiting_material_id,
      limiting_purity_mass_percent: numericInput(form.yieldBasis.limiting_purity_mass_percent, "限量原料质量纯度"),
      reactant_coefficient: numericInput(form.yieldBasis.reactant_coefficient, "原料计量系数"),
      product_coefficient: numericInput(form.yieldBasis.product_coefficient, "产物计量系数"),
    };
    if (!basis.limiting_material_id || Object.values(basis).some((value) => value === null))
      throw new CalculationInputError("收率依据缺少限量原料、质量纯度或计量系数。");
  }
  return {
    materials: form.materials.map(material), other_outputs: form.otherOutputs.map(material),
    input_boundary_complete: form.inputBoundaryComplete, yield_basis: basis,
    product: {
      smiles: form.product.smiles.trim(), mass: quantity(form.product.mass),
      purity_mass_percent: numericInput(form.product.purity_mass_percent, "产物质量纯度"),
      reported_yield_percent: numericInput(form.product.reported_yield_percent, "录入收率"),
    },
  };
}

export function acceptsProcess(value) {
  const rowsValid = (rows) => Array.isArray(rows) && rows.every((row) =>
    typeof row.id === "string" && typeof row.role_label === "string" && finiteOrNull(row.mass_g) &&
    (row.structure === null || validIdentity(row.structure)));
  return value?.scope === "user_entered_batch_accounting" && typeof value.rdkit_version === "string" &&
    validIdentity(value.product?.structure) && value.metrics &&
    ["known_input_mass_g", "total_input_mass_g", "known_other_output_mass_g", "non_product_mass_difference_g", "unaccounted_mass_g", "recorded_mass_recovery_percent", "pmi", "pmi_lower_bound", "purity_corrected_pmi"].every((key) => finiteOrNull(value.metrics[key])) &&
    ["isolated_mass_g", "purity_mass_percent", "pure_mass_g", "reported_yield_percent", "theoretical_mass_g", "calculated_yield_percent"].every((key) => finiteOrNull(value.product[key])) &&
    rowsValid(value.materials) && rowsValid(value.other_outputs) &&
    Array.isArray(value.missing_inputs) && Array.isArray(value.notices);
}
