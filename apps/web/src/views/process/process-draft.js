import { INPUT_ROLES, OUTPUT_ROLES, newMaterial, processBody } from "./process-form";
import { CalculationInputError as InputError } from "../assessment/useCalculation";

const units = new Set(["mg", "g", "kg"]);
export function freshProcessForm() {
  return {
    product: { smiles: "", mass: { value: "", unit: "g" }, purity_mass_percent: "", reported_yield_percent: "" },
    materials: [newMaterial("reactant")], otherOutputs: [], inputBoundaryComplete: false,
    useYieldBasis: false,
    yieldBasis: { limiting_material_id: "", limiting_purity_mass_percent: "", reactant_coefficient: "", product_coefficient: "" },
  };
}
function numeric(value, maximum = Infinity) {
  if (value === null) return "";
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > maximum)
    throw new InputError("已存批次含无效的数值依据。");
  return value;
}
function quantity(value) {
  if (!value || !units.has(value.unit)) throw new InputError("已存批次含无效的质量单位。");
  return { value: numeric(value.value), unit: value.unit };
}
function structure(value, required = false) {
  if (value === null && !required) return "";
  if (typeof value !== "string" || (required && !value.trim())) throw new InputError("已存批次结构无效。");
  return value;
}
function materials(rows, roles, required) {
  if (!Array.isArray(rows) || rows.length > 50 || (required && !rows.length))
    throw new InputError("已存批次的物料清单无效。");
  return rows.map((row) => {
    if (typeof row.id !== "string" || !row.id || typeof row.name !== "string"
      || !roles.some((role) => role.value === row.role)) throw new InputError("已存批次的物料身份无效。");
    return { id: row.id, name: row.name, smiles: structure(row.smiles), role: row.role, mass: quantity(row.mass) };
  });
}
export function restoreProcessForm(input) {
  if (!input?.product || typeof input.input_boundary_complete !== "boolean")
    throw new InputError("已存批次缺少完整输入。");
  const form = freshProcessForm();
  form.product = {
    smiles: structure(input.product.smiles, true), mass: quantity(input.product.mass),
    purity_mass_percent: numeric(input.product.purity_mass_percent, 100),
    reported_yield_percent: numeric(input.product.reported_yield_percent, 100),
  };
  form.materials = materials(input.materials, INPUT_ROLES, true);
  form.otherOutputs = materials(input.other_outputs, OUTPUT_ROLES, false);
  const ids = [...form.materials, ...form.otherOutputs].map((row) => row.id);
  if (new Set(ids).size !== ids.length) throw new InputError("已存批次物料身份重复。");
  form.inputBoundaryComplete = input.input_boundary_complete;
  if (input.yield_basis !== null) {
    const basis = input.yield_basis;
    if (!basis || !form.materials.some((row) => row.id === basis.limiting_material_id && row.role === "reactant"))
      throw new InputError("已存批次的限量原料无效。");
    form.useYieldBasis = true;
    form.yieldBasis = {
      limiting_material_id: basis.limiting_material_id,
      limiting_purity_mass_percent: numeric(basis.limiting_purity_mass_percent, 100),
      reactant_coefficient: numeric(basis.reactant_coefficient), product_coefficient: numeric(basis.product_coefficient),
    };
  }
  processBody(form);
  return form;
}
