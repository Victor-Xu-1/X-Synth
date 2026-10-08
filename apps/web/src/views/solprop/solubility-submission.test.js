import {
  API, deferred, deferFileRead, flushPromises, mountPrediction, readBlob, saveAs,
} from "./submission.test-support";
import { DEFAULT_LOCALE, setLocale } from "@/i18n";

const models = [
  ["solprop", "/api/solubility/fusion-cycle/call-async", "Fusion Cycle"],
  ["fastsolv", "/api/fastsolv/call-async", "FastSolv"],
  ["legacy", "/api/solubility/batch/call-async", "SolProp"],
];

test.each(models)("%s single request, displayed row and both exports retain submitted model/density", async (model, endpoint, label) => {
  const response = deferred();
  API.runCeleryTask.mockReturnValue(response.promise);
  const wrapper = await mountPrediction({ selectedModel: model, density: "0.81", refSolubility: 0 });
  const originalSolute = wrapper.vm.solute;
  const pending = wrapper.vm.predict();
  const [url, body] = API.runCeleryTask.mock.calls[0];
  expect(url).toBe(endpoint);
  const sentBody = JSON.stringify(body);
  await wrapper.setData({ selectedModel: model === "fastsolv" ? "legacy" : "fastsolv", density: "1.99", temperature: 350, solute: "CCN" });
  expect(JSON.stringify(body)).toBe(sentBody);
  const row = { Solute: originalSolute, Solvent: "O", Temp: 298, st_1: 0, warning_message: "source text" };
  response.resolve([row]);
  await pending;
  await flushPromises();
  expect(wrapper.vm.results[0]).toMatchObject({ ...row, model: label });
  if (model === "solprop") expect(wrapper.vm.results[0].density).toBe(0.81);
  else expect(wrapper.vm.results[0]).not.toHaveProperty("density");
  expect(wrapper.get('[data-cy="solpred-table"]').text()).toContain(label);
  wrapper.vm.downloadJSON();
  const exported = JSON.parse(await readBlob(saveAs.mock.calls[0][0]));
  expect(exported).toEqual(wrapper.vm.results);
  wrapper.vm.downloadCSV();
  const csv = await readBlob(saveAs.mock.calls[1][0]);
  expect(csv).toContain(label);
  if (model === "solprop") expect(csv).toContain("0.81");
  expect(csv).not.toContain("1.99");
  expect(wrapper.vm.loading).toBe(false);
  expect(wrapper.vm.pendingTasks).toBe(0);
});

test.each(models)("%s batch provenance is bound to dispatched rows, not subsequent draft/file edits", async (model, endpoint, label) => {
  const response = deferred();
  API.runCeleryTask.mockReturnValue(response.promise);
  const wrapper = await mountPrediction({ selectedModel: model, density: 9 });
  const inputs = [{ solute: "[13CH4]", solvent: "O", temp: 298, density: 0 },
    { solute: "F[C@H](Cl)Br", solvent: "CO", temp: 323, density: 0.91 }];
  const pending = wrapper.vm.predictBatch(inputs);
  const [url, body] = API.runCeleryTask.mock.calls[0];
  expect(url).toBe(endpoint);
  const sentBody = JSON.stringify(body);
  inputs[0].solute = "CCN";
  inputs[1].density = 8;
  await wrapper.setData({ selectedModel: model === "fastsolv" ? "legacy" : "fastsolv", density: 7 });
  response.resolve([{ Solute: "[13CH4]", Solvent: "O", Temp: 298 }, { Solute: "F[C@H](Cl)Br", Solvent: "CO", Temp: 323 }]);
  await pending;
  expect(JSON.stringify(body)).toBe(sentBody);
  expect(wrapper.vm.results.map((row) => row.model)).toEqual([label, label]);
  if (model === "solprop") expect(wrapper.vm.results.map((row) => row.density)).toEqual([0, 0.91]);
  else expect(wrapper.vm.results.every((row) => !Object.hasOwn(row, "density"))).toBe(true);
});

