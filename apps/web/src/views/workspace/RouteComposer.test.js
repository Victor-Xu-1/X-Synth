import { buildUnifiedRouteRequestBody } from "@/common/unified-route";
import { defineComponent, nextTick, reactive, ref } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { useRoute, useRouter } from "vue-router";
import { useWorkspaceStore } from "@/store/workspace";
import { useRouteWorkbenchStore } from "@/store/route-workbench";
import { API } from "@/common/api";
import { expandMolecule } from "@/common/one-step";
import RouteComposer from "./RouteComposer.vue";
import { deserialize, serialize } from "node:v8";
globalThis.structuredClone = value => deserialize(serialize(value));

jest.mock("vue-router", () => ({
  useRoute: jest.fn(), useRouter: jest.fn(), onBeforeRouteLeave: jest.fn(),
}));
jest.mock("@/store/workspace", () => ({ useWorkspaceStore: jest.fn() }));
jest.mock("@/common/api", () => ({ API: { post: jest.fn() } }));
jest.mock("@/common/one-step", () => ({ expandMolecule: jest.fn() }));
jest.mock("@/components/workspace/StructureWorkspace.vue", () => ({ name: "StructureWorkspace", template: "<div />" }));
jest.mock("@/components/workspace/RouteImportPanel.vue", () => ({ name: "RouteImportPanel", template: "<div />" }));
jest.mock("@/components/routes/RoutePreview.vue", () => ({ name: "RoutePreview", template: "<div />" }));
jest.mock("@/components/SmilesImage.vue", () => ({ name: "SmilesImage", template: "<div />" }));

const structure = defineComponent({
  name: "StructureWorkspace", props: ["modelValue", "disabled"], emits: ["update:modelValue"],
  setup(props, { expose }) {
    expose({ pending: ref(false), read: async () => props.modelValue, capture: jest.fn(), clear: jest.fn() });
  },
  template: '<div class="test-structure"><textarea :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" /></div>',
});
const wrappers = [];
const stubs = {
  StructureWorkspace: structure,
  VBtn: { props: ["type", "disabled", "loading"], template: '<button :type="type || \'button\'" :disabled="disabled || loading"><slot /></button>' },
  VBtnToggle: { name: "VBtnToggle", template: "<div><slot /></div>" },
  VTooltip: { template: '<span><slot name="activator" :props="{}" /></span>' },
  RoutePreview: { name: "RoutePreview", props: ["modelValue", "candidates"], template: '<div class="test-preview" :data-open="modelValue" />' },
};
function setup() {
  setActivePinia(createPinia());
  const route = reactive({ path: "/", query: { mode: "manual", smiles: "CCO" } });
  const router = { push: jest.fn(), replace: jest.fn(async (value) => { route.query = value.query; }) };
  useRoute.mockReturnValue(route); useRouter.mockReturnValue(router);
  useWorkspaceStore.mockReturnValue({ ready: true, can: () => true, refresh: jest.fn() });
  const wrapper = mount(RouteComposer, { global: { stubs } });
  wrappers.push(wrapper);
  return { wrapper, route, router, draft: useRouteWorkbenchStore() };
}
beforeEach(() => { jest.clearAllMocks(); API.post.mockReset(); expandMolecule.mockReset(); });
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));
async function generate(wrapper, outcomes = [{ outcome: "C.CO", plausibility: 0.8 }]) {
  // Transport fixture only; this does not certify a one-step chemical prediction.
  expandMolecule.mockResolvedValue({ canonical: "CCO", model: "pistachio", outcomes });
  await wrapper.get("form").trigger("submit");
  await flushPromises();
}

