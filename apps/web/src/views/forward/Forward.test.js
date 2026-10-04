import { defineComponent, nextTick, reactive, ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { useRoute, useRouter } from "vue-router";
import { API } from "@/common/api";
import { useWorkspaceStore } from "@/store/workspace";
import Forward from "./Forward.vue";

jest.mock("vue-router", () => ({ useRoute: jest.fn(), useRouter: jest.fn() }));
jest.mock("@/common/api", () => ({ API: { post: jest.fn(), get: jest.fn() } }));
jest.mock("@/store/workspace", () => ({ useWorkspaceStore: jest.fn() }));
jest.mock("vuetify-use-dialog", () => ({ useConfirm: () => jest.fn().mockResolvedValue(true) }));
jest.mock("file-saver", () => ({ saveAs: jest.fn() }));
jest.mock("@/components/SmilesImage.vue", () => ({
  name: "SmilesImage", props: ["smiles"], template: '<span class="rendered-smiles">{{ smiles }}</span>',
}));
jest.mock("@/components/workspace/StructureInput.vue", () => ({ name: "StructureInput", template: "<div />" }));

const structureInput = defineComponent({
  name: "StructureInput",
  props: ["modelValue", "label", "id", "disabled"], emits: ["update:modelValue"],
  setup(_, { expose }) { const pending = ref(false); expose({ pending }); return { pending }; },
  template: `<div><textarea :id="id" :aria-label="label" :value="modelValue" :disabled="disabled"
    @input="$emit('update:modelValue', $event.target.value)" />
    <button type="button" class="draft" @click="pending = !pending">Draft</button></div>`,
});
const stubs = {
  ModuleWorkbench: {
    props: ["title", "modules", "activeModule"], emits: ["select-module"],
    template: `<section><h1>{{ title }}</h1><slot name="actions" />
      <div class="modules"><button v-for="item in modules" :key="item.value" type="button"
        @click="$emit('select-module', item.value)">{{ item.title }}</button></div><slot /></section>`,
  },
  StructureInput: structureInput,
  VBtn: { props: ["disabled", "loading", "type"],
    template: '<button :type="type || \'button\'" :disabled="disabled || loading"><slot /></button>' },
  VTextField: { props: ["modelValue", "label", "disabled", "errorMessages"], emits: ["update:modelValue"],
    template: `<label>{{ label }}<input :value="modelValue" :disabled="disabled" :aria-label="label"
      @input="$emit('update:modelValue', $event.target.value)" /><span>{{ errorMessages }}</span></label>` },
  VTooltip: { template: '<span><slot name="activator" :props="{}" /></span>' },
  VIcon: true, VProgressLinear: true,
};
const wrappers = [];
const conditions = {
  reactants: "CCO", product: "CC=O", conditions: [{ temperature: 25, solvent: "O", reagent: "", catalyst: "", score: 0.1 }],
  model: "nn_v1", asset_identity: "a".repeat(64), evidence_type: "model_prediction",
  record_id: "unit-condition-record",
};
const products = {
  reactants: "CCO", products: [{ product: "CC=O", log_probability: -2.5, feasibility_score: 0.7 }],
  model: "graph2smiles_uspto_stereo", asset_identity: "b".repeat(64), evidence_type: "model_prediction",
  record_id: "unit-forward-record",
};
async function setup(query = { tab: "context", reactants: "CCO", product: "CC=O" }, features = ["conditions", "fast_filter"]) {
  const route = reactive({ path: "/forward", query });
  const router = { replace: jest.fn(async (value) => { route.query = value.query; }) };
  useRoute.mockReturnValue(route);
  useRouter.mockReturnValue(router);
  useWorkspaceStore.mockReturnValue({ can: (feature) => features.includes(feature) });
  API.get.mockResolvedValue({ modules: [] });
  const wrapper = mount(Forward, { global: { stubs } });
  wrappers.push(wrapper);
  await flushPromises();
  return { wrapper, route, router };
}
beforeEach(() => { API.post.mockReset(); API.get.mockReset(); });
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

test("conditions-only workspace has an accurate title, no unavailable controls, and no auto prediction", async () => {
  const { wrapper } = await setup();
  expect(wrapper.get("h1").text()).toBe("反应条件预测");
  expect(wrapper.get("#forward-reactants").element.value).toBe("CCO");
  expect(wrapper.get("#forward-product").element.value).toBe("CC=O");
  expect(wrapper.findAll(".modules button")).toHaveLength(0);
  expect(wrapper.text()).not.toMatch(/QUARC|杂质|wldn5|Pistachio/);
  expect(API.post).not.toHaveBeenCalled();
  expect(API.get).not.toHaveBeenCalled();
});
test("one condition submit owns one request and shows real response fields", async () => {
  const { wrapper } = await setup();
  let finish;
  API.post.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  await wrapper.get("form").trigger("submit");
  expect(wrapper.get('[data-cy="submit-button"]').element.disabled).toBe(true);
  await wrapper.get("form").trigger("submit");
  expect(API.post).toHaveBeenCalledTimes(1);
  expect(API.post.mock.calls[0]).toEqual(["/api/v1/conditions/predict", { reactants: "CCO", product: "CC=O", count: 10 }]);
  finish(conditions);
  await flushPromises();
  expect(wrapper.get('[data-cy="condition-table"]').text()).toContain("25.0");
  expect(wrapper.get('[data-cy="submit-button"]').element.disabled).toBe(false);
});
test("changing input clears candidates, FF evidence, and errors; URL prefill stays manual", async () => {
  const { wrapper, route } = await setup();
  API.post.mockResolvedValueOnce(conditions).mockResolvedValueOnce({ result: 0.3 });
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  await wrapper.get('[data-cy="evaluate-reaction"]').trigger("click");
  await flushPromises();
  expect(wrapper.text()).toContain("FF）：0.300");
  route.query = { tab: "context", rxnsmiles: "CCN>O>CC=N" };
  await nextTick();
  expect(wrapper.get("#forward-reactants").element.value).toBe("CCN");
  expect(wrapper.get("#forward-product").element.value).toBe("CC=N");
  expect(wrapper.find('[data-cy="condition-table"]').exists()).toBe(false);
  expect(wrapper.text()).not.toContain("FF）：0.300");
  expect(API.post).toHaveBeenCalledTimes(2);
});
test("unconfirmed structure drafts prevent submit and invalidate old results", async () => {
  const { wrapper } = await setup();
  API.post.mockResolvedValue(conditions);
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  await wrapper.get(".draft").trigger("click");
  expect(wrapper.get('[data-cy="submit-button"]').element.disabled).toBe(true);
  expect(wrapper.find('[data-cy="condition-table"]').exists()).toBe(false);
  await wrapper.get("form").trigger("submit");
  expect(API.post).toHaveBeenCalledTimes(1);
});
test("invalid counts visibly block submit without a model call", async () => {
  const { wrapper } = await setup();
  await wrapper.get('[data-cy="settings-num-results"] input').setValue("21");
  expect(wrapper.get('[data-cy="submit-button"]').element.disabled).toBe(true);
  expect(wrapper.text()).toContain("1-20");
  await wrapper.get("form").trigger("submit");
  expect(API.post).not.toHaveBeenCalled();
});
test("API failure is visible, recovers on explicit retry, and clears on input edits", async () => {
  const { wrapper } = await setup();
  API.post.mockRejectedValueOnce(new Error('{"detail":"无法解析反应物或产物结构。"}'));
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toContain("无法解析");
  expect(wrapper.text()).toContain("条件预测未完成");
  API.post.mockResolvedValue(conditions);
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  await wrapper.get("#forward-product").setValue("O");
  expect(wrapper.find('[data-cy="condition-table"]').exists()).toBe(false);
});
test("a late FF score cannot attach to a different reaction", async () => {
  const { wrapper, route } = await setup();
  API.post.mockResolvedValueOnce(conditions);
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  let finish;
  API.post.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  await wrapper.get('[data-cy="evaluate-reaction"]').trigger("click");
  route.query = { tab: "context", reactants: "O", product: "O" };
  await nextTick();
  finish({ result: 0.8 });
  await flushPromises();
  expect(wrapper.text()).not.toContain("0.800");
});
test("ready forward mode uses only the new endpoint and distinct finite score columns", async () => {
  const { wrapper } = await setup({ tab: "forward", reactants: "CCO" }, ["conditions", "forward", "fast_filter"]);
  expect(wrapper.get("h1").text()).toBe("产物预测");
  expect(wrapper.find("#forward-product").exists()).toBe(false);
  expect(wrapper.find("#forward-reagents").exists()).toBe(false);
  expect(API.post).not.toHaveBeenCalled();
  expect(API.get).not.toHaveBeenCalled();
  API.post.mockResolvedValue(products);
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(API.post.mock.calls).toEqual([["/api/v1/reactions/predict", { reactants: "CCO", count: 5 }]]);
  const table = wrapper.get('[data-cy="forward-product-table"]');
  expect(table.text()).toContain("序列对数评分");
  expect(table.text()).toContain("反应模型评分（FF）");
  expect(table.text()).toContain("-2.5000");
  expect(table.text()).toContain("0.7000");
  expect(wrapper.text()).not.toMatch(/验证通过|实验|预测杂质/);
  expect(wrapper.get('[data-cy="forward-record-link"]').attributes("to")).toBe("/analyses/unit-forward-record");
});
test("parent navigation changes the URL mode without duplicate local tabs or auto prediction", async () => {
  const { wrapper, route } = await setup(undefined, ["conditions", "forward", "fast_filter"]);
  API.post.mockResolvedValue(conditions);
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(wrapper.findAll(".modules button")).toHaveLength(0);
  route.query = { ...route.query, tab: "forward" };
  await flushPromises();
  expect(wrapper.get("h1").text()).toBe("产物预测");
  expect(wrapper.find("table").exists()).toBe(false);
  expect(wrapper.find('[data-cy="forward-record-link"]').exists()).toBe(false);
  expect(API.post).toHaveBeenCalledTimes(1);
});
test("forward empty candidates are not fabricated and edits reset that state", async () => {
  const { wrapper } = await setup({ tab: "forward", reactants: "CCO" }, ["forward"]);
  API.post.mockResolvedValue({ ...products, products: [] });
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(wrapper.text()).toContain("未返回产物候选");
  expect(wrapper.find("table").exists()).toBe(false);
  expect(wrapper.get('[data-cy="forward-record-link"]').attributes("to")).toBe("/analyses/unit-forward-record");
  await wrapper.get("#forward-reactants").setValue("O");
  expect(wrapper.text()).toContain("暂无产物候选");
});