test.each(["resolve", "reject"])("clear retires single work and ignores late %s without touching a replacement", async (outcome) => {
  const old = deferred(), current = deferred();
  API.runCeleryTask.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
  const wrapper = await mountPrediction();
  const oldPending = wrapper.vm.predict();
  const signal = API.runCeleryTask.mock.calls[0][3].signal;
  wrapper.vm.clear();
  expect(signal.aborted).toBe(true);
  expect(wrapper.vm.pendingTasks).toBe(0);
  expect(wrapper.vm.loading).toBe(false);
  await wrapper.setData({ solute: "CCN", selectedModel: "fastsolv" });
  const pending = wrapper.vm.predict();
  expect(API.runCeleryTask).toHaveBeenCalledTimes(2);
  if (outcome === "resolve") old.resolve([{ Solute: "old" }]);
  else old.reject(new Error("retired error"));
  await oldPending;
  expect(wrapper.vm.results).toEqual([]);
  expect(wrapper.vm.requestError).toBeNull();
  expect(wrapper.vm.loading).toBe(true);
  expect(wrapper.vm.pendingTasks).toBe(1);
  current.resolve([{ Solute: "CCN", Solvent: "O", Temp: 298 }]);
  await pending;
  expect(wrapper.vm.results[0]).toMatchObject({ Solute: "CCN", model: "FastSolv" });
  expect(API.toErrorObject).not.toHaveBeenCalled();
});

test("pending inputs and model/batch controls are explicitly locked; clear remains reachable", async () => {
  const response = deferred();
  API.runCeleryTask.mockReturnValue(response.promise);
  const wrapper = await mountPrediction();
  const pending = wrapper.vm.predict();
  await flushPromises();
  for (const selector of ['[data-cy="model-selection"]', '[data-cy="solpred-run-batch"]', '[data-cy="solpred-temp"]', '[aria-label="密度"]']) {
    expect(wrapper.get(selector).element.disabled).toBe(true);
  }
  expect(wrapper.get('[data-cy="solpred-clear-results"]').element.disabled).toBe(false);
  wrapper.vm.clear();
  response.resolve([]);
  await pending;
});

test("file read belongs to submitted model/source and uses that context after deferred read", async () => {
  const reader = deferFileRead(), response = deferred();
  API.runCeleryTask.mockReturnValue(response.promise);
  const file = new File(['[]'], "submitted.json");
  const wrapper = await mountPrediction({ uploadFile: file, selectedModel: "solprop" });
  const pending = wrapper.vm.handleUploadSubmit();
  expect(wrapper.vm.loading).toBe(true);
  const completeRead = reader.onload;
  await wrapper.setData({ selectedModel: "legacy", uploadFile: new File(['[]'], "edited.json"), density: 9 });
  completeRead({ target: { result: '[{"solute":"[13CH4]","solvent":"O","temperature":298,"density":0.91}]' } });
  await flushPromises();
  expect(API.runCeleryTask.mock.calls[0][0]).toBe(models[0][1]);
  expect(API.runCeleryTask.mock.calls[0][1].density).toEqual([0.91]);
  response.resolve([{ Solute: "[13CH4]", Solvent: "O", Temp: 298 }]);
  await pending;
  wrapper.vm.downloadJSON();
  expect(saveAs.mock.calls[0][1]).toBe("submitted_solubility_export.json");
  expect(wrapper.vm.results[0]).toMatchObject({ model: "Fusion Cycle", density: 0.91 });
});

test("clear during file read aborts it and prevents late dispatch", async () => {
  const reader = deferFileRead();
  const wrapper = await mountPrediction({ uploadFile: new File(['[]'], "submitted.json") });
  const pending = wrapper.vm.handleUploadSubmit();
  const completeRead = reader.onload;
  wrapper.vm.clear();
  expect(reader.abort).toHaveBeenCalledTimes(1);
  completeRead({ target: { result: '[{"solute":"CCO","solvent":"O"}]' } });
  await pending;
  await flushPromises();
  expect(API.runCeleryTask).not.toHaveBeenCalled();
  expect(wrapper.vm.results).toEqual([]);
  expect(wrapper.vm.loading).toBe(false);
});

test("density-only draft changes cannot relabel the value sent by a still-selected Fusion Cycle model", async () => {
  const response = deferred();
  API.runCeleryTask.mockReturnValue(response.promise);
  const wrapper = await mountPrediction({ density: 0 });
  const pending = wrapper.vm.predict();
  await wrapper.setData({ density: 1.5 });
  response.resolve([{ Solute: wrapper.vm.solute, Solvent: "O", Temp: 298 }]);
  await pending;
  expect(API.runCeleryTask.mock.calls[0][1].density).toEqual([0]);
  expect(wrapper.vm.results[0]).toMatchObject({ model: "Fusion Cycle", density: 0 });
});

