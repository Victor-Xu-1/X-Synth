import { createSubmissionAttempts } from "./submission-attempt";
import { annotateSolubilityOutput, createScreenSubmission, createSolubilitySubmission, runSolubilitySubmission } from "./submission";
import { parseSubmissionFile, readSubmissionFile } from "./submission-file";

test("replacing an attempt aborts the previous transport; old retirement cannot cancel the replacement", () => {
  const lifetime = new AbortController(), attempts = createSubmissionAttempts(lifetime.signal);
  const first = attempts.begin(), second = attempts.begin();
  expect(first.signal.aborted).toBe(true);
  expect(second.id).toBeGreaterThan(first.id);
  expect(attempts.isCurrent(first)).toBe(false);
  attempts.retire(first);
  expect(attempts.isCurrent(second)).toBe(true);
  expect(second.signal.aborted).toBe(false);
  attempts.invalidate();
  expect(second.signal.aborted).toBe(true);
  expect(attempts.isCurrent(second)).toBe(false);
  const third = attempts.begin();
  lifetime.abort();
  expect(third.signal.aborted).toBe(true);
  expect(attempts.isCurrent(third)).toBe(false);
  expect(attempts.begin()).toBeNull();
  expect(() => attempts.retire(undefined)).not.toThrow();
});

test("legacy snapshots retain complete source identity, optional roles and zero values without mutating inputs", () => {
  const input = { solute: "[13CH3][C@H]([NH3+])CO.[Cl-]", solvent: "[Na+].CC(=O)[O-]", temperature: 323,
    ref_solvent: "O", ref_solubility: 0, ref_temp: 298, hsub298: 0, cp_gas_298: 0, cp_solid_298: 0 };
  const original = JSON.stringify(input);
  const submission = createSolubilitySubmission("legacy", [input], "source.csv");
  expect(JSON.stringify(input)).toBe(original);
  expect(submission).toMatchObject({ model: "legacy", modelLabel: "SolProp", sourceName: "source.csv" });
  expect(submission.body.task_list[0]).toMatchObject({ solute: input.solute, solvent: input.solvent, temp: 323,
    ref_solvent: "O", ref_solubility: 0, hsub298: 0, cp_gas_298: 0, cp_solid_298: 0 });
  input.solute = "CCN";
  expect(submission.body.task_list[0].solute).not.toBe(input.solute);
  expect(Object.isFrozen(submission.body.task_list[0])).toBe(true);
  expect(() => { submission.body.task_list[0].solute = "CCO"; }).toThrow(TypeError);
});

test("screen captures every temperature/solvent and all reference/solute roles before any child dispatch", () => {
  const values = { solute: "F[C@H](Cl)Br", refSolvent: "O", refSolubility: 0, refTemperature: 298,
    soluteHsub: 20, soluteCpg: 10, soluteCps: 5 };
  const solvents = ["[Na+].CC(=O)[O-]", "[13CH4]"], temperatures = [298, 323];
  const submission = createScreenSubmission(values, solvents, temperatures);
  values.solute = "CCN"; values.refSolvent = "CO";
  solvents[0] = "O"; temperatures[0] = 350;
  expect(submission.solute).toBe("F[C@H](Cl)Br");
  expect(submission.temperatures).toEqual([298, 323]);
  expect(submission.solvents).toEqual(["[Na+].CC(=O)[O-]", "[13CH4]"]);
  expect(submission.requests[1].body.task_list[1]).toEqual({ solute: "F[C@H](Cl)Br", solvent: "[13CH4]", temp: 323,
    ref_solvent: "O", ref_solubility: 0, ref_temp: 298, hsub298: 20, cp_gas_298: 10, cp_solid_298: 5 });
  expect(Object.isFrozen(submission.requests[0].body)).toBe(true);
});

test.each(["unknown", "toString", "__proto__", null])("unknown model %s is rejected without endpoint/provenance guessing", (model) => {
  expect(() => createSolubilitySubmission(model, [{ solute: "CCO", solvent: "O" }])).toThrow(RangeError);
});

test.each([null, [], [null], ["CCO"], [["CCO"]]])("invalid batch %j has no dispatchable snapshot", (data) => {
  expect(() => createSolubilitySubmission("solprop", data)).toThrow(TypeError);
});