test("manual entry starts with focused input, no empty comparison or automatic execution", () => {
  const { wrapper } = setup();
  expect(wrapper.findAll("form")).toHaveLength(1);
  expect(wrapper.find(".manual-outcomes").exists()).toBe(false);
  expect(wrapper.find('[data-cy="manual-comparison-tab"]').exists()).toBe(true);
  expect(wrapper.get('[data-cy="manual-comparison-tab"]').attributes("disabled")).toBeDefined();
  expect(API.post).not.toHaveBeenCalled(); expect(expandMolecule).not.toHaveBeenCalled();
});
test("successful manual generation opens comparison instead of stacking it below the full input", async () => {
  const { wrapper } = setup();
  const board = wrapper.getComponent(structure).vm.$.uid;
  await generate(wrapper);
  expect(wrapper.get(".manual-outcomes").isVisible()).toBe(true);
  expect(wrapper.get(".test-structure").isVisible()).toBe(false);
  expect(wrapper.getComponent(structure).vm.$.uid).toBe(board);
  expect(wrapper.get('[data-cy="manual-input-tab"]').attributes("aria-pressed")).toBe("false");
  expect(wrapper.get('[data-cy="manual-comparison-tab"]').attributes("aria-pressed")).toBe("true");
  expect(wrapper.text()).toContain("未核验采购闭合");
  await wrapper.get('[data-cy="manual-input-tab"]').trigger("click");
  expect(wrapper.get(".test-structure").isVisible()).toBe(true);
  expect(wrapper.find(".manual-outcomes").exists()).toBe(false);
  await wrapper.get('[data-cy="manual-comparison-tab"]').trigger("click");
  expect(wrapper.get(".manual-outcomes").isVisible()).toBe(true);
  expect(expandMolecule).toHaveBeenCalledTimes(1);
});
test("editing the input returns to input and removes stale comparison and preview", async () => {
  const { wrapper, draft } = setup();
  await generate(wrapper);
  const outcomes = wrapper.getComponent({ name: "ManualOutcomes" });
  outcomes.vm.$emit("preview", 0); await nextTick();
  expect(wrapper.getComponent({ name: "RoutePreview" }).props("modelValue")).toBe(true);
  draft.manual.threshold = 0.5; draft.manual.threshold = 0.75;
  await nextTick();
  expect(wrapper.find(".manual-outcomes").exists()).toBe(false);
  expect(wrapper.get(".test-structure").isVisible()).toBe(true);
  expect(wrapper.getComponent({ name: "RoutePreview" }).props("modelValue")).toBe(false);
});
test("empty candidate pools are honest results and remain navigable back to input", async () => {
  const { wrapper } = setup();
  await generate(wrapper, []);
  expect(wrapper.get(".manual-outcomes").text()).toContain("当前模型没有返回候选");
  expect(wrapper.get(".test-structure").isVisible()).toBe(false);
  expect(wrapper.get('[data-cy="manual-comparison-tab"]').attributes("disabled")).toBeUndefined();
  await wrapper.get('[data-cy="manual-input-tab"]').trigger("click");
  expect(wrapper.get(".test-structure").isVisible()).toBe(true);
});
test("comparison displays the submitted settings and retains every candidate and original preview index", async () => {
  const { wrapper, draft } = setup();
  draft.manual.count = 700; draft.manual.threshold = 0.6;
  const outcomes = Array.from({ length: 14 }, () => ({ outcome: "C.CO", plausibility: 0.8 }));
  await generate(wrapper, outcomes);
  expect(wrapper.get(".manual-comparison-context").text()).toContain("700");
  expect(wrapper.get(".manual-comparison-context").text()).toContain("0.6");
  expect(wrapper.findAll(".manual-outcome")).toHaveLength(12);
  await wrapper.findAll("button").find((button) => button.text() === "更多候选").trigger("click");
  expect(wrapper.findAll(".manual-outcome")).toHaveLength(14);
  const last = wrapper.findAll(".manual-outcome")[13];
  await last.get('[aria-label="预览候选"]').trigger("click");
  expect(wrapper.getComponent({ name: "RoutePreview" }).props("candidates")[0].route_id).toMatch(/:13$/);
  expect(wrapper.getComponent({ name: "RoutePreview" }).props("candidates")[0].closed).toBe(false);
  expect(draft.manualResult.outcomes).toHaveLength(14);
});
test("mode switches preserve the single board and context query fields", async () => {
  const { wrapper, route, router, draft } = setup();
  const board = wrapper.getComponent(structure).vm.$.uid;
  route.query = { ...route.query, context: "step-inspector", task_name: "Manual target" };
  await nextTick();
  draft.settings.minutes = 7;
  for (const mode of ["import", "auto", "manual"]) {
    await wrapper.findAllComponents({ name: "VBtnToggle" })[0].vm.$emit("update:modelValue", mode);
    await nextTick();
    expect(wrapper.getComponent(structure).vm.$.uid).toBe(board);
    expect(router.replace).toHaveBeenLastCalledWith({ path: "/", query: { ...route.query, mode } });
    expect(draft.smiles).toBe("CCO"); expect(draft.settings.minutes).toBe(7);
  }
  expect(API.post).not.toHaveBeenCalled(); expect(expandMolecule).not.toHaveBeenCalled();
});
test("workspace settings map to the sole product contract without changing route quality defaults", () => {
  const body = buildUnifiedRouteRequestBody({
    smiles: "CCO",
    description: "测试",
    expansion_time: 120,
    max_routes: 6,
    tuning: { max_depth: 15, template_count: 1200 },
  });
  expect(body).toMatchObject({
    smiles: "CCO",
    description: "测试",
    backend: "askcos",
    strategies: ["mcts", "retro_star"],
    expansion_time: 120,
    min_routes: 3,
    max_routes: 6,
    public: false,
  });
  expect(body.tuning).toMatchObject({
    max_depth: 15,
    template_count: 1200,
    minimum_plausibility: 0.75,
    cumulative_probability: 0.999,
  });
});
