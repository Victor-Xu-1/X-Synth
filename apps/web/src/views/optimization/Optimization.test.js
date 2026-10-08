import { TextDecoder, TextEncoder } from "node:util";
import { randomUUID } from "node:crypto";
import { reactive } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { useRoute, useRouter } from "vue-router";
import { API } from "@/common/api";
import Optimization from "./Optimization.vue";
import ParameterRail from "./ParameterRail.vue";
import { DEFAULT_LOCALE, setLocale } from "@/i18n";
jest.mock("vue-router", () => ({ useRoute: jest.fn(), useRouter: jest.fn() }));
jest.mock("@/common/api", () => ({ API: { get: jest.fn(), post: jest.fn(), toErrorObject: (error) => ({ string_error: error.message }) } }));
jest.mock("file-saver", () => ({ saveAs: jest.fn() }));
jest.mock("./optimization.css", () => ({}));
global.TextDecoder = TextDecoder; global.TextEncoder = TextEncoder;
// Protocol-only fixtures; actual model acceptance uses the published measured CSV.
const CSV = "temperature,solvent,response\n10,a,0\n20,a,2\n10,b,3\n20,b,4\n";
const columns = [
  { name: "temperature", numeric: true, values: ["10", "20"], unique_count: 2 },
  { name: "solvent", numeric: false, values: ["a", "b"], unique_count: 2 },
  { name: "response", numeric: true, values: ["0", "2", "3", "4"], unique_count: 4 },
];
const rows = [["10", "a", "0"], ["20", "a", "2"], ["10", "b", "3"], ["20", "b", "4"]]
  .map((row, index) => ({ index: index + 1, values: Object.fromEntries(columns.map((column, i) => [column.name, row[i]])) }));
const table = { columns, rows, row_count: 4, table_sha256: "a".repeat(64) };
const inputs = { content: CSV, table_sha256: table.table_sha256, selected_rows: [1, 2, 3],
  factors: [{ name: "temperature", kind: "numerical", values: [10, 20] }, { name: "solvent", kind: "categorical", values: ["a", "b"] }],
  target: { name: "response", kind: "response", direction: "minimize", unit: "mM" }, batch_size: 1, seed: 0,
  confirmed_measurements: true, confirmed_candidates: true };
const record = (id = "a".repeat(32)) => ({ id, kind: "optimization", status: "completed", created: "2026-10-08T00:00:00Z", inputs, result: {} });
const wrappers = [], hosts = [];
beforeAll(() => Object.defineProperty(globalThis.crypto, "randomUUID", { configurable: true, value: randomUUID }));
const stubs = {
  ModuleWorkbench: { template: '<section><slot name="actions" /><slot /></section>' },
  VBtn: { props: ["disabled", "loading", "type"], template: '<button :type="type || \'button\'" :disabled="disabled || loading"><slot /></button>' },
  VIcon: true, VProgressCircular: true, RouterLink: { props: ["to"], template: '<a :href="to"><slot /></a>' },
};
async function setup(query = {}) {
  const route = reactive({ query, fullPath: "/optimization" });
  const router = { push: jest.fn().mockResolvedValue(undefined) };
  useRoute.mockReturnValue(route); useRouter.mockReturnValue(router);
  const host = document.createElement("div"); document.body.appendChild(host); hosts.push(host);
  const wrapper = mount(Optimization, { attachTo: host, global: { stubs } }); wrappers.push(wrapper); await flushPromises();
  return { wrapper, router, route };
}
beforeEach(() => {
  jest.clearAllMocks(); API.post.mockReset(); window.history.replaceState({}, "");
  API.get.mockImplementation((url) => Promise.resolve(url.endsWith("/health") ? { ready: true, versions: { baybe: "0.15.0" } } : record()));
});
afterEach(() => {
  wrappers.splice(0).forEach(wrapper => wrapper.unmount());
  hosts.splice(0).forEach(host => host.remove());
});

test("input-only view has no empty recommendation panel or automatic calculation", async () => {
  const { wrapper } = await setup();
  expect(wrapper.find(".opt-recommendations").exists()).toBe(false);
  expect(wrapper.find('[role="tablist"]').exists()).toBe(false);
  expect(API.post).not.toHaveBeenCalled();
});

