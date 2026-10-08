import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, onMounted, onUnmounted, reactive } from "vue";
import { randomUUID } from "node:crypto";
import QM from "./QM.vue";
import { DEFAULT_LOCALE, setLocale } from "@/i18n";

global.CSS = { supports: () => false };
const { createVuetify, components } = require("vuetify/dist/vuetify.js");
let mockWorkspace, mockRoute, mockSdf;
jest.mock("@/store/workspace", () => ({ useWorkspaceStore: () => mockWorkspace }));
jest.mock("vue-router", () => ({ useRoute: () => mockRoute }));
jest.mock("@/components/workspace/StructureInput.vue", () => ({
  __esModule: true, default: { name: "StructureInput" },
}));
jest.mock("@/common/api", () => ({ API: {
  post: jest.fn(() => mockSdf.promise),
  runCeleryTask: jest.fn(),
  toErrorObject: (error) => ({ string_error: error.message }),
} }));
jest.mock("@/composables/useTheme", () => ({ useTheme: () => ({ isDark: { value: false } }) }));

const wrappers = [], hosts = [];
let mounts, unmounts;
const StructureDraft = defineComponent({
  props: { modelValue: String },
  emits: ["update:modelValue"],
  setup(props, { emit }) {
    onMounted(() => mounts++);
    onUnmounted(() => unmounts++);
    return () => h("input", {
      "aria-label": "chemical draft", value: props.modelValue,
      onInput: (event) => emit("update:modelValue", event.target.value),
    });
  },
});
const Container = defineComponent({ setup(_, { slots }) { return () => h("div", slots.default?.()); } });

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
async function setup() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  hosts.push(host);
  const wrapper = mount(QM, {
    attachTo: host,
    global: {
      plugins: [createVuetify({
        components,
        defaults: { VDialog: { transition: false } }, theme: false,
      })],
      stubs: {
        StructureInput: StructureDraft, VCard: Container, VForm: Container,
        VBtn: Container, VIcon: true, VProgressLinear: true, VProgressCircular: true,
        VTooltip: true, RouterLink: { template: '<a><slot /></a>' },
      },
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
  mockSdf = deferred();
  mockRoute = reactive({ path: "/qm", query: {}, meta: { feature: "qm" } });
  mockWorkspace = reactive({
    features: { qm: true, drawing: true }, loading: false, error: "",
    can: (feature) => !mockWorkspace.error && mockWorkspace.features[feature] === true,
    checking: () => false, refresh: jest.fn(async () => {}),
  });
});
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  hosts.splice(0).forEach((host) => host.remove());
});

test("a background readiness refresh preserves the initialized QM chemical draft", async () => {
  const wrapper = await setup();
  const input = wrapper.get('input[aria-label="chemical draft"]');
  await input.setValue("[13CH3][C@H]([NH3+])CO.[Cl-]");
  mockWorkspace.loading = true;
  await flushPromises();
  expect(wrapper.get('input[aria-label="chemical draft"]').element).toBe(input.element);
  mockWorkspace.loading = false;
  await flushPromises();
  expect(input.element.value).toContain("[Cl-]");
  expect(mounts).toBe(1);
  expect(unmounts).toBe(0);
});

test("English-default QM labels and native column captions react without changing draft or scientific records", async () => {
  const wrapper = await setup(), input = wrapper.get('input[aria-label="chemical draft"]');
  await input.setValue("[13CH3][C@H]([NH3+])CO.[Cl-]");
  wrapper.vm.results = [{ smiles: "[13CH3][C@H]([NH3+])CO.[Cl-]", npa_e: 0, IP: null, license: "raw source license" }];
  const original = JSON.stringify(wrapper.vm.results), rawFields = JSON.stringify(wrapper.vm.fields);
  setLocale(DEFAULT_LOCALE, { persist: false }); await flushPromises();
  expect(wrapper.text()).toContain("QM descriptors"); expect(wrapper.text()).toContain("Calculation results");
  expect(wrapper.vm.localizedFields.find((field) => field.key === "npa_e").title).toBe("NPA charge (e)");
  expect(wrapper.vm.selectedColumnCategories).toEqual(["NPA"]);
  expect(wrapper.get('input[aria-label="chemical draft"]').element).toBe(input.element);
  expect(JSON.stringify(wrapper.vm.results)).toBe(original); expect(JSON.stringify(wrapper.vm.fields)).toBe(rawFields);
  setLocale("zh-CN", { persist: false }); await flushPromises();
  expect(wrapper.text()).toContain("QM 描述符"); expect(wrapper.vm.localizedFields.find((field) => field.key === "npa_e").title).toBe("NPA 电荷 (e)");
  expect(input.element.value).toContain("[Cl-]"); expect(mounts).toBe(1); expect(unmounts).toBe(0);
});

test("a core outage gates the QM draft without disposing it and restores the original focus", async () => {
  const wrapper = await setup();
  const input = wrapper.get('input[aria-label="chemical draft"]');
  await input.setValue("N[C@@H](C)C(=O)O");
  input.element.focus();
  mockWorkspace.error = "connection unavailable";
  await flushPromises();
  expect(input.element.isConnected).toBe(true);
  expect(wrapper.get(".workbench-content").attributes("inert")).toBeDefined();
  expect(unmounts).toBe(0);
  mockWorkspace.error = "";
  await flushPromises();
  expect(wrapper.get('input[aria-label="chemical draft"]').element).toBe(input.element);
  expect(input.element.value).toBe("N[C@@H](C)C(=O)O");
  expect(document.activeElement).toBe(input.element);
});

test("QM visualization stays inside the workbench and leaves the global overlay stack during an outage", async () => {
  const wrapper = await setup();
  const pending = wrapper.vm.openVisualization({ smiles: "CCO" });
  await flushPromises();
  const scene = document.querySelector(".qm-visualization");
  expect(scene.closest(".workbench-content")).toBe(wrapper.get(".workbench-content").element);
  expect(document.querySelectorAll(".v-dialog.v-overlay--active")).toHaveLength(1);
  mockWorkspace.error = "connection unavailable";
  await flushPromises();
  expect(document.querySelectorAll(".v-dialog.v-overlay--active")).toHaveLength(0);
  expect(scene.isConnected).toBe(true);
  mockWorkspace.error = "";
  await flushPromises();
  expect(document.querySelector(".qm-visualization")).toBe(scene);
  expect(document.querySelectorAll(".v-dialog.v-overlay--active")).toHaveLength(1);
  wrapper.vm.dialog = false;
  mockSdf.resolve({ sdf: "" });
  await pending;
});

test("late structure failure does not publish visualization state after the QM page is disposed", async () => {
  const wrapper = await setup();
  const vm = wrapper.vm;
  const pending = vm.openVisualization({ smiles: "CCO" });
  await flushPromises();
  wrapper.unmount();
  mockSdf.resolve({ sdf: "" });
  await pending;
  expect(vm.visualizationError).toBe("");
  expect(vm.visualizationLoading).toBe(true);
});
