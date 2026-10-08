import { freshProcessForm, restoreProcessForm } from "./process-draft";
import { processBody, newMaterial } from "./process-form";
beforeEach(() => { let id = 0; crypto.randomUUID = () => `material-${++id}`; });

test("saved batch round trips units, missing data, zero yields, salt identity and explicit molar basis", () => {
  const form = freshProcessForm();
  form.product = { smiles: "N[C@@H](C)C(=O)O.[Na+]", mass: { value: 20, unit: "mg" }, purity_mass_percent: 80, reported_yield_percent: 0 };
  form.materials[0].smiles = "N[C@@H](C)C(=O)O";
  form.materials[0].mass = { value: 100, unit: "g" };
  form.otherOutputs = [newMaterial("recovered")];
  form.otherOutputs[0].mass = { value: 0, unit: "kg" };
  form.useYieldBasis = true;
  form.yieldBasis = { limiting_material_id: form.materials[0].id, limiting_purity_mass_percent: 99, reactant_coefficient: 1, product_coefficient: 1 };
  const input = processBody(form), before = JSON.stringify(input);
  expect(processBody(restoreProcessForm(input))).toEqual(input);
  expect(JSON.stringify(input)).toBe(before);
  expect(restoreProcessForm(input).otherOutputs[0].mass.value).toBe(0);
});

test("blank/null quantities stay unknown rather than zero or one hundred percent", () => {
  const form = freshProcessForm(); form.product.smiles = "CCO";
  const restored = restoreProcessForm(processBody(form));
  expect(restored.product.mass.value).toBe("");
  expect(restored.product.purity_mass_percent).toBe("");
  expect(restored.materials[0].smiles).toBe("");
  expect(restored.useYieldBasis).toBe(false);
});

test.each([
  (input) => { input.product.mass.unit = "mL"; },
  (input) => { input.product.purity_mass_percent = 101; },
  (input) => { input.materials[0].role = "unknown"; },
  (input) => { input.materials.push({ ...input.materials[0] }); },
  (input) => { input.yield_basis = { limiting_material_id: "missing" }; },
  (input) => { input.input_boundary_complete = "yes"; },
])("malformed saved input is rejected atomically, never silently replaced", (change) => {
  const form = freshProcessForm(); form.product.smiles = "CCO";
  const input = processBody(form); change(input);
  expect(() => restoreProcessForm(input)).toThrow();
});