test("factor-level validation follows the locale without changing user column names or draft values", async () => {
  const name = "研究者列 [Na+].CC(=O)[O-]";
  const factors = [{ name, kind: "numerical", levels: "0\n0" }];
  const original = JSON.stringify(factors);
  const wrapper = mount(ParameterRail, { props: { columns: [{ name, unique_count: 2, selectable: true }],
    factors, target: { name: "响应原文", kind: "response", direction: "minimize", unit: "mM" }, count: 0 },
    global: { stubs: { VBtn: true } } });
  try {
    const input = wrapper.get("textarea").element;
    setLocale(DEFAULT_LOCALE, { persist: false }); await flushPromises();
    expect(wrapper.text()).toContain(`Levels for ${name} contain duplicates.`);
    expect(wrapper.get("textarea").element).toBe(input); expect(input.value).toBe("0\n0");
    setLocale("zh-CN", { persist: false }); await flushPromises();
    expect(wrapper.text()).toContain(`${name} 的水平重复。`); expect(JSON.stringify(factors)).toBe(original);
    expect(API.post).not.toHaveBeenCalled();
  } finally { wrapper.unmount(); }
});

test("successful isolated protocol submission opens the immutable result route", async () => {
  API.post.mockImplementation((url, body) => Promise.resolve(url.endsWith("/inspect") ? table : {
    engine: "BayBE", versions: { baybe: "0.15.0" }, empirically_confirmed: false,
    seed: body.seed,
    table_sha256: body.table_sha256, selected_rows: body.selected_rows, measurement_count: 3, target: body.target,
    recommendations: [{ conditions: { temperature: 20, solvent: "b" }, posterior_mean: 0, posterior_std: 1 }],
    csv_content: "protocol-only", record_id: "b".repeat(32),
  }));
  const { wrapper, router } = await setup();
  const file = wrapper.get('input[type="file"]');
  Object.defineProperty(file.element, "files", { configurable: true, value: [{ name: "protocol.csv", size: CSV.length,
    arrayBuffer: async () => new TextEncoder().encode(CSV).buffer }] });
  await file.trigger("change"); await flushPromises();
  await wrapper.findAll('[role="tab"]')[1].trigger("click");
  await wrapper.get('[aria-label="实测响应列"]').setValue("response");
  await wrapper.get('[aria-label="因子 temperature"]').setValue(true);
  await wrapper.get('[aria-label="因子 solvent"]').setValue(true);
  await wrapper.findAll('[role="tab"]')[0].trigger("click");
  for (const index of [1, 2, 3]) await wrapper.get('[aria-label="选择实测记录 ' + index + '"]').setValue(true);
  await wrapper.findAll('[role="tab"]')[2].trigger("click");
  await wrapper.get('[aria-label="下一批实验数"]').setValue(1);
  for (const checkbox of wrapper.findAll(".opt-confirmation input")) await checkbox.setValue(true);
  await wrapper.get("form").trigger("submit"); await flushPromises();
  expect(router.push).toHaveBeenCalledWith({ path: "/analyses/" + "b".repeat(32), query: { kind: "optimization" } });
  expect(wrapper.find(".opt-recommendations").exists()).toBe(false);
});

test("saved replay restores every declared field but requires fresh confirmations", async () => {
  API.post.mockResolvedValue(table);
  const { wrapper } = await setup({ record: "a".repeat(32) });
  expect(wrapper.get('[aria-label="实测响应列"]').element.value).toBe("response");
  expect(wrapper.get('[aria-label="响应目标类型"]').element.value).toBe("response");
  expect(wrapper.get('[aria-label="优化方向"]').element.value).toBe("minimize");
  expect(wrapper.get('[aria-label="响应单位"]').element.value).toBe("mM");
  expect(wrapper.get('[aria-label="随机种子"]').element.value).toBe("0");
  expect(wrapper.findAll('tbody input[type="checkbox"]:checked')).toHaveLength(3);
  expect(wrapper.findAll(".opt-confirmation input").every((input) => !input.element.checked)).toBe(true);
  expect(API.post.mock.calls).toEqual([["/api/v1/optimization/inspect", { content: CSV }]]);
});

test("same-URL New Optimization clears a history-restored form and its recovery pointer", async () => {
  window.history.replaceState({ xSynthSubmittedInput: { version: 1, kind: "optimization", id: "a".repeat(32), location: "/optimization" } }, "");
  API.post.mockResolvedValue(table);
  const { wrapper } = await setup();
  expect(wrapper.find(".opt-layout").exists()).toBe(true);
  await wrapper.findAll("button").find((button) => button.text() === "新建优化").trigger("click");
  expect(wrapper.find(".opt-layout").exists()).toBe(false);
  expect(wrapper.text()).toContain("尚无已选实验数据");
  expect(window.history.state.xSynthSubmittedInput).toBeNull();
});

test("declared response with unselected pending labels remains editable after replay", async () => {
  const inspected = { ...table, columns: columns.map((column) => column.name === "response"
    ? { ...column, numeric: false, values: ["0", "2", "3", "pending"] } : column) };
  API.post.mockResolvedValue(inspected);
  const { wrapper } = await setup({ record: "a".repeat(32) });
  expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  expect(wrapper.get('[aria-label="实测响应列"]').element.value).toBe("response");
  expect(wrapper.findAll('[aria-label="实测响应列"] option').map((option) => option.element.value)).toContain("response");
});

