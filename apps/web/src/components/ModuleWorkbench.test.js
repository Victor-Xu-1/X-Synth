import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, onMounted, onUnmounted, reactive, ref } from "vue";
import { randomUUID } from "node:crypto";
import ModuleWorkbench from "./ModuleWorkbench.vue";
import WorkbenchDialog from "./workspace/WorkbenchDialog.vue";
import { setLocale } from "@/i18n";

global.CSS = { supports: () => false };
const { createVuetify, components } = require("vuetify/dist/vuetify.js");
let mockWorkspace, mockRoute;
jest.mock("@/store/workspace", () => ({ useWorkspaceStore: () => mockWorkspace }));
jest.mock("vue-router", () => ({ useRoute: () => mockRoute }));

const wrappers = [], hosts = [];
let mounts, unmounts;
const Draft = defineComponent({
  setup() {
    const draft = ref("");
    onMounted(() => mounts++);
    onUnmounted(() => unmounts++);
    return () => h("input", { "aria-label": "chemical draft", value: draft.value,
      onInput: (event) => { draft.value = event.target.value; } });
  },
});
async function setup(props = {}, slots = { default: () => h(Draft) }) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  hosts.push(host);
  const wrapper = mount(ModuleWorkbench, {
    attachTo: host,
    props: { title: "Test workbench", ...props }, slots,
    global: {
      plugins: [createVuetify({ components: { VDefaultsProvider: components.VDefaultsProvider, VDialog: components.VDialog }, theme: false })],
      stubs: { transition: false, VIcon: true, VProgressLinear: true, RouterLink: { template: '<a><slot /></a>' } },
    },
  });
  wrappers.push(wrapper);
  await flushPromises();
  return wrapper;
}
beforeAll(() => {
  Object.defineProperty(globalThis.crypto, "randomUUID", { configurable: true, value: randomUUID });
  window.matchMedia = jest.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  global.visualViewport = undefined;
});
beforeEach(() => {
  mounts = 0;
  unmounts = 0;
  mockRoute = reactive({ path: "/buyables", query: {}, meta: { feature: "stock" } });
  mockWorkspace = reactive({
    features: { stock: true }, pending: {}, loading: false, refreshed: 1, error: "",
    can: jest.fn((feature) => !feature || mockWorkspace.features[feature] === true),
    checking: jest.fn((feature) => !mockWorkspace.error && mockWorkspace.pending[feature] === true),
  });
});
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  hosts.splice(0).forEach((host) => host.remove());
});

test.each([false, true])("an unconfirmed relevant optional probe is connecting even with overall loading %s", async (loading) => {
  mockRoute.path = "/template";
  mockRoute.meta.feature = "templates";
  mockWorkspace.features = {};
  mockWorkspace.pending = { templates: true };
  mockWorkspace.loading = loading;
  const wrapper = await setup();
  expect(wrapper.text()).toContain("连接计算服务");
  expect(wrapper.text()).not.toContain("当前服务未启用");
  expect(mounts).toBe(0);
  expect(mockWorkspace.checking).toHaveBeenCalledWith("templates");
});
test("unrelated pending probes do not replace a confirmed available workbench", async () => {
  mockWorkspace.loading = true;
  mockWorkspace.pending = { templates: true, optimization: true, references: true };
  const wrapper = await setup();
  const input = wrapper.get("input");
  await input.setValue("[13CH3][C@H]([NH3+])CO.[Cl-]");
  mockWorkspace.refreshed++;
  await flushPromises();
  expect(wrapper.get("input").element).toBe(input.element);
  expect(input.element.value).toContain("[Cl-]");
  expect(mounts).toBe(1);
  expect(unmounts).toBe(0);
  expect(wrapper.find(".workspace-loading").exists()).toBe(false);
});

