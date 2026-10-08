import { defineComponent, nextTick, reactive, ref } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import { useRoute, useRouter } from "vue-router";
import { API } from "@/common/api";
import { useWorkspaceStore } from "@/store/workspace";
import { reactionInput, setReactionDraft } from "../workspace/reaction-canvas.test-support";
import Forward from "./Forward.vue";
jest.mock("vue-router", () => ({ useRoute: jest.fn(), useRouter: jest.fn() }));
jest.mock("@/common/api", () => ({ API: { post: jest.fn(), get: jest.fn() } }));
jest.mock("@/store/workspace", () => ({ useWorkspaceStore: jest.fn() }));
jest.mock("vuetify-use-dialog", () => ({ useConfirm: () => jest.fn().mockResolvedValue(true) }));
jest.mock("@/components/workspace/StructureInput.vue", () => ({ name: "StructureInput", template: "<div />" }));
jest.mock("@/components/workspace/ReactionInput.vue", () => ({ name: "ReactionInput", template: "<div />" }));
const input = defineComponent({ name: "StructureInput", props: ["modelValue", "label", "disabled"], emits: ["update:modelValue"],
  setup(_, { expose }) { const pending = ref(false); expose({ pending }); },
  template: '<textarea :value="modelValue" :aria-label="label" @input="$emit(\'update:modelValue\', $event.target.value)" />' });
const stubs = {
  RouterLink: { props: ["to"], template: '<a :href="to"><slot /></a>' },
  ModuleWorkbench: { props: ["title"], template: '<section><h1>{{ title }}</h1><slot name="actions" /><slot /></section>' },
  StructureInput: input, ReactionInput: reactionInput,
  VBtn: { props: ["type", "disabled", "loading"], template: '<button :type="type || \'button\'" :disabled="disabled || loading"><slot /></button>' },
  VTextField: { props: ["modelValue", "label", "errorMessages"], emits: ["update:modelValue"], template: '<label>{{ label }}<input :aria-label="label" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />{{ errorMessages }}</label>' },
  VIcon: true, VTooltip: { template: '<span><slot name="activator" :props="{}" /></span>' },
};
// Transport/metadata fixtures only; real trained models are verified in Chrome.
const condition = { reactants: "CCO", product: "CC=O", conditions: [{ temperature: 25, solvent: "O", reagent: "", catalyst: "", score: 0.1 }], model: "nn_v1", asset_identity: "a".repeat(64), evidence_type: "model_prediction", record_id: "condition-record" };
const forward = { reactants: "CCO", products: [{ product: "CC=O", log_probability: -2.5, feasibility_score: 0.7 }], model: "graph2smiles_uspto_stereo", asset_identity: "b".repeat(64), evidence_type: "model_prediction", record_id: "forward-record" };
const wrappers = [];
beforeEach(() => { API.post.mockReset(); API.get.mockReset(); });
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));
async function setup(query = { tab: "context", reactants: "CCO", product: "CC=O" }, features = ["conditions", "forward", "fast_filter"]) {
  const route = reactive({ path: "/forward", query });
  const router = { push: jest.fn().mockResolvedValue(undefined), replace: jest.fn(async (to) => { route.query = to.query; }) };
  useRoute.mockReturnValue(route); useRouter.mockReturnValue(router);
  useWorkspaceStore.mockReturnValue({ can: (feature) => features.includes(feature) });
  const wrapper = mount(Forward, { global: { stubs } }); wrappers.push(wrapper); await flushPromises();
  if (query.tab !== "forward") await setReactionDraft(wrapper, { reactants: ["CCO"], product: "CC=O" });
  return { wrapper, route, router };
}
test.each(["context", "forward"])("%s is an input-only workbench with no empty results or automatic inference", async (tab) => {
  const { wrapper } = await setup({ tab, reactants: "CCO", product: "CC=O" });
  expect(wrapper.findAll("form")).toHaveLength(1); expect(wrapper.find(".forward-results").exists()).toBe(false);
  expect(API.post).not.toHaveBeenCalled(); expect(API.get).not.toHaveBeenCalled();
});
test("conditions send only selected model roles plus separately bound complete reaction context", async () => {
  const { wrapper, router } = await setup(); API.post.mockResolvedValue(condition);
  await wrapper.get("form").trigger("submit"); await flushPromises();
  expect(API.post).toHaveBeenCalledWith("/api/v1/conditions/predict", { reactants: "CCO", product: "CC=O", count: 10, reaction_smiles: "CCO>>CC=O" });
  expect(router.push).toHaveBeenCalledWith({ path: "/analyses/condition-record", query: { kind: "conditions" } });
});
test("forward models receive their original payload and open the immutable result record", async () => {
  const { wrapper, router } = await setup({ tab: "forward", reactants: "CCO" }); API.post.mockResolvedValue(forward);
  await wrapper.get("form").trigger("submit"); await flushPromises();
  expect(API.post).toHaveBeenCalledWith("/api/v1/reactions/predict", { reactants: "CCO", count: 5 });
  expect(router.push).toHaveBeenCalledWith({ path: "/analyses/forward-record", query: { kind: "forward" } });
});
test("pending and edited/reverted requests never open an older result", async () => {
  const { wrapper, route, router } = await setup(); let finish;
  API.post.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  await wrapper.get("form").trigger("submit"); await wrapper.get("form").trigger("submit");
  expect(API.post).toHaveBeenCalledTimes(1);
  route.query = { tab: "forward", reactants: "CCN" }; await nextTick();
  route.query = { tab: "context", reactants: "CCO", product: "CC=O" }; await nextTick();
  finish(condition); await flushPromises(); expect(router.push).not.toHaveBeenCalled();
});
test.each(["0", "21", "1.5", "invalid"])("invalid candidate count %s does not invoke a model", async (count) => {
  const { wrapper } = await setup(); await wrapper.get('[aria-label="结果数量"]').setValue(count);
  await wrapper.get("form").trigger("submit"); expect(API.post).not.toHaveBeenCalled(); expect(wrapper.text()).toContain("1-20");
});
test("unconfirmed drafts and unavailable engines block requests", async () => {
  const { wrapper } = await setup(); await setReactionDraft(wrapper, { pending: true });
  await wrapper.get("form").trigger("submit"); expect(API.post).not.toHaveBeenCalled();
  const other = await setup({ tab: "forward", reactants: "CCO" }, ["conditions"]);
  await other.wrapper.get("form").trigger("submit"); expect(API.post).not.toHaveBeenCalled();
});
test("API errors, malformed output and navigation failure stay explicit", async () => {
  const { wrapper, router } = await setup(); API.post.mockRejectedValue(new Error('{"detail":"模型暂不可用。"}'));
  await wrapper.get("form").trigger("submit"); await flushPromises(); expect(wrapper.get('[role="alert"]').text()).toContain("模型暂不可用");
  API.post.mockResolvedValue({ ...condition, model: "invalid" }); await wrapper.get("form").trigger("submit"); await flushPromises(); expect(router.push).not.toHaveBeenCalled();
  API.post.mockResolvedValue(condition); router.push.mockRejectedValue(new Error("navigation failed"));
  await wrapper.get("form").trigger("submit"); await flushPromises(); expect(wrapper.get('[role="alert"]').text()).toContain("结果已保存");
  expect(wrapper.get('a[href="/analyses/condition-record"]').text()).toBe("打开已保存的结果");
});