test("a mismatched saved CSV inspection locks editing and exposes retry", async () => {
  API.post.mockResolvedValue({ ...table, table_sha256: "b".repeat(64) });
  const { wrapper } = await setup({ record: "a".repeat(32) });
  expect(wrapper.get('[role="alert"]').text()).toContain("CSV 核验不一致");
  expect(wrapper.get('input[type="file"]').element.disabled).toBe(true);
  expect(wrapper.find("table").exists()).toBe(false);
  API.post.mockResolvedValue(table);
  await wrapper.get('[role="alert"] button').trigger("click"); await flushPromises();
  expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  expect(wrapper.get('input[type="file"]').element.disabled).toBe(false);
});

test("failed health lookup does not invent an installed BayBE version", async () => {
  API.get.mockRejectedValue(new Error("runtime unavailable"));
  const { wrapper } = await setup();
  expect(wrapper.text()).toContain("版本未确认");
  expect(wrapper.text()).not.toContain("BayBE 0.15.0");
});

test("derived posterior columns cannot become measured responses or experimental factors", () => {
  const wrapper = mount(ParameterRail, { props: { columns: [...columns, { name: "posterior_mean", numeric: true, unique_count: 3, selectable: false }],
    factors: [], target: { name: "", kind: "yield_percent", direction: "maximize", unit: "%" }, batchSize: 1, selectedCount: 0, count: 0 },
    global: { stubs: { VBtn: true } } });
  expect(wrapper.find('option[value="posterior_mean"]').exists()).toBe(false);
  expect(wrapper.find('[aria-label="因子 posterior_mean"]').exists()).toBe(false);
  wrapper.unmount();
});

test("replayed input starts with measured data and retains the table across configuration layers", async () => {
  API.post.mockResolvedValue(table);
  const { wrapper } = await setup({ record: "a".repeat(32) });
  const data = wrapper.get('[data-section="measurements"]');
  const originalTable = wrapper.get("table").element;
  const tabs = wrapper.findAll('[role="tab"]');
  expect(tabs.map(tab => tab.text())).toEqual(["实测记录", "实验因子", "下一批实验"]);
  expect(data.attributes("hidden")).toBeUndefined();
  await tabs[1].trigger("click");
  expect(data.attributes("hidden")).toBeDefined();
  expect(data.attributes("inert")).toBeDefined();
  expect(wrapper.get('[data-section="factors"]').attributes("hidden")).toBeUndefined();
  await tabs[2].trigger("click");
  expect(wrapper.get('[data-section="batch"]').attributes("hidden")).toBeUndefined();
  expect(wrapper.findAll(".opt-confirmation input").every(input => !input.element.checked)).toBe(true);
  await tabs[0].trigger("click");
  expect(wrapper.get("table").element).toBe(originalTable);
  expect(wrapper.findAll('tbody input:checked')).toHaveLength(3);
  expect(API.post.mock.calls).toEqual([["/api/v1/optimization/inspect", { content: CSV }]]);
});

test("layer navigation leaves confirmations intact but actual factor edits invalidate both", async () => {
  API.post.mockResolvedValue(table);
  const { wrapper } = await setup({ record: "a".repeat(32) });
  const tabs = wrapper.findAll('[role="tab"]');
  await tabs[2].trigger("click");
  for (const checkbox of wrapper.findAll(".opt-confirmation input")) await checkbox.setValue(true);
  await tabs[1].trigger("click");
  await tabs[0].trigger("click");
  await tabs[2].trigger("click");
  expect(wrapper.findAll(".opt-confirmation input").every(input => input.element.checked)).toBe(true);
  await tabs[1].trigger("click");
  await wrapper.get('[aria-label="temperature 候选水平"]').setValue("10\n20\n30");
  expect(wrapper.findAll(".opt-confirmation input").every(input => !input.element.checked)).toBe(true);
});

test("adjacent navigation focuses its retained panel and pending CSV prevents switching", async () => {
  API.post.mockResolvedValue(table);
  const { wrapper } = await setup({ record: "a".repeat(32) });
  const focus = jest.spyOn(wrapper.get('[data-section="factors"]').element, "focus");
  await wrapper.get('[data-layer-next]').trigger("click");
  await flushPromises();
  expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  let finish;
  API.post.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const file = wrapper.get('input[type="file"]');
  Object.defineProperty(file.element, "files", { configurable: true, value: [{ name: "protocol.csv", size: CSV.length,
    arrayBuffer: async () => new TextEncoder().encode(CSV).buffer }] });
  await file.trigger("change"); await flushPromises();
  expect(wrapper.find('[role="tablist"]').exists()).toBe(false);
  expect(file.element.disabled).toBe(true);
  finish(table); await flushPromises();
  expect(wrapper.get('[role="tab"][aria-selected="true"]').text()).toBe("实测记录");
});

