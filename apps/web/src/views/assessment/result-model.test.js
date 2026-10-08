import {
  ASSESSMENT_READING_TABS, acceptsAssessment, assessmentComplexityRows, assessmentComponentNotices,
  assessmentCoreRows, assessmentDescriptorRows, assessmentIdentityRows, assessmentSingleComponent,
  finiteOrNull, metricValue, validIdentity,
} from "./result-model";
import { realCalculation } from "./test-support";

const results = {};
beforeAll(() => {
  const inputs = { chiral: "N[C@@H](C)C(=O)O", salt: "[Na+].CC(=O)[O-]", hydrogen: "[2H][2H]" };
  Object.entries(inputs).forEach(([key, smiles]) => { results[key] = realCalculation("assessment", { smiles }); });
});

test.each(["chiral", "salt", "hydrogen"])("reading projections keep all actual descriptor and identity values without mutating %s", (key) => {
  const result = results[key], original = JSON.stringify(result);
  expect(acceptsAssessment(result)).toBe(true);
  const identity = assessmentIdentityRows(result.structure);
  identity.forEach((row) => expect(row.value).toBe(result.structure[row.key]));
  expect(new Set(identity.map((row) => row.key)).size).toBe(6);
  const descriptors = assessmentDescriptorRows(result);
  expect(descriptors).toHaveLength(12);
  expect(new Set(descriptors.map((row) => row.key)).size).toBe(12);
  descriptors.forEach((row) => expect(row.value).toBe(
    ["exact_mass_da", "heavy_atoms"].includes(row.key) ? result.structure[row.key] : result.descriptors[row.key],
  ));
  const core = assessmentCoreRows(result);
  expect(core).toHaveLength(6);
  core.forEach((row) => expect(row.value).toBe(result.descriptors[row.key]));
  result.components.forEach((component) => {
    assessmentComplexityRows(component).forEach((row) => expect(row.value).toBe(component.metrics[row.key]));
  });
  expect(JSON.stringify(result)).toBe(original);
});

test("single-component summary is the actual component and never produces an aggregate for salts or inconsistent counts", () => {
  expect(assessmentSingleComponent(results.chiral)).toBe(results.chiral.components[0]);
  expect(assessmentSingleComponent(results.salt)).toBeNull();
  expect(assessmentSingleComponent({ ...results.chiral, structure: { ...results.chiral.structure, components: 2 } })).toBeNull();
  expect(assessmentSingleComponent({ ...results.salt, structure: { ...results.salt.structure, components: 1 } })).toBeNull();
});

test("atom count is labeled as a molecular-graph count without inferring formula hydrogens", () => {
  const row = assessmentIdentityRows(results.chiral.structure).find((item) => item.key === "atoms");
  expect(results.chiral.structure.formula).toBe("C3H7NO2");
  expect(row.value).toBe(6);
  expect(row.label).toBe("结构图原子数");
});

test("real sodium component zero complexity is not missing and does not acquire an SA score", () => {
  const ion = results.salt.components.find((component) => component.structure.smiles === "[Na+]");
  const values = Object.fromEntries(assessmentComplexityRows(ion).map((row) => [row.key, row.value]));
  expect(values).toEqual({ sa_score: null, sps: 0, nsps: 0, bertz_ct: 0 });
  expect(metricValue(values.sa_score)).toBe("未定义"); expect(metricValue(values.nsps)).toBe("0");
});

test("a hydrogen-only component keeps null normalization, not a fabricated zero", () => {
  const component = assessmentSingleComponent(results.hydrogen);
  const rows = assessmentComplexityRows(component);
  expect(results.hydrogen.structure.heavy_atoms).toBe(0);
  expect(rows.find((row) => row.key === "nsps").value).toBeNull();
  expect(rows.find((row) => row.key === "sa_score").value).toBeNull();
  expect(rows.find((row) => row.key === "sps").value).toBe(component.metrics.sps);
});

test("every component notice retains its original context and text without filtering warnings", () => {
  const result = results.salt, notices = assessmentComponentNotices(result);
  expect(notices).toHaveLength(result.components.reduce((count, component) => count + component.notices.length, 0));
  result.components.forEach((component) => component.notices.forEach((text) => {
    expect(notices).toContainEqual(expect.objectContaining({ text, index: component.index, formula: component.structure.formula }));
  }));
});

test("reading tab identifiers remain a unique presentation-only set", () => {
  expect(ASSESSMENT_READING_TABS.map((tab) => tab.value)).toEqual(["overview", "components", "descriptors", "methods"]);
  expect(new Set(ASSESSMENT_READING_TABS.map((tab) => tab.value)).size).toBe(4);
});

test("existing shared null/zero utilities and identity validator remain unchanged", () => {
  expect(metricValue(0)).toBe("0"); expect(metricValue(null)).toBe("未定义"); expect(metricValue(undefined)).toBe("未定义");
  expect(finiteOrNull(0)).toBe(true); expect(finiteOrNull(null)).toBe(true); expect(finiteOrNull(Infinity)).toBe(false);
  expect(validIdentity(results.chiral.structure)).toBe(true);
  expect(validIdentity({ ...results.chiral.structure, molecular_weight_g_mol: Infinity })).toBe(false);
});

test("malformed protocol descriptor values still fail the existing acceptance gate, not a scientific fallback", () => {
  const result = results.chiral;
  expect(acceptsAssessment({ ...result, descriptors: { ...result.descriptors, logp_crippen: null } })).toBe(false);
  expect(acceptsAssessment({ ...result, components: [{ ...result.components[0], metrics: { ...result.components[0].metrics, sps: Infinity } }] })).toBe(false);
  expect(acceptsAssessment({ ...result, scope: "experimental_probability" })).toBe(false);
});