test("density belongs only to Fusion Cycle; absent, zero and per-row densities remain distinct", () => {
  const inputs = [{ solute: "CCO", solvent: "O", density: "" }, { solute: "CCN", solvent: "CO", density: 0 }];
  const submission = createSolubilitySubmission("solprop", inputs);
  expect(submission.body.density).toEqual([null, 0]);
  inputs[1].density = 9;
  const output = [{ Solute: "CCO", warning_message: "raw source", st_1: 0 }, { Solute: "CCN" }];
  const rows = annotateSolubilityOutput(submission, output);
  expect(rows[0]).not.toHaveProperty("density");
  expect(rows[1]).toMatchObject({ model: "Fusion Cycle", density: 0 });
  expect(output[1]).not.toHaveProperty("model");
  expect(rows[0]).toMatchObject({ warning_message: "raw source", st_1: 0 });
  expect(() => annotateSolubilityOutput(submission, [{ Solute: "ambiguous" }])).toThrow(TypeError);
  expect(annotateSolubilityOutput(submission, [])).toEqual([]);
  expect(createSolubilitySubmission("fastsolv", inputs).body).not.toHaveProperty("density");
  expect(() => createSolubilitySubmission("solprop", [{ density: "invalid" }])).toThrow(TypeError);
});

test.each([null, {}, [null], ["row"]])("malformed output %j cannot become labeled results", (output) => {
  const submission = createSolubilitySubmission("legacy", [{ solute: "CCO", solvent: "O" }]);
  expect(() => annotateSolubilityOutput(submission, output)).toThrow(TypeError);
});

test("dispatch forwards the immutable body and exact attempt signal; late success after cancellation is discarded", async () => {
  const controller = new AbortController();
  const submission = createSolubilitySubmission("fastsolv", [{ solute: "CCO", solvent: "O" }]);
  let complete;
  const runTask = jest.fn(() => new Promise((resolve) => { complete = resolve; }));
  const pending = runSolubilitySubmission(submission, controller.signal, runTask);
  expect(runTask).toHaveBeenCalledWith(submission.endpoint, submission.body, undefined, { signal: controller.signal });
  controller.abort(); complete([{}]);
  await expect(pending).resolves.toEqual([]);
  await expect(runSolubilitySubmission(submission, controller.signal, runTask)).resolves.toEqual([]);
  expect(runTask).toHaveBeenCalledTimes(1);
});

test.each(["error", "abort", "success"])("file reader %s releases callbacks/listener and settles once", async (outcome) => {
  const reader = { readAsText: jest.fn(), abort: jest.fn(), error: new Error("read failed") };
  const spy = jest.spyOn(globalThis, "FileReader").mockImplementation(() => reader);
  const controller = new AbortController(), remove = jest.spyOn(controller.signal, "removeEventListener");
  try {
    const pending = readSubmissionFile(new File(["[]"], "rows.json"), controller.signal);
    const late = reader.onload;
    if (outcome === "error") reader.onerror();
    else if (outcome === "abort") controller.abort();
    else reader.onload({ target: { result: "[]" } });
    if (outcome === "success") await expect(pending).resolves.toBe("[]");
    else await expect(pending).rejects.toBe(outcome === "error" ? reader.error : controller.signal.reason);
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(reader.onload).toBeNull();
    late({ target: { result: "late" } });
    if (outcome === "abort") expect(reader.abort).toHaveBeenCalledTimes(1);
  } finally { spy.mockRestore(); }
});

test("actual CSV/JSON parsing preserves raw structures and zero values; syntax failures are not empty successes", () => {
  const csv = "solute,solvent,temp,density,ref_solubility\r\n[Na+].CC(=O)[O-],O,298,0,0\r\n";
  const data = parseSubmissionFile({ name: "input.csv" }, csv);
  expect(data[0]).toMatchObject({ solute: "[Na+].CC(=O)[O-]", density: "0", ref_solubility: "0" });
  expect(parseSubmissionFile({ name: "input.json" }, JSON.stringify(data))).toEqual(data);
  expect(() => parseSubmissionFile({ name: "input.json" }, "[")).toThrow();
  expect(() => parseSubmissionFile({ name: "input.csv" }, 'solute,solvent\n"unterminated')).toThrow();
});