test("language switches translate workbench headings while retaining the same scoped chemical draft", async () => {
  const wrapper = await setup({ title: "工艺核算" });
  const input = wrapper.get("input");
  const draft = "[13CH3][C@H]([NH3+])CO.[Cl-]";
  await input.setValue(draft);
  setLocale("en", { persist: false });
  await flushPromises();
  expect(wrapper.get("h1").text()).toBe("Process accounting");
  expect(wrapper.get("input").element).toBe(input.element);
  expect(input.element.value).toBe(draft);
  mockWorkspace.features.stock = false;
  await flushPromises();
  expect(wrapper.text()).toContain("Service not enabled");
  expect(unmounts).toBe(0);
  setLocale("zh-CN", { persist: false });
  mockWorkspace.features.stock = true;
  await flushPromises();
  expect(wrapper.get("h1").text()).toBe("工艺核算");
  expect(wrapper.get("input").element).toBe(input.element);
  expect(input.element.value).toBe(draft);
  expect(mounts).toBe(1);
});
test("known core error bypasses connecting and never initializes guarded contents or actions", async () => {
  mockWorkspace.features = {};
  mockWorkspace.loading = true;
  mockWorkspace.refreshed = 0;
  mockWorkspace.pending = { stock: true };
  mockWorkspace.error = "无法确认工作区会话";
  const wrapper = await setup({}, { default: () => h(Draft), actions: () => h("button", "guarded action") });
  expect(wrapper.text()).not.toContain("连接计算服务");
  expect(wrapper.text()).toContain("无法确认工作区会话");
  expect(wrapper.find("input").exists()).toBe(false);
  expect(wrapper.text()).not.toContain("guarded action");
  expect(mounts).toBe(0);
});
test("failure gates an initialized draft and actions without remounting, and recovery resumes the same draft", async () => {
  const wrapper = await setup({}, { default: () => h(Draft), actions: () => h("button", "guarded action") });
  const input = wrapper.get("input");
  await input.setValue("[13CH3][C@H]([NH3+])CO.[Cl-]");
  input.element.focus();
  mockWorkspace.loading = true;
  mockWorkspace.features.stock = false;
  mockWorkspace.error = "无法连接工作区服务";
  await flushPromises();
  const content = wrapper.get(".workbench-content");
  expect(content.isVisible()).toBe(false);
  expect(content.attributes("inert")).toBeDefined();
  expect(content.attributes("aria-hidden")).toBe("true");
  expect(wrapper.get(".page-actions").isVisible()).toBe(false);
  expect(wrapper.get(".page-actions").attributes("inert")).toBeDefined();
  expect(document.activeElement).toBe(wrapper.get('[role="status"]').element);
  expect(unmounts).toBe(0);
  mockWorkspace.error = "";
  mockWorkspace.features.stock = true;
  await flushPromises();
  expect(wrapper.get("input").element).toBe(input.element);
  expect(input.element.value).toContain("[Cl-]");
  expect(content.isVisible()).toBe(true);
  expect(content.attributes("inert")).toBeUndefined();
  expect(mounts).toBe(1);
  expect(document.activeElement).toBe(input.element);
});
test("known unavailable is not connecting just because unrelated optional probes remain pending", async () => {
  mockWorkspace.features.stock = false;
  mockWorkspace.loading = true;
  mockWorkspace.pending.references = true;
  const wrapper = await setup();
  expect(wrapper.text()).toContain("当前服务未启用");
  expect(wrapper.find("input").exists()).toBe(false);
});
test("feature and path changes dispose old scope; query-only navigation preserves the initialized input", async () => {
  const wrapper = await setup();
  const input = wrapper.get("input");
  await input.setValue("old scope");
  mockRoute.query = { smiles: "CCO" };
  await flushPromises();
  expect(wrapper.get("input").element).toBe(input.element);
  mockRoute.meta.feature = "scscore";
  await flushPromises();
  expect(wrapper.find("input").exists()).toBe(false);
  expect(unmounts).toBe(1);
  mockWorkspace.features.scscore = true;
  await flushPromises();
  expect(wrapper.get("input").element.value).toBe("");
  const second = wrapper.get("input").element;
  mockRoute.path = "/molcom";
  await flushPromises();
  expect(wrapper.get("input").element).not.toBe(second);
  expect(mounts).toBe(3);
});
test("featureless pages do not wait for overall refresh or ask for a feature probe", async () => {
  mockRoute.meta = {};
  mockWorkspace.loading = true;
  mockWorkspace.refreshed = 0;
  const wrapper = await setup();
  expect(wrapper.get("input").isVisible()).toBe(true);
  expect(mockWorkspace.checking).not.toHaveBeenCalled();
});
test("named native tabs link to the active shared panel and support roving disabled-skipping focus", async () => {
  let wrapper;
  const modules = [{ value: "a", title: "Alpha" }, { value: "b", title: "Beta", disabled: true }, { value: "c", title: "Gamma" }];
  wrapper = await setup({ modules, activeModule: "a", onSelectModule: (value) => wrapper.setProps({ activeModule: value }) });
  expect(wrapper.get('[role="tablist"]').attributes("aria-label")).toBe("Test workbench模块");
  const tabs = wrapper.findAll('[role="tab"]');
  expect(tabs.map((tab) => tab.attributes("tabindex"))).toEqual(["0", "-1", "-1"]);
  expect(tabs.every((tab) => tab.attributes("id") && tab.attributes("aria-controls"))).toBe(true);
  tabs[0].element.focus();
  await tabs[0].trigger("keydown", { key: "ArrowRight" });
  await flushPromises();
  expect(document.activeElement).toBe(tabs[2].element);
  expect(tabs[2].attributes("aria-selected")).toBe("true");
  const panel = wrapper.get('[role="tabpanel"]');
  expect(panel.attributes("id")).toBe(tabs[2].attributes("aria-controls"));
  expect(panel.attributes("aria-labelledby")).toBe(tabs[2].attributes("id"));
  await tabs[2].trigger("keydown", { key: "Home" });
  await flushPromises();
  expect(document.activeElement).toBe(tabs[0].element);
  await tabs[0].trigger("keydown", { key: "End" });
  await flushPromises();
  expect(document.activeElement).toBe(tabs[2].element);
  expect(mounts).toBe(1);
});
test("real Vuetify dialogs remain inside the gated content and keep the mounted chemical input", async () => {
  mockRoute.meta.feature = "native_account";
  mockWorkspace.features.native_account = true;
  const wrapper = await setup({}, { default: () => h(WorkbenchDialog,
    { modelValue: true, transition: false, scrim: false }, { default: () => h(Draft) }) });
  const input = document.querySelector('input[aria-label="chemical draft"]');
  expect(input.closest(".workbench-content")).toBe(wrapper.get(".workbench-content").element);
  input.value = "retained native draft";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.focus();
  mockWorkspace.features.native_account = false;
  await flushPromises();
  expect(input.isConnected).toBe(true);
  expect(wrapper.get(".workbench-content").isVisible()).toBe(false);
  expect(document.activeElement).toBe(wrapper.get('[role="status"]').element);
  expect(unmounts).toBe(0);
  mockWorkspace.features.native_account = true;
  await flushPromises();
  expect(document.querySelector('input[aria-label="chemical draft"]')).toBe(input);
  expect(input.value).toBe("retained native draft");
});

