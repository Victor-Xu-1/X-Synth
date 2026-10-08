import { API, deferred, flushPromises, mountScreen, readBlob, saveAs } from "./submission.test-support";

const row = (solute, temp, st_1 = 1) => ({ Solute: solute, Solvent: "O", Temp: temp, st_1 });

test("temperature children publish atomically in submitted order, never partial completion order", async () => {
  const first = deferred(), second = deferred();
  API.runCeleryTask.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const wrapper = await mountScreen({ refSolvent: "[Na+].CC(=O)[O-]", refSolubility: 0 });
  const solute = wrapper.vm.solute;
  const pending = wrapper.vm.predict();
  const calls = API.runCeleryTask.mock.calls;
  expect(calls).toHaveLength(2);
  expect(calls[0][1].task_list[0]).toMatchObject({ solute, solvent: "O", temp: 298, ref_solvent: "[Na+].CC(=O)[O-]", ref_solubility: 0 });
  expect(calls[0][3].signal).toBe(calls[1][3].signal);
  const bodies = calls.map((call) => JSON.stringify(call[1]));
  await wrapper.setData({ solute: "CCN", temperatures: "350", refSolvent: "CO", refSolubility: 10 });
  second.resolve([row(solute, 323, 2)]);
  await flushPromises();
  expect(wrapper.vm.results).toEqual([]);
  expect(wrapper.vm.loading).toBe(true);
  first.resolve([row(solute, 298, 0)]);
  await pending;
  expect(calls.map((call) => JSON.stringify(call[1]))).toEqual(bodies);
  expect(wrapper.vm.results.map((item) => item.Temp)).toEqual([298, 323]);
  expect(wrapper.vm.results.every((item) => item.Solute === solute && item.model === "SolProp")).toBe(true);
  expect(wrapper.vm.tableData).toEqual([{ solvent: "O", 298: 0, 323: 2 }]);
  expect(wrapper.vm.chartData.datasets.map((dataset) => dataset.label)).toEqual(["298", "323"]);
  wrapper.vm.downloadJSON();
  expect(JSON.parse(await readBlob(saveAs.mock.calls[0][0]))).toEqual(wrapper.vm.results);
});

test.each(["resolve", "reject"])("failed sibling retires run A; late %s cannot publish/error/finalize current run B", async (outcome) => {
  const failed = deferred(), late = deferred(), current = deferred();
  API.runCeleryTask.mockReturnValueOnce(failed.promise).mockReturnValueOnce(late.promise).mockReturnValueOnce(current.promise);
  const wrapper = await mountScreen();
  const oldPending = wrapper.vm.predict();
  const oldSignals = API.runCeleryTask.mock.calls.map((call) => call[3].signal);
  failed.reject(new Error("sibling failure"));
  await oldPending;
  expect(oldSignals.every((signal) => signal.aborted)).toBe(true);
  expect(wrapper.vm.results).toEqual([]);
  expect(wrapper.vm.loading).toBe(false);
  expect(wrapper.vm.requestError).toEqual({ string_error: "sibling failure" });
  await wrapper.setData({ solute: "F[C@H](Cl)Br", temperatures: "298" });
  const pending = wrapper.vm.predict();
  const signal = API.runCeleryTask.mock.calls[2][3].signal;
  if (outcome === "resolve") late.resolve([row("old solute", 323, 99)]);
  else late.reject(new Error("retired child error"));
  await flushPromises();
  expect(wrapper.vm.results).toEqual([]);
  expect(wrapper.vm.requestError).toBeNull();
  expect(wrapper.vm.loading).toBe(true);
  expect(signal.aborted).toBe(false);
  current.resolve([row("F[C@H](Cl)Br", 298, 3)]);
  await pending;
  expect(wrapper.vm.results).toHaveLength(1);
  expect(wrapper.vm.tableData).toEqual([{ solvent: "O", 298: 3 }]);
  expect(wrapper.vm.chartData.datasets).toHaveLength(1);
  expect(wrapper.vm.chartData.datasets[0].data).toEqual([{ x: "O", y: 3 }]);
  wrapper.vm.downloadJSON(); wrapper.vm.downloadCSV();
  expect(JSON.parse(await readBlob(saveAs.mock.calls[0][0]))).toEqual(wrapper.vm.results);
  const csv = await readBlob(saveAs.mock.calls[1][0]);
  expect(csv).toContain("F[C@H](Cl)Br");
  expect(csv).not.toContain("old solute");
  expect(API.toErrorObject).toHaveBeenCalledTimes(1);
});

