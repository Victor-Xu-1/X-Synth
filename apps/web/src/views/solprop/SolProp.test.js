import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { defineComponent, h, onMounted, onUnmounted, reactive, ref } from "vue";
import { randomUUID } from "node:crypto";
import SolProp from "./SolProp.vue";
import { DEFAULT_LOCALE, setLocale } from "@/i18n";

let mockWorkspace;
jest.mock("@/store/workspace", () => ({ useWorkspaceStore: () => mockWorkspace }));
jest.mock("@/views/solprop/tabs/SolubilityPredictView", () => ({ name: "SolubilityPredict", template: '<Draft label="prediction" />' }));
jest.mock("@/views/solprop/tabs/SolventScreenView", () => ({ name: "SolventScreen", template: '<Draft label="screening" />' }));

const wrappers = [], hosts = [];
let mounted, unmounted;
const Draft = defineComponent({ props: ["label"], setup(props) {
  const text = ref("");
  onMounted(() => mounted.push(props.label));
  onUnmounted(() => unmounted.push(props.label));
  return () => h("input", { "aria-label": props.label, value: text.value,
    onInput: (event) => { text.value = event.target.value; } });
} });
async function setup(query = {}) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/solprop", component: SolProp, meta: { feature: "solubility" } }] });
  await router.push({ path: "/solprop", query });
  const host = document.createElement("div");
  document.body.appendChild(host);
  hosts.push(host);
  const wrapper = mount(SolProp, { attachTo: host, global: {
    plugins: [router], components: { Draft },
    stubs: { RouterLink: { template: '<a><slot /></a>' }, VDefaultsProvider: { props: ["defaults"], template: '<slot />' }, VIcon: true, VProgressLinear: true },
  } });
  wrappers.push(wrapper);
  await flushPromises();
  return { wrapper, router };
}
beforeEach(() => {
  Object.defineProperty(globalThis.crypto, "randomUUID", { configurable: true, value: randomUUID });
  mounted = [];
  unmounted = [];
  mockWorkspace = reactive({ allowed: true, loading: false, refreshed: 1, error: "",
    can: () => mockWorkspace.allowed, checking: () => false, refresh: jest.fn() });
});
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  hosts.splice(0).forEach((host) => host.remove());
});

test("English-default solubility navigation and Chinese return retain selected native module, query identity and draft", async () => {
  const { wrapper, router } = await setup({ smiles: "[13CH3][C@H]([NH3+])CO.[Cl-]" });
  const input = wrapper.get('input[aria-label="prediction"]'); await input.setValue("研究者原始结构草稿 [Na+].CC(=O)[O-]");
  const query = JSON.stringify(router.currentRoute.value.query);
  setLocale(DEFAULT_LOCALE, { persist: false }); await flushPromises();
  expect(wrapper.text()).toContain("Solubility and solvents"); expect(wrapper.text()).toContain("Solubility prediction");
  expect(wrapper.get('input[aria-label="prediction"]').element).toBe(input.element);
  expect(JSON.stringify(router.currentRoute.value.query)).toBe(query); expect(unmounted).toEqual([]);
  setLocale("zh-CN", { persist: false }); await flushPromises();
  expect(wrapper.text()).toContain("溶解度与溶剂"); expect(input.element.value).toContain("研究者原始结构草稿");
});

test("native solubility panels initialize on first selection, keep separate drafts, and link every tab", async () => {
  const { wrapper, router } = await setup({ smiles: "[13CH3]CO" });
  expect(mounted).toEqual(["prediction"]);
  const prediction = wrapper.get('input[aria-label="prediction"]');
  await prediction.setValue("prediction draft");
  const tabs = wrapper.findAll('[role="tab"]');
  expect(wrapper.findAll('[role="tabpanel"]')).toHaveLength(2);
  tabs.forEach((tab) => {
    const panel = document.getElementById(tab.attributes("aria-controls"));
    expect(panel.getAttribute("aria-labelledby")).toBe(tab.attributes("id"));
  });
  tabs[0].element.focus();
  await tabs[0].trigger("keydown", { key: "ArrowRight" });
  await flushPromises();
  expect(router.currentRoute.value.query).toMatchObject({ tab: "solscreen", smiles: "[13CH3]CO" });
  expect(document.activeElement).toBe(tabs[1].element);
  const screening = wrapper.get('input[aria-label="screening"]');
  await screening.setValue("screening draft");
  expect(prediction.isVisible()).toBe(false);
  expect(prediction.element.closest('[role="tabpanel"]').hasAttribute("inert")).toBe(true);
  await tabs[1].trigger("keydown", { key: "Home" });
  await flushPromises();
  expect(wrapper.get('input[aria-label="prediction"]').element).toBe(prediction.element);
  expect(prediction.element.value).toBe("prediction draft");
  expect(screening.element.value).toBe("screening draft");
  expect(mounted).toEqual(["prediction", "screening"]);
  expect(unmounted).toEqual([]);
});
test("background refresh/failure/recovery gates but never remounts an initialized native input", async () => {
  const { wrapper } = await setup();
  const input = wrapper.get('input[aria-label="prediction"]');
  await input.setValue("[13CH3][C@H]([NH3+])CO.[Cl-]");
  mockWorkspace.loading = true;
  await flushPromises();
  expect(wrapper.get('input[aria-label="prediction"]').element).toBe(input.element);
  mockWorkspace.allowed = false;
  await flushPromises();
  expect(input.element.isConnected).toBe(true);
  expect(wrapper.get(".workbench-content").isVisible()).toBe(false);
  expect(unmounted).toEqual([]);
  mockWorkspace.allowed = true;
  await flushPromises();
  expect(wrapper.get('input[aria-label="prediction"]').element).toBe(input.element);
  expect(input.element.value).toContain("[Cl-]");
});
test("unavailable native entry never mounts input and invalid tab normalization retains prefill", async () => {
  mockWorkspace.allowed = false;
  const { wrapper, router } = await setup({ tab: "invalid", smiles: "CCO" });
  expect(mounted).toEqual([]);
  expect(wrapper.find("input").exists()).toBe(false);
  expect(router.currentRoute.value.query).toEqual({ tab: "solpred", smiles: "CCO" });
  expect(mockWorkspace.refresh).toHaveBeenCalledTimes(1);
});