test("inactive named panels retain dialog inputs but release focus and scroll capture", async () => {
  const modules = [{ value: "a", title: "Alpha" }, { value: "b", title: "Beta" }];
  const wrapper = await setup({ modules, activeModule: "a" }, { module: ({ value }) => value === "a"
    ? h(WorkbenchDialog, { modelValue: true, transition: false, scrim: false }, { default: () => h(Draft) })
    : h("button", "other panel") });
  const input = wrapper.get("input").element;
  const dialog = wrapper.getComponent(components.VDialog).getComponent(components.VOverlay);
  expect(dialog.props("retainFocus")).toBe(true);
  await wrapper.setProps({ activeModule: "b" });
  await flushPromises();
  expect(input.isConnected).toBe(true);
  expect(wrapper.findAll('[role="tabpanel"]')[0].isVisible()).toBe(false);
  expect(dialog.props("modelValue")).toBe(false);
  const selectedTab = wrapper.findAll('[role="tab"]')[1].element;
  selectedTab.focus();
  await flushPromises();
  expect(document.activeElement).toBe(selectedTab);
  expect(unmounts).toBe(0);
});

test("an optional recheck gates the retained draft as connecting and resumes it without remount", async () => {
  mockRoute.meta.feature = "templates";
  mockWorkspace.features.templates = true;
  const wrapper = await setup();
  const input = wrapper.get("input").element;
  mockWorkspace.features.templates = false;
  await flushPromises();
  mockWorkspace.pending.templates = true;
  await flushPromises();
  expect(wrapper.text()).toContain("连接计算服务");
  expect(wrapper.get(".workbench-content").isVisible()).toBe(false);
  expect(input.isConnected).toBe(true);
  mockWorkspace.pending.templates = false;
  mockWorkspace.features.templates = true;
  await flushPromises();
  expect(wrapper.get("input").element).toBe(input);
  expect(mounts).toBe(1);
});