test("a success followed by sibling failure discards all partial rows and aborts remaining polls", async () => {
  const first = deferred(), second = deferred(), third = deferred();
  API.runCeleryTask.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockReturnValueOnce(third.promise);
  const wrapper = await mountScreen({ temperatures: "298\n323\n350" });
  const pending = wrapper.vm.predict();
  first.resolve([row(wrapper.vm.solute, 298)]);
  await flushPromises();
  expect(wrapper.vm.results).toEqual([]);
  second.reject(new Error("failure"));
  await pending;
  expect(API.runCeleryTask.mock.calls.every((call) => call[3].signal.aborted)).toBe(true);
  third.resolve([row(wrapper.vm.solute, 350)]);
  await flushPromises();
  expect(wrapper.vm.results).toEqual([]);
  expect(wrapper.vm.tableData).toEqual([]);
  expect(wrapper.vm.chartData.datasets).toEqual([]);
});

test.each(["clear", "unmount"])("%s invalidates every child and ignores late completion", async (action) => {
  const first = deferred(), second = deferred();
  API.runCeleryTask.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const wrapper = await mountScreen();
  const pending = wrapper.vm.predict(), vm = wrapper.vm;
  const signals = API.runCeleryTask.mock.calls.map((call) => call[3].signal);
  if (action === "clear") await vm.clear(true);
  else wrapper.unmount();
  expect(signals.every((signal) => signal.aborted)).toBe(true);
  first.resolve([row("retired", 298)]); second.reject(new Error("retired"));
  await pending;
  expect(vm.results).toEqual([]);
  expect(vm.requestError).toBeNull();
  expect(API.toErrorObject).not.toHaveBeenCalled();
  if (action === "clear") expect(vm.loading).toBe(false);
});

test("clear/restart during pending success isolates the replacement even when all retired children later succeed", async () => {
  const first = deferred(), late = deferred(), current = deferred();
  API.runCeleryTask.mockReturnValueOnce(first.promise).mockReturnValueOnce(late.promise).mockReturnValueOnce(current.promise);
  const wrapper = await mountScreen();
  const oldPending = wrapper.vm.predict();
  first.resolve([row("old solute", 298, 99)]);
  await flushPromises();
  await wrapper.vm.clear(true);
  await wrapper.setData({ solute: "[13CH4]", temperatures: "350" });
  const pending = wrapper.vm.predict();
  late.resolve([row("old solute", 323, 99)]);
  await oldPending;
  expect(wrapper.vm.results).toEqual([]);
  expect(wrapper.vm.requestError).toBeNull();
  expect(wrapper.vm.loading).toBe(true);
  current.resolve([row("[13CH4]", 350, 0)]);
  await pending;
  expect(wrapper.vm.resultSubmission).toMatchObject({ solute: "[13CH4]", temperatures: [350], model: "legacy" });
  expect(wrapper.vm.results).toEqual([{ ...row("[13CH4]", 350, 0), model: "SolProp" }]);
});

test("screening parameters lock during work and the pending run remains clearable", async () => {
  const response = deferred();
  API.runCeleryTask.mockReturnValue(response.promise);
  const wrapper = await mountScreen({ temperatures: "298" });
  const pending = wrapper.vm.predict();
  await flushPromises();
  expect(wrapper.get('[aria-label="温度列表"]').element.disabled).toBe(true);
  expect(wrapper.get('[aria-label="参考溶解度 (log10(mol/L))"]').element.disabled).toBe(true);
  expect(wrapper.get('[data-cy="solscreen-clear"]').element.disabled).toBe(false);
  await wrapper.vm.clear(true);
  response.resolve([]);
  await pending;
});
