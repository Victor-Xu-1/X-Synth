import { realCalculation } from "../assessment/test-support";
import {
  PROCESS_RESULT_TABS, processBoundary, processMaterialGroups, processMetricGroups,
  processMetricValue, processPrimaryMetrics, processYieldBasis,
} from "./process-result-model";

function batch(overrides = {}) {
  return {
    materials: [{ id: "ethanol", name: "乙醇批次", smiles: "CCO", role: "reactant", mass: { value: 100, unit: "g" } }],
    product: { smiles: "CC=O", mass: { value: 20, unit: "g" }, purity_mass_percent: 80, reported_yield_percent: 0 },
    other_outputs: [{ id: "water", name: "回收水", smiles: "O", role: "recovered", mass: { value: 10, unit: "g" } }],
    input_boundary_complete: true,
    yield_basis: { limiting_material_id: "ethanol", limiting_purity_mass_percent: 95, reactant_coefficient: 1, product_coefficient: 1 },
    ...overrides,
  };
}

let complete, partial;
beforeAll(() => {
  complete = realCalculation("process", batch());
  partial = realCalculation("process", batch({ input_boundary_complete: false, yield_basis: null }));
});

test("all fifteen source metrics occur once in the appropriate overview group", () => {
  const groups = processMetricGroups(complete);
  expect(groups.map((group) => [group.id, group.rows.length])).toEqual([["product", 6], ["inputs", 5], ["outputs", 4]]);
  const rows = groups.flatMap((group) => group.rows);
  expect(new Set(rows.map((row) => row.key)).size).toBe(15);
  expect(rows.every((row) => Object.is(row.value, complete.product[row.key] ?? complete.metrics[row.key] ?? null))).toBe(true);
  expect(rows.find((row) => row.key === "reported_yield_percent")).toMatchObject({ value: 0, source: "录入值" });
  expect(rows.find((row) => row.key === "calculated_yield_percent")).toMatchObject({ source: "计算值" });
});

test("complete bulk PMI and purity-corrected PMI remain distinct", () => {
  const primary = processPrimaryMetrics(complete);
  expect(primary.find((row) => row.key === "pmi")).toMatchObject({ value: 5, label: "PMI" });
  expect(primary.find((row) => row.key === "pure_mass_g").value).toBe(16);
  expect(complete.metrics.purity_corrected_pmi).toBe(6.25);
  expect(processBoundary(complete).status).toBe("calculated");
  expect(primary.find((row) => row.key === "calculated_yield_percent").value).toBe(complete.product.calculated_yield_percent);
});

test("partial inputs are a lower bound, never a complete or purity-corrected PMI", () => {
  expect(processPrimaryMetrics(partial).find((row) => row.key === "pmi_lower_bound"))
    .toMatchObject({ value: 5, label: "PMI 下限" });
  const inputs = processMetricGroups(partial).find((group) => group.id === "inputs").rows;
  expect(inputs.find((row) => row.key === "pmi").value).toBeNull();
  expect(inputs.find((row) => row.key === "total_input_mass_g").value).toBeNull();
  expect(inputs.find((row) => row.key === "purity_corrected_pmi").value).toBeNull();
  expect(processBoundary(partial).detail).toContain("不能作为完整工艺 PMI");
});

test.each([null, undefined, NaN, Infinity, "0", false])("undefined metric %p is not coerced to zero", (value) => {
  expect(processMetricValue(value)).toBe("未定义");
});

test("actual zero and small nonzero values keep their meaning without padded precision", () => {
  expect(processMetricValue(0)).toBe("0");
  expect(processMetricValue(16)).toBe("16");
  expect(processMetricValue(6.25)).toBe("6.25");
  expect(processMetricValue(0.0001)).toBe("1E-4");
  expect(processMetricValue(-0.0001)).toBe("-1E-4");
});

test("zero bulk product and zero purity do not invent valid PMI denominators", () => {
  const zero = realCalculation("process", batch({
    product: { smiles: "CC=O", mass: { value: 0, unit: "g" }, purity_mass_percent: 0, reported_yield_percent: 0 },
  }));
  expect(processBoundary(zero)).toMatchObject({ status: "unavailable", label: "PMI 未定义" });
  expect(processBoundary(zero).detail).toContain("分母为零");
  expect(processPrimaryMetrics(zero).find((row) => row.key === "pmi").value).toBeNull();
  expect(zero.product.pure_mass_g).toBe(0);
  expect(zero.product.calculated_yield_percent).toBe(0);
  expect(zero.metrics.purity_corrected_pmi).toBeNull();
});

test("declared complete boundary with missing mass still produces only a lower bound", () => {
  const result = realCalculation("process", batch({
    materials: [...batch().materials, { id: "solvent", name: "", smiles: "O", role: "water", mass: { value: null, unit: "g" } }],
  }));
  expect(result.input_boundary_complete).toBe(true);
  expect(processBoundary(result).status).toBe("lower_bound");
  expect(processPrimaryMetrics(result).find((row) => row.key === "pmi_lower_bound").value).toBe(5);
});

test("material groups and declared yield basis retain exact source identities and do not mutate them", () => {
  const snapshot = JSON.stringify(complete);
  const groups = processMaterialGroups(complete), basis = processYieldBasis(complete);
  expect(groups[0].rows).toBe(complete.materials);
  expect(groups[1].rows).toBe(complete.other_outputs);
  expect(basis.material).toBe(complete.materials[0]);
  expect(basis.label).toBe("乙醇批次");
  expect(basis.limiting_purity_mass_percent).toBe(95);
  expect(processYieldBasis(partial)).toBeNull();
  processMetricGroups(complete); processPrimaryMetrics(complete);
  expect(JSON.stringify(complete)).toBe(snapshot);
  expect(PROCESS_RESULT_TABS.map((tab) => tab.label)).toEqual(["核算总览", "物料明细", "核算口径"]);
});
