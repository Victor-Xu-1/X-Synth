import { numericInput, processBody } from "./process-form";
import { metricValue } from "../assessment/result-model";

test("empty values stay missing and explicit zero survives", () => {
  expect(numericInput("", "质量")).toBeNull();
  expect(numericInput("  ", "质量")).toBeNull();
  expect(numericInput("0", "质量")).toBe(0);
  expect(numericInput("1e-3", "质量")).toBe(0.001);
  expect(metricValue(0)).toBe("0");
  expect(metricValue(null)).toBe("未定义");
});
test.each(["NaN", "Infinity", -1, true, {}, []])("invalid numeric %p is not silently made zero", (value) => {
  expect(() => numericInput(value, "质量")).toThrow("有限的非负数");
});
test("reported zero yield does not become inferred product mass", () => {
  const body = processBody({
    materials: [{ id: "r", name: "", smiles: "[Na+].CC(=O)[O-]", role: "reactant", mass: { value: "0", unit: "kg" } }],
    otherOutputs: [], inputBoundaryComplete: false, useYieldBasis: false,
    product: { smiles: "N[C@@H](C)C(=O)O", mass: { value: "", unit: "g" }, purity_mass_percent: "", reported_yield_percent: "0" },
  });
  expect(body.product.mass.value).toBeNull();
  expect(body.product.reported_yield_percent).toBe(0);
  expect(body.materials[0].smiles).toBe("[Na+].CC(=O)[O-]");
  expect(body.product.smiles).toContain("@@");
});