test("keyboard and locale changes preserve layer relationships, focus, raw data and controls", async () => {
  API.post.mockResolvedValue(table);
  const { wrapper } = await setup({ record: "a".repeat(32) });
  const first = wrapper.get('[role="tab"]'); first.element.focus();
  await first.trigger("keydown", { key: "ArrowRight" }); await flushPromises();
  const selected = wrapper.get('[role="tab"][aria-selected="true"]');
  const panel = wrapper.get('[data-section="factors"]');
  expect(document.activeElement).toBe(selected.element);
  expect(selected.attributes("aria-controls")).toBe(panel.attributes("id"));
  expect(panel.attributes("aria-labelledby")).toBe(selected.attributes("id"));
  const input = wrapper.get('[aria-label="temperature 候选水平"]').element;
  const disclosure = wrapper.get(".opt-factor-settings").element; disclosure.open = true;
  setLocale(DEFAULT_LOCALE, { persist: false }); await flushPromises();
  expect(wrapper.get('[role="tab"][aria-selected="true"]').text()).toBe("Experimental factors");
  expect(wrapper.get('[aria-label="temperature candidate levels"]').element).toBe(input);
  expect(input.value).toBe("10\n20"); expect(disclosure.open).toBe(true);
  expect(wrapper.get('[aria-label="Response unit"]').element.value).toBe("mM");
  expect(wrapper.text()).toContain("Saved measured CSV");
  setLocale("zh-CN", { persist: false }); await flushPromises();
  expect(wrapper.findAll('tbody input:checked')).toHaveLength(3);
  expect(API.post).toHaveBeenCalledTimes(1);
});

test("an isolated pending recommendation locks layer and selection controls without a second run", async () => {
  API.post.mockResolvedValue(table);
  const { wrapper } = await setup({ record: "a".repeat(32) });
  await wrapper.findAll('[role="tab"]')[2].trigger("click");
  for (const checkbox of wrapper.findAll(".opt-confirmation input")) await checkbox.setValue(true);
  let finish;
  API.post.mockImplementation(() => new Promise((resolve, reject) => { finish = reject; }));
  await wrapper.get("form").trigger("submit"); await flushPromises();
  expect(wrapper.findAll('[role="tab"]').every(tab => tab.element.disabled)).toBe(true);
  expect(wrapper.get("fieldset.opt-parameter-fields").element.disabled).toBe(true);
  expect(wrapper.get('[aria-label="选择实测记录 1"]').element.disabled).toBe(true);
  expect(wrapper.get('[data-layer-previous]').element.disabled).toBe(true);
  await wrapper.get("form").trigger("submit");
  expect(API.post).toHaveBeenCalledTimes(2);
  finish(new Error("isolated runtime rejection")); await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toBe("isolated runtime rejection");
  expect(wrapper.findAll('[role="tab"]').every(tab => !tab.element.disabled)).toBe(true);
});

test("implicit configuration submit cannot execute the hidden confirmed recommendation", async () => {
  API.post.mockResolvedValue(table);
  const { wrapper } = await setup({ record: "a".repeat(32) });
  await wrapper.findAll('[role="tab"]')[2].trigger("click");
  for (const checkbox of wrapper.findAll(".opt-confirmation input")) await checkbox.setValue(true);
  await wrapper.findAll('[role="tab"]')[1].trigger("click");
  await wrapper.get("form").trigger("submit"); await flushPromises();
  expect(API.post.mock.calls).toEqual([["/api/v1/optimization/inspect", { content: CSV }]]);
  expect(wrapper.findAll(".opt-confirmation input").every(input => input.element.checked)).toBe(true);
});

test("correcting factor validation preserves the open editor and active input", async () => {
  API.post.mockResolvedValue(table);
  const { wrapper } = await setup({ record: "a".repeat(32) });
  await wrapper.findAll('[role="tab"]')[1].trigger("click");
  const input = wrapper.get('[aria-label="temperature 候选水平"]');
  const disclosure = input.element.closest("details"); disclosure.open = true; input.element.focus();
  await input.setValue("10\n10");
  expect(wrapper.get(".opt-level-error").attributes("id")).toBe(input.attributes("aria-describedby"));
  await input.setValue("10\n20");
  expect(disclosure.open).toBe(true);
  expect(document.activeElement).toBe(input.element);
  expect(wrapper.find(".opt-level-error").exists()).toBe(false);
});
