import { analysisKinds, analysisQuery, analysisResultError, listQuery, readAnalysisList,
  readAnalysisRecord, recordDate, recordPath, analysisIngredient } from "./analysis-records";
import { rankedForwardFixture, incompleteForwardFixture } from "./forward-result.test-support";

const row = { id: "record-a", kind: "optimization", status: "completed", created: "2026-10-04T00:00:00Z", structure: "" };
test.each([undefined, null, "", "invalid", 0])("missing date %s never becomes an epoch date", (value) => {
  expect(recordDate(value)).toBe("未提供");
});
test("date and encoded record paths retain actual identity", () => {
  expect(recordDate(row.created)).not.toBe("未提供");
  expect(recordPath("record/part")).toBe("/analyses/record%2Fpart");
  expect(recordPath(undefined)).toBe("");
});
test("known kinds preserve the parent impurity entry", () => expect(analysisKinds.impurity.to).toBe("/impurity"));
test("filters/page are URL-stable and map to bounded API offsets", () => {
  expect(analysisQuery({ kind: "forward", page: "2" })).toEqual({ kind: "forward", page: 2 });
  expect(listQuery("", 1)).toEqual({ kind: undefined, page: undefined });
});
test.each([{ kind: "unknown" }, { kind: [] }, { page: "0" }, { page: "NaN" }, { page: "1.5" },
  { page: "Infinity" }, { page: "9007199254740991" }, { page: [] }])("invalid query %s is rejected", (query) => {
  expect(() => analysisQuery(query)).toThrow();
});
test.each([{ total: -1, items: [] }, { total: 1, items: null }, { total: 0, items: [row] },
  { total: 2, items: [row, row] }, { total: 1, items: [{ ...row, structure: {} }] },
  { total: 1, items: [{ ...row, status: "success" }] }])("malformed list %s never becomes empty success", (response) => {
  expect(() => readAnalysisList(response)).toThrow("格式无效");
});
test("summary and detail binding preserve data without mutation", () => {
  const record = { ...row, inputs: { name: "protocol record" }, result: {} };
  expect(readAnalysisList({ total: 1, items: [row] }).items[0]).toBe(row);
  expect(readAnalysisRecord(record, row.id)).toBe(record);
  expect(() => readAnalysisRecord(record, "other")).toThrow();
  expect(() => readAnalysisRecord({ ...record, status: "running" }, row.id)).toThrow();
  expect(() => readAnalysisRecord({ ...record, result: null }, row.id)).toThrow();
});
test("empty arrays are legitimate outputs, but absent arrays are schema failures", () => {
  expect(analysisResultError("forward", { reactants: "", products: [] })).toBe("");
  expect(analysisResultError("conditions", { reactants: "", product: "", conditions: [] })).toBe("");
  expect(analysisResultError("forward", {})).toContain("格式无效");
  expect(analysisResultError("optimization", { recommendations: [] })).toContain("格式无效");
});

test("saved modern forward results use the same complete-provenance contract as live predictions", () => {
  const result = rankedForwardFixture(), before = JSON.stringify(result);
  expect(analysisResultError("forward", result)).toBe("");
  expect(JSON.stringify(result)).toBe(before);
  result.provenance.decisions.at(-1).joint_rank = 1;
  expect(analysisResultError("forward", result)).toContain("格式无效");
});

test("saved legacy results reject invented model ranks instead of repairing scientific records", () => {
  const result = { reactants: "CCO", products: [{ product: "CO", log_probability: -1, feasibility_score: 0.9 }] };
  expect(analysisResultError("forward", result)).toBe("");
  result.products[0].native_rank = 1;
  expect(analysisResultError("forward", result)).toContain("格式无效");
});

test("EOS history accepts recorded incomplete decoding but rejects coercion or a forged native disposition", () => {
  const result = incompleteForwardFixture(), before = JSON.stringify(result);
  expect(analysisResultError("forward", result)).toBe("");
  expect(JSON.stringify(result)).toBe(before);
  result.provenance.decoder.hypotheses[3].disposition = "returned";
  expect(analysisResultError("forward", result)).toContain("格式无效");
  const coerced = rankedForwardFixture();
  coerced.provenance.decoder.hypotheses[0].decoded_token_count = "16";
  expect(analysisResultError("forward", coerced)).toContain("格式无效");
});
test.each(["CCO", "Reaxys 12345", "DIPEA", "not a structure"])("legacy ingredient %s stays a label, never a guessed structure", (label) => {
  expect(analysisIngredient({ reagent: label }, "reagent")).toEqual({ label, smiles: null, status: "label_only" });
  expect(analysisIngredient({ reagent: label, ingredients: null }, "reagent").smiles).toBeNull();
});
test("only explicit typed identities may provide a structure", () => {
  const identity = { label: "OCC", smiles: "CCO", status: "structure" };
  expect(analysisIngredient({ reagent: "OCC", ingredients: { reagent: identity } }, "reagent")).toBe(identity);
  expect(analysisIngredient({ reagent: "" }, "reagent")).toEqual({ label: "", smiles: null, status: "not_predicted" });
});
test.each(["assessment", "process", "impurity"])("%s uses the caller's existing result contract and converts contract failures into an error", (kind) => {
  const result = {}, accepts = jest.fn().mockReturnValueOnce(true).mockReturnValueOnce(false)
    .mockImplementationOnce(() => { throw new Error("broken nested object"); });
  expect(analysisResultError(kind, result, accepts)).toBe("");
  expect(accepts).toHaveBeenCalledWith(result);
  expect(analysisResultError(kind, result, accepts)).toContain("格式无效");
  expect(analysisResultError(kind, result, accepts)).toContain("格式无效");
  expect(analysisResultError(kind, result)).toContain("格式无效");
});