test("a late parsed link cannot overwrite a newly restored record", async () => {
  let finish;
  const parser = jest.spyOn(require("@/common/ketcher-reaction"), "parseReactionText")
    .mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  const { wrapper, route } = await setup({ tab: "forward", rxnsmiles: "CCO>>CC=O" });
  API.get.mockResolvedValue({ id: "saved-forward", kind: "forward", status: "completed", created: "2026-10-08T00:00:00Z",
    inputs: { reactants: "CCN", count: 3 }, result: {} });
  route.query = { tab: "forward", record: "saved-forward" }; await flushPromises();
  finish({ reactants: [{ smiles: "CCO" }] }); await flushPromises();
  expect(wrapper.get('textarea[aria-label="反应物"]').element.value).toBe("CCN");
  expect(wrapper.get('[aria-label="结果数量"]').element.value).toBe("3");
  expect(API.post).not.toHaveBeenCalled();
  parser.mockRestore();
});
test("honest zero-candidate predictions still have a saved result without fabricated rows", async () => {
  const { wrapper, router } = await setup({ tab: "forward", reactants: "CCO" }); API.post.mockResolvedValue({ ...forward, products: [] });
  await wrapper.get("form").trigger("submit"); await flushPromises(); expect(router.push).toHaveBeenCalledTimes(1); expect(wrapper.find("table").exists()).toBe(false);
});
test.each([{ rxnsmiles: ["CCO>>CC=O"] }, { reaction_smiles: "CCO>>CC=O", rxnsmiles: "CCN>>CC=N" }, { reactants: ["CCO"], product: "CC=O" }])("ambiguous link seeds never become model input", async (query) => {
  const { wrapper } = await setup({ tab: "context", ...query });
  await wrapper.get("form").trigger("submit"); expect(API.post).not.toHaveBeenCalled(); expect(wrapper.find('[role="alert"]').exists()).toBe(true);
});