test.each(["resolve", "reject"])("batch disposal cancels transport and ignores late %s", async (outcome) => {
  const response = deferred();
  API.runCeleryTask.mockReturnValue(response.promise);
  const wrapper = await mountPrediction(), vm = wrapper.vm;
  const pending = vm.predictBatch([{ solute: "[13CH4]", solvent: "O", density: 0.8 }]);
  const signal = API.runCeleryTask.mock.calls[0][3].signal;
  wrapper.unmount();
  expect(signal.aborted).toBe(true);
  if (outcome === "resolve") response.resolve([{}]);
  else response.reject(new Error("disposed"));
  await pending;
  expect(vm.results).toEqual([]);
  expect(vm.requestError).toBeNull();
  expect(API.toErrorObject).not.toHaveBeenCalled();
});

test("file disposal aborts the read, and a late saved callback cannot start polling", async () => {
  const reader = deferFileRead();
  const wrapper = await mountPrediction({ uploadFile: new File(['[]'], "rows.json") });
  const pending = wrapper.vm.handleUploadSubmit(), complete = reader.onload;
  wrapper.unmount();
  expect(reader.abort).toHaveBeenCalledTimes(1);
  complete({ target: { result: '[{"solute":"CCO","solvent":"O"}]' } });
  await pending;
  expect(API.runCeleryTask).not.toHaveBeenCalled();
});

test.each(["read", "parse"])("file %s error releases the current busy state and permits a successful retry", async (failure) => {
  const reader = deferFileRead();
  const wrapper = await mountPrediction({ uploadFile: new File(['[]'], "rows.json") });
  const pending = wrapper.vm.handleUploadSubmit();
  if (failure === "read") { reader.error = new Error("read failed"); reader.onerror(); }
  else reader.onload({ target: { result: "[" } });
  await pending;
  expect(wrapper.vm.loading).toBe(false);
  expect(wrapper.vm.pendingTasks).toBe(0);
  expect(wrapper.vm.requestError).not.toBeNull();
  expect(API.runCeleryTask).not.toHaveBeenCalled();
  API.runCeleryTask.mockResolvedValue([{}]);
  await wrapper.vm.predict();
  expect(wrapper.vm.requestError).toBeNull();
  expect(wrapper.vm.results).toHaveLength(1);
});

test("completed rows retain their respective submitted methods when a later single request is appended", async () => {
  API.runCeleryTask.mockResolvedValueOnce([{ Solute: "first" }]).mockResolvedValueOnce([{ Solute: "second" }]);
  const wrapper = await mountPrediction({ density: 0.8 });
  await wrapper.vm.predict();
  await wrapper.setData({ selectedModel: "legacy", density: 9 });
  await wrapper.vm.predict();
  expect(wrapper.vm.results.map((item) => item.model)).toEqual(["SolProp", "Fusion Cycle"]);
  expect(wrapper.vm.results[1].density).toBe(0.8);
});

test("locale changes during a deferred prediction preserve the dispatched identity and current result", async () => {
  setLocale(DEFAULT_LOCALE, { persist: false });
  const response = deferred();
  API.runCeleryTask.mockReturnValue(response.promise);
  const wrapper = await mountPrediction({ density: 0.8 });
  expect(wrapper.text()).toContain("More parameters");
  const pending = wrapper.vm.predict(), body = API.runCeleryTask.mock.calls[0][1];
  const original = JSON.stringify(body);
  setLocale("zh-CN", { persist: false }); await flushPromises();
  expect(wrapper.text()).toContain("更多参数");
  expect(API.runCeleryTask).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(body)).toBe(original);
  response.resolve([{ Solute: wrapper.vm.solute, Solvent: "O", Temp: 298 }]);
  await pending;
  const results = JSON.stringify(wrapper.vm.results);
  setLocale(DEFAULT_LOCALE, { persist: false }); await flushPromises();
  expect(JSON.stringify(wrapper.vm.results)).toBe(results);
  expect(wrapper.vm.results[0]).toMatchObject({ model: "Fusion Cycle", density: 0.8 });
});

test("stored file syntax error uses the existing full phrase in English and follows the Chinese switch", async () => {
  setLocale(DEFAULT_LOCALE, { persist: false });
  const reader = deferFileRead();
  const wrapper = await mountPrediction({ uploadFile: new File(['['], "rows.json") });
  const pending = wrapper.vm.handleUploadSubmit();
  reader.onload({ target: { result: "[" } });
  await pending; await flushPromises();
  expect(wrapper.text()).toContain("Invalid JSON file format");
  const error = JSON.stringify(wrapper.vm.requestError);
  setLocale("zh-CN", { persist: false }); await flushPromises();
  expect(wrapper.text()).toContain("JSON 文件格式无效");
  expect(JSON.stringify(wrapper.vm.requestError)).toBe(error);
  expect(API.runCeleryTask).not.toHaveBeenCalled();
});
