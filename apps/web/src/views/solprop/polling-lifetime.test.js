import fs from "node:fs";
import path from "node:path";
import { compileScript, parse } from "@vue/compiler-sfc";
import { transformSync } from "@babel/core";
import * as Vue from "vue";
import { mount } from "@vue/test-utils";
import { useWorkbenchActivity } from "@/components/workspace/workbench-activity";
import WorkbenchScope from "@/components/workspace/WorkbenchScope.vue";
import { uiText } from "@/i18n";
import { solubilityContextText, solubilityFieldCaption } from "./ui-copy";

const runCeleryTask = jest.fn(), confirm = jest.fn(), wrappers = [];
const files = ["../qm/QM.vue", "tabs/SolubilityPredictView.vue", "tabs/SolventScreenView.vue"];
const cache = new Map();

function optionsOf(file) {
  if (cache.has(file)) return cache.get(file);
  const filename = path.resolve(__dirname, file);
  const { descriptor } = parse(fs.readFileSync(filename, "utf8"), { filename });
  const script = compileScript(descriptor, { id: file });
  const { code } = transformSync(script.content, {
    babelrc: false, configFile: false, plugins: ["@babel/plugin-transform-modules-commonjs"],
  });
  const module = { exports: {} };
  const requireMock = (id) => {
    if (id === "vue") return Vue;
    if (id === "@/i18n") return { uiText };
    if (id === "../ui-copy") return { solubilityContextText, solubilityFieldCaption };
    if (id === "vue-router") return { useRoute: () => ({ query: {} }) };
    if (id === "@/common/api") return { API: { runCeleryTask, toErrorObject: () => ({ string_error: "failed" }) } };
    if (id === "@/store/workspace") return { useWorkspaceStore: () => ({ can: () => true, refresh: async () => {} }) };
    if (id === "@/composables/useTheme") return { useTheme: () => ({ isDark: Vue.ref(false) }) };
    if (id === "vuetify-use-dialog") return { useConfirm: () => confirm };
    if (id === "chart.js") return { Chart: { register() {} } };
    if (id === "@/components/workspace/workbench-activity") return { useWorkbenchActivity };
    return {};
  };
  new Function("require", "module", "exports", code)(requireMock, module, module.exports);
  cache.set(file, module.exports.default);
  return module.exports.default;
}

function setup(file) {
  const options = optionsOf(file);
  let state;
  const wrapper = mount(Vue.defineComponent({ setup() {
    state = options.setup({}, { expose() {} });
    return () => null;
  } }));
  wrappers.push(wrapper);
  if (options.data) {
    state = { ...state, ...options.data() };
    Object.assign(state, options.methods);
    state.selectedModel = "legacy";
    state.solute = "CCO";
    state.solvent = "O";
    state.structurePending = false;
  } else state.smiles.value = "CCO";
  return { state, wrapper };
}

beforeEach(() => jest.clearAllMocks());
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

test.each([
  [files[0], "predict", "resolve"], [files[0], "predict", "reject"],
  [files[1], "predict", "resolve"], [files[1], "predict", "reject"],
  [files[1], "predictBatch", "resolve"], [files[1], "predictBatch", "reject"],
  [files[2], "predictBatch", "resolve"], [files[2], "predictBatch", "reject"],
])("%s %s disposes its poll and ignores late %s without touching remote operations", async (file, method, outcome) => {
  let resolve, reject;
  runCeleryTask.mockImplementation(() => new Promise((yes, no) => { resolve = yes; reject = no; }));
  const { state, wrapper } = setup(file);
  const pending = state[method]([{ solute: "CCO", solvent: "O", temp: 298 }]);
  const settled = Promise.resolve(pending).catch(() => {});
  expect(runCeleryTask).toHaveBeenCalledTimes(1);
  const signal = runCeleryTask.mock.calls[0][3].signal;
  expect(signal.aborted).toBe(false);
  wrapper.unmount();
  wrappers.splice(wrappers.indexOf(wrapper), 1);
  expect(signal.aborted).toBe(true);
  if (outcome === "resolve") resolve(file === files[0] ? { result: [{ smiles: "CCO" }] } : [{ solute: "CCO" }]);
  else reject(new Error("late response"));
  await settled;
  expect(file === files[0] ? state.results.value : state.results).toEqual([]);
  expect(confirm).not.toHaveBeenCalled();
  await state[method]([]);
  expect(runCeleryTask).toHaveBeenCalledTimes(1);
});