test("unavailable gating never steals outside focus and late focus is cancelled by recovery or unmount", async () => {
  const wrapper = await setup();
  const outside = document.createElement("button");
  hosts[0].appendChild(outside);
  outside.focus();
  mockWorkspace.features.stock = false;
  await flushPromises();
  expect(document.activeElement).toBe(outside);
  mockWorkspace.features.stock = true;
  await flushPromises();
  wrapper.get("input").element.focus();
  mockWorkspace.features.stock = false;
  mockWorkspace.features.stock = true;
  await flushPromises();
  expect(document.activeElement).toBe(wrapper.get("input").element);
  const focus = jest.spyOn(HTMLElement.prototype, "focus");
  mockWorkspace.features.stock = false;
  wrapper.unmount();
  await flushPromises();
  expect(focus).not.toHaveBeenCalled();
  focus.mockRestore();
});

test("a hidden real dialog ignores Escape, releases back guarding and restores its retained file/radio focus", async () => {
  const cancelled = jest.fn();
  const wrapper = await setup({}, { default: () => h(WorkbenchDialog,
    { modelValue: true, transition: false, scrim: false, "onUpdate:modelValue": cancelled },
    { default: () => h("div", [h("input", { type: "file" }), h("input", { type: "radio", checked: true })]) }) });
  const file = wrapper.get('input[type="file"]').element;
  const radio = wrapper.get('input[type="radio"]').element;
  radio.focus();
  mockWorkspace.features.stock = false;
  await flushPromises();
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await flushPromises();
  expect(cancelled).not.toHaveBeenCalled();
  expect(wrapper.getComponent(components.VDialog).getComponent(components.VOverlay).props("modelValue")).toBe(false);
  mockWorkspace.features.stock = true;
  await flushPromises();
  expect(wrapper.get('input[type="file"]').element).toBe(file);
  expect(wrapper.get('input[type="radio"]').element).toBe(radio);
  expect(radio.checked).toBe(true);
  expect(document.activeElement).toBe(radio);
});

test.each([false, true])("cold unavailable tabs link only to empty guarded panel shells (named %s)", async (named) => {
  mockWorkspace.features.stock = false;
  const wrapper = await setup({ modules: [{ value: "a", title: "Alpha" }, { value: "b", title: "Beta" }], activeModule: "a" },
    named ? { module: () => h(Draft) } : { default: () => h(Draft) });
  const tabs = wrapper.findAll('[role="tab"]');
  expect(tabs.every((tab) => tab.element.disabled)).toBe(true);
  tabs.forEach((tab) => expect(document.getElementById(tab.attributes("aria-controls"))).not.toBeNull());
  expect(wrapper.find("input").exists()).toBe(false);
  expect(mounts).toBe(0);
});

test("returning to an older open dialog restores Escape ownership without cancelling the newer inactive draft", async () => {
  const open = reactive({ a: true, b: true });
  const wrapper = await setup({ modules: [{ value: "a", title: "Alpha" }, { value: "b", title: "Beta" }], activeModule: "a" },
    { module: ({ value }) => h(WorkbenchDialog, { modelValue: open[value], transition: { css: false }, scrim: false,
      "onUpdate:modelValue": (next) => { open[value] = next; } },
    { default: () => h("input", { "aria-label": `draft ${value}` }) }) });
  const first = wrapper.get('input[aria-label="draft a"]').element;
  await wrapper.setProps({ activeModule: "b" });
  await flushPromises();
  const second = wrapper.get('input[aria-label="draft b"]').element;
  await wrapper.setProps({ activeModule: "a" });
  await flushPromises();
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await flushPromises();
  expect(open.a).toBe(false);
  expect(open.b).toBe(true);
  expect(first.isConnected).toBe(false);
  expect(second.isConnected).toBe(true);
});