test.each([
  [files[0], "predict"], [files[1], "predict"], [files[1], "predictBatch"], [files[2], "predictBatch"],
])("%s %s still publishes a successful result while mounted", async (file, method) => {
  const result = { smiles: "CCO", solute: "CCO" };
  runCeleryTask.mockResolvedValue(file === files[0] ? { result: [result] } : [result]);
  const { state } = setup(file);
  await state[method]([{ solute: "CCO", solvent: "O", temp: 298 }]);
  expect(file === files[0] ? state.results.value : state.results).toHaveLength(1);
  expect(confirm).not.toHaveBeenCalled();
});

test.each([
  [files[1], "predict"], [files[1], "predictBatch"], [files[2], "predict"],
])("%s %s preserves a late error in its inactive pane without an application-root modal", async (file, method) => {
  let reject;
  runCeleryTask.mockImplementation(() => new Promise((yes, no) => { reject = no; }));
  const { state } = setup(file);
  state.workbenchActive = true;
  state.temperatureList = [298];
  state.solventList = ["O"];
  const pending = Promise.resolve(state[method]([{ solute: "CCO", solvent: "O", temp: 298 }])).catch(() => {});
  expect(runCeleryTask).toHaveBeenCalledTimes(1);
  state.workbenchActive = false;
  reject(new Error("late native error"));
  await pending;
  expect(confirm).not.toHaveBeenCalled();
  expect(state.requestError).toEqual({ string_error: "failed" });
  expect(state.pollingSignal.aborted).toBe(false);
  state.workbenchActive = true;
  expect(state.requestError).toEqual({ string_error: "failed" });
});

test.each([files[1], files[2]])("%s consumes reactive scope and preserves an inline late failure through suspend/resume", async (file) => {
  const active = Vue.ref(true), options = optionsOf(file);
  const Leaf = Vue.defineComponent({ ...options, created: undefined,
    render() { return Vue.h("pre", { hidden: !this.workbenchActive }, JSON.stringify(this.requestError)); } });
  const wrapper = mount(Vue.defineComponent({ setup: () => () => Vue.h(WorkbenchScope, { active: active.value },
    { default: () => Vue.h(Leaf) }) }));
  wrappers.push(wrapper);
  const leaf = wrapper.getComponent(Leaf);
  Object.assign(leaf.vm, { selectedModel: "legacy", solute: "CCO", solvent: "O", solvents: "O", temperatures: "298" });
  let reject;
  runCeleryTask.mockImplementation(() => new Promise((yes, no) => { reject = no; }));
  const pending = leaf.vm.predict();
  expect(runCeleryTask).toHaveBeenCalledTimes(1);
  active.value = false;
  await Vue.nextTick();
  expect(leaf.vm.workbenchActive).toBe(false);
  reject(new Error("late native error"));
  await pending;
  await Vue.nextTick();
  expect(confirm).not.toHaveBeenCalled();
  expect(leaf.vm.requestError).toEqual({ string_error: "failed" });
  expect(leaf.vm.pollingSignal.aborted).toBe(false);
  expect(leaf.get("pre").isVisible()).toBe(false);
  active.value = true;
  await Vue.nextTick();
  expect(leaf.get("pre").text()).toContain("failed");
  expect(leaf.get("pre").isVisible()).toBe(true);
  expect(runCeleryTask).toHaveBeenCalledTimes(1);
});
